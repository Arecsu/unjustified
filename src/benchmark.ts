export interface RunTiming {
  totalMs: number;
  fontMs: number;
  nativeMs: number;
  measureMs: number;
  searchMs: number;
  renderMs: number;
  otherMs: number;
  queueMs: number;
  mode: 'cold' | 'warm';
  measurements: number;
}
const ms = (n: number) => `${Math.max(0, n).toFixed(1)} ms`;
export function publishTiming(timing: RunTiming) {
  document.querySelector('#benchmark-total')!.textContent = ms(timing.totalMs);
  document.querySelector('#benchmark-mode')!.textContent = `${timing.mode === 'cold' ? 'Cold layout' : 'Cached layout'} · start → next paint opportunity`;
  document.querySelector('#benchmark-breakdown')!.innerHTML = [
    ['Font readiness', timing.fontMs], ['Native A geometry', timing.nativeMs],
    ['Canvas measurement', timing.measureMs], ['TypeScript search', timing.searchMs],
    ['DOM + frame wait', timing.renderMs], ['Startup / transport / other', timing.otherMs],
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${ms(Number(value))}</dd></div>`).join('');
  document.querySelector('#benchmark-queue')!.textContent = `Pending-input wait (no debounce): ${ms(timing.queueMs)} separately; interaction-to-frame: ${ms(timing.totalMs + timing.queueMs)}. ${timing.measurements.toLocaleString()} new Canvas measurements.`;
}
export async function benchmark(recompose: (cold: boolean) => Promise<RunTiming | undefined>) {
  const button = document.querySelector<HTMLButtonElement>('#benchmark-run')!;
  const result = document.querySelector('#benchmark-result')!;
  button.disabled = true;
  button.textContent = 'Measuring…';
  result.textContent = 'One cold-layout run, then five cached runs. Keep this tab visible.';
  try {
    const cold = await recompose(true);
    if (!cold) throw new Error('Benchmark interrupted by a new composition.');
    const warm: RunTiming[] = [];
    for (let i = 0; i < 5; i++) {
      const timing = await recompose(false);
      if (!timing) throw new Error('Benchmark interrupted by a new composition.');
      warm.push(timing);
    }
    const sorted = warm.map(t => t.totalMs).sort((a, b) => a - b);
    result.textContent = `Cold layout: ${ms(cold.totalMs)} · cached median: ${ms(sorted[2])} · cached max: ${ms(sorted[4])} (5 runs). Fonts may be HTTP-cached; this is not a cold-network test.`;
    Object.assign(window, { __benchmark: { cold, warm } });
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
    button.textContent = 'Benchmark cold + cached';
  }
}
