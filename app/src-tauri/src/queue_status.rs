//! Preserve queue diagnostics separately from parsed job rows.
use crate::types::*;
use chrono::Utc;

pub(crate) fn parse(output: &str) -> QueueSnapshot {
    let jobs = crate::ssh_service::parse_lpq_jobs(output);
    let lower = output.to_lowercase();
    let diagnostics: Vec<String> = output.lines().map(str::trim).filter(|line| {
        !line.is_empty() && !jobs.iter().any(|job| job.raw_line == *line)
    }).map(str::to_owned).collect();
    let status = if lower.contains("out of paper") || lower.contains("paper-out") || lower.contains("paper empty") {
        "OutOfPaper"
    } else if ["offline", "not responding", "unable to connect"].iter().any(|s| lower.contains(s)) {
        "Offline"
    } else if ["error", "disabled", "paused", "stalled", "jam", "not ready", "unknown printer", "no such printer"].iter().any(|s| lower.contains(s)) {
        "Error"
    } else if !jobs.is_empty() { "Busy" }
    else if lower.contains("is ready") || lower.contains("ready and printing") { "Online" }
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
        jobs_complete: (has_header || empty) && !unparsed_row && !matches!(status, "Error" | "Offline" | "OutOfPaper"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
