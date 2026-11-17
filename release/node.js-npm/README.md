# Print@SoC Node CLI

> npm publication has ended. Install current versions with `pip install --upgrade print-at-soc` or download the desktop from GitHub Releases. This directory retains the source launcher for existing integrations.

Print@SoC helps National University of Singapore (NUS) School of Computing users print without configuring each campus printer. Preview documents, choose print settings and keep a job history in the desktop app on Windows, macOS and Linux.

This package is the **Node.js CLI launcher** for the desktop app and MCP stdio server. On macOS/Linux, `print-soc virtual-printer install` starts guided setup of a system printer for Word and other apps. A SoC account and network access are required; Office conversion needs LibreOffice.

[Download the desktop](https://github.com/Qingbolan/Print-SoC/releases/latest) · [Setup and user guide](https://github.com/Qingbolan/Print-SoC/blob/main/docs/usage.md) · [Agent skill for Codex and Claude Code](https://github.com/Qingbolan/Print-SoC#agent-skill-support) · [Get help or report a bug](https://github.com/Qingbolan/Print-SoC/issues)

An independent community project by [Silan Hu](https://silan.tech), not an official NUS service.

## Installation

```bash
npm install -g print-at-soc
```

## Updates and clean uninstall

Desktop installation and maintenance use the same Python service as the Python
CLI. This keeps release verification, transactional replacement, rollback and
cleanup in one implementation. With Python 3.8+ and `venv` installed, explicitly
starting installation prepares a private Python environment when needed:

```bash
print-soc --install
```

The private environment lives in `~/.PrintAtSoC/maintenance-runtime/<version>`
and installs the exact npm package version from PyPI. Setup shows its three steps
and pip download progress, then opens the interactive desktop installation
wizard. It does not change global Python packages or register private scripts on
Windows PATH. `self update` also prepares a missing runtime; scripted setup needs
`--yes`. Set `PSOC_PYTHON` to use an existing Python environment containing the
same package version instead.

The npm launcher invokes the Python module directly. Missing Python produces
installation guidance before changing the desktop. Normal launches, update
checks, diagnostics and MCP do not bootstrap Python or install dependencies.
An already installed desktop can launch without Python, with automatic checks
skipped until a matching maintenance runtime is available.

```bash
print-soc self update --check       # Inspect the latest available desktop release
print-soc self update               # Review, download, verify and safely replace
print-soc self update --rollback    # Restore the retained previous desktop version
print-soc self update --auto notify # Check automatically on normal app launches
print-soc self update --auto apply  # Opt into applying updates on normal launches
print-soc self update --auto off    # Disable automatic checks

print-soc self uninstall --dry-run  # Preview exactly what would be removed
print-soc self uninstall            # Choose whether to preserve user data
print-soc self uninstall --purge    # Remove owned application data and credentials
print-soc self uninstall --purge --remove-cli # Also remove the global npm launcher
```

The terminal wizard preserves interactive menus and animations. Use `--plain`
for simple logs or `--non-interactive --yes` for an explicitly authorized scripted
operation. Normal desktop launches first recover an interrupted replacement from local
transaction data, before deciding whether installation or a network check is
needed. A recovery failure stops launch instead of overwriting the installation.
MCP and structured printing commands never check or apply updates.
`self install` and `--install` use the same safe updater with `--force`; there is
no separate destructive npm download path.

`--remove-cli` removes only the **global npm package**, after the cleanup service
has confirmed actual completion. Purge and `--remove-cli` also remove private
Python environments owned by this npm launcher after the Python cleanup process
returns. The preview includes that directory. Global Python environments and
unrelated files are retained. A preview, declined confirmation, cancellation or
failed cleanup does not remove the launcher or its runtime. For a project-local
npm package, run `npm uninstall print-at-soc`
in that project's directory after completing desktop cleanup instead.

`npm update -g print-at-soc` updates this launcher package. The desktop version is
managed by `self update`; a package-manager uninstall alone does not remove the
desktop application, queues, history or credentials.

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

Submit a PDF without opening the desktop UI:

```bash
print-soc print assignment.pdf --printer psts-dx --copies 1
```

Inspect live SoC printing state:

```bash
print-soc printer list --username your-soc-id --password-stdin
print-soc job list --printer psts-dx --json
print-soc quota show --json
print-soc config show
```

The npm CLI calls the installed Print@SoC binary's MCP stdio server for these
commands, so run `print-soc --install` first. Credentials can be passed as
options or through `PSOC_SSH_*` environment variables.

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

- Node.js 14.14+
- Python 3.8+ with `venv` for installation and maintenance (the matching package is prepared automatically during explicit setup)
- macOS, Linux, or Windows x64/arm64 as supported by the released desktop binaries
- NUS SoC network access or VPN for SSH printing
