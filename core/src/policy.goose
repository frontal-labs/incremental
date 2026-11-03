import std;
import os;
import json;
// plan(state, query): the rules of spec/POLICY.md, P0 to P11.
import store;
import native;

// status: 0 modified, 1 added, 2 deleted, 3 renamed.
struct Chg { path: Span, status: i64, old: Span }

// Query resizables, as globals (see store.goose). Reset by query_reset().
var q_ctx: Kv[>..] = [];
var q_env: Kv[>..] = [];
var q_changes: Chg[>..] = [];
var q_ignore: Span[>..] = [];
var q_globals: Span[>..] = [];
var q_keys: Span[>..] = [];
var q_declared: Span[>..] = [];

struct Query {
    baseline: Span,
    has_ctx: bool,
    verify: bool,
    conservative: bool,
}

fn query_reset() {
    q_ctx.clear();
    q_env.clear();
    q_changes.clear();
    q_ignore.clear();
    q_globals.clear();
    q_keys.clear();
    q_declared.clear();
}

// A known task for this query: obs is its latest observation, or -1.
struct Tk { id: Span, obs: i64 }

// A reason on a task: task is an index into the sorted task list.
struct Rs { task: i64, text: Span }

// Fallback ranks (spec 8.5): the highest rank wins.
// 5 baseline_mismatch, 4 context_missing, 3 global_input,
// 2 context_changed, 1 unobserved_input, 0 none.
fn fallback_name(rank: i64) -> const u8[:] {
    if rank == 5 { return "baseline_mismatch"; }
    if rank == 4 { return "context_missing"; }
    if rank == 3 { return "global_input"; }
    if rank == 2 { return "context_changed"; }
    return "unobserved_input";
}

// Glob match: '*' within a segment, '**' across segments, '?' one byte.
recursive fn glob_at(p: const u8[:], s: const u8[:]) -> bool {
    if p.len == 0 { return s.len == 0; }
    if p[0] == '*' {
        if p.len >= 2 && p[1] == '*' {
            var rest = p[2..];
            if rest.len > 0 && rest[0] == '/' { rest = rest[1..]; }
            for k in s.len + 1 {
                if glob_at(rest, s[k..]) { return true; }
            }
            return false;
        }
        let rest1 = p[1..];
        var k: i64 = 0;
        for j in s.len + 1 {
            if glob_at(rest1, s[k..]) { return true; }
            if k >= s.len || s[k] == '/' { return false; }
            k += 1;
        }
        return false;
    }
    if s.len == 0 { return false; }
    if p[0] == '?' {
        if s[0] == '/' { return false; }
        return glob_at(p[1..], s[1..]);
    }
    if p[0] != s[0] { return false; }
    return glob_at(p[1..], s[1..]);
}

fn glob_any(st: Store&, globs: Span[>..]&, path: const u8[:]) -> bool {
    for i in globs.len {
        if glob_at(text(st, globs[i]), path) { return true; }
    }
    return false;
}

// The parent directory of a path: everything before the last '/', or "".
fn parent_of(path: const u8[:]) -> const u8[:] {
    var i = path.len;
    while i > 0 {
        if path[i - 1] == '/' { return path[..i - 1]; }
        i -= 1;
    }
    return path[..0];
}

// Index of key in kvs[from, from + n), or -1.
fn kv_find(st: Store&, kvs: Kv[>..]&, from: i64, n: i64, key: const u8[:]) -> i64 {
    for i in n {
        if same(st, kvs[from + i].k, key) { return from + i; }
    }
    return -1;
}

// True when a reserved context key or caps flag is true in canonical text.
fn cap_true(t: const u8[:], name: const u8[:]) -> bool {
    var want: u8[>..] = [];
    format(want, "\"", name, "\":true");
    return find(t, want) >= 0;
}

// Reason text: prefix + argument.
fn reason(st: Store&, prefix: const u8[:], arg: const u8[:]) -> Span {
    var b: u8[>..] = [];
    b.append(prefix);
    b.append(arg);
    return put(st, b);
}

fn add_reason(st: Store&, rs: Rs[>..]&, task: i64, prefix: const u8[:], arg: const u8[:]) {
    rs.push(Rs { task: task, text: reason(st, prefix, arg) });
}

fn push_unique(st: Store&, xs: Span[>..]&, s: const u8[:]) {
    for i in xs.len {
        if same(st, xs[i], s) { return; }
    }
    xs.push(put(st, s));
}

fn is_reserved(k: const u8[:]) -> bool {
    return k == "lockfile" || k == "tsconfig" || k == "pkgjson" || k == "runner"
        || k == "node" || k == "fmt" || k == "caps";
}

// Change order: path, then status, then old path (spec 5, determinism).
fn chg_less(st: Store&, a: Chg, b: Chg) -> bool {
    let c = compare(text(st, a.path), text(st, b.path));
    if c != 0 { return c < 0; }
    if a.status != b.status { return a.status < b.status; }
    return compare(text(st, a.old), text(st, b.old)) < 0;
}

// Reason order: task index, then reason text.
fn rs_less(st: Store&, a: Rs, b: Rs) -> bool {
    if a.task != b.task { return a.task < b.task; }
    return compare(text(st, a.text), text(st, b.text)) < 0;
}

// Writes the plan as a JSON object to out. Returns false when the query
// names no store baseline (P0 applies, so the plan is a fallback).
fn plan(st: Store&, q: Query&, root: const u8[:], out: u8[>..]&) {
    // Known tasks: latest observed and not forgotten, plus declared ones.
    var tk: Tk[>..] = [];
    for i in g_tasks.len {
        let t = g_tasks[i];
        if t.forgotten || t.latest < 0 { continue; }
        tk.push(Tk { id: t.id, obs: t.latest });
    }
    for i in q_declared.len {
        var found = false;
        for j in tk.len {
            if same(st, tk[j].id, text(st, q_declared[i])) { found = true; }
        }
        if !found { tk.push(Tk { id: q_declared[i], obs: -1 }); }
    }
    sort(tk) { a, b => compare(text(st, a.id), text(st, b.id)) < 0 };

    var fb: i64 = 0;
    // P0: baseline. A store without a baseline never matches (spec 7.1).
    if !st.has_baseline || text(st, q.baseline) != text(st, st.baseline) { fb = 5; }
    // P0b: context.
    if fb == 0 && !q.has_ctx { fb = 4; }

    var ignored: Span[>..] = [];
    var kept: Chg[>..] = [];
    var unobserved: Span[>..] = [];
    var deleted: Span[>..] = [];
    var rs: Rs[>..] = [];
    var invalid_codes: i64 = 0;

    if fb == 0 {
        // P11: ignored paths are dropped first.
        for i in q_changes.len {
            let c = q_changes[i];
            if glob_any(st, q_ignore, text(st, c.path)) {
                push_unique(st, ignored, text(st, c.path));
            } else {
                kept.push(c);
            }
        }
        // P1: global inputs.
        for i in kept.len {
            if glob_any(st, q_globals, text(st, kept[i].path)) && fb < 3 { fb = 3; }
        }
        // P2: reserved and listed context keys against the store's context.
        var checked: Span[>..] = [];
        for pass in 2 {
            // pass 0: reserved keys; pass 1: listed keys.
            if pass == 0 {
                let names = ["lockfile", "tsconfig", "pkgjson", "runner", "node", "fmt", "caps"];
                for j in names.len {
                    let qi = kv_find(st, q_ctx, 0, q_ctx.len, names[j]);
                    let si = kv_find(st, g_kvs, st.ctx_from, st.ctx_n, names[j]);
                    if !ctx_equal(st, q, qi, si) && fb < 2 { fb = 2; }
                }
            } else {
                for j in q_keys.len {
                    let key = text(st, q_keys[j]);
                    if is_reserved(key) { continue; }
                    let qi = kv_find(st, q_ctx, 0, q_ctx.len, key);
                    let si = kv_find(st, g_kvs, st.ctx_from, st.ctx_n, key);
                    if !ctx_equal(st, q, qi, si) && fb < 2 { fb = 2; }
                }
            }
        }
    }

    var deleted_names: Span[>..] = [];
    if fb == 0 {
        let cons = q.conservative;
        let caps_ok = cap_true(qctx_caps(st, q), "probes") && cap_true(qctx_caps(st, q), "dirs");
        sort(kept) { a, b => chg_less(st, a, b) };
        for i in kept.len {
            let c = kept[i];
            let p = text(st, c.path);
            // P5: deleted or renamed-away paths.
            if c.status == 2 || c.status == 3 {
                let old = if c.status == 2 { text(st, c.path) } else { text(st, c.old) };
                let dir = parent_of(old);
                for j in tk.len {
                    if tk[j].obs < 0 { continue; }
                    let o = g_obs[tk[j].obs];
                    for k in o.inp_n {
                        let inp = g_inps[o.inp_from + k];
                        if (inp.kind == 0 || inp.kind == 5) && same(st, inp.path, old) {
                            add_reason(st, rs, j, "removed_read:", old);
                        }
                        if inp.kind == 1 && same(st, inp.path, dir) {
                            add_reason(st, rs, j, "removed_listed:", dir);
                        }
                    }
                }
                for j in tk.len {
                    if same(st, tk[j].id, old) { push_unique(st, deleted, old); }
                }
            }
            if c.status == 2 { continue; }
            // P3: readers of the path, and P4 below.
            var in_index = false;
            for j in tk.len {
                if tk[j].obs < 0 { continue; }
                let o = g_obs[tk[j].obs];
                for k in o.inp_n {
                    let inp = g_inps[o.inp_from + k];
                    if (inp.kind == 0 || inp.kind == 5) && same(st, inp.path, p) {
                        in_index = true;
                        if inp.kind == 5 {
                            add_reason(st, rs, j, "declared:", p);
                        } else {
                            add_reason(st, rs, j, "reads:", p);
                        }
                    }
                }
            }
            var self_idx: i64 = -1;
            for j in tk.len {
                if same(st, tk[j].id, p) { self_idx = j; }
            }
            if self_idx >= 0 && (c.status == 1 || c.status == 0) {
                // P4
                add_reason(st, rs, self_idx, "self_changed", "");
            } else if !in_index && (c.status == 1 || c.status == 3) {
                // P6
                if !cons && caps_ok {
                    let dir = parent_of(p);
                    for j in tk.len {
                        if tk[j].obs < 0 { continue; }
                        let o = g_obs[tk[j].obs];
                        for k in o.inp_n {
                            let inp = g_inps[o.inp_from + k];
                            if inp.kind == 2 && same(st, inp.path, p) {
                                add_reason(st, rs, j, "probe:", p);
                            }
                            if inp.kind == 1 && same(st, inp.path, dir) {
                                add_reason(st, rs, j, "dir:", dir);
                            }
                        }
                    }
                } else if fb < 1 {
                    fb = 1;
                }
            } else if !in_index && c.status == 0 {
                // P7
                if !cons && caps_ok {
                    push_unique(st, unobserved, p);
                } else if fb < 1 {
                    fb = 1;
                }
            }
        }
    }

    // Fallback: every known task carries "fallback" (spec 9.6).
    if fb > 0 {
        write_fallback(st, tk, fb, q.verify, out);
        return;
    }

    // P8, P9, P2b, P10 for every known task.
    for j in tk.len {
        let obs = tk[j].obs;
        if obs < 0 {
            add_reason(st, rs, j, "no_observation", "");
            continue;
        }
        let o = g_obs[obs];
        if o.dirty { add_reason(st, rs, j, "dirty_observation", ""); }
        if o.outcome == 1 || o.outcome == 2 { add_reason(st, rs, j, "failed_outcome", ""); }
        for k in o.inp_n {
            let inp = g_inps[o.inp_from + k];
            if inp.kind == 3 {
                let qi = kv_find(st, q_env, 0, q_env.len, text(st, inp.name));
                let cur = if qi >= 0 { text(st, q_env[qi].v) } else { "unset" };
                if cur != text(st, inp.vh) {
                    add_reason(st, rs, j, "env_changed:", text(st, inp.name));
                }
            }
            if inp.kind == 4 && env_all_differs(st, q, inp) {
                add_reason(st, rs, j, "env_all_changed", "");
            }
            if q.verify && (inp.kind == 0 || inp.kind == 5) {
                if !file_matches(st, root, text(st, inp.path), text(st, inp.hash)) {
                    var b: u8[>..] = [];
                    b.append("stale:");
                    b.append(text(st, inp.path));
                    rs.push(Rs { task: j, text: put(st, b) });
                }
            }
        }
    }

    sort(rs) { a, b => rs_less(st, a, b) };

    write_plan(st, tk, rs, ignored, unobserved, deleted, q.verify, out);
}

// The caps object of the query context, as canonical text.
fn qctx_caps(st: Store&, q: Query&) -> const u8[:] {
    let i = kv_find(st, q_ctx, 0, q_ctx.len, "caps");
    if i < 0 { return ""; }
    return text(st, q_ctx[i].v);
}

// Equal when both are absent, or both are present with the same text.
fn ctx_equal(st: Store&, q: Query&, qi: i64, si: i64) -> bool {
    if qi < 0 && si < 0 { return true; }
    if qi < 0 || si < 0 { return false; }
    return text(st, q_ctx[qi].v) == text(st, g_kvs[si].v);
}

// env_all: the query env and the observation's snapshot must hold the
// same name/value pairs (spec 3.2, P2b).
fn env_all_differs(st: Store&, q: Query&, inp: Inp) -> bool {
    if !inp.has_snap { return true; }
    for i in q_env.len {
        let si = kv_find(st, g_kvs, inp.env_from, inp.env_n, text(st, q_env[i].k));
        if si < 0 { return true; }
        if text(st, g_kvs[si].v) != text(st, q_env[i].v) { return true; }
    }
    for i in inp.env_n {
        let e = g_kvs[inp.env_from + i];
        let qi = kv_find(st, q_env, 0, q_env.len, text(st, e.k));
        if qi < 0 { return true; }
        if text(st, q_env[qi].v) != text(st, e.v) { return true; }
    }
    return false;
}

// P10: the worktree file at root/path hashes to hash. Missing is a mismatch.
fn file_matches(st: Store&, root: const u8[:], path: const u8[:], hash: const u8[:]) -> bool {
    var full: u8[>..] = [];
    full.append(root);
    if root.len > 0 && root[root.len - 1] != '/' { full.push('/'); }
    full.append(path);
    var body: u8[>..] = [];
    if !read_file(full, body) { return false; }
    var hex: u8[>..] = [];
    native_sha256_hex(body, hex);
    var want: u8[>..] = [];
    want.append("sha256:");
    want.append(hex);
    return want == hash;
}

// graph_version (FORMAT.md): "g_" + the first 8 hex digits of SHA-256 over
// the log length in decimal, then its last 1024 bytes.
fn graph_version(out: u8[>..]&) {
    var msg: u8[>..] = [];
    format(msg, g_logbuf.len);
    let tail = if g_logbuf.len > 1024 { g_logbuf.len - 1024 } else { 0 };
    msg.append(g_logbuf[tail..]);
    var hex: u8[>..] = [];
    native_sha256_hex(msg, hex);
    out.append("g_");
    out.append(hex[..8]);
}

// Writes the baseline and graph_version members of a plan.
fn plan_head(st: Store&, out: u8[>..]&) {
    out.append("\"baseline\":");
    if st.has_baseline { json::format_string(out, text(st, st.baseline)); } else { out.append("null"); }
    out.append(",\"graph_version\":\"");
    graph_version(out);
    out.append("\",");
}

// Fallback plan: every known task listed with reason "fallback".
fn write_fallback(st: Store&, tk: Tk[>..]&, rank: i64, verify: bool, out: u8[>..]&) {
    out.append("{\"protocol\":1,");
    plan_head(st, out);
    out.append("\"tasks\":[");
    for j in tk.len {
        if j > 0 { out.push(','); }
        out.append("{\"id\":");
        json::format_string(out, text(st, tk[j].id));
        out.append(",\"reasons\":[\"fallback\"]}");
    }
    out.append("],\"unobserved\":[],\"ignored\":[],\"deleted_tasks\":[],\"total_tasks\":");
    json::format_int(out, tk.len);
    out.append(",\"skipped\":0,\"fallback\":{\"action\":\"run_all\",\"reason\":\"");
    out.append(fallback_name(rank));
    out.append("\"},\"confidence\":\"n/a\",\"verify\":");
    json::format_bool(out, verify);
    out.append("}");
}

fn write_list(st: Store&, xs: Span[>..]&, out: u8[>..]&) {
    sort(xs) { a, b => compare(text(st, a), text(st, b)) < 0 };
    out.push('[');
    for i in xs.len {
        if i > 0 { out.push(','); }
        json::format_string(out, text(st, xs[i]));
    }
    out.push(']');
}

fn write_plan(st: Store&, tk: Tk[>..]&, rs: Rs[>..]&, ignored: Span[>..]&, unobserved: Span[>..]&,
              deleted: Span[>..]&, verify: bool, out: u8[>..]&) {
    var invalid: i64 = 0;
    var high = verify;
    out.append("{\"protocol\":1,");
    plan_head(st, out);
    out.append("\"tasks\":[");
    var first = true;
    var i: i64 = 0;
    for j in tk.len {
        var any = false;
        var idx = i;
        while idx < rs.len && rs[idx].task == j {
            if !any {
                if !first { out.push(','); }
                first = false;
                out.append("{\"id\":");
                json::format_string(out, text(st, tk[j].id));
                out.append(",\"reasons\":[");
                invalid += 1;
            }
            if idx > i && rs[idx - 1].task == j && same(st, rs[idx - 1].text, text(st, rs[idx].text)) {
                idx += 1;
                continue;
            }
            if any { out.push(','); }
            any = true;
            json::format_string(out, text(st, rs[idx].text));
            let r = text(st, rs[idx].text);
            if r == "no_observation" || r == "dirty_observation" || r.len >= 6 && r[..6] == "stale:" {
                high = false;
            }
            idx += 1;
        }
        if any { out.append("]}"); }
        i = idx;
    }
    out.append("],\"unobserved\":");
    write_list(st, unobserved, out);
    out.append(",\"ignored\":");
    write_list(st, ignored, out);
    out.append(",\"deleted_tasks\":");
    write_list(st, deleted, out);
    out.append(",\"total_tasks\":");
    json::format_int(out, tk.len);
    out.append(",\"skipped\":");
    json::format_int(out, tk.len - invalid);
    out.append(",\"fallback\":null,\"confidence\":\"");
    if high { out.append("high"); } else { out.append("medium"); }
    out.append("\",\"verify\":");
    json::format_bool(out, verify);
    out.append("}");
}
