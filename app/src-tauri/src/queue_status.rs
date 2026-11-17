//! Preserve queue diagnostics separately from parsed job rows.
use crate::types::*;
use chrono::Utc;

pub(crate) fn parse(output: &str) -> QueueSnapshot {
    let long_format = output.contains("[job ");
    let (jobs, blocks_complete) = if long_format { parse_long(output) }
        else { (crate::ssh_service::parse_lpq_jobs(output), true) };
    let lower = output.to_lowercase();
    let diagnostics: Vec<String> = output.lines().map(str::trim).filter(|line| {
        !line.is_empty() && !jobs.iter().any(|job| job.raw_line.lines().any(|raw| raw.trim() == *line))
    }).map(str::to_owned).collect();
    let health = diagnostics.join("\n").to_lowercase();
    let status = if health.contains("out of paper") || health.contains("paper-out") || health.contains("paper empty") {
        "OutOfPaper"
    } else if ["offline", "not responding", "unable to connect"].iter().any(|s| health.contains(s)) {
        "Offline"
    } else if ["error", "disabled", "paused", "stalled", "jam", "not ready", "unknown printer", "no such printer"].iter().any(|s| health.contains(s)) {
        "Error"
    } else if !jobs.is_empty() { "Busy" }
    else if health.contains("is ready") || health.contains("ready and printing") { "Online" }
    else { "Unknown" };
    // A successful command alone is not proof that all jobs have been parsed.
    let has_header = lower.lines().any(|line| line.contains("rank") && line.contains("owner") && line.contains("job"));
    let empty = lower.contains("no entries") || lower.contains("no printable jobs");
    let unparsed_row = diagnostics.iter().any(|line| {
        let token = line.split_whitespace().next().unwrap_or("");
        token.chars().next().is_some_and(|c| c.is_ascii_digit()) || token.eq_ignore_ascii_case("active") || token.eq_ignore_ascii_case("stalled")
    });
    QueueSnapshot {
        status: status.into(), jobs, diagnostics, raw_output: output.into(),
        checked_at: Utc::now(),
        jobs_complete: (has_header || empty || long_format) && blocks_complete && !unparsed_row && !matches!(status, "Error" | "Offline" | "OutOfPaper"),
    }
}

/// A long-format job is a header followed by one or more indented file rows.
/// Keep each file separately: one lpr invocation can contain several documents.
fn parse_long(output: &str) -> (Vec<PrintQueueJob>, bool) {
    let mut jobs = Vec::<PrintQueueJob>::new();
    let mut complete = true;
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.contains("[job ") {
            let header = (|| {
                let (owner, rest) = trimmed.split_once(':')?;
                let (rank, identifier) = rest.split_once("[job ")?;
                let identifier = identifier.strip_suffix(']')?;
                let digits = identifier.chars().take_while(|c| c.is_ascii_digit()).count();
                if digits == 0 || owner.is_empty() || !valid_rank(rank.trim()) { return None; }
                let id = identifier[..digits].parse::<u32>().ok()?.to_string();
                Some(PrintQueueJob { rank: rank.trim().into(), owner: owner.into(), job_id: id,
                    file: String::new(), total_size: None, raw_line: line.into(), files: vec![],
                    origin: (!identifier[digits..].is_empty()).then(|| identifier[digits..].into()) })
            })();
            if let Some(job) = header { jobs.push(job); } else { complete = false; }
        } else if line.starts_with(char::is_whitespace) && trimmed.ends_with(" bytes") {
            let fields = trimmed.rsplitn(3, char::is_whitespace).collect::<Vec<_>>();
            if fields.len() != 3 || fields[1].parse::<u64>().is_err() || fields[2].trim().is_empty() {
                complete = false; continue;
            }
            if let Some(job) = jobs.last_mut() {
                let path = fields[2].trim().to_string();
                if job.file.is_empty() { job.file = path.clone(); job.total_size = Some(format!("{} bytes", fields[1])); }
                job.files.push(path); job.raw_line.push('\n'); job.raw_line.push_str(line);
            } else { complete = false; }
        } else if !jobs.is_empty() && line.starts_with(char::is_whitespace) && !trimmed.is_empty() {
            // A truncated extra file must not make a partially parsed job list
            // authoritative for queue departure or position calculations.
            complete = false;
        }
    }
    complete &= jobs.iter().all(|job| !job.files.is_empty());
    let mut ids = std::collections::HashSet::new();
    complete &= jobs.iter().all(|job| ids.insert((job.owner.clone(),job.job_id.clone(),job.origin.clone())));
    (jobs, complete)
}
fn valid_rank(rank: &str) -> bool {
    rank == "active" || ["st", "nd", "rd", "th"].iter().any(|suffix|
        rank.strip_suffix(suffix).is_some_and(|value| value.parse::<u32>().is_ok_and(|n| n > 0)))
}

/// Positions are derived only from a complete ordered snapshot. Reject
/// contradictory rank sequences rather than inventing a number of jobs ahead.
pub(crate) fn position(snapshot: &QueueSnapshot, index: usize) -> Option<u32> {
    if !snapshot.jobs_complete { return None; }
    let mut previous = 0;
    for (i, job) in snapshot.jobs.iter().enumerate() {
        if job.rank == "active" { if i != 0 { return None; } }
        else {
            let n = job.rank.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse::<u32>().ok()?;
            if n <= previous { return None; } previous = n;
        }
    }
    (index < snapshot.jobs.len()).then_some(index as u32 + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn live_soc_long_format_preserves_identity_and_console_diagnostics() {
        let snapshot = parse(include_str!("../tests/fixtures/soc-lpq-long.txt"));
        assert!(snapshot.jobs_complete);
        assert_eq!(snapshot.jobs.len(), 1);
        let row = &snapshot.jobs[0];
        assert_eq!(row.job_id, "3");
        assert_eq!(row.owner, "alice");
        assert_eq!(row.origin.as_deref(), Some("stu1.comp.nus.edu.sg"));
        assert_eq!(row.files, vec!["/tmp/unique-attempt.pdf.scaled.pdf"]);
        assert_eq!(position(&snapshot, 0), Some(1));
        assert!(snapshot.diagnostics.iter().any(|line| line.contains("Printing page")));
    }
    #[test]
    fn long_blocks_support_multiple_files_and_reject_truncated_jobs() {
        let snapshot = parse("bob: active [job 001host]\n\t/tmp/a.pdf 10 bytes\nalice: 1st [job 002host]\n\t/tmp/b c.pdf 20 bytes\n\t/tmp/d.pdf 30 bytes\ncarol: 2nd [job 003host]\n\t/tmp/e.pdf 40 bytes\n");
        assert!(snapshot.jobs_complete);
        assert_eq!(snapshot.jobs[1].files.len(), 2);
        assert_eq!(snapshot.jobs[1].files[0], "/tmp/b c.pdf");
        assert_eq!(position(&snapshot, 2), Some(3));
        for bad in ["alice: active [job 003host]\n", "alice: active [job ?]\n\t/tmp/a.pdf 2 bytes", "alice: active [job 003host]\n\t/tmp/a.pdf invalid bytes", "alice: active [job 003host]\n\t/tmp/a.pdf 2 bytes\n\t/tmp/truncated.pdf"] {
            assert!(!parse(bad).jobs_complete);
        }
    }
    #[test]
    fn keeps_faults_in_empty_queue() {
        let snapshot = parse("printer: psts\nprinter is out of paper\nno entries\n");
        assert_eq!(snapshot.status, "OutOfPaper");
        assert!(!snapshot.jobs_complete);
        assert!(snapshot.raw_output.contains("out of paper"));
    }
    #[test]
    fn unknown_response_is_not_online_or_completed() {
        for response in ["", "server maintenance", "Rank Owner Job Files Total Size\nactive alice\n"] {
            let snapshot = parse(response);
            assert!(!snapshot.jobs_complete);
            assert_ne!(snapshot.status, "Online");
        }
        assert!(parse("no entries\n").jobs_complete);
        assert_eq!(parse("no entries\n").status, "Unknown");
    }
    #[test]
    fn parses_active_queue_without_discarding_diagnostics() {
        let snapshot = parse("psts is ready\nRank Owner Job Files Total Size\nactive alice 123 notes.pdf 1024 bytes\n");
        assert_eq!(snapshot.status, "Busy");
        assert_eq!(snapshot.jobs[0].job_id, "123");
        assert!(snapshot.jobs_complete);
    }
}
