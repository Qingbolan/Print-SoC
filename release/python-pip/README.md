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

## Updates and uninstall

```bash
print-soc self update --check
print-soc self update
print-soc self update --auto apply
print-soc self update --rollback
print-soc self uninstall --dry-run
print-soc self uninstall --purge --remove-cli
```

Updates verify downloads before replacing the desktop and retain a previous
version for rollback. Normal CLI desktop launches check daily (notification by
default); automatic installation is opt-in on macOS/Linux. The uninstall wizard
previews owned components and lets you retain data or purge app data and saved
credentials. Use `--plain` for simple text, or `--non-interactive --yes` in scripts.
Python/npm package upgrades and CUPS service refreshes remain separate from
desktop updates. See [maintenance and recovery details](https://github.com/Qingbolan/Print-SoC/blob/main/docs/maintenance.md), including Windows
native-installer limits and the intentionally retained non-secret lock file.

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

Start the interactive installer with:

```bash
print-soc virtual-printer install
```

The terminal wizard offers arrow-key menus for the server, authentication,
paper and sides; validates typed values; hides password input; and previews the
account and destination before asking to install. Decline the confirmation to
edit the settings or cancel before any system changes. Animated stage indicators run
only while work is happening, and stop before password prompts. Ctrl+C exits
cleanly. The result explains how to use the printer or shows stage-specific
repair steps when setup fails. Re-running setup repairs an existing queue.

```bash
# Walk through setup without passwords, sudo or system changes:
print-soc virtual-printer install --dry-run

# Simple numbered prompts, without colors or animation:
print-soc virtual-printer install --plain

# Scripted installation: authenticate the administrator separately first.
sudo -v
print-soc virtual-printer install --non-interactive --username YOUR_SOC_ID --key-path ~/.ssh/id_ed25519
```

Scripts can provide a password through `--password-stdin` (one line) or the
existing `PSOC_SSH_PASSWORD` environment variable. Avoid `--password` in shell
history. Non-interactive mode never prompts, including for sudo; missing inputs
produce an actionable error and nonzero exit code. Redirected output, `NO_COLOR`
and `TERM=dumb` produce plain logs. `--yes` skips only the final confirmation;
use `--non-interactive` to disable all prompts. Authentication sources are
mutually exclusive. Exit status is `0` for success/declined review, `1` for a
handled failure, `2` for invalid command arguments, and `130` for Ctrl+C/EOF.
A successful installation verifies the local queue, not remote SSH connectivity
or physical printing. Setup never automatically submits a test page.

In the desktop app, open **Settings → Advanced → Add system printer**.
Setup opens Terminal to request the SoC password and administrator authentication;
return to the app and refresh integration status after installation completes.
The same installer is available through the command above. Run it as your normal
user: it requests `sudo` only for system changes. A working CUPS service and a
system/Homebrew Python installed outside the home directory are required.

The installer snapshots the backend and its installed dependencies into a
root-owned system directory (`/Library/Application Support/PrintAtSoC/cups` on
macOS, `/usr/local/lib/print-at-soc/cups` on Linux). It stores the forwarding
configuration in `/etc/print-at-soc/virtual-printer.json` with mode `0600` and
copies an explicitly configured SSH key there with the same permissions. This
allows the CUPS service to run without access to a logged-in user's home or SSH
agent. All local Print@SoC queues use this system forwarding account. Re-run the
installer after upgrading the CLI to update the installed backend snapshot.
The normal user configuration remains available for CLI commands; configuring
an installed virtual printer also updates its system configuration.

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
python -m print_at_soc virtual-printer install --username your-soc-id --ask-password
```

The installer now registers the packaged PDF PPD on both macOS and Linux. A4/A3
and duplex choices from the print dialog are forwarded to the SoC submission.
No real print job is sent while installing the queue.
