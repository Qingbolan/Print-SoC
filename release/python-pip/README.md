# Print@SoC Python CLI

Python wrapper for the Print@SoC desktop app and MCP stdio server.

## Installation

```bash
pip install print-at-soc
```

## Commands

All command names launch the same wrapper:

```bash
print-at-soc
print-soc
psoc
```

Useful options:

```bash
print-soc --help
print-soc --version
print-soc --install
print-soc --path
print-soc --doctor
```

Submit a file without opening the desktop UI:

```bash
print-soc print assignment.pdf --printer psts-dx --copies 1
```

Inspect live SoC printing state:

```bash
print-soc printer list --username your-soc-id --ask-password
print-soc job list --printer psts-dx --json
print-soc quota show --json
```

The inspection commands support `--server stu|stf`, `--host`, `--port`,
`--username`, `--password-stdin`, `--ask-password`, `--key-path`, and the
`PSOC_SSH_*` environment variables listed below. Human-readable commands print
tables/key-value output; pass `--json` for scripts.

## Virtual Printer

macOS and Linux can install a CUPS virtual printer queue named `PrintAtSoC`.
After installation, normal apps can print to `Print@SoC Virtual Printer`; the CUPS
queue uses the bundled PDF driver (not a raw queue), and the CUPS
backend forwards the spool file to the configured SoC SSH server and submits it
with remote `lpr`. The default remote queue is `psts-dx`; use `--printer` to
choose another SOCprint queue such as `psc008-dx` or `psts-sx`.

Install the Python package, configure SSH/default printer settings, and install
the system queue:

```bash
pip install print-at-soc
print-soc --install-virtual-printer --username your-soc-id --ask-password --printer psts-dx
```

Configuration is stored in `~/.PrintAtSoC/virtual-printer.json` with mode `0600`.
Use `--password-stdin` instead of `--ask-password` for scripted setup, or use
`--key-path` for SSH key authentication. The default server is
`stu.comp.nus.edu.sg`; pass `--server stf` for staff accounts.

Useful virtual printer commands:

```bash
print-soc virtual-printer configure --server stu --username your-soc-id --ask-password --printer psts-dx
print-soc virtual-printer install
print-soc virtual-printer status
print-soc virtual-printer uninstall

# Backward-compatible flag forms remain available:
print-soc --configure-virtual-printer --server stu --username your-soc-id --ask-password --printer psts-dx
print-soc --install-virtual-printer
print-soc --virtual-printer-status
print-soc --uninstall-virtual-printer
```

Run cleanup before uninstalling the Python package:

```bash
print-soc --uninstall-virtual-printer
pip uninstall print-at-soc
```

`pip uninstall` only removes Python package files. It does not know about CUPS
queues, backend files, or Print@SoC config created outside package metadata.

Windows virtual printer support is not installed by this command. Windows needs
the modern Print Support App/MSIX virtual printer path rather than a CUPS
backend.

Start the MCP server over stdio:

```bash
print-soc mcp
psoc mcp
```

MCP mode requires the desktop binary to already be installed. Run `print-soc --install` first if needed.

## MCP Environment Variables

`connect_ssh` can read credentials from arguments or these environment variables:

```bash
PSOC_SSH_SERVER=stu
PSOC_SSH_HOST=stu.comp.nus.edu.sg
PSOC_SSH_PORT=22
PSOC_SSH_USERNAME=your-soc-username
PSOC_SSH_PASSWORD=your-password
PSOC_SSH_KEY_PATH=/path/to/private/key
PSOC_SSH_KEY_PASSPHRASE=optional-passphrase
```

## MCP Tools

- `connect_ssh`
- `disconnect_ssh`
- `connection_status`
- `list_print_queues`
- `check_print_quota`
- `check_printer_queue`
- `submit_pdf_print_job`

`submit_pdf_print_job` requires `confirm=true` because it submits a real print job.

## Requirements

- Python 3.8+
- macOS, Linux, or Windows x64/arm64 as supported by the released desktop binaries
- NUS SoC network access or VPN for SSH printing

## 0.1.1

- Fix Windows installer execution and MSI asset selection; report unsuccessful installations.
- Run `--doctor` without downloading or launching the desktop app.
- Support passphrase-protected SSH keys through Paramiko.
- Clean up uploaded print files when a remote print command fails.

The desktop application is downloaded separately from GitHub Releases. This
Python package update does not replace the desktop release.

### macOS raw-queue installation error

If an older installation reports `Raw queues are no longer supported on macOS`,
upgrade the Python package and reinstall the queue:

```bash
python -m pip install --upgrade print-at-soc
sudo "$(command -v python)" -m print_at_soc virtual-printer install
```

The installer now registers the packaged PDF PPD on both macOS and Linux. A4/A3
and duplex choices from the print dialog are forwarded to the SoC submission.
No real print job is sent while installing the queue.
