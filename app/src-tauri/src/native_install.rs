//! Native installation owns the embedded backend, login service and CUPS queue.
use crate::{
    native_service::{config_path, health, ServiceConfig},
    native_wire,
};
use std::{
    fs,
    io::{IsTerminal, Write},
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};
const BACKEND: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/printatsoc-backend"));
const PPD: &str = include_str!("../resources/printatsoc.ppd");
const LABEL: &str = "tech.silan.PrintAtSoC.print-service";
fn backend_path() -> &'static str {
    if cfg!(target_os = "macos") {
        "/usr/libexec/cups/backend/printatsoc"
    } else {
        "/usr/lib/cups/backend/printatsoc"
    }
}
fn checked(command: &mut Command) -> Result<String, String> {
    let result = command.output().map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&result.stdout).into_owned())
}
fn root() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|p| p.join(".PrintAtSoC/native-runtime"))
        .ok_or("Home unavailable".into())
}
fn agent_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Home unavailable")?;
    Ok(if cfg!(target_os = "macos") {
        home.join(format!("Library/LaunchAgents/{LABEL}.plist"))
    } else {
        home.join(format!(".config/systemd/user/{LABEL}.service"))
    })
}
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
fn private_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid destination")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(data).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn sudo(args: &[&str]) -> Result<String, String> {
    checked(Command::new("sudo").arg("-n").args(args))
}
#[derive(Debug)]
struct Options {
    name: String,
    printer: String,
    paper: String,
    duplex: String,
    dry: bool,
    yes: bool,
    interactive: bool,
    plain: bool,
}
impl Options {
    fn parse(args: &[String]) -> Result<Self, String> {
        let mut result = Self {
            name: "PrintAtSoC".into(),
            printer: "psts-dx".into(),
            paper: "A4".into(),
            duplex: "DuplexNoTumble".into(),
            dry: false,
            yes: false,
            interactive: std::io::stdin().is_terminal() && std::io::stdout().is_terminal(),
            plain: std::env::var_os("NO_COLOR").is_some(),
        };
        let mut args = args.iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--dry-run" => result.dry=true, "--yes" => result.yes=true, "--plain" => result.plain=true, "--non-interactive" => result.interactive=false,
                "--name" => result.name=args.next().ok_or("Missing queue name")?.clone(),
                "--printer" => result.printer=args.next().ok_or("Missing remote queue")?.clone(),
                "--paper-size" => result.paper=args.next().ok_or("Missing paper size")?.to_uppercase(),
                "--duplex" => result.duplex=match args.next().ok_or("Missing duplex mode")?.as_str() { "simplex"=>"None", "duplex-short-edge"=>"DuplexTumble", "duplex"|"duplex-long-edge"=>"DuplexNoTumble", _=>return Err("Invalid duplex mode".into()) }.into(),
                "--keep-config" | "--system-config" | "--no-scale" => {},
                "--username"|"--host"|"--port"|"--display-name"|"--location" => { args.next().ok_or("Missing argument value")?; },
                _ => return Err(format!("Unsupported option {arg}. Use --printer, --paper-size, --duplex, --dry-run, --plain or --non-interactive. Account settings belong to the shared desktop account.")),
            }
        }
        crate::ssh_service::validate_print_queue_name(&result.name)?;
        crate::ssh_service::validate_print_queue_name(&result.printer)?;
        if !["A4", "A3"].contains(&result.paper.as_str()) {
            return Err("Only A4 and A3 are supported".into());
        }
        Ok(result)
    }
}
fn select(prompt: &str, choices: &[&str], default: usize, plain: bool) -> Result<usize, String> {
    if !plain {
        return dialoguer::Select::new()
            .with_prompt(prompt)
            .items(choices)
            .default(default)
            .interact()
            .map_err(|e| e.to_string());
    }
    println!("{prompt}");
    for (index, choice) in choices.iter().enumerate() {
        println!("  {}. {choice}", index + 1);
    }
    loop {
        print!("Choice [{}]: ", default + 1);
        std::io::stdout().flush().map_err(|e| e.to_string())?;
        let mut line = String::new();
        if std::io::stdin()
            .read_line(&mut line)
            .map_err(|e| e.to_string())?
            == 0
        {
            return Err("Input closed; setup cancelled".into());
        }
        if line.trim().is_empty() {
            return Ok(default);
        }
        if let Ok(value) = line.trim().parse::<usize>() {
            if (1..=choices.len()).contains(&value) {
                return Ok(value - 1);
            }
        }
        println!("Enter a number from 1 to {}.", choices.len());
    }
}
struct Stage(indicatif::ProgressBar);
impl Stage {
    fn new(label: &str, plain: bool) -> Self {
        eprintln!("{label}");
        let bar = if plain {
            indicatif::ProgressBar::hidden()
        } else {
            indicatif::ProgressBar::new_spinner()
        };
        bar.set_style(indicatif::ProgressStyle::with_template("{spinner:.cyan} {msg}").unwrap());
        bar.set_message(label.to_string());
        bar.enable_steady_tick(Duration::from_millis(90));
        Self(bar)
    }
}
impl Drop for Stage {
    fn drop(&mut self) {
        self.0.finish_and_clear();
    }
}
fn start_service(config: &ServiceConfig) -> Result<(), String> {
    let runtime = root()?;
    fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
    // AppImage retains its bundled libraries. On macOS the executable depends
    // only on OS frameworks; OpenSSL is statically linked by Cargo.
    let source = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .unwrap_or(std::env::current_exe().map_err(|e| e.to_string())?);
    let destination = runtime.join("print-service");
    if source != destination {
        let temporary = runtime.join(format!(".stage-{}", uuid::Uuid::new_v4()));
        fs::copy(source, &temporary).map_err(|e| e.to_string())?;
        executable(&temporary)?;
        fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
    }
    private_write(
        &config_path()?,
        &serde_json::to_vec(config).map_err(|e| e.to_string())?,
    )?;
    let agent = agent_path()?;
    if cfg!(target_os = "macos") {
        #[cfg(unix)]
        let domain = format!("gui/{}", unsafe { libc::getuid() });
        #[cfg(not(unix))]
        let domain = String::new();
        let _ = Command::new("launchctl")
            .args(["bootout", &format!("{domain}/tech.silan.PrintAtSoC.relay")])
            .output();
        let _ = Command::new("launchctl")
            .args(["bootout", &format!("{domain}/{LABEL}")])
            .output();
        private_write(&agent,format!("<?xml version=\"1.0\"?><!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\"><plist version=\"1.0\"><dict><key>Label</key><string>{LABEL}</string><key>ProgramArguments</key><array><string>{}</string><string>--native-print-service</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>",xml(&destination.to_string_lossy())).as_bytes())?;
        checked(
            Command::new("launchctl")
                .args(["bootstrap", &domain])
                .arg(&agent),
        )?;
    } else {
        let _ = Command::new("systemctl")
            .args([
                "--user",
                "disable",
                "--now",
                "tech.silan.PrintAtSoC.relay.service",
            ])
            .output();
        let executable = destination
            .to_string_lossy()
            .replace('%', "%%")
            .replace('"', "\\\"");
        private_write(&agent,format!("[Unit]\nDescription=Print@SoC native printing\n[Service]\nExecStart=\"{executable}\" --native-print-service\nRestart=on-failure\n[Install]\nWantedBy=default.target\n").as_bytes())?;
        checked(Command::new("systemctl").args(["--user", "daemon-reload"]))?;
        checked(Command::new("systemctl").args([
            "--user",
            "enable",
            "--now",
            &format!("{LABEL}.service"),
        ]))?;
        checked(Command::new("systemctl").args([
            "--user",
            "restart",
            &format!("{LABEL}.service"),
        ]))?;
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if health(config) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("Native login service did not start. Check port 18631 and rerun installation. No test page was sent.".into())
}
pub fn install(args: &[String]) -> Result<(), String> {
    if !cfg!(unix) {
        return Err("System printer installation supports macOS/Linux CUPS".into());
    }
    let mut options = Options::parse(args)?;
    if let Ok(bytes) = fs::read(config_path()?) {
        if let Ok(previous) = serde_json::from_slice::<ServiceConfig>(&bytes) {
            if !args.iter().any(|arg| arg == "--printer") {
                options.printer = previous.printer;
            }
            if !args.iter().any(|arg| arg == "--paper-size") {
                options.paper = previous.paper;
            }
            if !args.iter().any(|arg| arg == "--duplex") {
                options.duplex = previous.duplex;
            }
        }
    }
    println!("\nPrint@SoC · Native system printer setup\nRust backend → Rust print service → shared GUI job history\n");
    let account=crate::account_service::account_current(None).data.flatten().ok_or("Save the shared account in desktop Settings first; no Python or separate driver password is needed.")?;
    for pair in args.windows(2) {
        let expected = match pair[0].as_str() {
            "--username" => Some(account.username.clone()),
            "--host" => Some(account.host.clone()),
            "--port" => Some(account.port.to_string()),
            _ => None,
        };
        if expected.is_some_and(|expected| expected != pair[1]) {
            return Err("The requested account differs from the saved shared account. Save account changes in desktop Settings first.".into());
        }
    }
    let devices = checked(Command::new("lpstat").arg("-v")).or_else(|error| {
        if error.contains("No destinations added") {
            Ok(String::new())
        } else {
            Err(error)
        }
    })?;
    for line in devices.lines() {
        if line.starts_with(&format!("device for {}:", options.name))
            && !line.contains("printatsoc:")
        {
            return Err(
                "That local queue belongs to another printer. Choose another --name.".into(),
            );
        }
    }
    if devices
        .lines()
        .any(|line| line.starts_with(&format!("device for {}:", options.name)))
    {
        if !checked(Command::new("lpstat").args(["-o", &options.name]))?
            .trim()
            .is_empty()
        {
            return Err(
                "Finish or cancel pending CUPS jobs before repairing the native driver.".into(),
            );
        }
    }
    if options.interactive && !options.yes {
        options.printer = dialoguer::Input::new()
            .with_prompt("Remote SoC queue")
            .default(options.printer.clone())
            .validate_with(|value: &String| crate::ssh_service::validate_print_queue_name(value))
            .interact_text()
            .map_err(|e| e.to_string())?;
        let sizes = ["A4", "A3"];
        options.paper = sizes[select(
            "Paper size",
            &sizes,
            usize::from(options.paper == "A3"),
            options.plain,
        )?]
        .into();
        let choices = [
            "Two-sided · long edge",
            "Two-sided · short edge",
            "One-sided",
        ];
        let selected = select(
            "Print sides",
            &choices,
            match options.duplex.as_str() {
                "DuplexTumble" => 1,
                "None" => 2,
                _ => 0,
            },
            options.plain,
        )?;
        options.duplex = ["DuplexNoTumble", "DuplexTumble", "None"][selected].into();
    }
    options.printer = crate::ssh_service::queue_for_duplex_mode(&options.printer, options.duplex == "None")?;
    println!("Local queue: {}\nRemote queue: {}\nDefaults: {} / {}\nNo document is printed during setup.",options.name,options.printer,options.paper,options.duplex);
    if options.dry {
        println!("Preview complete. No service, printer or credentials were changed.");
        return Ok(());
    }
    if options.interactive
        && !options.yes
        && !dialoguer::Confirm::new()
            .with_prompt("Install / repair this system printer?")
            .default(true)
            .interact()
            .map_err(|e| e.to_string())?
    {
        println!("Cancelled; no system changes.");
        return Ok(());
    }
    eprintln!("[1/4] Administrator authentication (your Mac/Linux password, not the SoC password)");
    let mut auth = Command::new("sudo");
    if !options.interactive {
        auth.arg("-n");
    }
    auth.arg("-v");
    if !auth.status().map_err(|e| e.to_string())?.success() {
        return Err("Administrator authentication required. Run this setup in your terminal; no system changes were made.".into());
    }
    let config = ServiceConfig {
        token: format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        ),
        port: native_wire::PORT,
        printer: options.printer,
        paper: options.paper.clone(),
        duplex: options.duplex.clone(),
    };
    {
        let _stage = Stage::new("[2/4] Starting the Rust login service", options.plain);
        start_service(&config)?;
    }
    let staging = tempfile::tempdir().map_err(|e| e.to_string())?;
    let backend = staging.path().join("printatsoc");
    private_write(&backend, BACKEND)?;
    executable(&backend)?;
    checked(Command::new(&backend).arg("--self-test"))?;
    let ppd = staging.path().join("printer.ppd");
    private_write(&ppd, PPD.as_bytes())?;
    let connection = staging.path().join("native.conf");
    private_write(
        &connection,
        format!("{}\n{}\n", config.token, config.port).as_bytes(),
    )?;
    let receipt = staging.path().join("status.json");
    private_write(
        &receipt,
        b"{\"configured\":true,\"account_source\":\"native-rust-v1\"}",
    )?;
    {
        let _stage = Stage::new(
            "[3/4] Installing embedded backend and registering CUPS",
            options.plain,
        );
        sudo(&[
            "mkdir",
            "-p",
            "/etc/print-at-soc",
            Path::new(backend_path())
                .parent()
                .unwrap()
                .to_str()
                .unwrap(),
        ])?;
        for (source, destination, mode) in [
            (&backend, backend_path(), "0500"),
            (&connection, native_wire::CONFIG, "0600"),
            (&receipt, "/etc/print-at-soc/status.json", "0644"),
        ] {
            sudo(&[
                "install",
                "-o",
                "root",
                "-m",
                mode,
                source.to_str().unwrap(),
                destination,
            ])?;
        }
        sudo(&[
            "lpadmin",
            "-p",
            &options.name,
            "-E",
            "-v",
            "printatsoc://default",
            "-P",
            ppd.to_str().unwrap(),
            "-D",
            "Print@SoC Virtual Printer",
            "-o",
            "printer-error-policy=abort-job",
            "-o",
            &format!("PageSize={}", options.paper),
            "-o",
            &format!("Duplex={}", options.duplex),
        ])?;
        sudo(&["cupsaccept", &options.name])?;
        sudo(&["cupsenable", &options.name])?;
    }
    checked(Command::new("lpstat").args(["-v", &options.name]))?;
    // Retire the old Python credential snapshot only after native registration.
    sudo(&[
        "rm",
        "-f",
        "/etc/print-at-soc/virtual-printer.json",
        "/etc/print-at-soc/ssh_key",
    ])?;
    let old_runtime = if cfg!(target_os = "macos") {
        "/Library/Application Support/PrintAtSoC/cups"
    } else {
        "/usr/local/lib/print-at-soc/cups"
    };
    sudo(&["rm", "-rf", old_runtime])?;
    if let Some(home) = dirs::home_dir() {
        for path in [
            home.join(".PrintAtSoC/relay.json"),
            home.join("Library/LaunchAgents/tech.silan.PrintAtSoC.relay.plist"),
            home.join(".config/systemd/user/tech.silan.PrintAtSoC.relay.service"),
        ] {
            if path.exists() {
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
    }
    println!("[4/4] Native system printer ready. Use Command/Ctrl+P → Print@SoC Virtual Printer.\nJobs and spool-PDF previews appear in desktop Print history. Stay logged in and connected to NUS/VPN.\nRemote/physical printing is not tested by installation. Rerun setup to repair; use --uninstall-system-printer to remove.");
    Ok(())
}
/// Read-only inspection shared by CLI and agents; never return the service token.
pub(crate) fn inspect() -> Result<serde_json::Value, String> {
    let path = config_path()?;
    let config = if path.exists() {
        Some(serde_json::from_slice::<ServiceConfig>(&fs::read(path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?)
    } else { None };
    let mut result = serde_json::json!({"configured":config.is_some(),"service_running":config.as_ref().is_some_and(health),"backend_installed":cfg!(unix) && Path::new(backend_path()).is_file(),"local_queues":[]});
    if let Some(config) = config {
        result["printer"] = serde_json::json!(config.printer);
        result["paper_size"] = serde_json::json!(config.paper);
        result["duplex"] = serde_json::json!(config.duplex);
    }
    if cfg!(unix) {
        match checked(Command::new("lpstat").arg("-v")) {
            Ok(output) => result["local_queues"] = serde_json::json!(output.lines().filter_map(|line| {
                let (name, uri) = line.split_once(": ")?;
                uri.starts_with("printatsoc:").then(||name.rsplit(' ').next().unwrap_or(name).to_string())
            }).collect::<Vec<_>>()),
            Err(error) if error.contains("No destinations added") => {},
            Err(error) => result["inspection_error"] = serde_json::json!(error),
        }
    }
    Ok(result)
}
pub fn status() -> Result<(), String> {
    let config: ServiceConfig =
        serde_json::from_slice(&fs::read(config_path()?).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    println!(
        "Rust service running: {}\nNative backend installed: {}",
        health(&config),
        Path::new(backend_path()).exists()
    );
    Ok(())
}
pub fn uninstall(args: &[String]) -> Result<(), String> {
    let options = Options::parse(args)?;
    println!("Remove local queue {}, native backend and user service. Shared account and history are retained.",options.name);
    if options.dry {
        return Ok(());
    }
    let pending = checked(Command::new("lpstat").args(["-o", &options.name]))?;
    if !pending.trim().is_empty() {
        return Err("Finish or cancel pending CUPS jobs before removal".into());
    }
    let devices = checked(Command::new("lpstat").arg("-v"))?;
    if devices.lines().any(|line| {
        line.starts_with(&format!("device for {}:", options.name)) && !line.contains("printatsoc:")
    }) {
        return Err("Queue belongs to another printer".into());
    }
    if options.interactive
        && !options.yes
        && !dialoguer::Confirm::new()
            .with_prompt("Remove this system printer?")
            .default(false)
            .interact()
            .map_err(|e| e.to_string())?
    {
        return Ok(());
    }
    let mut auth = Command::new("sudo");
    if !options.interactive {
        auth.arg("-n");
    }
    if !auth
        .arg("-v")
        .status()
        .map_err(|e| e.to_string())?
        .success()
    {
        return Err("Administrator authentication required".into());
    }
    sudo(&["lpadmin", "-x", &options.name])?;
    if checked(Command::new("lpstat").arg("-v"))
        .or_else(|error| {
            if error.contains("No destinations added") {
                Ok(String::new())
            } else {
                Err(error)
            }
        })?
        .contains("printatsoc:")
    {
        return Ok(());
    }
    if cfg!(target_os = "macos") {
        #[cfg(unix)]
        {
            let _ = Command::new("launchctl")
                .args([
                    "bootout",
                    &format!("gui/{}/{LABEL}", unsafe { libc::getuid() }),
                ])
                .output();
        }
    } else {
        checked(Command::new("systemctl").args([
            "--user",
            "disable",
            "--now",
            &format!("{LABEL}.service"),
        ]))?;
    }
    for path in [agent_path()?, config_path()?] {
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    if root()?.exists() {
        fs::remove_dir_all(root()?).map_err(|e| e.to_string())?;
    }
    sudo(&[
        "rm",
        "-f",
        backend_path(),
        native_wire::CONFIG,
        "/etc/print-at-soc/status.json",
    ])?;
    println!("Native printer removed; account and history retained.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn embedded_backend_runs_with_an_empty_environment_without_python_or_shell() {
        if !cfg!(unix) {
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        let backend = directory.path().join("backend");
        private_write(&backend, BACKEND).unwrap();
        executable(&backend).unwrap();
        let result = Command::new(&backend)
            .env_clear()
            .arg("--self-test")
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(String::from_utf8_lossy(&result.stdout).contains("native backend protocol 1"));
        let discovery = Command::new(&backend).env_clear().output().unwrap();
        assert!(discovery.status.success());
        assert!(String::from_utf8_lossy(&discovery.stdout).contains("printatsoc://default"));
    }
    #[test]
    fn installer_options_validate_before_any_privileged_action() {
        let args = |values: &[&str]| values.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let options = Options::parse(&args(&[
            "--dry-run",
            "--non-interactive",
            "--paper-size",
            "a3",
            "--duplex",
            "duplex-short-edge",
        ]))
        .unwrap();
        assert!(options.dry);
        assert!(!options.interactive);
        assert_eq!(options.paper, "A3");
        assert_eq!(options.duplex, "DuplexTumble");
        assert!(Options::parse(&args(&["--name", "../other"])).is_err());
        assert!(Options::parse(&args(&["--printer", "psts;rm"])).is_err());
        assert!(Options::parse(&args(&["--password", "secret"])).is_err());
        assert!(Options::parse(&args(&["--paper-size", "Letter"])).is_err());
        assert!(Options::parse(&args(&["--name"])).is_err());
    }
}
