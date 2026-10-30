import { defineConfig } from 'vite';

/** Cross-origin isolation: browsers only give isolated pages fine-grained
 *  `performance.now()`, which the timing panel needs for millisecond-scale work.
 *  Every resource here is same-origin, so nothing else changes. */
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers: isolation },
  preview: { headers: isolation },
});
