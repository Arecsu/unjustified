/**
 * Loads the WebAssembly paragraph search (wasm/, built with `pnpm build:wasm`)
 * and installs it in the optimizer. Without it, the JavaScript search runs.
 */
import { setSearchKernel } from './optimizer';
import type { LineColumns, SearchResult } from './optimizer';

interface Exports {
  memory: WebAssembly.Memory;
  input(lines: number): number;
  run(lines: number, total: number, beam: number, restraint: number, fontSize: number): number;
  output(): number;
  output_len(): number;
  explored(): number;
}

export function searchKernel(instance: WebAssembly.Instance) {
  const wasm = instance.exports as unknown as Exports;
  return (t: LineColumns, total: number, beam: number, restraint: number, fontSize: number): SearchResult => {
    const n = t.start.length;
    // Take views only after calls that may grow memory.
    const pointer = wasm.input(n);
    const input = new Float64Array(wasm.memory.buffer, pointer, n * 9);
    input.set(t.start, 0); input.set(t.end, n); input.set(t.cost, 2 * n); input.set(t.tracking, 3 * n);
    input.set(t.wordSpacing, 4 * n); input.set(t.kashida, 5 * n); input.set(t.kashidaWidth, 6 * n);
    input.set(t.stretch, 7 * n); input.set(t.fill, 8 * n);
    const count = wasm.run(n, total, beam, restraint, fontSize);
    const outPointer = wasm.output(), outLength = wasm.output_len();
    const out = new Float64Array(wasm.memory.buffer, outPointer, outLength);
    const retained: SearchResult['retained'] = [];
    for (let i = 0, o = 0; i < count; i++) {
      const cost = out[o], length = out[o + 1];
      retained.push({ cost, ids: Array.from(out.subarray(o + 2, o + 2 + length)) });
      o += 2 + length;
    }
    return { retained, explored: wasm.explored() };
  };
}

/** Browser: compile and install from a URL. Failure leaves the JavaScript search. */
export async function loadSearchKernel(url: string | URL): Promise<boolean> {
  try {
    const { instance } = await WebAssembly.instantiateStreaming(fetch(url));
    setSearchKernel(searchKernel(instance));
    return true;
  } catch {
    return false;
  }
}
