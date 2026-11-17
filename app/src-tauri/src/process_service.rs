//! Owns a local converter and its lifetime. Diagnostics go to a file so a noisy
//! converter cannot deadlock on a full stderr pipe or allocate unbounded memory.
use std::{
    io::{Read, Seek, SeekFrom},
    process::{Child, Command, ExitStatus, Stdio},
    time::{Duration, Instant},
};

struct ConverterProcess {
    child: Child,
    reaped: bool,
}
impl ConverterProcess {
    fn spawn(command: &mut Command) -> std::io::Result<Self> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        Ok(Self {
            child: command.spawn()?,
            reaped: false,
        })
    }
    fn stop(&mut self) {
        if self.reaped {
            return;
        }
        #[cfg(unix)]
        {
            // SAFETY: spawn created a new process group with the child's PID.
            // The unreaped child still owns that PID, so it cannot be reused.
            unsafe {
                libc::kill(-(self.child.id() as i32), libc::SIGKILL);
            }
        }
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/PID", &self.child.id().to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.reaped = true;
    }
}
impl Drop for ConverterProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

/// GUI launches do not inherit a terminal's shell initialization.
/// Give converters a deterministic search path, including their subprocesses.
pub(crate) fn converter_command(name: &str) -> Command {
    let mut directories: Vec<std::path::PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect()).unwrap_or_default();
    #[cfg(unix)]
    for directory in ["/opt/homebrew/bin", "/usr/local/bin", "/Library/TeX/texbin", "/usr/bin", "/bin"] {
        let path = std::path::PathBuf::from(directory);
        if !directories.contains(&path) { directories.push(path); }
    }
    let executable = directories.iter().map(|dir| dir.join(name)).find(|path| path.is_file())
        .unwrap_or_else(|| name.into());
    let mut command = Command::new(executable);
    if let Ok(path) = std::env::join_paths(directories) { command.env("PATH", path); }
    command
}

pub(crate) struct ProcessResult {
    pub status: ExitStatus,
    pub diagnostic: String,
}

pub(crate) fn run(
    command: &mut Command,
    timeout: Duration,
    cancelled: impl Fn() -> bool,
) -> Result<ProcessResult, String> {
    if cancelled() {
        return Err("Document preparation cancelled".into());
    }
    let mut diagnostic = tempfile::tempfile().map_err(|e| e.to_string())?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(diagnostic.try_clone().map_err(|e| e.to_string())?);
    let mut process = ConverterProcess::spawn(command).map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        // Check cancellation before accepting an exit status: cancelled work
        // must never cross into submission merely because it finished at once.
        if cancelled() {
            return Err("Document preparation cancelled".into());
        }
        if let Some(status) = process.child.try_wait().map_err(|e| e.to_string())? {
            process.reaped = true;
            diagnostic
                .seek(SeekFrom::Start(0))
                .map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            diagnostic
                .take(64 * 1024)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            return Ok(ProcessResult {
                status,
                diagnostic: String::from_utf8_lossy(&bytes).into_owned(),
            });
        }
        if started.elapsed() >= timeout {
            return Err(format!(
                "Document preparation timed out after {} seconds",
                timeout.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn noisy_failure_does_not_block_and_diagnostics_are_bounded() {
        let result = run(Command::new("sh").args(["-c", "i=0; while [ $i -lt 10000 ]; do echo 'diagnostic-line' >&2; i=$((i+1)); done; exit 3"]), Duration::from_secs(10), || false).unwrap();
        assert_eq!(result.status.code(), Some(3));
        assert_eq!(result.diagnostic.len(), 64 * 1024);
    }
    #[test]
    fn cancellation_terminates_descendants_too() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("descendant-pid");
        // Cancel after the descendant exists, independent of runner scheduling.
        let script = format!(
            "sleep 30 & child=$!; echo $child > {}; wait",
            crate::ssh_service::shell_quote(ready.to_str().unwrap())
        );
        let error = run(
            Command::new("sh").args(["-c", &script]),
            Duration::from_secs(10),
            || std::fs::read_to_string(&ready)
                .ok().and_then(|value| value.trim().parse::<u32>().ok()).is_some(),
        ).err().expect("ready descendant must trigger cancellation");
        assert!(error.contains("cancelled"), "{error}");
        let pid = std::fs::read_to_string(&ready).unwrap().trim().parse::<i32>().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let output = Command::new("ps").args(["-o", "stat=", "-p", &pid.to_string()])
                .output().unwrap();
            let state = String::from_utf8_lossy(&output.stdout);
            // A zombie is terminated and awaits the OS reaper.
            if state.trim().is_empty() || state.trim().starts_with('Z') {
                break;
            }
            if Instant::now() >= deadline {
                // Clean up the fixture even when group termination regresses.
                unsafe { libc::kill(pid, libc::SIGKILL); }
                panic!("descendant {pid} survived cancellation: {state}");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn timeout_and_cancel_stop_converters_without_waiting_for_normal_exit() {
        let start = Instant::now();
        let error = run(
            Command::new("sh").args(["-c", "sleep 30 & wait"]),
            Duration::from_millis(100),
            || false,
        )
        .err()
        .unwrap();
        assert!(error.contains("timed out"));
        assert!(start.elapsed() < Duration::from_secs(5));
        let start = Instant::now();
        let error = run(
            Command::new("sh").args(["-c", "sleep 30 & wait"]),
            Duration::from_secs(20),
            || start.elapsed() > Duration::from_millis(100),
        )
        .err()
        .unwrap();
        assert!(error.contains("cancelled"));
        assert!(start.elapsed() < Duration::from_secs(5));
    }
}
