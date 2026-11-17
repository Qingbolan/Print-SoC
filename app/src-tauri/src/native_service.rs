//! Login-session Rust print service. The backend carries a rendered spool PDF;
//! this service owns credentials and submits through the desktop's job lifecycle.
use crate::{native_wire as wire, types::*};
use std::{
    collections::BTreeMap,
    io::{BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    time::Duration,
};
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ServiceConfig {
    pub token: String,
    pub port: u16,
    pub printer: String,
    pub paper: String,
    pub duplex: String,
}
pub fn config_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|p| p.join(".PrintAtSoC/native-service.json"))
        .ok_or("Home unavailable".into())
}
pub fn dispatch(args: &[String]) -> Option<i32> {
    let command = args.first()?.as_str();
    if args.get(1).is_some_and(|arg| arg == "--help")
        && ["--install-system-printer", "--uninstall-system-printer"].contains(&command)
    {
        println!("Print@SoC native system printer
Options: --printer QUEUE --name LOCAL_QUEUE --paper-size A4|A3 --duplex simplex|duplex-long-edge|duplex-short-edge
         --dry-run --plain --yes --non-interactive
Save your account in desktop Settings. No Python, pip, Conda or local SSH executable is needed.");
        return Some(0);
    }
    let result = match command {
        "--native-print-service" => run(),
        "--install-system-printer" => crate::native_install::install(&args[1..]),
        "--uninstall-system-printer" => crate::native_install::uninstall(&args[1..]),
        "--native-printer-status" => crate::native_install::status(),
        "--native-driver-self-test" => {
            println!("PrintSoC Rust native driver protocol 1");
            Ok(())
        }
        _ => return None,
    };
    Some(match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Print@SoC: {error}");
            1
        }
    })
}
pub fn parse_options(text: &str) -> Result<BTreeMap<String, String>, String> {
    let mut tokens = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    for character in text.chars() {
        if escaped {
            word.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if let Some(q) = quote {
            if character == q {
                quote = None;
            } else {
                word.push(character);
            }
        } else if character == '\'' || character == '"' {
            quote = Some(character);
        } else if character.is_whitespace() {
            if !word.is_empty() {
                tokens.push(std::mem::take(&mut word));
            }
        } else {
            word.push(character);
        }
    }
    if escaped || quote.is_some() {
        return Err("Malformed native printing options".into());
    }
    if !word.is_empty() {
        tokens.push(word);
    }
    let allowed = [
        "media",
        "PageSize",
        "PageRegion",
        "sides",
        "Duplex",
        "orientation-requested",
        "landscape",
        "number-up",
        "number-up-layout",
        "page-ranges",
        "page-set",
        "fit-to-page",
        "scaling",
        "print-color-mode",
        "ColorModel",
        "collate",
        "Collate",
        "outputorder",
        "media-source",
        "InputSlot",
        "MediaType",
        "print-quality",
        "Resolution",
        "printer-resolution",
        "output-bin",
    ];
    Ok(tokens
        .into_iter()
        .filter_map(|token| {
            let (key, value) = token.split_once('=').unwrap_or((&token, "true"));
            allowed
                .contains(&key)
                .then(|| (key.to_string(), value.to_string()))
        })
        .collect())
}
fn paper(options: &BTreeMap<String, String>) -> Result<PaperSize, String> {
    let value = options
        .get("media")
        .or(options.get("PageSize"))
        .or(options.get("PageRegion"))
        .map(String::as_str)
        .unwrap_or("A4");
    match value
        .split(',')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "a4" | "iso_a4_210x297mm" => Ok(PaperSize::A4),
        "a3" | "iso_a3_297x420mm" => Ok(PaperSize::A3),
        _ => Err(format!(
            "Unsupported paper size {value}; this driver supports A4 and A3"
        )),
    }
}
pub fn physical_options(
    options: &BTreeMap<String, String>,
) -> Result<Vec<(String, String)>, String> {
    let mut output = vec![(
        "media".into(),
        match paper(options)? {
            PaperSize::A4 => "A4",
            PaperSize::A3 => "A3",
        }
        .into(),
    )];
    for (key, values) in [
        ("print-color-mode", &["auto", "color", "monochrome"][..]),
        ("ColorModel", &["Gray", "RGB", "CMYK"][..]),
        ("collate", &["true", "false"][..]),
        ("Collate", &["True", "False"][..]),
    ] {
        if (key == "ColorModel" && options.contains_key("print-color-mode"))
            || (key == "Collate" && options.contains_key("collate"))
        {
            continue;
        }
        if let Some(value) = options.get(key) {
            if !values.contains(&value.as_str()) {
                return Err(format!("Unsupported native option {key}={value}"));
            }
            output.push((key.into(), value.clone()));
        }
    }
    if let Some(media) = options.get("media").filter(|value| value.contains(',')) {
        output[0].1 = media.clone();
    }
    for key in [
        "media-source",
        "InputSlot",
        "MediaType",
        "print-quality",
        "Resolution",
        "printer-resolution",
        "output-bin",
    ] {
        if let Some(value) = options.get(key) {
            if value.is_empty()
                || value.len() > 128
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"-._".contains(&byte))
            {
                return Err(format!("Invalid physical option {key}"));
            }
            output.push((key.into(), value.clone()));
        }
    }
    Ok(output)
}
fn settings(
    copies: u32,
    options: &BTreeMap<String, String>,
    dimensions: (f64, f64),
) -> Result<PrintSettings, String> {
    let duplex = match options
        .get("sides")
        .or(options.get("Duplex"))
        .map(String::as_str)
        .unwrap_or("two-sided-long-edge")
    {
        "one-sided" | "None" => DuplexMode::Simplex,
        "two-sided-long-edge" | "DuplexNoTumble" => DuplexMode::DuplexLongEdge,
        "two-sided-short-edge" | "DuplexTumble" => DuplexMode::DuplexShortEdge,
        _ => return Err("Unsupported native duplex option".into()),
    };
    physical_options(options)?;
    Ok(PrintSettings {
        color_mode: ColorMode::Auto, scaling: ScalingMode::Fit,
        copies,
        duplex,
        orientation: if dimensions.0 > dimensions.1 {
            Orientation::Landscape
        } else {
            Orientation::Portrait
        },
        page_range: PageRange::All,
        pages_per_sheet: 1,
        booklet: false,
        paper_size: paper(options)?,
    })
}
/// pdftopdf can expand copies itself. Its preamble specifies the remaining
/// hardware copies/collation, which must override the original dialog count.
fn device_copies(
    prefix: &[u8],
    requested: u32,
    options: &mut BTreeMap<String, String>,
) -> Result<u32, String> {
    let mut copies = requested;
    options.insert("requested-copies".into(), requested.to_string());
    for line in String::from_utf8_lossy(prefix).lines().take(64) {
        if let Some(value) = line
            .strip_prefix("%%PDFTOPDFNumCopies")
            .and_then(|value| value.split_once(':').map(|(_, value)| value.trim()))
        {
            copies = value.parse().map_err(|_| "Invalid pdftopdf copy count")?;
            if !(1..=999).contains(&copies) {
                return Err("Invalid pdftopdf copy count".into());
            }
        }
        if let Some(value) = line
            .strip_prefix("%%PDFTOPDFCollate")
            .and_then(|value| value.split_once(':').map(|(_, value)| value.trim()))
        {
            if !["true", "false"].contains(&value) {
                return Err("Invalid pdftopdf collation".into());
            }
            if let Some(requested) = options
                .remove("Collate")
                .or_else(|| options.remove("collate"))
            {
                options.insert("requested-collate".into(), requested);
            }
            options.insert("collate".into(), value.into());
        }
    }
    options.insert("device-copies".into(), copies.to_string());
    Ok(copies)
}
fn account() -> Result<SSHConfig, String> {
    let response = crate::account_service::account_current(None);
    response.data.flatten().ok_or_else(|| {
        response
            .error
            .unwrap_or("Save your account in desktop Settings first".into())
    })
}
fn handle(
    stream: &mut TcpStream,
    config: &ServiceConfig,
    engine: &std::sync::Mutex<()>,
) -> Result<String, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(60)))
        .map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut read = || wire::line(&mut reader).map_err(|e| e.to_string());
    if read()? != "PrintSoC/1" {
        return Err("Unsupported native protocol".into());
    }
    let token = read()?;
    if token.len() != config.token.len()
        || token
            .bytes()
            .zip(config.token.bytes())
            .fold(0u8, |value, (a, b)| value | (a ^ b))
            != 0
    {
        return Err("Native service authentication failed".into());
    }
    let cups_job_id = wire::unhex(&read()?).map_err(|e| e.to_string())?;
    let copies: u32 = read()?.parse().map_err(|_| "Invalid copies")?;
    let title = wire::unhex(&read()?).map_err(|e| e.to_string())?;
    let mut options = parse_options(&wire::unhex(&read()?).map_err(|e| e.to_string())?)?;
    if !["media", "PageSize", "PageRegion"]
        .iter()
        .any(|key| options.contains_key(*key))
    {
        options.insert("PageSize".into(), config.paper.clone());
    }
    if !["sides", "Duplex"]
        .iter()
        .any(|key| options.contains_key(*key))
    {
        options.insert("Duplex".into(), config.duplex.clone());
    }
    let size: usize = read()?.parse().map_err(|_| "Invalid document length")?;
    if size == 0 && cups_job_id == "health" {
        return Ok("ready".into());
    }
    let _engine = engine
        .lock()
        .map_err(|_| "Native print worker unavailable")?;
    if size == 0 || size > wire::LIMIT || !(1..=999).contains(&copies) {
        return Err("Invalid document size or copy count".into());
    }
    let mut pdf = tempfile::Builder::new()
        .suffix(".pdf")
        .tempfile()
        .map_err(|e| e.to_string())?;
    let received =
        std::io::copy(&mut reader.take(size as u64), &mut pdf).map_err(|e| e.to_string())?;
    if received != size as u64 {
        return Err("Incomplete PDF spool file".into());
    }
    pdf.flush().map_err(|e| e.to_string())?;
    let job = prepare_spool(pdf.path(), title, cups_job_id, copies, options, config)?;
    let config = match account() {
        Ok(config) => config,
        Err(error) => {
            crate::print_service::print_update_job_status(
                job.id,
                PrintJobStatus::Failed,
                Some(error.clone()),
            );
            return Err(error);
        }
    };
    let connection = crate::ssh_service::ssh_connect_blocking(config.clone());
    if !connection.success {
        let error = connection.error.unwrap_or("SSH connection failed".into());
        crate::print_service::print_update_job_status(
            job.id,
            PrintJobStatus::Failed,
            Some(error.clone()),
        );
        return Err(error);
    }
    let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let monitor_done = done.clone();
    let job_id = job.id.clone();
    let cancel_config = config.clone();
    let mut monitor = stream.try_clone().map_err(|e| e.to_string())?;
    monitor
        .set_read_timeout(Some(Duration::from_millis(250)))
        .map_err(|e| e.to_string())?;
    let watcher = std::thread::spawn(move || {
        let mut byte = [0u8; 1];
        while !monitor_done.load(std::sync::atomic::Ordering::SeqCst) {
            match monitor.read(&mut byte) {
                Ok(0) => {
                    let _ = crate::print_service::print_cancel_job_blocking(job_id, cancel_config);
                    break;
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                    ) =>
                {
                    continue
                }
                _ => break,
            }
        }
    });
    let response = crate::print_service::submit_job(job.id, config);
    done.store(true, std::sync::atomic::Ordering::SeqCst);
    let _ = watcher.join();
    response.data.ok_or_else(|| {
        response
            .error
            .unwrap_or("Submission result unknown; check job history".into())
    })
}
/// Retain the native spool document before starting any remote submission.
pub(crate) fn prepare_spool(pdf: &std::path::Path, title: String, cups_job_id: String,
    copies: u32, mut options: BTreeMap<String,String>, config: &ServiceConfig) -> Result<PrintJob,String> {
    let path = pdf.to_string_lossy().to_string();
    let info = crate::pdf_service::get_pdf_info_internal(&path).map_err(|e| e.to_string())?;
    let mut prefix = Vec::new();
    std::fs::File::open(&path)
        .map_err(|e| e.to_string())?
        .take(4096)
        .read_to_end(&mut prefix)
        .map_err(|e| e.to_string())?;
    let copies = device_copies(&prefix, copies, &mut options)?;
    let settings = settings(
        copies,
        &options,
        (info.page_size.0 as f64, info.page_size.1 as f64),
    )?;
    let created =
        crate::print_service::print_create_job(title, path, config.printer.clone(), settings);
    let job = created.data.ok_or_else(|| {
        created
            .error
            .unwrap_or("Could not record native print job".into())
    })?;
    crate::print_service::attach_native(
        &job.id,
        NativePrintInfo {
            cups_job_id,
            options,
        },
    )?;
    crate::print_service::print_get_job(job.id).data.ok_or("Native record unavailable".into())
}

pub fn health(config: &ServiceConfig) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", config.port).parse().unwrap(),
        Duration::from_secs(1),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    if wire::send(&mut stream, &config.token, "health", "1", "", "", &[]).is_err() {
        return false;
    }
    wire::line(&mut BufReader::new(stream)).is_ok_and(|line| line == "OK 7265616479")
}
fn run() -> Result<(), String> {
    let config: ServiceConfig =
        serde_json::from_slice(&std::fs::read(config_path()?).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let listener = TcpListener::bind(("127.0.0.1", config.port)).map_err(|e| e.to_string())?;
    let engine = std::sync::Arc::new(std::sync::Mutex::new(()));

    // The login service owns tracking even when the desktop window is closed.
    let monitor_engine = engine.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3));
        let Ok(_idle) = monitor_engine.try_lock() else {
            continue;
        };
        let Ok(config) = account() else {
            continue;
        };
        let identity = SSHIdentity::from(&config);
        let jobs = crate::print_service::print_get_all_jobs()
            .data
            .unwrap_or_default();
        if !jobs.iter().any(|job| {
            matches!(
                job.status,
                PrintJobStatus::Queued | PrintJobStatus::Printing
            ) && job
                .submission
                .as_ref()
                .is_some_and(|attempt| attempt.account == identity)
        }) {
            continue;
        }
        let connected = crate::ssh_service::ssh_current_config()
            .as_ref()
            .is_some_and(|active| SSHIdentity::from(active) == identity);
        if !connected && !crate::ssh_service::ssh_connect_blocking(config.clone()).success {
            continue;
        }
        if !crate::print_service::print_check_active_jobs_blocking(config).success {
            // A dropped VPN/SSH session must be re-established on the next poll.
            // This only reconnects for status queries; it never resubmits a job.
            let _ = crate::ssh_service::ssh_disconnect();
        }
    });
    let active = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    for stream in listener.incoming() {
        let mut stream = stream.map_err(|e| e.to_string())?;
        if active.fetch_add(1, std::sync::atomic::Ordering::SeqCst) >= 16 {
            active.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
            continue;
        }
        let engine = engine.clone();
        let config = config.clone();
        let active = active.clone();
        std::thread::spawn(move || {
            let response = match handle(&mut stream, &config, &engine) {
                Ok(message) => format!("OK {}\n", wire::hex(&message)),
                Err(error) => format!("ERR {}\n", wire::hex(&error)),
            };
            let _ = stream.write_all(response.as_bytes());
            active.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        });
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn protocol_health_is_authenticated_without_loading_credentials_or_printing() {
        for authorized in [true, false] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let address = listener.local_addr().unwrap();
            let config = ServiceConfig {
                token: "a".repeat(64),
                port: address.port(),
                printer: "psts-dx".into(),
                paper: "A4".into(),
                duplex: "None".into(),
            };
            let worker = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                handle(&mut stream, &config, &std::sync::Mutex::new(()))
            });
            let mut stream = TcpStream::connect(address).unwrap();
            wire::send(
                &mut stream,
                &if authorized {
                    "a".repeat(64)
                } else {
                    "b".repeat(64)
                },
                "health",
                "1",
                "",
                "",
                &[],
            )
            .unwrap();
            let result = worker.join().unwrap();
            if authorized {
                assert_eq!(result.unwrap(), "ready");
            } else {
                assert!(result.unwrap_err().contains("authentication"));
            }
        }
    }
    #[test]
    fn software_expanded_copies_are_not_multiplied_again() {
        let mut options = parse_options("Collate=True").unwrap();
        assert_eq!(
            device_copies(
                b"%PDF-1.7\n%%PDFTOPDFNumCopies : 1\n%%PDFTOPDFCollate : false\n",
                3,
                &mut options
            )
            .unwrap(),
            1
        );
        assert_eq!(options["requested-copies"], "3");
        assert_eq!(options["requested-collate"], "True");
        assert_eq!(options["collate"], "false");
        assert!(!options.contains_key("Collate"));
        assert_eq!(
            device_copies(b"%PDF-1.7\n", 3, &mut BTreeMap::new()).unwrap(),
            3
        );
        assert!(device_copies(b"%%PDFTOPDFNumCopies : 0\n", 3, &mut BTreeMap::new()).is_err());
    }
    #[test]
    fn native_layout_is_consumed_once_but_physical_settings_are_preserved() {
        let options = parse_options("PageSize=A3 Duplex=DuplexTumble number-up=4 page-ranges='2-5' orientation-requested=4 print-color-mode=monochrome collate=true job-password=do-not-store").unwrap();
        let settings = settings(3, &options, (1191.0, 842.0)).unwrap();
        assert!(matches!(settings.duplex, DuplexMode::DuplexShortEdge));
        assert!(matches!(settings.orientation, Orientation::Landscape));
        assert!(matches!(settings.page_range, PageRange::All));
        assert_eq!(settings.pages_per_sheet, 1);
        assert!(!options.contains_key("job-password"));
        let forwarded = physical_options(&options).unwrap();
        assert!(forwarded.contains(&("media".into(), "A3".into())));
        assert!(!forwarded.iter().any(|(key, _)| [
            "number-up",
            "page-ranges",
            "orientation-requested"
        ]
        .contains(&key.as_str())));
        assert!(parse_options("PageSize='A3").is_err());
        assert!(physical_options(&parse_options("media=Letter").unwrap()).is_err());
    }
}
