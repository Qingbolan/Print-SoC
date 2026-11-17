//! CUPS entrypoint. Built with rustc + std only; no Python, shell, GUI or SSH dependencies.
mod native_wire;
use std::{
    io::{self, BufReader, Read},
    net::TcpStream,
    time::Duration,
};
fn run(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    if args.is_empty() {
        println!("direct printatsoc://default \"Print@SoC\" \"Print@SoC Virtual Printer\"");
        return Ok(());
    }
    if args == ["--self-test"] {
        println!("PrintSoC native backend protocol 1");
        return Ok(());
    }
    if args.len() < 5 {
        return Err("Expected CUPS job/user/title/copies/options/[file]".into());
    }
    let config = std::fs::read_to_string(native_wire::CONFIG)?;
    let mut lines = config.lines();
    let token = lines.next().ok_or("Missing native service token")?;
    let port: u16 = lines.next().ok_or("Missing native service port")?.parse()?;
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid native service token".into());
    }
    let source: Box<dyn Read> = if let Some(path) = args.get(5) {
        Box::new(std::fs::File::open(path)?)
    } else {
        Box::new(io::stdin())
    };
    let mut pdf = Vec::new();
    source
        .take(native_wire::LIMIT as u64 + 1)
        .read_to_end(&mut pdf)?;
    if pdf.is_empty() || pdf.len() > native_wire::LIMIT {
        return Err("Document is empty or exceeds 128 MB".into());
    }
    let mut stream = TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}").parse()?,
        Duration::from_secs(5),
    )?;
    stream.set_read_timeout(Some(Duration::from_secs(300)))?;
    stream.set_write_timeout(Some(Duration::from_secs(60)))?;
    native_wire::send(
        &mut stream,
        token,
        &args[0],
        &args[3],
        &args[2],
        &args[4],
        &pdf,
    )?;
    let response = native_wire::line(&mut BufReader::new(stream))?;
    let (status, detail) = response.split_once(' ').ok_or("Invalid service response")?;
    let detail = native_wire::unhex(detail)?;
    if status != "OK" {
        return Err(detail.into());
    }
    eprintln!("INFO: {detail}");
    Ok(())
}
fn main() {
    if let Err(error) = run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        eprintln!("ERROR: Print@SoC: {error}. Check the desktop job history before retrying.");
        std::process::exit(1);
    }
}
