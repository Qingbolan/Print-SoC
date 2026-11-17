# Setup, system printer and maintenance

## Inspect before installing

```sh
print-soc --version
print-soc --help
print-soc self path
```

If absent, install one launcher, then its desktop binary:

```sh
python3 -m pip install print-at-soc
print-soc --install
print-soc
```

Use a virtual environment or pipx when the OS manages Python; do not override
system package protections. npm is another launcher: `npm install -g print-at-soc`.
Its maintenance workflow also needs Python/venv. Follow the user's chosen installer.
The desktop/native print runtime is Rust; installing a launcher alone does not
install or update that runtime. Compare installed help with these instructions.

The desktop needs a SoC account and campus/VPN connectivity. Have the user save
the account in desktop Settings using the OS credential store. CLI/native printing
uses that shared identity. MCP `connect_ssh {}` uses the same saved identity (see mcp.md). Do not put
passwords in command arguments, chat, checked-in files or MCP JSON.

## Find queues through the CLI

```sh
print-soc printer list --json
print-soc quota show --json
print-soc job list --printer QUEUE --json
```

Replace `QUEUE` with a discovered name. These inspect the live server and may
need an unlocked credential store. The CLI job list currently uses short `lpq`
output; truncated names cannot prove job identity or completion. Use GUI history
for durable tracking and preview. Quota failure means unknown quota, not zero.

## Add a native system printer (macOS/Linux)

After selecting a destination and saving the desktop account:

```sh
print-soc virtual-printer status
print-soc virtual-printer install --printer QUEUE --paper-size A4 --duplex duplex-long-edge --dry-run --non-interactive
print-soc virtual-printer install --printer QUEUE --paper-size A4 --duplex duplex-long-edge
print-soc virtual-printer status
```

A missing configuration may make `status` fail before first installation. Diagnose
that rather than assuming the service is running. Dry-run does not grant admin
access. The real installer needs local administrator authentication; let the user
handle it if the agent cannot access the secure terminal prompt. Do not invent a
successful installation when blocked.

Installer paper values: `A4`, `A3`. Duplex: `simplex`, `duplex-long-edge`,
`duplex-short-edge`. `--plain` simplifies terminal rendering; `--non-interactive`
requires existing administrator authorization for real changes. Re-running the
installer repairs/reconfigures the native integration; it refuses pending jobs.
The installed defaults apply to the local printer; per-document native Print
settings can override them. For an installed backend, `virtual-printer configure` invokes the same native
installer to update the queue defaults. Before installation, use `install`.

On macOS/Linux, additionally inspect `lpstat -v PrintAtSoC` and
`lpstat -o PrintAtSoC` (substitute the local name if customized). Status should
show the Rust service running and backend installed. Then the user can select
**Print@SoC Virtual Printer** in Word's Print dialog. Check copies, paper, scaling
and binding before an authorized print. Retained spool PDFs appear in GUI Jobs.
Do not reapply page layout to the spool PDF. Stay logged in with the credential
store unlocked and network available. Windows uses direct desktop printing;
this CUPS installer does not provide a Windows system driver.

## Update, rollback and removal

```sh
print-soc self update --check
print-soc self update
print-soc self update --rollback
print-soc virtual-printer uninstall --dry-run
print-soc virtual-printer uninstall
print-soc self uninstall --dry-run
print-soc self uninstall --keep-data
print-soc self uninstall --purge --dry-run
```

Execute mutations only within the requested scope. Preview removal before doing
it. `--purge` on the actual uninstall removes owned account/history data; use it
only when that cleanup is requested. Never remove original documents.

Optional CLI-launch update policy: `self update --auto notify|apply|off` (choose
one value, not the literal pipe expression). Opening the desktop directly does
not trigger this CLI check. Updating pip/npm, the desktop, and the installed native
service are separate operations; inspect native status and rerun native setup
when a service refresh is needed. Windows installer rollback differs from the
managed macOS/Linux binary rollback.

For failures, preserve the error, inspect version, connectivity, service status
and pending jobs, and repair the identified component. Do not repeatedly reinstall
or send test prints. Full guide:
https://github.com/Qingbolan/Print-SoC/blob/main/docs/maintenance.md
