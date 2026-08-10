# Frontend Architecture and Design System

This app uses one operational product language built on Radix primitives and
Tailwind tokens. The interface is intentionally flat, clear, and NUS SoC-aligned.

## Structure

```txt
src/
  app/                  App composition: providers, shell, routes
  components/common/    Brand and shared non-layout helpers
  components/layout/    App chrome, background, headers, navigation
  components/ui/        Reusable design-system primitives; no domain behavior
  components/printer/   Printer domain components
  components/jobs/      Print-job domain components
  pages/                Route-level workflows
  styles/               Global tokens, base styles, utilities
```

Rules:
- `src/App.tsx` should stay thin. Put provider wiring in `src/app/AppProviders.tsx`,
  shell/chrome in `src/app/AppShell.tsx`, and routes in `src/app/AppRoutes.tsx`.
- `pages/` should orchestrate workflows, not define shared visual language.
- Put reusable visual primitives in `components/ui/` and reusable brand pieces in
  `components/common/`.

## Design Language

The product language is **NUS SoC Computing Utility**.

| Role | Rule |
| --- | --- |
| Application | One continuous NUS navy background carrying global navigation |
| Workspace | One 10px rounded content layer floating above that background with an 8px gap on every side |
| Panel | Solid grouping surface; use contrast before adding a hairline border |
| Data list | Dark header band and quiet row dividers for comparable domain objects |
| Document | Reading surface with a local table of contents or category rail |
| Overlay | Dialog, menu, or popover; one border and one elevation token |
| Paper | Physical document preview; elevation is allowed |

NUS Blue is used for primary actions, selection, focus, and the global navigation
band. NUS Orange is reserved for the `@` brand mark, the active navigation keyline,
workflow entry points, drafts, and warnings. It is never a decorative gradient endpoint.

## Type System

Use a restrained but real hierarchy:

| Role | Size | Use |
| --- | --- | --- |
| Caption | 12px | Metadata, status details, helper text |
| Control | 14px | Controls, navigation, compact labels |
| Body | 15px | Paragraphs and primary content |
| Section | 17px | Card and workflow headings |
| Page | 22px | Page titles |

Tailwind aliases are mapped to this scale in `globals.css`. Do not use arbitrary
font-size utilities or `text-5xl` and above.

## Brand Tokens

Primary brand tokens live in `src/styles/globals.css`.

```css
--brand-blue: #003D7C;
--brand-orange: #EF7C00;
```

Usage:
- Primary actions, active navigation, focus and selection: `primary`.
- Draft and warning states: `--brand-orange`.
- Main surfaces should use `card`, `background`, `border`, and `muted` tokens.
- Avoid introducing one-off purple/cyan gradients. Extend the token set instead.

## Layout

The app shell is one CSS Grid, not a fixed sidebar plus a compensating margin.
The sidebar and the exposed shell area share the same background; only the workspace
is rendered as a foreground layer:

```txt
sidebar | workspace
        | mobile app bar (below 768px)
        | PageScaffold
```

Page pattern:
- `PageScaffold` owns header, metrics, navigation, and the scrolling content area.
- Use its `contentWidth` presets (`full`, `wide`, `reading`, `form`) instead of
  route-level `max-w-*` wrappers. Every preset stays left-aligned to the same gutter.
- Primary content area below the header.
- Home uses a document workbench plus service context and recent activity.
- Printers and jobs use comparable data rows on desktop and folded rows on mobile.
- Settings and documentation use a desktop category rail and compact mobile switcher.
- Preview uses a paper workbench; the empty state must preserve that physical-paper model.
- Dense tools use panels and split layouts, not marketing hero sections.
- Cards are for repeated objects, dialogs, and genuinely bounded tool surfaces. Do not
  use a card grid as a default route layout.

Responsive sizing:
- Do not assign route-level fixed, minimum, or maximum pixel/rem dimensions to page
  regions. Use fractional grid tracks, flex growth, content padding, viewport-relative
  overlays, and `aspect-ratio` instead.
- PDF canvases read their actual container with `ResizeObserver`; the renderer's pixel
  width is derived from available space rather than being a layout constant.
- Stable icon dimensions, accessible control heights, and paper aspect ratios are
  component or domain constraints and are not page-layout widths.
- Content may wrap or stack at a breakpoint; it must not rely on horizontal overflow to
  preserve a desktop arrangement.

## Information Hierarchy

Each route should lead with the decision or action the user came to complete:
- Home: add a PDF, confirm print-service readiness, see the default destination, and
  resume recent work. SSH host, port, and username belong in Settings.
- Printers: availability, location, queue length, and capabilities. Technical queue
  names are secondary identifiers; full variants and coordinates belong in details.
- Jobs: document, status, output summary, submission time, and the next valid action.
  Internal job IDs and failure diagnostics belong in details.
- Preview: physical output, page navigation, essential print options, destination, and
  submission. Advanced details must not displace the document.
- Settings: user-controlled preferences and connection configuration, grouped by task.
- Help: the standard workflow first; commands and troubleshooting remain separate topics.

Use progressive disclosure for infrastructure data. A field should appear in a primary
view only when it changes the user's immediate decision.

## Components

Use these primitives before hand-writing styles:
- `Surface`: one solid grouping surface with a small set of semantic tones.
- `SegmentedControl`: the only page-level view/category switcher.
- `BrandLogo`: Print@SoC lockup with optional subtitle.
- `BrandBadge`: compact NUS SoC brand accent chip.
- `PageHeader`: consistent page title, icon, description, and actions.

Surface tones:
- `default`: ordinary solid panel.
- `muted`: lower-emphasis utility panel.
- `brand`: primary-blue emphasis.
- `warning`: NUS-orange emphasis for drafts, drag-over, and warning states.

## Interaction Rules

- Keep button corners at 6-8px unless an existing primitive requires otherwise.
- Never animate layout dimensions on hover. Use color transitions and pressed feedback.
- Use a hairline border only for bounded cards, inputs, tool frames, and overlays.
- Do not use shadows for persistent page structure; reserve elevation for overlays and paper preview.
- Dividers are limited to table rows, resizable panes, and overlay structure.
- Use icons for clear commands and compact controls.
- Keep text inside controls short and scannable.
- Hover states should not resize or shift layout.
- At 768-1199px the sidebar starts collapsed. Below 768px it becomes a drawer.
- At narrow widths, split tools stack or hide secondary navigation behind a control.
- Collapse low-frequency filter sets behind one labelled mobile action so primary
  data appears in the first viewport.
- Dangerous mobile actions need visible text; hover tooltips are not sufficient.

## Ownership Rules

- Radix/shadcn is the base component layer. Third-party complex controls require
  a local adapter before use in a page or feature.
- A status presentation belongs to its domain module and must be shared by list,
  detail, and compact views.
- Connection state has one source of truth in `printer-store`; never hardcode an
  optimistic connected indicator.
- Tauri APIs belong behind infrastructure helpers, not inside presentational components.
  Every optional plugin must be guarded with `isTauriAvailable()` before import or use.
- Prefer pure functions and controller hooks for domain behavior. React does not
  benefit from class-based OOP for view composition.

## Verification

Run these before shipping UI changes:

```bash
npm run lint
npm run typecheck
npm run build
```

For a single quality gate, run:

```bash
npm run check
```
