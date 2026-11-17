# MCP interface

Run `print-soc mcp` over stdio and discover the live tools. Client prefixes vary;
the names here are the server's unprefixed names. Update the desktop runtime if
an older installed server does not expose the workflow below.

## Connect and choose

- `get_saved_account {}` returns the saved identity, never the password.
- `connect_ssh {}` authenticates through the shared OS credential store.
- `connection_status {}` and `disconnect_ssh {}` inspect/close this process's session.
- `list_print_queues {}` discovers actual queues on the connected server.
- `find_printers` filters those queues using the same catalogue as the desktop.
  Optional fields: `building`, `paper_size` (`A4`/`A3`), `color`, `duplex`,
  `allowed_access` (array of `public`, `staff`, `restricted`, `unknown`),
  `check_queues`. Access defaults to public. Set colour/duplex to true when required.
  With `check_queues:true`, results include fresh queue snapshots and counts where
  complete. Missing metadata never establishes room access or availability.
- `check_print_quota {}` queries quota. A failed query means unknown quota.
- `get_queue_snapshot {"printer":"QUEUE"}` returns long-format job rows,
  `checked_at`, diagnostics and `jobs_complete`. Use this for queue evidence.
- `check_printer_queue` retains the older array-only interface.

An explicit `connect_ssh` configuration may use `server` (`stu`/`stf`), `host`,
`port`, `username`, `auth_type` (`password`/`private_key`) and the corresponding
credentials. Existing `PSOC_SSH_*` environment variables are also supported.
Prefer the saved account. Never put secrets in chat, committed MCP JSON or shell
history, and never export the credential store. Connecting does not change the
saved desktop identity.

## Prepare, review, submit

`prepare_document {"file_path":"/absolute/path/slides.pptx"}` uses the desktop's
conversion pipeline and returns a retained PDF with page information. PDF and
static PNG/JPEG/WebP/BMP run locally in Rust. Office/text conversion uses LibreOffice.

Create a durable, unsubmitted job and layout preview:

```json
{
  "file_path": "/absolute/path/document.pdf",
  "printer": "DISCOVERED_QUEUE",
  "copies": 1,
  "paper_size": "A4",
  "duplex": "duplex_long_edge",
  "orientation": "portrait",
  "page_range": {"type":"Range", "start":1, "end":2},
  "pages_per_sheet": 1,
  "booklet": false,
  "color_mode": "monochrome",
  "scaling": "fit"
}
```

Pass this to `prepare_print_job`. Required: `file_path`, `printer`. Settings:
copies 1–99; paper A4/A3; duplex `simplex`/`duplex_long_edge`/`duplex_short_edge`;
orientation `portrait`/`landscape`; n-up 1, 2, 4, 6 or 9; colour
`auto`/`monochrome`/`color`; scaling `fit`/`actual_size`. Page range is
`{"type":"All"}`, `{"type":"Range","start":1,"end":2}` or
`{"type":"Selection","pages":[1,3]}`. Booklet cannot combine with n-up > 1.
Layout previews use pdfjam/TeX Live. If preparation returns `preview_error`, fix
that dependency/settings problem and call `get_job_preview`; the job is still
pending and no paper was consumed.

Inspect the preview and effective settings. Source changes after preparation do
not modify this retained job. Once authorized, call
`submit_print_job {"job_id":"RETURNED_ID","confirm":true}` exactly once.
Only pending jobs are accepted by this tool. A failed or uncertain submission
must be inspected before deciding what to do next; never automatically resubmit.
The older `submit_pdf_print_job` is a direct PDF-only submission interface and
accepts the same settings plus `confirm`.

## History and lifecycle

- `list_print_jobs {}` returns desktop, agent and native history newest first.
- `get_print_job {"job_id":"ID"}` returns settings, progress and tracking evidence.
- `get_job_preview {"job_id":"ID"}` returns the retained preview path and page info.
- `refresh_print_jobs {}` polls active jobs for the connected account using `lpq -l`.
- `cancel_print_job {"job_id":"ID","confirm":true}` cancels an authorized exact job.
  Pending/local preparation can be cancelled without an SSH connection; remote
  cancellation checks the submission's saved account, queue and remote identity.
- `confirm_print_output {"job_id":"ID","confirm":true}` records the user's explicit
  confirmation of paper received. Never call it merely because a queue is empty.

Inspect `isError` as well as JSON-RPC errors. Keep the existing job ID on any
error. A complete queue departure supports “left queue”; it does not prove
physical output. On failed refresh, retain the previous observation as stale.

## System printer

`system_printer_status {}` reports configuration, destination and Rust service
health without exposing the local service token.

`configure_system_printer` takes required `printer` and optional `name`,
`paper_size`, `duplex`, `dry_run`, `confirm`. Installer duplex values use hyphens:
`simplex`, `duplex-long-edge`, `duplex-short-edge`. Dry-run defaults to true.
Review its plan, then use `dry_run:false, confirm:true` for authorized setup.
Real installation also needs local administrator authorization. Installation
creates the macOS/Linux system printer; it sends no test page.

`remove_system_printer` takes optional `name`, `dry_run`, `confirm`, and retains
shared account/history. Preview first. For updates, rollback and full uninstall,
use the CLI maintenance commands in [setup.md](setup.md).
