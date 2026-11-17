# Choose a printer and prepare the pages

## Printer selection

1. Obtain live queue names using `list_print_queues` (MCP) or
   `print-soc printer list --json` (CLI). Do not treat a bundled list as current.
2. Use `find_printers` for live discovery joined to the desktop catalogue, including
   building, room, access and capabilities.
   If running headlessly, consult the repository catalogue and official SoC queue
   documentation below. Ask the user for their building/access only if unknown.
3. Exclude inaccessible rooms and queues that cannot meet paper/colour/duplex
   requirements. A student account does not imply staff/restricted room access.
   Unknown model, access or location must remain unknown until checked.
4. Among eligible choices, prefer a nearby printer with suitable current health;
   use queue length to break ties only when comparable fresh observations exist.
   Do not calculate precise walking time from the catalogue's approximate map.
5. Give the queue, location, relevant capability and reason for the choice. If no
   suitable accessible queue is known, explain the missing evidence and ask a
   focused question rather than choosing an arbitrary printer.

Some public catalogue examples are `psts-dx` in COM1 Level 1 near Tech Services
and `psc008-dx`/`psc011-dx` in COM1 basement. Recheck discovery and access before
using them. The validated `psc111` example is restricted; it is not a default
recommendation for new students. Historical `psc245` entries have unverified
location/access. Neither server discovery nor an empty queue proves accessibility.

Use the exact advertised queue. Do not append `-dx` universally: some monochrome
main queues default to duplex, colour queues may default to simplex, and suffixes
vary. Match the requested setting to actual queue capabilities.

Sources (read as needed; school pages may require user login):
- [Repository catalogue](https://github.com/Qingbolan/Print-SoC/blob/main/app/shared/printers.json)
- [Catalogue provenance](https://github.com/Qingbolan/Print-SoC/blob/main/docs/printer-catalog-sources.md)
- [Official queue guide](https://dochub.comp.nus.edu.sg/cf/guides/printing/print-queues)
- [Official Unix printing guide](https://dochub.comp.nus.edu.sg/cf/guides/printing/stf-stu)

## Document and settings

The desktop imports PDF, PNG/JPEG/WebP/BMP and, with LibreOffice, Office/text
formats including PPTX, DOCX, XLSX, ODP, ODT, ODS, RTF, TXT and CSV. Use Browse
Files to prepare and preview the PDF, or export PDF in the originating app.
MCP `prepare_document` and `prepare_print_job` use the same conversion pipeline. The CLI `print FILE` is a direct submission
route, not a general Office converter; do not send an unconverted Office file.

Check the prepared page count, page size and visible margins. For a slide deck,
check text and fonts on representative pages; for a form, inspect every page
and any requested actual-size requirement. If the preview clips content, resolve
paper/scaling before submission. Do not use a physical print to discover an
obvious preview error. Do not promise physical dimensions based on preview alone.

| Setting | Decision |
| --- | --- |
| Copies | Use the user's count; otherwise propose one. Avoid duplicating both software-expanded and device copies. |
| Paper | A4/A3 according to the document and actual destination support. |
| Binding | Long edge for ordinary portrait book-style pages; short edge for a top flip or typical landscape book-style pages. Confirm intended reading direction when ambiguous. |
| Orientation | Preserve intended layout; landscape does not by itself determine duplex binding. |
| Scaling | Fit only when appropriate; official forms may require actual size. Check margins and clipping. |
| Page range | Set MCP `page_range` to All, Range or Selection; inspect the resulting preview. |
| N-up/booklet | Use only when requested; advanced desktop layout needs pdfjam/TeX Live. MCP booklet cannot combine with n-up > 1. |
| Colour | Select a capable accessible queue and set MCP `color_mode` to auto, monochrome or color. |

The desktop preview shows the chosen long-edge/short-edge mode, a front/back
binding guide and the physical binding edge. Portrait long-edge and landscape
short-edge turn left to right; portrait short-edge and landscape long-edge turn
top to bottom. The highlighted edge moves to the opposite side when viewing the back.

Before submission, the plan should identify the file, queue/location, pages,
copies, paper, sides/binding and layout. Preserve the user's established choices.

## Tracking and cancellation

Keep the local job ID and submission attempt returned by the Rust workflow.
Use `get_print_job`, `get_job_preview` and `refresh_print_jobs` or GUI history
for retained previews and evidence-bearing state. `get_queue_snapshot` exposes
completeness/freshness. Only complete current observations justify jobs-ahead
counts. CLI short queue output can truncate filenames; use the Rust tracking
interface for identity and completion evidence.

With a complete `lpq -l` snapshot available through an already authorized SSH
connection, match the owner, queue and unique attempt filename, preserving the
remote numeric job ID and origin. Count preceding job blocks in that same ordered
snapshot. Do not count file rows as jobs, conflate different logical queues, match
only a basename like `original.pdf`, or reuse an old queue ID blindly.

A successful submission means accepted. A fresh complete observation of departure
means left queue. Only user confirmation or a supported device receipt establishes
physical output. On connection failure, retain the prior state as stale; do not
resubmit. Poll reasonably (the desktop uses about three seconds for active jobs),
then report pending/stale status if observation cannot continue.

For a cancellation request, verify the job belongs to the user and the exact queue
and remote ID. Use `cancel_print_job` with the local job ID and `confirm:true`, the desktop, or:

```sh
print-soc job cancel --printer QUEUE --id REMOTE_ID --yes
print-soc job list --printer QUEUE --json
```

`--yes` expresses the already authorized cancellation. A success response alone
does not prove the printer stopped; report the subsequent observation. Never call
bare `lprm` to probe help, and never cancel unrelated jobs.
