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
  doc_input(paragraphs: number, layouts: number): number;
  joint(paragraphs: number, factor: number): number;
  doc_output(): number;
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

export function jointKernel(instance: WebAssembly.Instance) {
  const wasm = instance.exports as unknown as Exports;
  return (counts: Int32Array, costs: Float64Array, kinds: Uint8Array, features: Float64Array, factor: number) => {
    const paragraphs = counts.length, layouts = costs.length;
    const pointer = wasm.doc_input(paragraphs, layouts);
    const input = new Float64Array(wasm.memory.buffer, pointer, paragraphs + layouts * 8);
    input.set(counts, 0);
    for (let i = 0, o = paragraphs; i < layouts; i++, o += 8) {
      input[o] = costs[i];
      input[o + 1] = kinds[i];
      input.set(features.subarray(i * 6, i * 6 + 6), o + 2);
    }
    wasm.joint(paragraphs, factor);
    const out = new Float64Array(wasm.memory.buffer, wasm.doc_output(), paragraphs + 1);
    return { chosen: Array.from(out.subarray(0, paragraphs)), explored: out[paragraphs] };
  };
}

/** Browser: compile and install from a URL. Failure leaves the JavaScript search. */
export async function loadSearchKernel(url: string | URL): Promise<boolean> {
  try {
    const { instance } = await WebAssembly.instantiateStreaming(fetch(url));
    setSearchKernel(searchKernel(instance), jointKernel(instance));
    return true;
  } catch {
    return false;
  }
}
