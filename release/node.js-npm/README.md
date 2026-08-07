# Print@SoC npm CLI

Node.js wrapper for the Print@SoC desktop app and MCP stdio server.

## Installation

```bash
npm install -g print-at-soc
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

- Node.js 14+
- macOS, Linux, or Windows x64/arm64 as supported by the released desktop binaries
- NUS SoC network access or VPN for SSH printing
