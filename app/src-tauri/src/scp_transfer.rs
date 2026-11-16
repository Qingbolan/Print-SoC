//! SCP payload framing, after libssh2 has negotiated the file header.
use std::io::{self, Read, Write};

#[cfg(test)]
pub(crate) fn send_contents(
    source: &mut impl Read,
    channel: &mut (impl Read + Write),
    size: u64,
) -> io::Result<()> {
    send_contents_observed(source, channel, size, &mut |_, _| Ok(()))
}

pub(crate) fn send_contents_observed(
    source: &mut impl Read, channel: &mut (impl Read + Write), size: u64,
    progress: &mut impl FnMut(u64, u64) -> io::Result<()>,
) -> io::Result<()> {
    let mut copied = 0;
    let mut buffer = [0u8; 64 * 1024];
    progress(0, size)?;
    while copied < size {
        let length = ((size - copied) as usize).min(buffer.len());
        let count = source.read(&mut buffer[..length])?;
        if count == 0 { break; }
        channel.write_all(&buffer[..count])?;
        copied += count as u64;
        progress(copied, size)?;
    }
    if copied != size {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "Upload source became shorter than its announced size",
        ));
    }
    let mut extra = [0];
    if source.read(&mut extra)? != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Upload source changed during transfer",
        ));
    }
    // SSH EOF is not the SCP end-of-file marker. The receiver acknowledges
    // this NUL only after it has consumed and written the declared payload.
    channel.write_all(&[0])?;
    channel.flush()?;
    let mut response = [0];
    channel.read_exact(&mut response)?;
    match response[0] {
        0 => Ok(()),
        1 | 2 => {
            let mut message = Vec::new();
            for byte in channel.take(4096).bytes() {
                let byte = byte?;
                if byte == b'\n' {
                    break;
                }
                message.push(byte);
            }
            Err(io::Error::other(format!(
                "SCP receiver rejected upload: {}",
                String::from_utf8_lossy(&message)
            )))
        }
        code => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Invalid SCP acknowledgement: {code}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    struct Duplex<R, W> {
        reader: R,
        writer: W,
    }
    impl<R: Read, W> Read for Duplex<R, W> {
        fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
            self.reader.read(bytes)
        }
    }
    impl<R, W: Write> Write for Duplex<R, W> {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.writer.write(bytes)
        }
        fn flush(&mut self) -> io::Result<()> {
            self.writer.flush()
        }
    }

    #[test]
    fn requires_receiver_acknowledgement() {
        for response in [
            b"".as_slice(),
            b"\x01No space left on device\n",
            b"\x02Permission denied\n",
            b"\x03",
        ] {
            let mut channel = Duplex {
                reader: Cursor::new(response),
                writer: Vec::new(),
            };
            let error = send_contents(&mut Cursor::new(b"hello"), &mut channel, 5).unwrap_err();
            assert_eq!(channel.writer, b"hello\0");
            if response.starts_with(b"\x01") {
                assert!(error.to_string().contains("No space left"));
            }
        }
    }

    #[test]
    fn rejects_changed_source_without_sending_success_marker() {
        for size in [4, 6] {
            let mut channel = Duplex {
                reader: Cursor::new(b"\0"),
                writer: Vec::new(),
            };
            assert!(send_contents(&mut Cursor::new(b"hello"), &mut channel, size).is_err());
            assert!(!channel.writer.contains(&0));
        }
    }

    // Real OpenSSH sink, no SSH credentials, network, or print submission.
    #[test]
    #[cfg(unix)]
    fn openssh_sink_accepts_completed_transfer() {
        use std::process::{Command, Stdio};
        let dir = tempfile::tempdir().unwrap();
        for payload in [vec![], b"hello\0world\n".to_vec(), vec![42; 256 * 1024]] {
            let target = dir.path().join("upload.pdf");
            let mut child = Command::new("scp")
                .arg("-t")
                .arg(&target)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            let mut channel = Duplex {
                reader: child.stdout.take().unwrap(),
                writer: child.stdin.take().unwrap(),
            };
            let mut ack = [255];
            channel.read_exact(&mut ack).unwrap();
            assert_eq!(ack, [0]);
            writeln!(channel, "C0600 {} upload.pdf", payload.len()).unwrap();
            channel.flush().unwrap();
            channel.read_exact(&mut ack).unwrap();
            assert_eq!(ack, [0]);
            send_contents(
                &mut Cursor::new(&payload),
                &mut channel,
                payload.len() as u64,
            )
            .unwrap();
            drop(channel);
            assert!(child.wait().unwrap().success());
            assert_eq!(std::fs::read(&target).unwrap(), payload);
        }
    }
    #[test]
    fn progress_tracks_bytes_and_cancellation_stops_before_ack() {
        let data = vec![42; 150_000];
        let mut observed = Vec::new();
        let mut channel = Duplex { reader: Cursor::new(b"\0"), writer: Vec::new() };
        send_contents_observed(&mut Cursor::new(&data), &mut channel, data.len() as u64, &mut |sent, total| {
            observed.push((sent, total)); Ok(())
        }).unwrap();
        assert_eq!(observed.first(), Some(&(0, 150_000)));
        assert_eq!(observed.last(), Some(&(150_000, 150_000)));
        assert!(observed.windows(2).all(|pair| pair[0].0 < pair[1].0));
        let mut channel = Duplex { reader: Cursor::new(b"\0"), writer: Vec::new() };
        let result = send_contents_observed(&mut Cursor::new(&data), &mut channel, data.len() as u64, &mut |sent, _| {
            if sent > 0 { Err(io::Error::other("Cancelled")) } else { Ok(()) }
        });
        assert!(result.is_err());
        assert_eq!(channel.writer.len(), 64 * 1024);
        assert!(!channel.writer.contains(&0));
    }

}
