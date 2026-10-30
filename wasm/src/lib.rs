//! Paragraph beam search over a precomputed line table: a port of
//! `searchLinesJs` in src/optimizer.ts. Every floating-point expression keeps
//! the JavaScript operand order, so results are bit-identical.

const COLUMNS: usize = 10;
const WORD_STIFFNESS: f64 = 10.0;
const KASHIDA_STIFFNESS: f64 = 0.5;
const WIDTH_STIFFNESS: f64 = 0.015;

static mut STATE: Option<State> = None;

#[derive(Default)]
struct State {
    input: Vec<f64>,
    output: Vec<f64>,
    explored: f64,
    prev: Vec<i32>,
    depth: Vec<i32>,
    cost: Vec<f64>,
    line: Vec<i32>,
    bins: Vec<i32>,
    touched: Vec<usize>,
    keys: Vec<u128>,
    kept: Vec<u32>,
    paths: Vec<Vec<u32>>,
    predecessors: Vec<u32>,
}

fn state() -> &'static mut State {
    // Single-threaded WebAssembly instance: one caller at a time.
    unsafe { (*core::ptr::addr_of_mut!(STATE)).get_or_insert_with(State::default) }
}

/// Room for `lines` rows of input, column-major: start, end, cost, tracking,
/// word spacing, kashida, kashida width, stretch, fill, hyphen.
#[no_mangle]
pub extern "C" fn input(lines: usize) -> *mut f64 {
    let s = state();
    s.input.resize(lines * COLUMNS, 0.0);
    s.input.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn output() -> *const f64 { state().output.as_ptr() }
#[no_mangle]
pub extern "C" fn output_len() -> usize { state().output.len() }
#[no_mangle]
pub extern "C" fn explored() -> f64 { state().explored }

#[inline]
fn sq(n: f64) -> f64 { n * n }

struct Table<'a> { n: usize, data: &'a [f64] }
impl Table<'_> {
    #[inline] fn col(&self, c: usize, i: usize) -> f64 { self.data[c * self.n + i] }
    #[inline] fn start(&self, i: usize) -> usize { self.col(0, i) as usize }
}

fn transition(t: &Table, a: usize, b: usize, last: bool, r: f64, font_size: f64, stack: f64) -> f64 {
    let (ws_a, ws_b) = (t.col(4, a), t.col(4, b));
    let (st_a, st_b) = (t.col(7, a), t.col(7, b));
    0.035 * r * sq((t.col(3, a) - t.col(3, b)) / 0.01)
        + (if ws_a != ws_b { 0.35 * WORD_STIFFNESS * r * sq(ws_a - ws_b) } else { 0.0 })
        + (if t.col(5, a) != t.col(5, b) {
            0.35 * KASHIDA_STIFFNESS * r * sq((t.col(6, a) - t.col(6, b)) / font_size)
        } else { 0.0 })
        + (if st_a != st_b { 0.35 * WIDTH_STIFFNESS * r * sq(st_a - st_b) } else { 0.0 })
        + (if last { 0.0 } else { 0.16 * sq((t.col(8, a) - t.col(8, b)) / 0.12) })
        + (if t.col(9, a) != 0.0 && t.col(9, b) != 0.0 { stack } else { 0.0 })
}

/// Cost, then insertion order, as one integer: a total order, so the kept set
/// is unique whatever selection algorithm finds it. `+ 0.0` folds -0 into +0,
/// which JavaScript also treats as equal; the bit flip orders any finite f64.
#[inline]
fn key(cost: f64, id: u32) -> u128 {
    let bits = (cost + 0.0).to_bits();
    let ordered = if bits >> 63 == 1 { !bits } else { bits | (1 << 63) };
    ((ordered as u128) << 32) | id as u128
}

fn select_cheapest(paths: &mut [u32], k: usize, cost: &[f64], keys: &mut Vec<u128>) {
    keys.clear();
    keys.extend(paths.iter().map(|&id| key(cost[id as usize], id)));
    if k >= keys.len() {
        keys.sort_unstable();
    } else {
        keys.select_nth_unstable(k - 1);
        keys[..k].sort_unstable();
    }
    for (path, k) in paths.iter_mut().zip(keys.iter()) { *path = *k as u32; }
}

/// Fills `s.kept` with the first `limit` paths whose (depth, line start) bin
/// has fewer than four entries so far.
fn diversity(s: &mut State, t: &Table, paths: &[u32], count: usize, limit: usize, stride: usize) {
    // Reset only the bins the previous call touched.
    for &key in &s.touched { s.bins[key] = -1; }
    s.touched.clear();
    s.kept.clear();
    for &id in &paths[..count] {
        let id_us = id as usize;
        let key = s.depth[id_us] as usize * stride + t.start(s.line[id_us] as usize);
        let seen = if s.bins[key] < 0 { s.touched.push(key); 0 } else { s.bins[key] };
        s.bins[key] = seen + 1;
        if seen < 4 { s.kept.push(id); }
        if s.kept.len() >= limit { break; }
    }
}

/// Prunes `paths` in place.
fn prune(s: &mut State, t: &Table, paths: &mut Vec<u32>, limit: usize, stride: usize) {
    if paths.is_empty() { return; }
    let prefix = paths.len().min(limit * 4);
    select_cheapest(paths, prefix, &s.cost, &mut s.keys);
    diversity(s, t, paths, prefix, limit, stride);
    if s.kept.len() < limit && prefix < paths.len() {
        let all = paths.len();
        select_cheapest(paths, all, &s.cost, &mut s.keys);
        diversity(s, t, paths, all, limit, stride);
    }
    paths.clear();
    paths.extend_from_slice(&s.kept);
}

/// Runs the search over `lines` rows of input; returns how many layouts were
/// retained. Output, per layout: cost, line count, then that many line ids.
#[no_mangle]
pub extern "C" fn run(lines: usize, total: usize, beam: usize, r: f64, font_size: f64, stack: f64) -> usize {
    let s = state();
    let input = core::mem::take(&mut s.input);
    let t = Table { n: lines, data: &input[..lines * COLUMNS] };
    let stride = total + 1;
    s.bins.clear();
    s.bins.resize((total + 2) * stride, -1);
    s.touched.clear();
    s.prev.clear(); s.depth.clear(); s.cost.clear(); s.line.clear();
    s.prev.push(-1); s.depth.push(0); s.cost.push(0.0); s.line.push(-1);
    let mut paths = core::mem::take(&mut s.paths);
    for bucket in paths.iter_mut() { bucket.clear(); }
    paths.resize_with(total + 1, Vec::new);
    paths[0].push(0);
    let mut predecessors = core::mem::take(&mut s.predecessors);
    let mut explored = 0.0;
    let mut line = 0;
    for start in 0..total {
        if start > 0 { prune(s, &t, &mut paths[start], beam, stride); }
        // Swap out rather than borrow: the loop pushes into later buckets.
        core::mem::swap(&mut predecessors, &mut paths[start]);
        while line < lines && t.start(line) == start {
            let end = t.col(1, line) as usize;
            let last = end == total;
            let line_cost = t.col(2, line);
            for &path in &predecessors {
                let p = path as usize;
                let previous = s.line[p];
                let added = if previous < 0 { 0.0 } else { transition(&t, previous as usize, line, last, r, font_size, stack) };
                let id = s.cost.len() as u32;
                s.prev.push(path as i32);
                s.depth.push(s.depth[p] + 1);
                s.cost.push(s.cost[p] + line_cost + added);
                s.line.push(line as i32);
                paths[end].push(id);
                explored += 1.0;
            }
            if paths[end].len() > beam * 20 { prune(s, &t, &mut paths[end], beam * 2, stride); }
            line += 1;
        }
        predecessors.clear();
    }
    prune(s, &t, &mut paths[total], beam, stride);
    let retained = core::mem::take(&mut paths[total]);
    s.output.clear();
    for &id in &retained {
        let depth = s.depth[id as usize] as usize;
        s.output.push(s.cost[id as usize]);
        s.output.push(depth as f64);
        let base = s.output.len();
        s.output.resize(base + depth, 0.0);
        let mut node = id as usize;
        for i in (0..depth).rev() {
            s.output[base + i] = s.line[node] as f64;
            node = s.prev[node] as usize;
        }
    }
    s.explored = explored;
    s.input = input;
    let count = retained.len();
    paths[total] = retained;
    s.paths = paths;
    s.predecessors = predecessors;
    count
}

// ---------------------------------------------------------------------------
// Document stage: a port of `composeCandidates` (src/optimizer.ts). Each
// frontier state keeps running moments of the six shape features, so the
// pairwise term is O(1) per insertion.

const FEATURES: usize = 6;
const WEIGHTS: [f64; FEATURES] = [2.0, 2.0, 0.25, 0.25, 0.25, 0.25];
const EMPTY: u8 = 0;
const HAS_BODY: u8 = 2;
/// Per layout: cost, kind, six features.
const LAYOUT_COLUMNS: usize = 2 + FEATURES;

#[derive(Clone, Copy, Default)]
struct DocState {
    parent: u32,
    layout: u32,
    cost: f64,
    count: f64,
    body_count: f64,
    sum0: f64,
    sum_sq0: f64,
    sum_body: [f64; FEATURES - 1],
    sum_sq_body: [f64; FEATURES - 1],
}

static mut DOC: Option<DocBuffers> = None;
#[derive(Default)]
struct DocBuffers { input: Vec<f64>, output: Vec<f64>, keys: Vec<u128>, generations: Vec<Vec<DocState>> }
fn doc() -> &'static mut DocBuffers {
    unsafe { (*core::ptr::addr_of_mut!(DOC)).get_or_insert_with(DocBuffers::default) }
}

/// Room for the layout count of each paragraph, then `layouts` rows of
/// LAYOUT_COLUMNS values.
#[no_mangle]
pub extern "C" fn doc_input(paragraphs: usize, layouts: usize) -> *mut f64 {
    let d = doc();
    d.input.resize(paragraphs + layouts * LAYOUT_COLUMNS, 0.0);
    d.input.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn doc_output() -> *const f64 { doc().output.as_ptr() }

/// `pairCost`: the factor scales the whole sum.
fn pair_cost(state: &DocState, f: &[f64], kind: u8, factor: f64) -> f64 {
    if kind == EMPTY { return 0.0; }
    let v = f[0];
    let mut cost = WEIGHTS[0] * (state.count * v * v - 2.0 * v * state.sum0 + state.sum_sq0);
    if kind == HAS_BODY {
        for i in 1..FEATURES {
            let value = f[i];
            cost += WEIGHTS[i]
                * (state.body_count * value * value - 2.0 * value * state.sum_body[i - 1] + state.sum_sq_body[i - 1]);
        }
    }
    factor * cost
}

/// `childState`: the factor scales each term.
fn child_state(parent: &DocState, parent_index: u32, layout: u32, layout_cost: f64, f: &[f64], kind: u8, factor: f64) -> DocState {
    let mut next = *parent;
    next.parent = parent_index;
    next.layout = layout;
    let mut cost = parent.cost + layout_cost;
    if kind != EMPTY {
        let v = f[0];
        cost += factor * WEIGHTS[0] * (next.count * v * v - 2.0 * v * next.sum0 + next.sum_sq0);
        next.count += 1.0; next.sum0 += v; next.sum_sq0 += v * v;
        if kind == HAS_BODY {
            for i in 1..FEATURES {
                let value = f[i];
                let sum = parent.sum_body[i - 1];
                let sum_sq = parent.sum_sq_body[i - 1];
                cost += factor * WEIGHTS[i] * (parent.body_count * value * value - 2.0 * value * sum + sum_sq);
                next.sum_body[i - 1] = sum + value;
                next.sum_sq_body[i - 1] = sum_sq + value * value;
            }
            next.body_count += 1.0;
        }
    }
    next.cost = cost;
    next
}

/// Chooses one layout per paragraph. Output: the chosen layout index for each
/// paragraph, then the number of combinations scored.
#[no_mangle]
pub extern "C" fn joint(paragraphs: usize, factor: f64) -> usize {
    let d = doc();
    let input = core::mem::take(&mut d.input);
    let counts: Vec<usize> = input[..paragraphs].iter().map(|&n| n as usize).collect();
    let rows = &input[paragraphs..];
    let mut generations = core::mem::take(&mut d.generations);
    generations.resize_with(paragraphs + 1, Vec::new);
    for g in generations.iter_mut() { g.clear(); }
    generations[0].push(DocState::default());
    let mut explored = 0.0;
    let mut offset = 0;
    for i in 0..paragraphs {
        let n = counts[i];
        let limit = if paragraphs <= 3 && i < paragraphs - 1 { 1200 } else { 128 };
        let (done, rest) = generations.split_at_mut(i + 1);
        let frontier = &done[i];
        // Every (state, layout) combination, keyed by (cost, insertion order):
        // the same order as the JavaScript bounded heap.
        d.keys.clear();
        let mut order: u32 = 0;
        for state in frontier.iter() {
            for k in 0..n {
                let row = &rows[(offset + k) * LAYOUT_COLUMNS..(offset + k + 1) * LAYOUT_COLUMNS];
                let cost = state.cost + row[0] + pair_cost(state, &row[2..], row[1] as u8, factor);
                d.keys.push(key(cost, order));
                order += 1;
            }
        }
        explored += order as f64;
        let keep = limit.min(d.keys.len());
        if keep > 0 && keep < d.keys.len() { d.keys.select_nth_unstable(keep - 1); }
        d.keys[..keep].sort_unstable();
        let next = &mut rest[0];
        for &packed in &d.keys[..keep] {
            let insertion = packed as u32 as usize;
            let f = insertion / n;
            let k = insertion - f * n;
            let row = &rows[(offset + k) * LAYOUT_COLUMNS..(offset + k + 1) * LAYOUT_COLUMNS];
            next.push(child_state(&frontier[f], f as u32, k as u32, row[0], &row[2..], row[1] as u8, factor));
        }
        offset += n;
    }
    d.output.clear();
    d.output.resize(paragraphs + 1, 0.0);
    // Walk back from the best final state.
    let mut index = 0usize;
    for i in (0..paragraphs).rev() {
        let state = generations[i + 1][index];
        d.output[i] = state.layout as f64;
        index = state.parent as usize;
    }
    d.output[paragraphs] = explored;
    d.input = input;
    d.generations = generations;
    paragraphs
}
