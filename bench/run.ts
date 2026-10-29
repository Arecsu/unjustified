/**
 * Playwright driver for the DOM bench. Prints a JSON + table report.
 *
 *   pnpm dev --port 5199 &
 *   pnpm bench
 *
 * Set BENCH_URL to point at a running server (dev or preview).
 */
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';

const url = process.env.BENCH_URL ?? 'http://127.0.0.1:5199/bench.html';
const sizes = (process.env.BENCH_SIZES ?? '3,8,20,32,40').split(',').map(Number);
const repeat = Number(process.env.BENCH_REPEAT ?? 1);
const fmt = (n: number, digits = 1) => n.toFixed(digits).padStart(8);

/** Real app: layout shift from navigation to settled composition, for a
 *  6,000-character article applied through the editor. */
async function appCls(page: Page, paragraphs: string[]) {
  await page.goto(url.replace('/bench.html', '/'), { waitUntil: 'commit' });
  await page.evaluate(() => {
    (window as any).__shifts = [];
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as any[]) if (!entry.hadRecentInput) (window as any).__shifts.push({ v: entry.value, t: entry.startTime, sources: entry.sources?.length ?? 0 });
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.locator('#status-message').filter({ hasText: 'settled' }).waitFor({ timeout: 60000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const loadShifts = await page.evaluate(() => (window as any).__shifts as { v: number; t: number }[]);

  await page.locator('#edit-text').click();
  await page.locator('#text-editor').fill(paragraphs.join('\n\n'));
  await page.evaluate(() => { (window as any).__shiftCount = (window as any).__shifts.length; });
  await page.locator('#apply-text').click();
  await page.locator('#status-message').filter({ hasText: /settled|Widen the column/ }).waitFor({ timeout: 120000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const all = await page.evaluate(() => (window as any).__shifts as { v: number; t: number }[]);
  const count = await page.evaluate(() => (window as any).__shiftCount as number);
  return {
    loadCls: loadShifts.reduce((n, s) => n + s.v, 0),
    loadShiftCount: loadShifts.length,
    recomposeCls: all.slice(count).reduce((n, s) => n + s.v, 0),
    recomposeShiftCount: all.length - count,
  };
}

/** Blog fixture: CLS + paint marks for each integration strategy. */
async function blog(page: Page, mode: string, paragraphs = 35) {
  await page.goto(`${url.replace('/bench.html', '/bench/blog.html')}?mode=${mode}&n=${paragraphs}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => (window as any).blogReady === true, undefined, { timeout: 120000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  const data = await page.evaluate(() => {
    const blog = (window as any).__blog;
    const article = document.querySelector('#article')!;
    return {
      marks: blog.marks, shifts: (window as any).__shifts as number,
      articleHeight: article.getBoundingClientRect().height,
      paragraphs: article.querySelectorAll('p').length,
      longTasks: (blog.longTasks ?? []).length,
      shiftLog: (window as any).__shiftLog as { value: number; start: number; sources: number; nodes: string }[],
      resizeMarks: blog.resizeMarks ?? [],
      longTaskMs: (blog.longTasks ?? []).reduce((n: number, t: any) => n + t.duration, 0),
      lines: blog.result ? blog.result.paragraphs.reduce((n: number, p: any) => n + p.lines.length, 0) : 0,
    };
  });
  return data;
}

/** Blog fixture: resize burst, measuring long tasks and frame health. */
async function blogResize(page: Page, paragraphs = 35) {
  await page.goto(`${url.replace('/bench.html', '/bench/blog.html')}?mode=reserve&n=${paragraphs}`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).blogReady === true, undefined, { timeout: 120000 });
  return page.evaluate(async () => {
    const article = document.querySelector('#article') as HTMLElement;
    const longTasks: number[] = [];
    new PerformanceObserver(list => { for (const e of list.getEntries()) longTasks.push(e.duration); }).observe({ type: 'longtask' });
    const frames: number[] = [];
    let last = performance.now();
    let running = true;
    const tick = (t: number) => { frames.push(t - last); last = t; if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const widths = [640, 560, 480, 420, 390, 360, 320, 390, 480, 600, 640];
    const started = performance.now();
    for (const width of widths) {
      article.style.maxWidth = `${width}px`;
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => requestAnimationFrame(r));
    }
    running = false;
    frames.sort((a, b) => a - b);
    return {
      scenarioMs: performance.now() - started,
      medianFrameMs: frames[(frames.length / 2) | 0],
      worstFrameMs: frames.at(-1)!,
      longTasks: longTasks.length,
      longTaskMs: longTasks.reduce((n, d) => n + d, 0),
      shifts: (window as any).__shifts as number,
    };
  });
}

/** Real app: resize responsiveness — settled after a burst of viewport changes. */
async function appResize(page: Page) {
  await page.goto(url.replace('/bench.html', '/'), { waitUntil: 'load' });
  await page.locator('#status-message').filter({ hasText: 'settled' }).waitFor({ timeout: 60000 });
  return page.evaluate(async () => {
    const frames: number[] = [];
    let last = performance.now();
    let running = true;
    const tick = (t: number) => { frames.push(t - last); last = t; if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const widths = [1440, 1200, 1024, 900, 768, 640, 480, 390, 375, 320, 390, 640, 900, 1440];
    const started = performance.now();
    for (const width of widths) {
      // Drive the measure control exactly like a viewport resize does.
      const el = document.querySelector<HTMLInputElement>('#measure')!;
      el.value = String(Math.min(Number(el.max), width));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => requestAnimationFrame(r));
    }
    await new Promise<void>(resolve => {
      const check = () => document.querySelector('#status')!.classList.contains('is-busy') ? requestAnimationFrame(check) : resolve();
      check();
    });
    running = false;
    frames.sort((a, b) => a - b);
    return {
      scenarioMs: performance.now() - started,
      frames: frames.length,
      medianFrameMs: frames[(frames.length / 2) | 0],
      worstFrameMs: frames.at(-1)!,
      longFrames: frames.filter(f => f > 50).length,
    };
  });
}

const main = async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-precise-memory-info'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // tsx/esbuild injects `__name` into evaluated closures; define it in the page.
  await page.addInitScript(() => { (window as any).__name = (fn: any) => fn; });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(url);
  await page.waitForFunction(() => (window as any).benchReady === true, undefined, { timeout: 60000 });

  const only = process.env.BENCH_ONLY ?? 'all';
  const reports: any[] = [];
  for (let r = 0; only === 'all' || only === 'dom' ? r < repeat : false; r++) {
    for (const size of sizes) {
      const report = await page.evaluate(async n => await (window as any).bench.run(n), size);
      reports.push(report);
      console.log(`\n--- ${size} paragraphs, ${report.chars} chars, ${report.lines} lines ---`);
      console.log(`native geometry  ${fmt(report.nativeMs)} ms   (${report.nativeUnits} words, reps ${report.nativeReps.map((n: number) => n.toFixed(1)).join(' / ')})`);
      console.log(`worker cold      ${fmt(report.worker.roundTrip)} ms   search ${fmt(report.worker.searchMs)} measure ${fmt(report.worker.measureMs)} font ${fmt(report.worker.fontMs)} (${report.worker.measurements} calls)`);
      console.log(`worker warm      ${fmt(report.warm.roundTrip)} ms   search ${fmt(report.warm.searchMs)} measure ${fmt(report.warm.measureMs)} (${report.warm.measurements} calls)`);
      console.log(`main compose     ${fmt(report.main.total)} ms   ${report.main.measureCalls} calls, ${fmt(report.main.measureMs)} ms measuring`);
      console.log(`DOM commit       ${fmt(report.render.ms)} ms + ${fmt(report.render.layoutMs)} ms layout, ${report.render.elements} elements, CLS ${report.render.shift.toFixed(3)}`);
      console.log(`re-render        ${fmt(report.rerenderSameLayout.ms)} ms + ${fmt(report.rerenderSameLayout.layoutMs)} ms layout`);
      console.log(`resize           ${report.resize.map((x: any) => `${x.width}px: ${x.roundTrip.toFixed(0)}/${x.renderMs.toFixed(0)}/${x.layoutMs.toFixed(0)}ms`).join('  ')}`);
      console.log(`line delta       ${report.lineDelta.nativeLines} native vs ${report.lineDelta.composedLines} composed lines; ${report.lineDelta.changedParagraphs} paragraphs change height by ${report.lineDelta.heightDeltaPx.toFixed(0)} px total`);
      console.log(`copy integrity   ${report.copy.ok ? 'ok' : 'BROKEN'} (${report.copy.textLength} chars)`);
      console.log(`explored ${report.explored.toLocaleString()} paths, ${report.candidates} candidates`);
    }
  }

  const diagnostics = only === 'all' || only === 'dom'
    ? await page.evaluate(async n => await (window as any).bench.diagnostics(n), sizes.at(-1)!)
    : { visualizersMs: 0, guidesMs: 0, marks: 0 };
  console.log(`\ndiagnostics on ${sizes.at(-1)} paragraphs: ${diagnostics.visualizersMs.toFixed(1)} ms (${diagnostics.marks} marks), guides ${diagnostics.guidesMs.toFixed(1)} ms`);

  // Real app timings.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const cls = only === 'all' || only === 'app' ? await appCls(page, makeArticle()) : { loadCls: 0, loadShiftCount: 0, recomposeCls: 0, recomposeShiftCount: 0 };
  console.log(`\napp load CLS ${cls.loadCls.toFixed(4)} over ${cls.loadShiftCount} shifts`);
  console.log(`app recompose CLS ${cls.recomposeCls.toFixed(4)} over ${cls.recomposeShiftCount} shifts`);
  const resize = only === 'all' || only === 'app' ? await appResize(page) : { scenarioMs: 0, frames: 0, medianFrameMs: 0, worstFrameMs: 0, longFrames: 0 };
  const blogModes: Record<string, any> = {};
  for (const mode of ['naive', 'reserve', 'hidden', 'off']) {
    blogModes[mode] = await blog(page, mode);
    const m = blogModes[mode];
    const byPhase = (label: string, from: number, to: number) => {
      const v = m.shiftLog.filter((s: any) => s.start >= from && s.start < to).reduce((n: number, s: any) => n + s.value, 0);
      return v > 0.0001 ? `${label} ${v.toFixed(4)}` : '';
    };
    console.log(`blog ${mode.padEnd(8)} CLS ${m.shifts.toFixed(4)} (${m.shiftLog.map((s: any) => `${s.value.toFixed(4)}@${s.start.toFixed(0)}ms[${s.nodes}]`).join(' ')})`); console.log(`  ${' '.repeat(12)} · ${m.lines} lines · ${m.paragraphs} p · height ${m.articleHeight.toFixed(0)}px · long tasks ${m.longTasks} (${m.longTaskMs.toFixed(0)} ms) · settled ${(m.marks.settled ?? 0).toFixed(0)} ms (native ${(m.marks.native ?? 0).toFixed(0)}, worker ${(m.marks.search ?? 0).toFixed(0)} [rt ${(m.worker?.roundTrip ?? 0).toFixed(0)}, inside ${(m.worker?.elapsed ?? 0).toFixed(0)}, measure ${(m.worker?.measureMs ?? 0).toFixed(0)}, startup ${(m.worker?.startup ?? 0).toFixed(0)}], render ${(m.marks.render ?? 0).toFixed(0)}) · shifts: ${[byPhase('before-font', 0, m.marks.plain), byPhase('font-swap', m.marks.plain, m.marks.fonts), byPhase('swap', m.marks.fonts, 1e9)].filter(Boolean).join(', ') || 'none'}`);
    if (m.resizeMarks.length) console.log(`  resize marks ${m.resizeMarks.map((r: any) => `${r.width}px native ${r.native.toFixed(0)} + worker ${r.worker.toFixed(0)} + render ${r.render.toFixed(0)} + layout ${r.layout.toFixed(0)}`).join(' | ')}`);
  }
  const blogResizeReport = await blogResize(page);
  console.log(`blog resize burst ${blogResizeReport.scenarioMs.toFixed(0)} ms · median frame ${blogResizeReport.medianFrameMs.toFixed(1)} ms · worst ${blogResizeReport.worstFrameMs.toFixed(0)} ms · long tasks ${blogResizeReport.longTasks} (${blogResizeReport.longTaskMs.toFixed(0)} ms) · CLS ${blogResizeReport.shifts.toFixed(4)}`);
  console.log(`app resize burst ${resize.scenarioMs.toFixed(0)} ms, median frame ${resize.medianFrameMs.toFixed(1)} ms, worst ${resize.worstFrameMs.toFixed(0)} ms, ${resize.longFrames} long frames`);

  console.log(`\npage errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  console.log(`\nJSON ${JSON.stringify({ reports, diagnostics, cls, resize, blogModes, blogResizeReport, errors })}`);
  await browser.close();
};

/** ~6,000 UTF-16 characters of the deterministic corpus, as the editor accepts. */
function makeArticle() {
  const words = 'the of and to a in that is was for it with as his on be at by this had not are but from or have an they which one you were her all she there would their we him been has when who will more no if out said what up its about into than them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three states himself few house use during without again place around however home small found thought went say part once general high upon school every don t does got united left number course war until always away something fact water though less public put think almost hand enough far took head yet'.split(' ');
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const paragraphs: string[] = [];
  let total = 0;
  while (total < 5600) {
    const sentences: string[] = [];
    const sentencesCount = 3 + Math.floor(random() * 3);
    for (let s = 0; s < sentencesCount; s++) {
      const line: string[] = [];
      const count = 6 + Math.floor(random() * 12);
      for (let w = 0; w < count; w++) line.push(words[Math.floor(Math.pow(random(), 1.4) * words.length)]);
      line[0] = line[0][0].toUpperCase() + line[0].slice(1);
      sentences.push(line.join(' ') + '.');
    }
    const text = sentences.join(' ');
    paragraphs.push(text);
    total += text.length + 2;
  }
  return paragraphs;
}

void main();
