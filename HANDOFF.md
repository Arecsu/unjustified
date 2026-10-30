# Handoff

State as of 2026-10-30. Nothing below is committed yet.

## Uncommitted work

1. **Font sizes** (`src/styles/*.css`, 6 files): every size under 15px was raised
   (5–7→11, 8→12, 9–10→13, 11–12→14, 13–14→15px). The sidebar is wider: 17rem default,
   18rem above 96.875rem, 15.5rem at 67.5–78.125rem. The e2e tests pass (65/65).
   Known bug, not fixed: the sticky sidebar scrolls on its own while the lab sits below
   the fold, so it can show its middle with nothing above. The new lab replaces it anyway.
2. **`prototypes/`**: the lab redesign prototypes (below). This folder is an archive and
   must not be deleted.

## The plan

Move unjustified onto malejandro.com (source: `~/a9r/www`, Astro 7 + Svelte 5 + SCSS;
read its `AGENTS.md` and `docs/web/frontend-guidelines.md` first) as two pages:

- **Work page** (like `/work/monk`, `/work/martyr`): personal writing in the style of
  those pages, plus brutalist scroll-driven demos (e.g. hyphens on/off as you scroll),
  with a browser/unjustified switch always visible. Not started.
- **Lab** (proposed `/lab/unjustified`): the full controls as an app, responsive,
  modelled on rsms.me/inter/lab. No research or marketing copy.

Process: a funnel. Each round has 3–4 rough prototypes; the user gives feedback and the
next round refines it. The lab comes first, because the work page's demos will reuse its
controls.

## User's taste

Grid / editorial / brutalist, raw and utilitarian, never "fancy". Match malejandro.com:

- InterVariable; `#e8e6e3` background, black text; uppercase labels in a right-aligned
  gutter.
- Black-block hover; tabular numbers (`cv04`, `tnum`).
- No rounded corners, no shadows, no cards.

The user loves the `unjustified  lab  ↙` header.
Keep the metric symbols `ln · Σ · short`, with an **uppercase Σ**: lowercase σ reads as "o".

## Prototypes

Open with the dev server: `pnpm dev`, then `/prototypes/lab/`. That page lists every
round. The round-2 index also links round 1.

- Never built or deployed: `vite build` only takes `index.html`, and `tsconfig` only
  includes `src`, `bench` and `tests`.
- Each round is frozen in `prototypes/lab/round-N/` with its own `proto.css`/`proto.js`.
  The fonts are shared in `prototypes/fonts/`.
- **Never delete a round.** A new round gets a new folder and a new entry in
  `prototypes/lab/index.html`.
- CSS fakes the composer: column B uses `text-wrap: pretty`. The metrics (lines, Σ,
  short endings) are measured live from the DOM.
- Size, width, tracking, typeface, hyphens, justify, guides and the rag zone really
  change the text. Every other control only updates its own value.

**Round 1** (A panel, B toolbar, C ledger, D scrub). The user is undecided between A, B
and D.

- Liked:
  - A's plain desktop panel, but its sliders get repetitive.
  - B's black floating bar, with sheets that open above it.
  - C's on/off cells: the whole rectangle presses, with a small square at the top right.
  - D's scrub values and grouping, though D felt cramped.
- Asked for:
  - A+B always side by side, scrolling sideways when narrow, never stacked.
  - Mobile sheets that open above a bar that never moves.
  - A width handle between the columns that tracks the pointer 1:1.
  - A scrub underline that behaves like a real text underline, skipping descenders.

**Round 2**, built from that feedback; waiting for the user's feedback:

- A2 · panel of cells
- B2 · toolbar of cells
- D2 · spec on the label grid, with a strip that follows you down
- E · black bar that holds the scrub values directly

Shared parts in `round-2/proto.js`/`proto.css`:

- `tokHTML`, the scrub value. Its underline is two stacked copies of the text: the
  visible one has a faint track underline, and a transparent copy carries a solid
  underline clipped with `clip-path` to `--p`, the value's position from 0 to 1. Both use
  `text-decoration-skip-ink: auto`. The colour comes from an inherited `--ink`, never
  `currentColor`, because the copy's text is transparent.
- `cellHTML`, C's rectangle. The whole cell is the control.
- `pairHTML`, the side-by-side A+B row, with a width handle.
- The scrub engine: drag sideways (the full range is 320px of travel), click for
  toggles, arrow keys (shift steps by 10). A mostly vertical touch gesture scrolls the
  page instead.
- Edit text: both columns become editable and mirror each other.
- On phones the starting width is set to `innerWidth − 72`, so column B peeks in.

Fixed after the user reported it: `overscroll-behavior-x: contain` on the A+B row blocked
the touchpad's swipe-back. Don't use it on horizontal scrollers.

Also fixed: the sideways `.pair` scroller grew a vertical scrollbar because what hung below
the column (crop marks and a width label, both since removed) overflowed it. `.pair` is `overflow-y: hidden`
and `.col` keeps a little bottom padding for the handle.

**Round 3**, waiting for the user's feedback. One page, `round-3/lab.html`, in four
layouts set by `?layout=`: left, centre, gutter (the site's grid, readings in the label
gutter), wide (two-column panel on wide screens). Built from the user's notes:

- A2's frame with round 1 A's controls (native sliders, checkboxes, boxed selects), group
  labels right-aligned in a gutter as on the site.
- Unjustified alone by default; `compare` adds the browser column to its right. The user
  rejected "A / B / A+B" naming and a browser-only view.
- Auto width by default (fills the room, up to 70 ch); slider or handle fixes it.
- Units: width and indent in `ch` (the text's own), size in `rem` (the site's rule, and it
  follows the reader's font size). JS measures 1ch from the text (`chPx()`) for its pixel
  sums; the head and ruler use `--measure-px`, since Inter's ch differs.
  While auto, the width reads as computed: grey number, hollow slider thumb.
- Always editable, both columns share one source text. With kashida on, the Arabic column
  is rebuilt as you type and the caret is restored by paragraph and offset.
- `read` mode: only the text, on the site's content column.
- Progressive disclosure: "n more ↓" per group. No reset buttons (the user didn't want
  them always visible): double-click or double-tap a slider or label resets it, a tick on
  the track marks the default, and sliders snap to it within 1.5% of their range.
- Linked pairs show one number, the stretch (`+200%`), or `±` when symmetric. The user
  found `−50 / +520%` too much and `2× a space` cryptic.
- Linked pairs: the slider sets the + side. Tracking's − side follows at its ratio
  (`RATIO`, `ui.ratio`); word spacing's shrink stays at −20% unless split (user's call). Word spacing defaults −20% / +200% (the user's suggestion for stretch;
  shrink "much less"). Split, the pair's row stays as a heading (label and
  `linked` never move) over two indented rows, Shrink and Stretch. `auto` and `linked` are
  strike toggles from specimen T-04, with no hover block.
- Header: `left / centre` (gutter and wide stay reachable by URL), `hold ragged / justified`,
  `side by side / focus / read`. Holding ragged or justified (pointer, touch, or Space)
  shows the browser's text in place of yours until release; the last one pressed is what
  side by side compares against. Replaced `compare` and Show's "Justify browser".
  Focus only fades (opacity), never moves layout.
- Kashida group, modelled on Hyphens. The letter classes are the app's ranking in
  `src/kashida.ts`, each switchable. The user's Arabic contact asked for "more options,
  like what characters to use"; reading that as which letters stretch is a guess, to confirm.
- Indent (broken paragraphs), size up to 4.5 rem, line height. Faint paragraph
  numbers `01` (no brackets, no line count), no crop marks, a
  faint width handle that darkens on hover or drag.
- Show › Ruler: Hairline (default), Dimension, Ticks, None. Each but None marks the rag
  zone at the line's end as the same 1px line turning dashed (a thick bar, then a grey tail, read as a glitch). The old pixel ruler took too much attention.
- Alone, the column head's label is a Show › Label choice: Spec `19/29.5 SOURCE SERIF 4`
  (default), Block `684 × 342 PX`, Figure `FIG. 1 · EDITORIAL`, Sample, None. Comparing,
  UNJUSTIFIED / BROWSER. The header already says unjustified.
- Status bar: left counts (¶, words, characters); right only what's shown nowhere else
  (≈ characters a line, minutes to read, tatweels). The user didn't want it to repeat the label.
- The canvas is balanced like an app: the block is centred vertically by JS (`centre()`),
  skipped while typing so the text doesn't jump; a status bar mirrors the header.
- Arabic mirrors the whole canvas (`dir` on `.stage`). The width handle measures its own
  travel per pixel of width, so it tracks the pointer 1:1 in every layout and direction.

**Specimens**: `prototypes/lab/specimens/controls.html` is a separate exploration of
controls only (fifteen sliders, nine toggles), made outside this repo and kept as one
self-contained file with its own embedded font. Don't edit it; it's a reference.

## Decided

- Export was removed from every prototype. It froze column B's lines but set them in the
  reader's default sans-serif, so the lines no longer fit. It is still in the current
  app (`src/main.ts`, `#export`).
- Lab URL: `/lab/unjustified` is proposed, but the user hasn't confirmed it.

## Next

Get the user's round-3 feedback, then build round 4 in `prototypes/lab/round-4/`, by
copying `round-3/proto.*` and changing the copies. The user will fine-tune the controls
themselves later; round 3 keeps round 1 A's on purpose. After the lab settles, start the
work page funnel.
