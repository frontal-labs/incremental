import std;
import os;
import json;
// The store: an append-only JSON Lines log (spec/FORMAT.md) read into flat
// records. Strings live in one arena and are referred to by Span, so no
// record holds a slice of another buffer.
import native;

struct Span { off: i64, len: i64 }

// A name/value pair: a context field, an env entry, or a snapshot entry.
struct Kv { k: Span, v: Span }

// One input of an observation. kind: 0 file, 1 dir, 2 probe, 3 env,
// 4 env_all, 5 declared. Env entries of an env_all snapshot live in kvs
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

// outcome: 0 pass, 1 fail, 2 error, 3 none.
struct Ob {
    task: i64,
    ctx_from: i64,
    ctx_n: i64,
    baseline: Span,
    dirty: bool,
    outcome: i64,
    inp_from: i64,
    inp_n: i64,
}

struct Task { id: Span, forgotten: bool, latest: i64 }

// The resizable collections are globals: a struct may hold at most one
// resizable value, and it must be its last field (spec 3.4).
var g_arena: u8[>..] = [];
var g_kvs: Kv[>..] = [];
var g_inps: Inp[>..] = [];
var g_obs: Ob[>..] = [];
var g_tasks: Task[>..] = [];
var g_logbuf: u8[>..] = [];

struct Store {
    baseline: Span,
    has_baseline: bool,
    ctx_from: i64,
    ctx_n: i64,
    has_ctx: bool,
}

fn put(st: Store&, s: const u8[:]) -> Span {
    let off = g_arena.len;
    g_arena.append(s);
    return Span { off: off, len: s.len };
}

fn text(st: Store&, s: Span) -> const u8[:] {
    return g_arena[s.off .. s.off + s.len];
}

fn same(st: Store&, s: Span, t: const u8[:]) -> bool {
    return s.len == t.len && text(st, s) == t;
}

fn find_task(st: Store&, id: const u8[:]) -> i64 {
    for i in g_tasks.len {
        if same(st, g_tasks[i].id, id) { return i; }
    }
    return -1;
}

fn task_index(st: Store&, id: const u8[:]) -> i64 {
    let i = find_task(st, id);
    if i >= 0 { return i; }
    g_tasks.push(Task { id: put(st, id), forgotten: false, latest: -1 });
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

// Each member of an object becomes a Kv. raw: a string value is kept as
// its bare text (env values, which inputs store bare); otherwise the value
// is canonical JSON text (contexts and caps). Returns the first index and count.
fn read_pairs(st: Store&, obj: json::Node?, raw: bool) -> i64, i64 {
    let from = g_kvs.len;
    if !obj { return from, 0; }
    json::each(obj) { child =>
        var v: u8[>..] = [];
        let s, sok = json::as_string(child);
        if raw && sok { v.append(s); } else { scalar_text(child, v); }
        g_kvs.push(Kv { k: put(st, child.key), v: put(st, v) });
    };
    return from, g_kvs.len - from;
}

// Reads one observation object (the body of an obs record or observe
// params) into st. Returns false on a malformed observation.
fn add_obs(st: Store&, o: json::Node?) -> bool {
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
        else { outcome = 3; }
    }
    let cfrom, cn = read_pairs(st, json::member(o, "context"), false);
    let ti = task_index(st, tid);
    let ifrom = g_inps.len;
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
            g_inps.push(Inp {
                kind: kind,
                path: if pok { put(st, p) } else { Span { off: 0, len: 0 } },
                hash: if hok { put(st, h) } else { Span { off: 0, len: 0 } },
                name: if nok { put(st, nm) } else { Span { off: 0, len: 0 } },
                vh: if vok { put(st, vh) } else { Span { off: 0, len: 0 } },
                env_from: efrom,
                env_n: en,
                has_snap: snap,
            });
        };
    }
    let ni = g_inps.len - ifrom;
    g_obs.push(Ob {
        task: ti,
        ctx_from: cfrom,
        ctx_n: cn,
        baseline: put(st, bl),
        dirty: dok && dirty,
        outcome: outcome,
        inp_from: ifrom,
        inp_n: ni,
    });
    g_tasks[ti].latest = g_obs.len - 1;
    g_tasks[ti].forgotten = false;
    st.ctx_from = cfrom;
    st.ctx_n = cn;
    st.has_ctx = true;
    return true;
}

// Applies one parsed log record. Unknown record types are skipped (spec
// G-e). Returns false only for a record that is known and invalid.
fn apply_record(st: Store&, rec: json::Node?) -> bool {
    let r, rok = json::as_string(json::member(rec, "r"));
    if !rok { return true; }
    if r == "obs" { return add_obs(st, rec); }
    if r == "forget" {
        let tid, ok = json::as_string(json::member(rec, "task"));
        if !ok { return false; }
        let ti = find_task(st, tid);
        if ti >= 0 { g_tasks[ti].forgotten = true; }
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

// Parses one log line. A line that fails to parse is an error unless
// the caller says it is a truncated tail, which is ignored (G-e).
fn parse_line(st: Store&, line: const u8[:], tail: bool) -> bool {
    var doc: json::Node[>..] = [];
    var decoded: u8[>..] = [];
    let root, err = json::parse(line, doc, decoded);
    if !root {
        return tail;
    }
    return apply_record(st, root);
}

// Loads the log text. Returns false on a corrupt (non-tail) record.
fn load_log(st: Store&, log: const u8[:]) -> bool {
    g_logbuf.append(log);
    let parts = split(log, '\n');
    for i in parts.len {
        if parts[i].len == 0 { continue; }
        let tail = i == parts.len - 1;
        if !parse_line(st, parts[i], tail) { return false; }
    }
    return true;
}

// Appends one record (a complete JSON object without a newline) to the
// log file, and to the in-memory state. The caller holds the lock.
fn append_record(st: Store&, path: const u8[:], rec: const u8[:]) -> bool {
    var line: u8[>..] = [];
    line.append(rec);
    line.push('\n');
    if !append_file(path, line) { return false; }
    g_logbuf.append(line);
    return parse_line(st, line, false);
}
