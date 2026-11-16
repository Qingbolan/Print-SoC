//! Atomic remote attempt admission and durable lpr receipts. An incomplete
//! attempt is ambiguous and must never cause an automatic retry.
use crate::ssh_service::{execute_for_account, RemoteExit};
use crate::types::SubmissionAttempt;

const ROOT: &str = "\"$HOME/.local/state/print-at-soc/submissions\"";
const PENDING: &str = "PRINT_SOC_PENDING_V1";
const HEADER: &str = "PRINT_SOC_RECEIPT_V1";

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Receipt {
    pub code: i32,
    pub output: String,
}

fn validate(attempt: &SubmissionAttempt) -> Result<(), Box<dyn std::error::Error>> {
    uuid::Uuid::parse_str(&attempt.id)?;
    Ok(())
}

fn submission_script(root: &str, id: &str, command: &str) -> String {
    format!(
        r#"umask 077
root={root}
mkdir -p "$root" && chmod 700 "$root" || exit 70
dir="$root/{id}"
if mkdir "$dir" 2>/dev/null; then
  {command} > "$dir/output" 2>&1
  code=$?
  {{ printf '{HEADER}\n%s\n' "$code"; cat "$dir/output"; }} > "$dir/receipt.tmp" || exit 74
  mv "$dir/receipt.tmp" "$dir/receipt" || exit 74
fi
if test -f "$dir/receipt"; then cat "$dir/receipt"; else printf '{PENDING}\n'; fi"#
    )
}

fn parse(output: &str) -> Result<Option<Receipt>, Box<dyn std::error::Error>> {
    if output.trim() == PENDING {
        return Ok(None);
    }
    let rest = output
        .strip_prefix(&format!("{}\n", HEADER))
        .ok_or("Invalid submission receipt")?;
    let (code, output) = rest
        .split_once('\n')
        .ok_or("Incomplete submission receipt")?;
    let code: i32 = code.parse()?;
    if !(0..=255).contains(&code) {
        return Err("Invalid submission exit status".into());
    }
    Ok(Some(Receipt {
        code,
        output: output.to_owned(),
    }))
}

pub(crate) fn submit(
    attempt: &SubmissionAttempt,
    command: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    validate(attempt)?;
    // A shell failure may occur after lpr (e.g. disk full while writing the
    // receipt). Only an explicit complete receipt proves remote rejection.
    let output = execute_for_account(
        &attempt.account,
        &submission_script(ROOT, &attempt.id, command),
    )
    .map_err(|e| std::io::Error::other(e.to_string()))?;
    let receipt = parse(&output)?.ok_or("Submission is still pending or its result is unknown")?;
    if receipt.code != 0 {
        return Err(Box::new(RemoteExit {
            code: receipt.code,
            output: receipt.output,
        }));
    }
    Ok(receipt.output)
}

pub(crate) fn read(
    attempt: &SubmissionAttempt,
) -> Result<Option<Receipt>, Box<dyn std::error::Error>> {
    validate(attempt)?;
    let command = format!("root={ROOT}; file=\"$root/{}/receipt\"; if test -f \"$file\"; then cat \"$file\"; else printf '{PENDING}\\n'; fi", attempt.id);
    parse(&execute_for_account(&attempt.account, &command)?)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::ssh_service::shell_quote;
    use std::process::Command;

    #[test]
    fn same_attempt_never_prints_twice() {
        let dir = tempfile::tempdir().unwrap();
        let root = shell_quote(dir.path().to_str().unwrap());
        let counter = dir.path().join("invocations");
        let command = format!(
            "sh -c {}",
            shell_quote(&format!(
                "echo printed >> {}; echo 'request id is psts-123 (1 file(s))'",
                shell_quote(counter.to_str().unwrap())
            ))
        );
        let script = submission_script(&root, "attempt", &command);
        for _ in 0..2 {
            let output = Command::new("sh").args(["-c", &script]).output().unwrap();
            assert!(output.status.success());
            let receipt = parse(std::str::from_utf8(&output.stdout).unwrap())
                .unwrap()
                .unwrap();
            assert_eq!(receipt.code, 0);
            assert!(receipt.output.contains("psts-123"));
        }
        assert_eq!(std::fs::read_to_string(counter).unwrap(), "printed\n");
    }

    #[test]
    fn interrupted_attempt_never_reexecutes_and_rejection_is_retained() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("interrupted")).unwrap();
        let root = shell_quote(dir.path().to_str().unwrap());
        let script = submission_script(&root, "interrupted", "exit 99");
        let output = Command::new("sh").args(["-c", &script]).output().unwrap();
        assert!(output.status.success());
        assert_eq!(
            parse(std::str::from_utf8(&output.stdout).unwrap()).unwrap(),
            None
        );
        let script = submission_script(&root, "rejected", "sh -c 'echo queue-disabled; exit 1'");
        let output = Command::new("sh").args(["-c", &script]).output().unwrap();
        assert_eq!(
            parse(std::str::from_utf8(&output.stdout).unwrap()).unwrap(),
            Some(Receipt {
                code: 1,
                output: "queue-disabled\n".into()
            })
        );
        assert!(parse("broken response").is_err());
    }
}
