# Using Print@SoC

[Back to the overview](../README.md)

## Virtual Printer

On macOS/Linux, open **Settings → Advanced → Add system printer**. The desktop
contains a standalone Rust CUPS backend and a Rust login-session print service.
Python, Conda, pip, shell scripts, local SSH executables and Homebrew OpenSSL are
not part of the system printing path. Save your shared account in Settings first.
The native wizard offers interactive queue/paper/duplex choices, animated progress,
a preview, administrator authentication and failure guidance.

An optional Python CLI launcher can invoke the same embedded installer:

```sh
print-soc virtual-printer install
print-soc virtual-printer install --dry-run
print-soc virtual-printer install --plain
print-soc virtual-printer status
print-soc virtual-printer uninstall
```

The standalone backend is embedded at build time and installed as a root-owned
executable. Its only connection configuration is a private token in
`/etc/print-at-soc/native.conf`. The Rust login service reads the shared account
and OS keyring, saves the spool PDF, and submits through the desktop's existing
job state machine and remote receipt mechanism. System jobs appear in GUI history
with their source, effective settings, original native options and PDF preview,
including when the GUI was closed when the job arrived.

Page selection, orientation, scaling and n-up already rendered into the CUPS PDF
are not applied twice. Copies, paper, duplex and supported physical colour/collate
options are forwarded explicitly. Forwarding an option does not establish that
the SoC server honors it: its custom lpr is not assumed to implement CUPS options.
See the [live interface investigation](soc-print-interface-investigation-2026-11-17.md).
Unsupported physical settings fail with an error. Submission acknowledgment is
not proof of physical output.

Stay logged in with an unlocked credential store and NUS/VPN connectivity while
printing. Installer previews and registration checks never print a test page.
Repair refuses queues with pending jobs. Uninstall removes native runtime/service
and connection tokens; account/history are retained unless the full uninstall
wizard explicitly purges user data. Original documents are never removed.

The first native repair replaces the former Python backend and removes its
runtime and credential snapshots. Update the desktop before using the native
installer through an older CLI. Windows system-driver support remains separate
from CUPS; desktop printing is available there.

## MCP Server

The desktop binary includes a stdio MCP server. Open **Settings → Advanced** to
run a handshake test and copy a client configuration that points to the exact
installed executable. The same page reports the CLI, CUPS queue, backend,
configuration file, and loaded Tauri plugins without assuming they are present.
After installing the Python CLI, the server is also available through either CLI alias:

```bash
print-soc mcp
psoc mcp
```

The MCP server exposes printer selection, document conversion and preview, native setup, submission, shared history, tracking and cancellation. Use `prepare_print_job` to review a durable job, then `submit_print_job` with `confirm=true` for an authorized print.

The bundled [print-soc skill](../plugins/print-soc/skills/print-soc/SKILL.md)
covers the wider workflow using CLI, desktop and MCP. See [agent setup](agents.md)
for Codex/Claude Code installation, a ready-to-copy prompt and MCP configuration.
MCP `connect_ssh {}` opens its own SSH session using the saved desktop account, without exposing the password.

## Remembering your login password

On the desktop login screen, select **Remember account and save password securely**.
After a successful SSH login, the password is stored in macOS Keychain, Windows
Credential Manager, or the Linux Secret Service. On later launches, press Connect
without re-entering it. Enter a new password to replace the saved one after a
successful login. Browser storage contains only the account identity and a saved
status flag; the backend reads saved passwords without returning them to the webview.

Clearing the saved account or logging out deletes its saved password. Unchecking
the option uses the typed password for this session without accessing the system
password store; existing saved credentials remain until explicitly cleared.
If the system password store is locked or unavailable, the app reports the error
and does not fall back to storing passwords in a file. Existing remembered accounts
need one successful password login to opt into secure password storage.

## Importing documents and images

The desktop workbench and preview accept PDF, static PNG/JPEG/WebP/BMP images,
and DOC/DOCX/ODT, PPT/PPTX/ODP, XLS/XLSX/ODS, RTF, TXT and CSV documents.
Images convert locally with transparency composited onto white paper and EXIF
orientation respected. Office/text formats require LibreOffice (detected in the
standard macOS/Windows installation or as `soffice` on PATH). Fonts and pagination
may differ from the originating application; review the converted PDF before printing.

Preview and printing use the same converted PDF. Conversions are reused by content
hash in the application's `imports` directory so saved drafts remain available.
Conversion inputs are limited to 128 MB and static images to 40 megapixels.
Animated images and unrecognized formats are rejected with an explanation. For
other applications or formats, use their native Print → Save as PDF. No claim is
made to render arbitrary binary files.

macOS controls Keychain authorization prompts. Selecting **Always Allow** grants
this app access to that item; rebuilding an unsigned development binary may cause
macOS to request authorization again. The app retains credentials only in memory
for active SSH reconnects and clears them on disconnect, reducing repeated reads.
New accounts do not save passwords unless the checkbox is selected.

## Layout and interrupted submissions

Page selection, n-up and booklet layout require `pdfjam` with TeX Live on the
local desktop. Booklet mode arranges pages for folding, adds blank pages when
needed, and starts with landscape/short-edge duplex settings. Review both sides
before printing. A missing layout tool stops the job before upload.

Imported PDFs are kept as immutable local copies, including when the source is
already a PDF. Moving or editing the original after import does not change the
previewed document. A document must finish preparation before it can be submitted.

After a restart, interrupted preparation can be retried. A job that may already
have reached the printer is checked against its original account and receipt;
it is never automatically printed again. If a queue ID cannot be recovered,
check the queue and the physical output before using the manual confirmation
controls in job details. Confirmation updates history only.
