# Working with Print@SoC

Print@SoC helps NUS SoC users prepare documents, submit them through the school's
SSH printing service, and keep track of their jobs. Work from the user's concrete
printing task. Keep explanations direct; do not evaluate the user or other people.

## Choose the right workflow

- **Help someone print or configure their machine:** read
  [the print-soc skill](plugins/print-soc/skills/print-soc/SKILL.md). It covers
  installation, printer selection, document preparation, settings, submission,
  tracking, cancellation and maintenance. Do not change source code just to
  perform an ordinary print task.
- **Install the skill in Codex or Claude Code:** follow
  [agent setup](docs/agents.md). A skill supplies instructions; the CLI/desktop
  and, optionally, an MCP connection supply the actual capabilities.
- **Develop this project:** use the architecture and checks below. Read the
  relevant implementation before changing a public command or documenting it.

A request to configure printing authorizes setup work, not an unsolicited test
print. A request to print a specified file with specified settings is already
print authorization: do not ask the same question again. Resolve missing choices
before submission. Never automatically retry an ambiguous submission.

## Operational facts agents must preserve

- Discover queues from the user's connected SoC server. A catalogue entry is
  neither evidence of room access nor proof that a printer is online. Consider
  location, access, paper, colour, duplex and current queue health when choosing.
- Credentials belong in the desktop's OS credential store or the client's secure
  authentication mechanism. Do not ask for passwords in chat, print secrets,
  commit credentials, or write them into MCP configuration. MCP
  `connect_ssh {}` uses this saved identity; its SSH session remains process-local.
- Direct desktop printing works on Windows, macOS and Linux. The optional native
  system printer uses CUPS on macOS/Linux. Do not promise a Windows CUPS driver.
- The native backend and user service are Rust. Do not reintroduce a Python
  runtime dependency into the CUPS print path. The pip launcher is separate.
- Office files need LibreOffice for desktop conversion. Check the rendered PDF;
  renaming a PPTX/JPG to PDF does not convert it. System printing receives an
  already rendered spool PDF and must not apply its layout a second time.
- Queue association uses account, queue and unique attempt filename from
  `lpq -l`. Queue IDs may be reused. Show jobs ahead only from a fresh, complete,
  ordered snapshot. Query failure or truncated output is not an empty queue.
- `Accepted`, `LeftQueue` and `OutputConfirmed` are different evidence levels.
  Queue departure does not prove paper output. Preserve uncertainty and tell the
  user what was observed, including when physical confirmation is still needed.
- Do not mutate job history to make a validation look successful. Record physical
  confirmation only after the user confirms it. Keep private documents out of demos.

## Architecture and ownership

| Area | Source of truth |
| --- | --- |
| Document import/conversion and preview PDF | `app/src-tauri/src/document_service.rs`, `pdf_service.rs` |
| Submission state machine and remote receipts | `job_lifecycle.rs`, `print_service.rs`, `submission_receipt.rs` |
| SSH commands, long queue parsing | `ssh_service.rs`, `queue_status.rs` |
| Native installation, transport, service and shared jobs | `native_install.rs`, `native_backend.rs`, `native_wire.rs`, `native_service.rs`, `job_store.rs` |
| Shared identity and credentials | `account_service.rs`, `credential_service.rs`; CLI `release/python-pip/print_at_soc/account.py` |
| Desktop UI and background refresh | `app/src/pages`, `app/src/components`, `app/src/hooks/useBackgroundMonitor.ts` |
| CLI inspection/maintenance | `release/python-pip/print_at_soc`; npm launcher in `release/node.js-npm` |
| MCP schemas and agent workflow | `app/src-tauri/src/mcp_server.rs`, `agent_service.rs` |
| Shared printer capabilities and aliases | `app/shared/printers.json`, `printer-aliases.json`, `printer_catalog.rs` |
| Agent workflow | `plugins/print-soc/skills/print-soc`; keep one canonical skill |

Rust filenames without a directory in this table are under `app/src-tauri/src`.

Keep modules cohesive and boundaries explicit. Fix causes in their owning layer,
reuse shared logic and model lifecycle changes as state transitions. Prefer
encapsulated types with clear responsibilities over accumulating procedural
branches. Remove obsolete implementations after migration; do not keep parallel
legacy paths unless the specification requires them. Preserve public behavior
and interfaces while refactoring internals.

## Verification

Run checks appropriate to the changed behavior, from the repository root:

```sh
npm --prefix app run check
cargo test --manifest-path app/src-tauri/Cargo.toml --lib
PYTHONPATH=release/python-pip python3 -m pytest release/python-pip/tests -q
npm --prefix release/node.js-npm test
python3 scripts/version.py check
python3 scripts/verify_agent_workflow.py app/src-tauri/target/debug/print_at_soc --require-layout
git diff --check
```

Documentation-only edits need link/command checks, not a rebuild. For skill
changes, exercise read-only CLI help and MCP discovery, check every documented
parameter against the returned schema, and validate references after copying the
skill outside the checkout. Never make a real submission as an automated test.
For native print changes, distinguish unit tests from installed-driver, GUI preview,
setting propagation and physical-output checks. Report untested platforms honestly.

## Versions and delivery

- Use Tide for every project version. Read [VERSIONING.md](VERSIONING.md) before
  changing build or release logic.
- `scripts/version.py` owns all version projections. Do not hardcode another
  version, manually bump manifests or calculate independent CI versions.
- Preserve the shared source-commit receipt across builds and package publication.
- Commit only as `Silan.Hu <silan.hu@u.nus.edu>`.
- Review the diff and exclude credentials, private documents, recordings with
  personal content, temporary build output and Office lock files.
- Preserve concurrent user edits. When asked to push, verify the remote commit;
  a local commit or a started workflow is not evidence of delivery or release.
