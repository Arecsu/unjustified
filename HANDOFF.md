# Handoff

State as of 2026-10-31. Round 3's refinements are committed on `lab-prototypes`; nothing is pushed.

## Earlier work

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
  strike toggles from specimen T-04, with no hover block. The user found they read as
  part of the label: four looks to try for auto and linked (not the unit), `?chip=` or the panel foot's `buttons`: plain,
  underline (default; S-11, as ch / %, plus T-04's strike when off), outline (boxed and struck when off), fill (boxed,
  black when on). Where the option sits is a second choice, `?opts=` or `options`
  (OPTS, `place()`, `data-place` on the root): label (with room above the slider: the
  underline sat on it), value (beside the number; ch / % becomes its unit), below (a
  line under the slider, as Hyphens' start), pointer (value for
  `pointer: fine`, below for `pointer: coarse`), hybrid (the user's mix: auto and linked
  beside the label, ch / % beside the number, label spacing on every slider), glide
  (default; hybrid, and linked slides to the row's end as a pair splits). The state
  changes at once; the sequence is timing only. `slide()` measures linked on screen,
  applies the change, measures again and plays `translate` back to zero, so a second
  click mid-slide turns it around. Splitting, the number fades out first (CSS, .1s) and
  the slide waits that long (`NUMBER_OUT`, held by `fill: backwards`); joining, the slide
  starts at once and the number fades back in after .3s (CSS delay), so they never meet. Hybrid and glide
  use below on coarse pointers. Each row writes the option in all three
  slots and CSS shows one. Coarse pointers also get taller sliders and thumbs.
- Header: `left / centre` (gutter and wide stay reachable by URL), then
  `vs browser / focus / read` (first named side by side). Vs browser shows `native browser → ragged / justified`
  just left of it, a plain click choice of which browser text sits beside yours. The user
  first had it as hold-to-show (the browser's text in place of yours while held) and
  regretted it: unclear what it was about, and useless without the browser column.
  Focus only fades (opacity), never moves layout.
- Hyphens and Kashida have a master switch (`master` on the group): while off, the group
  shows only the switch, its options folded away. Folds (`.fold`, grid rows 0fr→1fr, which
  Safari and Firefox animate, unlike `height: auto`) also run "n more". The user
  picked a bare box over a row, a struck title and the site's button, then rejected
  leader (too many lines) and end (box too far from the title). Five looks to try,
  `?gt=` or the panel foot's `box`, each with its own markup (changing it rebuilds the
  panel): gutter, edge, start (default; the user's favourite), switch (off / on),
  cell (round 1 C). Off, the
  empty line says what the group does (`about` on the group). The title toggles in all.
  Titles sit at a fixed top offset (`align-items: start`, padding a row's), not on the
  first row's baseline, which moved them when a group opened.
- The panel foot's pickers are one table, `PICKS` ([name, ui key, choices]); the key is
  also the URL parameter and the root's data attribute, and refresh, clicks and start
  read it. Adding a look to try is a line there and its CSS. Below them, underline sliders
  (`UL`, `?ulat13=` `?ulat16=` `?ulw=`). The offset is one equation through two points
  the user picks, the gap under 13px words (panel) and under 16px (header), run on each
  word's own size like fluid type runs on the viewport:
  `clamp(max(1px, .05em), calc(at13 + (1em - 13px) * (at16 - at13) / 3), .5em)`.
  The user wanted the header's underlines closer than the panel's: a px floor
  (martyrio's `max(2px, .13em)`) or an em share only ever grows with size. Thickness
  is `--ul-w` in em (default .1em, the user's pick). Default 3px at 13, 2px at 16.
- Header looks, `?hd=` or `header`: block (default, as before), stops (S-11: chosen in ink
  and underlined, the rest at half ink), idle (stops, but a row with nothing on, vs
  browser / focus / read, stays in ink until one is on).
- Marks on dropdowns and "n more" (`.mk`, drawn by CSS), `?mk=` or `marks`: arrow (as
  before), chevron, caret, plus, corner, none, quiet (default, the user's pick: none on
  dropdowns, chevron on "more"). The user found ↓ repetitive.
  The mark turns over (`aria-expanded`) as "more" opens.
- Dropdowns are drawn (`.dd`: title, value, ↓) with the real select laid over them at
  opacity 0, so the native menu (and the phone's picker) still opens and the value updates
  through `paint()`'s `data-v`. Six looks, `?dd=` or the panel foot's `dropdown`: stack (as
  before), inline (default; title left, value right, one box), caption, legend (title in
  the top border), split (title cell ruled off), rule (no box, underline, black on hover).
  One-line looks start their row higher so the words sit on the group title's line.
  Double-click no longer resets a dropdown: the select takes every click.
- Group titles share the row labels' size and settings (TYPE and Typeface, same cap
  height), with a 6.25rem gutter (room for the box beside HYPHENS), a 1.5rem gap, and more space between rows.
- Kashida group, modelled on Hyphens. The letter classes are the app's ranking in
  `src/kashida.ts`, each switchable. The user's Arabic contact asked for "more options,
  like what characters to use"; reading that as which letters stretch is a guess, to confirm.
- Indent in ch or % of the width (`indent` / `indentPct`, one row shown per `ui.unit`,
  a `ch / %` switch converting on the spot, styled exactly as specimen S-11 word
  stops: chosen in ink with a 1.5px underline, the other at 52% ink, the slash at 20%). Shown at most 90% of the width (`indentCap`);
  the number is kept, greyed while held in, and comes back when the width does (it used
  to overflow, then to be overwritten). Indent (broken paragraphs), size up to 4.5 rem, line height. Faint paragraph
  numbers `01` (no brackets, no line count), no crop marks, a
  faint width handle that darkens on hover or drag.
- Show › Ruler: Hairline (default), Ticks, None (Dimension removed). Each but None marks the rag
  zone at the line's end as the same 1px line turning dashed (a thick bar, then a grey tail, read as a glitch). The old pixel ruler took too much attention.
- Alone, the column head's label is a Show › Label choice: Figure `FIG. 1 · EDITORIAL`
  (default; editable like the text, one line, `ui.caption`, reset by a new sample or by
  emptying it), Spec `19/29.5 SOURCE SERIF 4`, Block `684 × 342 PX`, Sample, None. Comparing,
  UNJUSTIFIED / NATIVE BROWSER · RAGGED. The header already says unjustified.
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
