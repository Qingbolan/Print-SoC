# Native printing validation — 2026-11-17

## Implemented path

System print dialog → CUPS PDF filters → embedded standalone Rust backend →
authenticated loopback Rust login service → shared Rust SSH submission lifecycle.
Python is not part of this runtime. The optional pip launcher delegates printer
installation/removal/status to the desktop executable; retired Python backend,
relay, runtime copier and installer implementation have been removed.

The service reads the desktop account and OS credential store. Native jobs and
retained spool PDFs are recorded under application data and merged into GUI
history even while the GUI is disconnected. Entries include native settings and
appear newest first. Per-job atomic records, file locking and deletion tombstones
coordinate the separate processes. Cancellation is arbitrated against the
irreversible submission boundary under the record lock.

The spool PDF already contains the system's layout. Native submission therefore
skips further page-range, n-up, rotation and Ghostscript layout processing.
Physical media, sides/binding, device copies, collation and supported device
options are forwarded. CUPS pdftopdf copy markers prevent software-expanded
copies from being multiplied again.

## Initial implementation checks (superseded by final checks below)

- Rust library: 61 passed; 5 external-converter integration tests excluded from
  the default suite (previously exercised locally).
- Frontend: 26 passed; TypeScript, design checks and production build passed.
- Python launcher/account/maintenance suite against checkout: 102 passed.
- Embedded backend: empty-environment self-test and CUPS discovery passed.
- Native terminal wizard: PTY arrow-key selection of A3/short-edge duplex passed;
  plain noninteractive preview with restricted PATH passed. Both used dry-run.
- CUPS PPD validation passed; native macOS debug app bundle built successfully.
- Desktop native self-test: passed with PATH restricted to /usr/bin:/bin.
- macOS binary dependencies: only OS libraries/frameworks; no Homebrew,
  Anaconda, Python or external OpenSSL library paths.
- Authenticated TCP health framing, parameter preservation, copy expansion,
  cross-process job visibility, cancellation races and tombstones covered by
  Rust tests. No real print command is sent by these tests.

## Initial live-verification gaps (historical)

The macOS installation and physical-output gaps described here were resolved
by the Word validation below. Windows/Linux live validation remains outstanding.

The existing system CUPS backend needs administrator authentication to replace.
An installed native queue, real CUPS sandbox execution and NUS remote/physical
output have not yet been verified. Windows and Linux native packaging have not
been run locally. This checkout is not a published release. Direct Office-file
conversion in the GUI retains its separately documented converter requirements;
the native system-print route receives an already rendered PDF.

## Follow-up: accepted jobs without a queue ID

A read-only probe of the configured SoC host confirmed a custom, non-readable
setuid `lpr` executable and no `lp` command. The affected `original.pdf` history
record had Accepted progress without a queue ID; its queue returned `no entries`.
No document was submitted during diagnosis.

Positive acceptance followed by a fresh, complete empty queue now transitions
to LeftQueue even if the job finished before the first poll. Unknown submissions,
stale snapshots, errors, offline queues and nonempty queues cannot take this
shortcut. Confirmed physical output has its own OutputConfirmed stage and label.
The native login service continues tracking while the GUI is closed and
reconnects after query failures without resubmitting. Single-job GUI reads and
queue reconciliation now merge native records before reading them.

## Local application cutover and file picker (before driver installation)

The previous GUI process was stopped and the native test bundle launched from
`~/.PrintAtSoC/local-builds/native-validation/Print_at_SoC.app`. On this running
build, the previously stuck original.pdf history record automatically changed
from Accepted/Queued to LeftQueue/Completed after a successful empty queue query.

The Browse Files regression came from document_extensions returning a bare array
while its caller required ApiResponse. The command now returns the shared result
shape. Tests verify the serialized Rust response and the frontend picker flow,
including cancellation versus discovery failure. Dialog failures now propagate
to the existing user-visible error handler instead of silently becoming cancel.

A two-page non-personal PDF was generated and visually checked for A4 short-edge
binding verification. The local driver install entrypoint preserves psc111 and
backs up the existing root driver/config/PPD/runtime before replacing them.
Administrator authentication is still pending. Computer Use reports permissions
not granted, so live file-picker/GUI-preview clicks and physical printing remain
unverified; no test job has been sent yet.


## Word → installed Rust driver: live validation at 21:37 SGT

On 2026-11-17, the public `docs/examples/word-print-demo.rtf` was opened in
Microsoft Word on the local Mac. Word's native Print dialog listed
**Print@SoC Virtual Printer (NUS SoC)**. The two-page document was submitted once
with one copy, A4 and **On (Short Edge)**.

- Local CUPS job: `PrintAtSoC-3`.
- Native service job: `769000f4-c666-49e4-b47f-f54da049d7b4`.
- Destination: `psc111`; associated remote queue ID: `4`.
- Persisted native options: `PageSize=A4`, `media=A4`,
  `Duplex=DuplexTumble`, `sides=two-sided-short-edge`,
  `requested-copies=1`, `device-copies=1`.
- At 21:38:13 SGT, the service observed a matched printing job, queue position 1,
  jobs ahead 0, a fresh snapshot and the device message `printing Busy.`
- At 21:38:25 SGT, it transitioned to `Completed` / `LeftQueue` with
  `evidence=queue_departure`.
- GUI Active count became 0. The Word job appeared first in History with the
  System printer label, A4, one copy and short-edge binding.
- Opening job details rendered the actual system-produced two-page PDF and
  showed CUPS job 3 and remote job 4.
- In response to a question explicitly asking whether both pages were on one
  sheet and upright after flipping over the short edge, the user confirmed
  **“打印正确无误”**. The GUI Output received action then recorded
  `OutputConfirmed`; no second print was sent.

This verifies the Word/system-driver path and short-edge output on this Mac and
`psc111`. It does not establish equivalent hardware behavior for all queues or
platforms.

The initial macOS selected-window recording was inspected and rejected: most
frames were black and the print dialog was absent. It is not included as product
evidence. The replacement user-provided recording at 21:43:54 SGT captures
Word printer selection, copies/page controls and clicking Print. Its first
15.5 seconds are published continuously at original speed in the README.
It does not capture duplex changes or the installer wizard. CLI installation
recording remains outstanding; screenshots are not a substitute for it.

## Pre-push checks

- Rust library suite: 64 passed, 5 ignored.
- Frontend `npm run check`: type checking, design checks, tests and production build passed.
- Python CLI: 102 passed with the repository package on `PYTHONPATH`.
- npm launcher: test, maintenance and runtime suites passed.
- Queue parser regression: 5 targeted tests passed, including a truncated second
  file row that must not be treated as a complete queue snapshot.
- Tide projection check: passed; versions remain owned by `scripts/version.py`.
