// The store: an append-only JSON Lines log (docs/spec/FORMAT.md) read into flat
// records, plus the index image (tg.idx) and the stat cache (stat.cache).
// Strings live in one arena and are referred to by Span, so no record holds
// a slice of another buffer.
import std;
import os;
import json;
import native;
import dictionary;

struct Span { off: i64, len: i64 }

// A name/value pair: a context field, an env entry, or a snapshot entry.
struct Kv { k: Span, v: Span }

// One input of an observation. kind: 0 file, 1 dir, 2 probe, 3 env,
// 4 env_all, 5 declared. Env entries of an env_all snapshot live in g_kvs
// at [env_from, env_from + env_n).
struct Inp {
    kind: i64,
    path: Span,
    hash: Span,
    name: Span,
    vh: Span,
    env_from: i64,
    env_n: i64,
    has_snap: bool,
}

// outcome: 0 pass, 1 fail, 2 error, 3 none. line: the record as logged.
struct Ob {
    task: i64,
    ctx_from: i64,
    ctx_n: i64,
    baseline: Span,
    dirty: bool,
    outcome: i64,
    inp_from: i64,
    inp_n: i64,
    line: Span,
}

// chain: the next task index with the same hash of its id, or -1.
struct Task { id: Span, forgotten: bool, latest: i64, chain: i64 }

// One stat cache entry (spec 6.3, 7.6).
struct CEnt { path: Span, size: i64, mtime: i64, hash: Span }

// Reverse indexes (spec 6.5). A posting says that input inp of observation obs
// sits on the path of its list. Postings of one list form a linked list
// through next (an index into g_post, -1 at the end).
struct Post { obs: i64, inp: i64, next: i64 }

// A path with the heads of its three lists: rd readers (file and declared
// inputs), ls dir listers, pr probers. chain links paths with the same hash.
struct PathE { p: Span, chain: i64, rd: i64, ls: i64, pr: i64 }

// The resizable collections are globals: a struct may hold at most one
// resizable value, and it must be its last field (spec 3.4).
var g_arena: u8[>..] = [];
// Text -> the arena span holding it, so each distinct string is stored once.
var g_intern: dictionary<u64, Span> = dictionary<u64, Span> {};
var g_kvs: Kv[>..] = [];
var g_inps: Inp[>..] = [];
var g_obs: Ob[>..] = [];
var g_tasks: Task[>..] = [];
// Hash of a task id -> the newest task index with that hash.
var g_task_head: dictionary<u64, i64> = dictionary<u64, i64> {};
// The whole log as read, including any truncated tail.
var g_logbuf: u8[>..] = [];
// Bytes of g_logbuf whose complete lines are applied to the state.
var g_applied: i64 = 0;
var g_cache: CEnt[>..] = [];
// Path table and the postings of every observation's path inputs.
var g_paths: PathE[>..] = [];
var g_post: Post[>..] = [];
// Hash of a path -> the newest path index with that hash.
var g_path_head: dictionary<u64, i64> = dictionary<u64, i64> {};
// Observations that can give a reason without a change: dirty, failed, or
// with env inputs. Entries that are no longer live are dropped at query time.
var g_standing: i64[>..] = [];
// Number of tasks that are live (latest observation, not forgotten).
var g_live: i64 = 0;
// Size and mtime of the log as last read, see refresh_log.
var g_log_mtime: i64 = 0;
var g_stat_known: bool = false;

struct Store {
    baseline: Span,
    has_baseline: bool,
    ctx_from: i64,
    ctx_n: i64,
    has_ctx: bool,
}

fn store_reset(st: Store&) {
    g_idx_current = false;
    g_arena.clear();
    g_intern.clear();
    g_kvs.clear();
    g_inps.clear();
    g_obs.clear();
    g_tasks.clear();
    g_task_head.clear();
    g_paths.clear();
    g_post.clear();
    g_path_head.clear();
    g_standing.clear();
    g_live = 0;
    g_logbuf.clear();
    g_applied = 0;
    st.baseline = Span { off: 0, len: 0 };
    st.has_baseline = false;
    st.ctx_from = 0;
    st.ctx_n = 0;
    st.has_ctx = false;
}

fn put(st: Store&, s: const u8[:]) -> Span {
    let off = g_arena.len;
    g_arena.append(s);
    return Span { off: off, len: s.len };
}

fn text(st: Store&, s: Span) -> const u8[:] {
    return g_arena[s.off .. s.off + s.len];
}

// The span of text s, shared with an equal string already in the arena.
fn intern(st: Store&, s: const u8[:]) -> Span {
    let h = hash(s);
    let hit = g_intern.get(h);
    if hit {
        if same(st, hit, s) { return hit; }
    }
    let sp = put(st, s);
    g_intern.insert(h, sp);
    return sp;
}

// The log bytes of an observation's record. Lines are spans of g_logbuf, the
// log as read: appends never move them, and a rewritten log is reloaded.
fn line_text(s: Span) -> const u8[:] {
    return g_logbuf[s.off .. s.off + s.len];
}

fn same(st: Store&, s: Span, t: const u8[:]) -> bool {
    return s.len == t.len && text(st, s) == t;
}

// A task is live when its latest observation stands and it is not forgotten.
fn task_live(ti: i64) -> bool {
    return g_tasks[ti].latest >= 0 && !g_tasks[ti].forgotten;
}

// Task lookup by id: a hash of the id gives the head of a chain of tasks
// that share the hash, and the chain is compared by bytes (so a hash
// collision cannot give a wrong task).
fn find_task(st: Store&, id: const u8[:]) -> i64 {
    let h = hash(id);
    let head = g_task_head.get(h);
    if !head { return -1; }
    var i = head;
    while i >= 0 {
        if same(st, g_tasks[i].id, id) { return i; }
        i = g_tasks[i].chain;
    }
    return -1;
}

fn task_index(st: Store&, id: const u8[:]) -> i64 {
    let i = find_task(st, id);
    if i >= 0 { return i; }
    let h = hash(id);
    let head = g_task_head.get(h);
    var next: i64 = -1;
    if head { next = head; }
    g_tasks.push(Task { id: put(st, id), forgotten: false, latest: -1, chain: next });
    g_task_head.insert(h, g_tasks.len - 1);
    return g_tasks.len - 1;
}

// A scalar as JSON text; anything else as null.
fn scalar_only(n: json::Node?, out: u8[>..]&) {
    if !n { out.append("null"); return; }
    let s, sok = json::as_string(n);
    if sok { json::format_string(out, s); return; }
    let i, iok = json::as_i64(n);
    if iok { json::format_int(out, i); return; }
    let b, bok = json::as_bool(n);
    if bok { json::format_bool(out, b); return; }
    let f, fok = json::as_f64(n);
    if fok { json::format_number(out, f); return; }
    out.append("null");
}

// Canonical form of a context or env value: a scalar as its JSON text, or
// an object (such as caps) as { key: scalar, ... } in member order.
fn scalar_text(n: json::Node?, out: u8[>..]&) {
    if !n { return; }
    let s, sok = json::as_string(n);
    let i, iok = json::as_i64(n);
    let b, bok = json::as_bool(n);
    let f, fok = json::as_f64(n);
    if sok || iok || bok || fok { scalar_only(n, out); return; }
    var first = true;
    out.push('{');
    json::each(n) { c =>
        if !first { out.push(','); }
        first = false;
        json::format_string(out, c.key);
        out.push(':');
        scalar_only(c, out);
    };
    out.push('}');
}

// Each member of an object becomes a Kv. raw: a string value is kept as its
// bare text (env values, which inputs store bare); otherwise the value is
// canonical JSON text (contexts and caps). Returns first index and count.
fn read_pairs(st: Store&, obj: json::Node?, raw: bool) -> i64, i64 {
    let from = g_kvs.len;
    if !obj { return from, 0; }
    json::each(obj) { child =>
        var v: u8[>..] = [];
        let s, sok = json::as_string(child);
        if raw && sok { v.append(s); } else { scalar_text(child, v); }
        g_kvs.push(Kv { k: intern(st, child.key), v: intern(st, v) });
    };
    return from, g_kvs.len - from;
}

// Reads one observation object into the state. line is the record as it is
// logged, kept so that compaction and the index can write it again.
fn add_obs(st: Store&, o: json::Node?, line: Span) -> bool {
    let tid, ok = json::as_string(json::member(o, "task"));
    if !ok { return false; }
    let bl, bok = json::as_string(json::member(o, "baseline"));
    if !bok { return false; }
    let dirty, dok = json::as_bool(json::member(o, "dirty"));
    let oc, ook = json::as_string(json::member(o, "outcome"));
    var outcome: i64 = 3;
    if ook {
        if oc == "pass" { outcome = 0; }
        else if oc == "fail" { outcome = 1; }
        else if oc == "error" { outcome = 2; }
    }
    let cfrom, cn = read_pairs(st, json::member(o, "context"), false);
    let ti = task_index(st, tid);
    let ifrom = g_inps.len;
    var env_any = false;
    let inputs = json::member(o, "inputs");
    if inputs {
        json::each(inputs) { inp =>
            let kstr, kok = json::as_string(json::member(inp, "kind"));
            var kind: i64 = -1;
            if kok {
                if kstr == "file" { kind = 0; }
                else if kstr == "dir" { kind = 1; }
                else if kstr == "probe" { kind = 2; }
                else if kstr == "env" { kind = 3; }
                else if kstr == "env_all" { kind = 4; }
                else if kstr == "declared" { kind = 5; }
            }
            let p, pok = json::as_string(json::member(inp, "path"));
            let h, hok = json::as_string(json::member(inp, "hash"));
            let nm, nok = json::as_string(json::member(inp, "name"));
            let vh, vok = json::as_string(json::member(inp, "value_hash"));
            var efrom: i64 = g_kvs.len;
            var en: i64 = 0;
            var snap = false;
            if kind == 4 {
                snap = json::member(inp, "snapshot") != null;
                efrom, en = read_pairs(st, json::member(inp, "snapshot"), true);
            }
            let ps = if pok { intern(st, p) } else { Span { off: 0, len: 0 } };
            let hs = if hok { intern(st, h) } else { Span { off: 0, len: 0 } };
            let ns = if nok { intern(st, nm) } else { Span { off: 0, len: 0 } };
            let vs = if vok { intern(st, vh) } else { Span { off: 0, len: 0 } };
            if kind == 3 || kind == 4 { env_any = true; }
            g_inps.push(Inp { kind: kind, path: ps, hash: hs, name: ns, vh: vs,
                env_from: efrom, env_n: en, has_snap: snap });
        };
    }
    let ni = g_inps.len - ifrom;
    let bs = intern(st, bl);
    g_obs.push(Ob { task: ti, ctx_from: cfrom, ctx_n: cn, baseline: bs, dirty: dok && dirty,
        outcome: outcome, inp_from: ifrom, inp_n: ni, line: line });
    let oi = g_obs.len - 1;
    for k in ni { index_input(st, oi, ifrom + k); }
    if dok && dirty || outcome == 1 || outcome == 2 || env_any { g_standing.push(oi); }
    if !task_live(ti) { g_live += 1; }
    g_tasks[ti].latest = oi;
    g_tasks[ti].forgotten = false;
    st.ctx_from = cfrom;
    st.ctx_n = cn;
    st.has_ctx = true;
    return true;
}

// ---- reverse indexes (spec 6.5) --------------------------------------------

// The path entry for the bytes of s, or -1 when no observation names it.
fn find_path(st: Store&, p: const u8[:]) -> i64 {
    let h = hash(p);
    let head = g_path_head.get(h);
    if !head { return -1; }
    var i = head;
    while i >= 0 {
        if same(st, g_paths[i].p, p) { return i; }
        i = g_paths[i].chain;
    }
    return -1;
}

// The path entry for s, created when missing. s must stay valid (arena span).
fn path_index(st: Store&, s: Span) -> i64 {
    let b = text(st, s);
    let i = find_path(st, b);
    if i >= 0 { return i; }
    let h = hash(b);
    let head = g_path_head.get(h);
    var next: i64 = -1;
    if head { next = head; }
    g_paths.push(PathE { p: s, chain: next, rd: -1, ls: -1, pr: -1 });
    g_path_head.insert(h, g_paths.len - 1);
    return g_paths.len - 1;
}

// Adds posting for input ii of observation oi to the list its kind names.
fn index_input(st: Store&, oi: i64, ii: i64) {
    let kind = g_inps[ii].kind;
    if kind == 0 || kind == 5 {
        let pi = path_index(st, g_inps[ii].path);
        g_post.push(Post { obs: oi, inp: ii, next: g_paths[pi].rd });
        g_paths[pi].rd = g_post.len - 1;
    } else if kind == 1 {
        let pi = path_index(st, g_inps[ii].path);
        g_post.push(Post { obs: oi, inp: ii, next: g_paths[pi].ls });
        g_paths[pi].ls = g_post.len - 1;
    } else if kind == 2 {
        let pi = path_index(st, g_inps[ii].path);
        g_post.push(Post { obs: oi, inp: ii, next: g_paths[pi].pr });
        g_paths[pi].pr = g_post.len - 1;
    }
}

// True when observation oi is the latest of a task that is not forgotten.
// Once false it stays false: a task's older observations never come back.
fn obs_live(oi: i64) -> bool {
    let t = g_obs[oi].task;
    return !g_tasks[t].forgotten && g_tasks[t].latest == oi;
}

fn list_head(pi: i64, which: i64) -> i64 {
    if which == 0 { return g_paths[pi].rd; }
    if which == 1 { return g_paths[pi].ls; }
    return g_paths[pi].pr;
}

fn set_list_head(pi: i64, which: i64, v: i64) {
    if which == 0 { g_paths[pi].rd = v; }
    else if which == 1 { g_paths[pi].ls = v; }
    else { g_paths[pi].pr = v; }
}

// Appends the live postings of list which (0 readers, 1 listers, 2 probers)
// of path entry pi to out. Dead postings are unlinked as they are met.
fn gather(pi: i64, which: i64, out: Post[>..]&) {
    out.clear();
    if pi < 0 { return; }
    var prev: i64 = -1;
    var cur = list_head(pi, which);
    while cur >= 0 {
        let e = g_post[cur];
        if obs_live(e.obs) {
            out.push(e);
            prev = cur;
        } else if prev < 0 {
            set_list_head(pi, which, e.next);
        } else {
            g_post[prev].next = e.next;
        }
        cur = e.next;
    }
}

// Applies one parsed record. Unknown record types are skipped (spec G-e).
// Returns false only for a known record that is invalid.
fn apply_record(st: Store&, rec: json::Node?, line: Span) -> bool {
    let r, rok = json::as_string(json::member(rec, "r"));
    if !rok { return true; }
    if r == "obs" { return add_obs(st, rec, line); }
    if r == "forget" {
        let tid, ok = json::as_string(json::member(rec, "task"));
        if !ok { return false; }
        let ti = find_task(st, tid);
        if ti >= 0 {
            if task_live(ti) { g_live -= 1; }
            g_tasks[ti].forgotten = true;
        }
        return true;
    }
    if r == "baseline" {
        let v, ok = json::as_string(json::member(rec, "value"));
        if !ok { return false; }
        st.baseline = put(st, v);
        st.has_baseline = true;
        return true;
    }
    return true;
}

// Applies one complete line. False if it does not parse or is invalid.
fn apply_line(st: Store&, line: const u8[:], at: i64) -> bool {
    g_idx_current = false;
    var doc: json::Node[>..] = [];
    var decoded: u8[>..] = [];
    let root, err = json::parse(line, doc, decoded);
    if !root { return false; }
    return apply_record(st, root, Span { off: at, len: line.len });
}

// Applies every complete line of log from offset from. The piece after the
// final newline is a line still being written, or a truncated tail, and is
// not applied (G-e). Returns the offset applied through, and false if a
// complete line is corrupt.
fn apply_from(st: Store&, log: const u8[:], from: i64) -> i64, bool {
    let rest = log[from..];
    let parts = split(rest, '\n');
    var off = from;
    if parts.len == 0 { return from, true; }
    for i in parts.len - 1 {
        let p = parts[i];
        if p.len > 0 {
            if !apply_line(st, p, off) { return off, false; }
        }
        off += p.len + 1;
    }
    return off, true;
}

// Loads the whole log from scratch. False when the store is corrupt (exit 3).
fn load_log(st: Store&, log: const u8[:]) -> bool {
    store_reset(st);
    g_logbuf.append(log);
    let applied, ok = apply_from(st, g_logbuf, 0);
    g_applied = applied;
    return ok;
}

// Re-reads the log and applies what other writers appended since the last
// read (spec 6.6). A log rewritten under us (compaction, or a changed
// prefix) is reloaded from scratch.
fn refresh_log(st: Store&, log_path: const u8[:]) -> bool {
    // The file only changes by appends or a rewrite, and both change its size
    // or mtime. When neither changed since we last looked, nothing to read.
    var size: i64 = 0;
    var mtime: i64 = 0;
    if native_stat_file(log_path, size, mtime) != 1 { return false; }
    if g_stat_known && size == g_logbuf.len && mtime == g_log_mtime { return true; }
    var log: u8[>..] = [];
    if !read_file(log_path, log) { return false; }
    g_stat_known = false;
    var same_prefix = log.len >= g_logbuf.len;
    if same_prefix && g_logbuf.len > 0 {
        same_prefix = log[..g_logbuf.len] == g_logbuf;
    }
    if !same_prefix {
        let loaded = load_log(st, log);
        if loaded { mark_log(log_path); }
        return loaded;
    }
    if log.len == g_logbuf.len {
        mark_log(log_path);
        return true;
    }
    g_logbuf.clear();
    g_logbuf.append(log);
    let applied, ok = apply_from(st, g_logbuf, g_applied);
    g_applied = applied;
    if ok { mark_log(log_path); }
    return ok;
}

// Remembers the log's size and mtime as read, so the next refresh can skip.
fn mark_log(log_path: const u8[:]) {
    var size: i64 = 0;
    var mtime: i64 = 0;
    if native_stat_file(log_path, size, mtime) == 1 && size == g_logbuf.len {
        g_log_mtime = mtime;
        g_stat_known = true;
    }
}

// Appends complete records (each ending in a newline). The caller holds the
// lock and has refreshed. A truncated tail is dropped first, so a crash
// never leaves a bad line in the middle of the log.
fn append_lines(st: Store&, log_path: const u8[:], recs: const u8[:]) -> bool {
    if g_applied < g_logbuf.len {
        if !write_file_atomic(log_path, g_logbuf[..g_applied]) { return false; }
        g_logbuf.resize(g_applied);
    }
    if !append_file(log_path, recs) { return false; }
    g_logbuf.append(recs);
    let applied, ok = apply_from(st, g_logbuf, g_applied);
    g_applied = applied;
    mark_log(log_path);
    return ok;
}

// ---- index image (spec 6.4) ------------------------------------------------
// tg.idx, format 2: a binary image of the state's arrays, written with Goose's
// serialization (to_bytes / from_bytes, reference section 23). Layout:
//   "BPIX"                         magic
//   uleb fmt (2)
//   uleb base_log_len
//   uleb n, n bytes                base_tail_sha: "sha256:<hex>" of the 1,024
//                                  log bytes ending at base_log_len
//   uleb has_baseline, uleb baseline.off, uleb baseline.len
//   uleb has_ctx, uleb ctx_from, uleb ctx_n
//   uleb 8                         number of sections
//   uleb len[k] for k in 0..8      byte length of each section
//   8 bytes, little endian         hash() of the body (damage check)
//   body: to_bytes of, in order, the arena (u8), the kvs, the inputs, the
//         observations, the tasks, the path table and the postings, then the
//         standing list (i64). Each section is a framed image of one array.
// The observation lines are not stored: each is a span of the log, which the
// load reads anyway, and the tail hash ties the image to that log.
// Not stored: the dictionaries (rebuilt from the tasks and paths in one pass),
// the intern table, the live count (recounted), and the stat cache.
// The body hash catches damage that the framing cannot see (a flipped value
// in range); from_bytes checks the framing and every index is checked against
// its array (index_ok). Loading is a verified copy of each section; no text is
// parsed. Any failure is a full replay from the log. hash() is not a
// cryptographic hash: it is a damage check, and the log's own tail hash is the
// identity check.

// SHA-256 of data as "sha256:<hex>".
fn sha_text(data: const u8[:], out: u8[>..]&) {
    out.append("sha256:");
    native_sha256_hex(data, out);
}

// The state as records: the latest observation of every live task, the
// last observation of the log (so the store context survives) with its
// forget if its task is gone, and the baseline.
fn state_records(st: Store&, out: u8[>..]&) {
    // The last observation of the log is written last, so replaying the
    // records leaves the store context the same as the full log's.
    var lo: i64 = -1;
    if g_obs.len > 0 { lo = g_obs.len - 1; }
    for i in g_tasks.len {
        let t = g_tasks[i];
        if t.forgotten || t.latest < 0 { continue; }
        if t.latest == lo { continue; }
        out.append(line_text(g_obs[t.latest].line));
        out.push('\n');
    }
    if lo >= 0 {
        let t = g_tasks[g_obs[lo].task];
        out.append(line_text(g_obs[lo].line));
        out.push('\n');
        if t.forgotten {
            out.append("{\"r\":\"forget\",\"task\":");
            json::format_string(out, text(st, t.id));
            out.append("}\n");
        }
    }
    if st.has_baseline {
        out.append("{\"r\":\"baseline\",\"value\":");
        json::format_string(out, text(st, st.baseline));
        out.append("}\n");
    }
}

// Set while the index on disk describes the state exactly, so a write is not needed.
var g_idx_current: bool = false;

fn flag_of(b: bool) -> i64 {
    if b { return 1; }
    return 0;
}

// Reads one ULEB128 at pos of s and advances pos. False when malformed.
fn take_uleb(s: const u8[:], pos: i64&) -> i64, bool {
    let v, n = parse_uleb(s[pos..]);
    if n == 0 { return 0, false; }
    pos += n;
    return v, true;
}

fn span_in(s: Span, n: i64) -> bool {
    return s.off >= 0 && s.len >= 0 && s.off <= n && s.len <= n - s.off;
}

fn range_in(from: i64, n: i64, total: i64) -> bool {
    return from >= 0 && n >= 0 && from <= total && n <= total - from;
}

// Checks every index and span of the state against the array it names, so a
// damaged image cannot make a query read out of range. The lists are chains
// that point to older entries (smaller indexes), which rules out cycles.
fn index_ok(st: Store&) -> bool {
    let an = g_arena.len;
    let nk = g_kvs.len;
    let ni = g_inps.len;
    let no = g_obs.len;
    let nt = g_tasks.len;
    let np = g_paths.len;
    let nq = g_post.len;
    for i in nk {
        if !span_in(g_kvs[i].k, an) || !span_in(g_kvs[i].v, an) { return false; }
    }
    for i in ni {
        let x = g_inps[i];
        if x.kind < 0 || x.kind > 5 { return false; }
        if !span_in(x.path, an) || !span_in(x.hash, an) || !span_in(x.name, an) || !span_in(x.vh, an) { return false; }
        if !range_in(x.env_from, x.env_n, nk) { return false; }
    }
    for i in no {
        let o = g_obs[i];
        if o.task < 0 || o.task >= nt { return false; }
        if o.outcome < 0 || o.outcome > 3 { return false; }
        if !span_in(o.baseline, an) || !span_in(o.line, g_logbuf.len) { return false; }
        if !range_in(o.ctx_from, o.ctx_n, nk) || !range_in(o.inp_from, o.inp_n, ni) { return false; }
    }
    for i in nt {
        let t = g_tasks[i];
        if !span_in(t.id, an) { return false; }
        if t.latest < -1 || t.latest >= no { return false; }
        if t.latest >= 0 && g_obs[t.latest].task != i { return false; }
        if t.chain < -1 || t.chain >= i { return false; }
    }
    for i in np {
        let p = g_paths[i];
        if !span_in(p.p, an) { return false; }
        if p.chain < -1 || p.chain >= i { return false; }
        if p.rd < -1 || p.rd >= nq || p.ls < -1 || p.ls >= nq || p.pr < -1 || p.pr >= nq { return false; }
    }
    for i in nq {
        let e = g_post[i];
        if e.obs < 0 || e.obs >= no || e.inp < 0 || e.inp >= ni { return false; }
        if e.next < -1 || e.next >= i { return false; }
    }
    for i in g_standing.len {
        if g_standing[i] < 0 || g_standing[i] >= no { return false; }
    }
    if st.has_baseline && !span_in(st.baseline, an) { return false; }
    if st.has_ctx && !range_in(st.ctx_from, st.ctx_n, nk) { return false; }
    return true;
}

// Rebuilds the two dictionaries (task id hash, path hash) from the arrays.
// Each chain is already stored in the entries, so the head of a hash is the
// newest entry with that hash, as it was when the state was built.
fn rebuild_dicts(st: Store&) {
    g_task_head.clear();
    g_path_head.clear();
    for i in g_tasks.len { g_task_head.insert(hash(text(st, g_tasks[i].id)), i); }
    for i in g_paths.len { g_path_head.insert(hash(text(st, g_paths[i].p)), i); }
}

// Writes tg.idx for the applied prefix of the log. A no-op when the file on
// disk already describes the state.
fn write_index(st: Store&, idx_path: const u8[:]) -> bool {
    if g_idx_current { return true; }
    let base = g_applied;
    let tail = if base > 1024 { base - 1024 } else { 0 };
    var sha: u8[>..] = [];
    sha_text(g_logbuf[tail..base], sha);
    var body: u8[>..] = [];
    var lens: i64[>..] = [];
    var mark: i64 = 0;
    to_bytes(g_arena, body);
    lens.push(body.len - mark); mark = body.len;
    to_bytes(g_kvs, body);
    lens.push(body.len - mark); mark = body.len;
    to_bytes(g_inps, body);
    lens.push(body.len - mark); mark = body.len;
    to_bytes(g_obs, body);
    lens.push(body.len - mark); mark = body.len;
    to_bytes(g_tasks, body);
    lens.push(body.len - mark); mark = body.len;
    to_bytes(g_paths, body);
    lens.push(body.len - mark); mark = body.len;
    to_bytes(g_post, body);
    lens.push(body.len - mark); mark = body.len;
    to_bytes(g_standing, body);
    lens.push(body.len - mark);
    var img: u8[>..] = [];
    img.append("BPIX");
    format_uleb(img, 2);
    format_uleb(img, base);
    format_uleb(img, sha.len);
    img.append(sha);
    format_uleb(img, flag_of(st.has_baseline));
    format_uleb(img, st.baseline.off);
    format_uleb(img, st.baseline.len);
    format_uleb(img, flag_of(st.has_ctx));
    format_uleb(img, st.ctx_from);
    format_uleb(img, st.ctx_n);
    format_uleb(img, lens.len);
    for k in lens.len { format_uleb(img, lens[k]); }
    let h = hash(body);
    for k in 8 { img.push(((h >> (8 * k)) & 255) as u8); }
    img.append(body);
    let ok = write_file_atomic(idx_path, img);
    if ok { g_idx_current = true; }
    return ok;
}

// Loads tg.idx when it describes a prefix of the log. False (with the state
// cleared) when it does not, and the caller replays the log instead.
fn load_index(st: Store&, idx_path: const u8[:], log: const u8[:]) -> bool {
    var img: u8[>..] = [];
    if !read_file(idx_path, img) { return false; }
    if img.len < 4 || img[..4] != "BPIX" { return false; }
    var pos: i64 = 4;
    let fmt, f_ok = take_uleb(img, pos);
    if !f_ok || fmt != 2 { return false; }
    let base, b_ok = take_uleb(img, pos);
    if !b_ok || base < 0 || base > log.len { return false; }
    let sl, s_ok = take_uleb(img, pos);
    if !s_ok || sl < 0 || sl > img.len - pos { return false; }
    let sha = img[pos .. pos + sl];
    pos += sl;
    let tail = if base > 1024 { base - 1024 } else { 0 };
    var want: u8[>..] = [];
    sha_text(log[tail..base], want);
    if want != sha { return false; }
    let has_b, hb_ok = take_uleb(img, pos);
    let bo, bo_ok = take_uleb(img, pos);
    let bl, bl_ok = take_uleb(img, pos);
    let has_c, hc_ok = take_uleb(img, pos);
    let cf, cf_ok = take_uleb(img, pos);
    let cn, cn_ok = take_uleb(img, pos);
    let nsec, n_ok = take_uleb(img, pos);
    if !(hb_ok && bo_ok && bl_ok && hc_ok && cf_ok && cn_ok && n_ok) { return false; }
    if has_b > 1 || has_c > 1 || nsec != 8 { return false; }
    var lens: i64[>..] = [];
    var total: i64 = 0;
    for k in 8 {
        let len, ok = take_uleb(img, pos);
        if !ok || len < 0 || len > img.len { return false; }
        lens.push(len);
        total += len;
    }
    if pos + 8 > img.len { return false; }
    var stored: u64 = 0;
    for k in 8 { stored = stored | ((img[pos + k] as u64) << (8 * k as u64)); }
    pos += 8;
    if total != img.len - pos { return false; }
    let body = img[pos ..];
    if hash(body) != stored { return false; }
    var at: i64 = 0;
    let arena, a_ok = from_bytes<u8[>..]>(body[at .. at + lens[0]]); at += lens[0];
    let kvs, k_ok = from_bytes<Kv[>..]>(body[at .. at + lens[1]]); at += lens[1];
    let inps, i_ok = from_bytes<Inp[>..]>(body[at .. at + lens[2]]); at += lens[2];
    let obs, o_ok = from_bytes<Ob[>..]>(body[at .. at + lens[3]]); at += lens[3];
    let tasks, t_ok = from_bytes<Task[>..]>(body[at .. at + lens[4]]); at += lens[4];
    let paths, p_ok = from_bytes<PathE[>..]>(body[at .. at + lens[5]]); at += lens[5];
    let posts, q_ok = from_bytes<Post[>..]>(body[at .. at + lens[6]]); at += lens[6];
    let standing, s2_ok = from_bytes<i64[>..]>(body[at .. at + lens[7]]);
    if !(a_ok && k_ok && i_ok && o_ok && t_ok && p_ok && q_ok && s2_ok) { return false; }
    store_reset(st);
    g_arena = copy(arena);
    g_kvs = copy(kvs);
    g_inps = copy(inps);
    g_obs = copy(obs);
    g_tasks = copy(tasks);
    g_paths = copy(paths);
    g_post = copy(posts);
    g_standing = copy(standing);
    st.baseline = Span { off: bo, len: bl };
    st.has_baseline = has_b == 1;
    st.ctx_from = cf;
    st.ctx_n = cn;
    st.has_ctx = has_c == 1;
    g_logbuf.append(log);
    if !index_ok(st) {
        store_reset(st);
        return false;
    }
    var live: i64 = 0;
    for i in g_tasks.len { if task_live(i) { live += 1; } }
    g_live = live;
    rebuild_dicts(st);
    g_applied = base;
    g_idx_current = true;
    let applied, ok = apply_from(st, g_logbuf, base);
    g_applied = applied;
    return ok;
}

// ---- stat cache (spec 6.3, 7.6) ---------------------------------------------

// Loads stat.cache into g_cache. A missing or unreadable cache is empty;
// deleting it never changes an answer.
fn load_stat_cache(st: Store&, cache_path: const u8[:]) {
    g_cache.clear();
    var body: u8[>..] = [];
    if !read_file(cache_path, body) { return; }
    var doc: json::Node[>..] = [];
    var decoded: u8[>..] = [];
    let root, err = json::parse(body, doc, decoded);
    if !root { return; }
    json::each(root) { c =>
        let size, sok = json::as_i64(json::member(c, "size"));
        let mtime, mok = json::as_i64(json::member(c, "mtime_ns"));
        let h, hok = json::as_string(json::member(c, "hash"));
        if sok && mok && hok {
            g_cache.push(CEnt { path: put(st, c.key), size: size, mtime: mtime, hash: put(st, h) });
        }
    };
}

fn save_stat_cache(st: Store&, cache_path: const u8[:]) -> bool {
    var body: u8[>..] = [];
    body.push('{');
    for i in g_cache.len {
        if i > 0 { body.push(','); }
        json::format_string(body, text(st, g_cache[i].path));
        body.append(":{\"size\":");
        json::format_int(body, g_cache[i].size);
        body.append(",\"mtime_ns\":");
        json::format_int(body, g_cache[i].mtime);
        body.append(",\"hash\":");
        json::format_string(body, text(st, g_cache[i].hash));
        body.push('}');
    }
    body.push('}');
    return write_file_atomic(cache_path, body);
}
