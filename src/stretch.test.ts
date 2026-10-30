import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitMeasure, shareGap } from './stretch';
import type { Tool } from './stretch';

const objective = (gap: number, a: number, tools: Tool[], x: number[]) =>
  a * (tools.reduce((n, t, i) => n + t.k * x[i], 0) - gap) ** 2
  + tools.reduce((n, t, i) => n + t.b * x[i] ** 2, 0);

/** Grid search: slow, obviously correct. */
function bruteForce(gap: number, a: number, tools: Tool[]): number[] {
  const steps = 160;
  const grid = (t: Tool) => Array.from({ length: steps + 1 }, (_, i) => t.min + (t.max - t.min) * i / steps);
  let best: number[] = tools.map(() => 0), bestCost = Infinity;
  const walk = (i: number, x: number[]) => {
    if (i === tools.length) {
      const cost = objective(gap, a, tools, x);
      if (cost < bestCost) { bestCost = cost; best = [...x]; }
      return;
    }
    for (const value of grid(tools[i])) walk(i + 1, [...x, value]);
  };
  walk(0, []);
  return best;
}

test('one tool reproduces the original tracking expression bit for bit', () => {
  const out = new Float64Array(1);
  for (const [a, k, gap, b, min, max] of [
    [100, 2.44, 0.05, 1000, -0.012, 0.012],
    [100, 1.7, -0.03, 1000, -0.04, 0],
    [240, 0.9, 0.2, 2, -0.08, 0.08],
    [0, 2, 0.1, 1000, -0.012, 0.012],
    [0, 2, -0.1, 1000, 0, 0.012], // −0 unclamped; a zero bound must give +0
  ]) {
    shareGap(gap, a, [{ k, b, min, max }], out);
    const original = Math.min(max, Math.max(min, a * k * gap / (a * k * k + b)));
    assert.equal(Object.is(out[0], original), true, `${out[0]} vs ${original}`);
  }
});

test('a disabled tool (zero bounds or zero effect) stays at zero and does not disturb the others', () => {
  const out = new Float64Array(2);
  const tracking = { k: 2.44, b: 1000, min: -0.012, max: 0.012 };
  shareGap(0.05, 100, [{ k: 0.4, b: 10, min: 0, max: 0 }, tracking], out);
  const alone = new Float64Array(1);
  shareGap(0.05, 100, [tracking], alone);
  assert.equal(out[0], 0);
  assert.equal(Object.is(out[1], alone[0]), true);
  shareGap(0.05, 100, [{ k: 0, b: 10, min: -1, max: 1 }, tracking], out);
  assert.equal(out[0], 0);
  assert.equal(Object.is(out[1], alone[0]), true);
});

test('matches a brute-force minimizer within grid resolution', () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = new Float64Array(2);
  for (let trial = 0; trial < 60; trial++) {
    const tools: Tool[] = [
      { k: 0.1 + random() * 0.5, b: 1 + random() * 20, min: -random() * 0.15, max: random() * 0.15 },
      { k: 1 + random() * 2, b: 200 + random() * 1000, min: -random() * 0.05, max: random() * 0.05 },
    ];
    const gap = (random() - 0.4) * 0.2;
    shareGap(gap, 100, tools, out);
    const best = bruteForce(gap, 100, tools);
    const ours = objective(gap, 100, tools, [out[0], out[1]]);
    const reference = objective(gap, 100, tools, best);
    assert.ok(ours <= reference + 1e-6, `trial ${trial}: ${ours} > ${reference}`);
    tools.forEach((t, i) => assert.ok(out[i] >= t.min - 1e-12 && out[i] <= t.max + 1e-12));
  }
});

test('the looser tool takes the larger share of the gap', () => {
  const out = new Float64Array(2);
  shareGap(0.04, 100, [{ k: 0.39, b: 10, min: -0.2, max: 0.2 }, { k: 2.44, b: 1000, min: -0.08, max: 0.08 }], out);
  assert.ok(0.39 * out[0] > 2.44 * out[1]);
});

test('fitMeasure reproduces the original single-tool fit and shrinks the loosest tool first', () => {
  const x = new Float64Array([0.01]);
  const tools = [{ k: 2.44, b: 1000, min: -0.012, max: 0.012 }];
  fitMeasure(0.99, tools, x);
  assert.equal(Object.is(x[0], Math.max(-0.012, (1 - 0.99) / 2.44)), true);

  const two = new Float64Array([0.05, 0.004]);
  const both = [{ k: 0.4, b: 10, min: -0.1, max: 0.1 }, { k: 2.44, b: 1000, min: -0.012, max: 0.012 }];
  fitMeasure(0.99, both, two);
  assert.ok(0.99 + 0.4 * two[0] + 2.44 * two[1] <= 1 + 1e-12);
  assert.equal(two[1], 0.004, 'tracking untouched when word spacing alone can fit the line');
});

test('fitMeasure leaves an already-fitting line alone', () => {
  const x = new Float64Array([0.002]);
  fitMeasure(0.9, [{ k: 2.44, b: 1000, min: -0.012, max: 0.012 }], x);
  assert.equal(x[0], 0.002);
});
