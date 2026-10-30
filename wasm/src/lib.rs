//! Paragraph beam search over a precomputed line table: a port of
//! `searchLinesJs` in src/optimizer.ts. Every floating-point expression keeps
//! the JavaScript operand order, so results are bit-identical.

const COLUMNS: usize = 9;
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
}

fn state() -> &'static mut State {
    // Single-threaded WebAssembly instance: one caller at a time.
    unsafe { (*core::ptr::addr_of_mut!(STATE)).get_or_insert_with(State::default) }
}

/// Room for `lines` rows of input, column-major: start, end, cost, tracking,
/// word spacing, kashida, kashida width, stretch, fill.
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

fn transition(t: &Table, a: usize, b: usize, last: bool, r: f64, font_size: f64) -> f64 {
    let (ws_a, ws_b) = (t.col(4, a), t.col(4, b));
    let (st_a, st_b) = (t.col(7, a), t.col(7, b));
    0.035 * r * sq((t.col(3, a) - t.col(3, b)) / 0.01)
        + (if ws_a != ws_b { 0.35 * WORD_STIFFNESS * r * sq(ws_a - ws_b) } else { 0.0 })
        + (if t.col(5, a) != t.col(5, b) {
            0.35 * KASHIDA_STIFFNESS * r * sq((t.col(6, a) - t.col(6, b)) / font_size)
        } else { 0.0 })
        + (if st_a != st_b { 0.35 * WIDTH_STIFFNESS * r * sq(st_a - st_b) } else { 0.0 })
        + (if last { 0.0 } else { 0.16 * sq((t.col(8, a) - t.col(8, b)) / 0.12) })
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

fn diversity(s: &mut State, t: &Table, paths: &[u32], count: usize, limit: usize, stride: usize) -> Vec<u32> {
    // Reset only the bins the previous call touched.
    for &key in &s.touched { s.bins[key] = -1; }
    s.touched.clear();
    let mut kept = Vec::with_capacity(limit);
    for &id in &paths[..count] {
        let id_us = id as usize;
        let key = s.depth[id_us] as usize * stride + t.start(s.line[id_us] as usize);
        let seen = if s.bins[key] < 0 { s.touched.push(key); 0 } else { s.bins[key] };
        s.bins[key] = seen + 1;
        if seen < 4 { kept.push(id); }
        if kept.len() >= limit { break; }
    }
    kept
}

fn prune(s: &mut State, t: &Table, mut paths: Vec<u32>, limit: usize, stride: usize) -> Vec<u32> {
    if paths.is_empty() { return paths; }
    let prefix = paths.len().min(limit * 4);
    select_cheapest(&mut paths, prefix, &s.cost, &mut s.keys);
    let mut kept = diversity(s, t, &paths, prefix, limit, stride);
    if kept.len() < limit && prefix < paths.len() {
        let all = paths.len();
        select_cheapest(&mut paths, all, &s.cost, &mut s.keys);
        kept = diversity(s, t, &paths, all, limit, stride);
    }
    kept
}

/// Runs the search over `lines` rows of input; returns how many layouts were
/// retained. Output, per layout: cost, line count, then that many line ids.
#[no_mangle]
pub extern "C" fn run(lines: usize, total: usize, beam: usize, r: f64, font_size: f64) -> usize {
    let s = state();
    let input = core::mem::take(&mut s.input);
    let t = Table { n: lines, data: &input[..lines * COLUMNS] };
    let stride = total + 1;
    s.bins.clear();
    s.bins.resize((total + 2) * stride, -1);
    s.touched.clear();
    s.prev.clear(); s.depth.clear(); s.cost.clear(); s.line.clear();
    s.prev.push(-1); s.depth.push(0); s.cost.push(0.0); s.line.push(-1);
    let mut paths: Vec<Vec<u32>> = vec![Vec::new(); total + 1];
    paths[0].push(0);
    let mut explored = 0.0;
    let mut line = 0;
    for start in 0..total {
        if start > 0 {
            let pending = core::mem::take(&mut paths[start]);
            paths[start] = prune(s, &t, pending, beam, stride);
        }
        let predecessors = core::mem::take(&mut paths[start]);
        while line < lines && t.start(line) == start {
            let end = t.col(1, line) as usize;
            let last = end == total;
            let line_cost = t.col(2, line);
            for &path in &predecessors {
                let p = path as usize;
                let previous = s.line[p];
                let added = if previous < 0 { 0.0 } else { transition(&t, previous as usize, line, last, r, font_size) };
                let id = s.cost.len() as u32;
                s.prev.push(path as i32);
                s.depth.push(s.depth[p] + 1);
                s.cost.push(s.cost[p] + line_cost + added);
                s.line.push(line as i32);
                paths[end].push(id);
                explored += 1.0;
            }
            if paths[end].len() > beam * 20 {
                let bucket = core::mem::take(&mut paths[end]);
                paths[end] = prune(s, &t, bucket, beam * 2, stride);
            }
            line += 1;
        }
    }
    let last = core::mem::take(&mut paths[total]);
    let retained = prune(s, &t, last, beam, stride);
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
    retained.len()
}
