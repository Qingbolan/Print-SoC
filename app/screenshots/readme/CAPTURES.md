# README screenshot provenance

The README hero uses native macOS captures taken on 2026-11-17, after desktop
access was authorized. These replace the older empty-workbench illustration in
the README. Older images in this directory are historical assets, not evidence
of the current native workflow.

| File | Actual application state |
| --- | --- |
| `preview-native-dark.jpg` | Dark theme; front of sheet 1, two-page A4 PDF, long-edge selection |
| `preview-native-light.jpg` | Same document and settings in the light theme |
| `preview-native-back.jpg` | Light theme; Show back selected, PDF page 2 visible |

All three files are unedited window captures from the installed local development
application, taken using the desktop-control screenshot API. No browser mock
backend, painted UI, replacement text, synthetic job status, compositing or
image generation was used. The sample document itself is intentionally authored
for this demonstration; it is not a customer document or a print receipt.

The application binary captured has SHA-256:

```
fa52ad8575ccf6869132ffc6a455f9bb657377f2bc75291c728fd77992446229
```

This identifies the local validation build, not a published release. The
screenshots are not evidence that every current source change has been deployed.

## Reproduce

1. Open the desktop app and connect to an accessible SoC server.
2. Use Browse Files to open [print-guide.pdf](../../../docs/examples/print-guide.pdf).
3. Keep A4, portrait, one copy and long-edge duplex; select an accessible printer.
4. Wait for PDF rendering to finish. Capture the full application window in each theme.
5. Click Show back, wait for page 2 to render, and capture the reverse-side view.
6. Check that no account identity, private path, password or private document is visible.

The PDF can be regenerated with [make_print_guide.py](../../../docs/examples/make_print_guide.py)
using ReportLab. That script is documentation tooling only, not a dependency of
the Rust printer driver.

The capture session verified native file selection, PDF import, front/back
preview and theme switching. It did not submit the sample for printing. Physical
binding, system-driver submission and queue completion require separate live tests.

The toolbar's rightmost binding badge is clipped at this window size; the full
binding value remains visible in Print Options. The capture preserves this actual
layout limitation rather than retouching it away.

## README structure references

- [LocalSend README](https://github.com/localsend/localsend): concise introduction,
  screenshots, download choices and separate contributor instructions.
- [Tauri README](https://github.com/tauri-apps/tauri): clear entry points and links
  to detailed architecture and platform documentation.

These informed the information hierarchy, not the product screenshots or copy.

## Continuous Word recording

`word-native-print.mp4` comes from the user-provided macOS recording
`Screen Recording 2026-11-17 at 21.43.54.mov` (20.493333 seconds,
2940 × 1912, H.264). The published clip retains the first 15.5 seconds
continuously at original speed, resized to 1920 pixels wide and encoded as
H.264/yuv420p with MP4 fast-start. The trailing recording toolbar is omitted.
No scenes were reconstructed, reordered or generated from still screenshots.
There is no audio. `word-native-print.jpg` is a frame at source time 8.3 seconds.

Visible actions: open Word's Print dialog, open the printer selector with
Print@SoC Virtual Printer selected, inspect copies/page controls and click Print.
The clip does not demonstrate duplex changes, installer configuration or
physical output. Physical short-edge output was confirmed separately in the
[validation record](../../../docs/repair-validation-2026-11-17.md).

The earlier screenshot-sequence animation is no longer used in the README.

## Diagonal theme comparison

`preview-native-split.jpg` joins the original dark and light captures at their
original 2800 × 1698 alignment. Dark pixels occupy the left of the line from
(2040, 0) to (1640, 1698); light pixels occupy the right. A 4-pixel blue divider
marks the join and avoids crossing the document preview. The result is encoded
as JPEG at quality 92. The published image uses original screenshot pixels,
not a generated UI. It is a comparison composite, not a single application state.
