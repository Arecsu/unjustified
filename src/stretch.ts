/**
 * Splits a line's fill gap across adjustable tools (word spacing, tracking, …).
 *
 * Each tool i changes fill by kᵢ per unit and costs Bᵢ per unit². We minimize
 * A·(Σ kᵢxᵢ − gap)² + Σ Bᵢxᵢ² subject to minᵢ ≤ xᵢ ≤ maxᵢ. Unclamped,
 * xᵢ = (kᵢ/Bᵢ)·A·gap / (1 + A·Σ kⱼ²/Bⱼ). Tools that cross a bound are fixed
 * there, and the remaining gap is re-solved over the others. The objective is
 * convex and separable in the bounds, so this active-set loop converges in at
 * most one pass per tool.
 *
 * Tools are ordered loosest first; `fitMeasure` relies on that order.
 */
export interface Tool { k: number; b: number; min: number; max: number }

const enabled = (t: Tool) => t.k > 0 && (t.min < 0 || t.max > 0);

export function shareGap(gap: number, a: number, tools: Tool[], out: Float64Array): void {
  let free = 0;
  for (let i = 0; i < tools.length; i++) {
    out[i] = 0;
    if (enabled(tools[i])) free |= 1 << i;
  }
  while (free) {
    let remaining = gap, sum = 0, count = 0;
    for (let i = 0; i < tools.length; i++) {
      if (free & (1 << i)) { sum += tools[i].k * tools[i].k / tools[i].b; count++; }
      else if (out[i] !== 0) remaining -= tools[i].k * out[i];
    }
    let clamped = false;
    for (let i = 0; i < tools.length; i++) {
      if (!(free & (1 << i))) continue;
      const t = tools[i];
      // A lone tool keeps the original tracking expression, so results with
      // the new tools disabled stay bit-identical to the reference search.
      const x = count === 1
        ? a * t.k * remaining / (a * t.k * t.k + t.b)
        : t.k / t.b * a * remaining / (1 + a * sum);
      if (x < t.min) { out[i] = t.min; free &= ~(1 << i); clamped = true; }
      else if (x > t.max) { out[i] = t.max; free &= ~(1 << i); clamped = true; }
      else out[i] = x;
    }
    if (!clamped) break;
  }
}

/**
 * If the adjusted line is wider than the measure, shrink tools loosest first
 * until it fits or every tool is at its minimum. This admits a word that only
 * just doesn't fit naturally.
 */
export function fitMeasure(naturalFill: number, tools: Tool[], x: Float64Array): void {
  let used = 0;
  for (let i = 0; i < tools.length; i++) if (x[i] !== 0) used += tools[i].k * x[i];
  if (naturalFill + used <= 1) return;
  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    if (!enabled(t)) continue;
    const others = used - (x[i] !== 0 ? t.k * x[i] : 0);
    x[i] = Math.max(t.min, (1 - naturalFill - others) / t.k);
    used = others + (x[i] !== 0 ? t.k * x[i] : 0);
    if (naturalFill + used <= 1) return;
  }
}
