# Prototypes

Design archive. Never built, bundled or deployed: `vite build` only takes `index.html`,
and `tsconfig.json` only checks `src`, `bench` and `tests`.

Each round lives in its own folder with its own `proto.css` and `proto.js`, so a later
round never changes an earlier one. Nothing here is imported by `src/`, and nothing here
imports from `src/`. Shared assets (fonts) sit in `fonts/` and are only read.

Open with the dev server: `pnpm dev`, then `/prototypes/lab/`.

- `lab/round-1/`: four ways to hold the controls (panel, toolbar, ledger, scrub).
- `lab/round-2/`: scrub values and pressable cells across panel, toolbar, spec and value bar.
