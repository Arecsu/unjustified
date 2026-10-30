/**
 * Font installation inside a worker, shared by the composer and its paragraph
 * helpers: faces come from binaries the page already fetched, and width-step
 * faces are built from the same binaries on demand.
 */
import { fontBinaries, installWidthSteps, widthSteps } from './fonts';
import type { FontBinary } from './fonts';

export function createFontInstaller(set: FontFaceSet) {
  const installed = new Map<string, Promise<FontFace>>();
  const steps = new Map<string, Promise<FontFace>>();
  /** Every binary received so far, in order: forwarded to new helpers. */
  const received: FontBinary[] = [];
  return {
    received,
    /** Returns whether the set was usable; a failure lets the caller fetch instead. */
    async install(fonts: FontBinary[] | undefined): Promise<boolean> {
      try {
        for (const font of fonts ?? []) {
          const key = `${font.family}:${font.weight}:${font.range}`;
          if (installed.has(key)) continue;
          received.push(font);
          const face = new FontFace(font.family, font.data, { weight: font.weight, unicodeRange: font.range,
            ...(font.stretch ? { stretch: font.stretch } : {}) });
          set.add(face);
          installed.set(key, face.load().catch(error => {
            installed.delete(key);
            throw error;
          }));
        }
        // Warm-up and a compose can overlap while a FontFace loads. Both await the
        // same job; warm resize requests neither clone nor decode these fonts again.
        await Promise.all(installed.values());
        return installed.size > 0;
      } catch {
        return false;
      }
    },
    async installSteps(flex: number): Promise<void> {
      const list = widthSteps(flex);
      if (list.length) await installWidthSteps([...received, ...fontBinaries()], list, set, steps);
    },
  };
}
