//! Bounded, versioned local transport shared with the standalone CUPS executable.
use std::io::{self, BufRead, Read, Write};
pub const LIMIT: usize = 128 * 1024 * 1024;
pub const PORT: u16 = 18631;
pub const CONFIG: &str = "/etc/print-at-soc/native.conf";
pub fn hex(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
pub fn unhex(value: &str) -> io::Result<String> {
    if value.len() % 2 != 0 {
        return Err(io::Error::other("Invalid encoded field"));
    }
    let bytes: Result<Vec<_>, _> = value
        .as_bytes()
        .chunks(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair).map_err(io::Error::other)?;
            u8::from_str_radix(text, 16).map_err(io::Error::other)
        })
        .collect();
    String::from_utf8(bytes?).map_err(io::Error::other)
}
pub fn line(reader: &mut impl BufRead) -> io::Result<String> {
    let mut buffer = Vec::new();
    reader.take(32769).read_until(b'\n', &mut buffer)?;
    if buffer.len() > 32768 || buffer.last() != Some(&b'\n') {
        return Err(io::Error::other("Invalid transport header"));
    }
    buffer.pop();
    String::from_utf8(buffer).map_err(io::Error::other)
}
pub fn send(
    writer: &mut impl Write,
    token: &str,
    job: &str,
    copies: &str,
    title: &str,
    options: &str,
    pdf: &[u8],
) -> io::Result<()> {
    if pdf.len() > LIMIT || title.len() > 4096 || options.len() > 8192 {
        return Err(io::Error::other("Print request is too large"));
    }
    writeln!(
        writer,
        "PrintSoC/1\n{}\n{}\n{}\n{}\n{}\n{}",
        token,
        hex(job),
        copies,
        hex(title),
        hex(options),
        pdf.len()
    )?;
    writer.write_all(pdf)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framed_metadata_preserves_unicode_and_never_splits_title_into_headers() {
        let mut bytes = Vec::new();
        send(
            &mut bytes,
            "token",
            "17",
            "2",
            "报告\nwith newline",
            "page-ranges='2-5'",
            b"%PDF-fixture",
        )
        .unwrap();
        let mut input = std::io::BufReader::new(bytes.as_slice());
        assert_eq!(line(&mut input).unwrap(), "PrintSoC/1");
        assert_eq!(line(&mut input).unwrap(), "token");
        assert_eq!(unhex(&line(&mut input).unwrap()).unwrap(), "17");
        assert_eq!(line(&mut input).unwrap(), "2");
        assert_eq!(
            unhex(&line(&mut input).unwrap()).unwrap(),
            "报告\nwith newline"
        );
        assert_eq!(
            unhex(&line(&mut input).unwrap()).unwrap(),
            "page-ranges='2-5'"
        );
        assert_eq!(line(&mut input).unwrap(), "12");
        let mut payload = Vec::new();
        input.read_to_end(&mut payload).unwrap();
        assert_eq!(payload, b"%PDF-fixture");
    }
    #[test]
    fn malformed_and_oversized_headers_fail_closed() {
        assert!(unhex("a").is_err());
        assert!(unhex("gg").is_err());
        assert!(unhex("ff").is_err());
        assert!(line(&mut std::io::Cursor::new(b"unterminated")).is_err());
        let text = format!("{}\n", "x".repeat(32769));
        assert!(line(&mut std::io::Cursor::new(text)).is_err());
        assert!(send(
            &mut Vec::new(),
            "token",
            "1",
            "1",
            "title",
            &"x".repeat(8193),
            b"pdf"
        )
        .is_err());
    }
}
