import std;
import os;
import json;
// plan(state, query): the rules of docs/spec/POLICY.md, P0 to P11.
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
// Declared names sorted and without repeats, built by build_declared.
var q_decl: Span[>..] = [];

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
    q_decl.clear();
}

// A reason on a task: name is the task id (a span of the arena), text the
// reason. Grouping by name gives each task its reasons.
struct Rs { name: Span, text: Span }

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

fn add_reason(st: Store&, rs: Rs[>..]&, name: Span, prefix: const u8[:], arg: const u8[:]) {
    rs.push(Rs { name: name, text: reason(st, prefix, arg) });
}

// Reason order: task name, then reason text.
fn rs_less(st: Store&, a: Rs, b: Rs) -> bool {
    let c = compare(text(st, a.name), text(st, b.name));
    if c != 0 { return c < 0; }
    return compare(text(st, a.text), text(st, b.text)) < 0;
}

// Copies q_declared into q_decl, sorted and without repeats.
fn build_declared(st: Store&) {
    var names: Span[>..] = [];
    for i in q_declared.len { names.push(q_declared[i]); }
    sort(names) { a, b => compare(text(st, a), text(st, b)) < 0 };
    q_decl.clear();
    for i in names.len {
        if i == 0 || !same(st, names[i], text(st, names[i - 1])) { q_decl.push(names[i]); }
    }
}

// Index of a declared name in q_decl, or -1.
fn decl_find(st: Store&, name: const u8[:]) -> i64 {
    var lo: i64 = 0;
    var hi: i64 = q_decl.len;
    while lo < hi {
        let mid = (lo + hi) / 2;
        let c = compare(text(st, q_decl[mid]), name);
        if c == 0 { return mid; }
        if c < 0 { lo = mid + 1; } else { hi = mid; }
    }
    return -1;
}

// Index of the live task with this id, or -1.
fn known_ti(st: Store&, name: const u8[:]) -> i64 {
    let ti = find_task(st, name);
    if ti >= 0 && task_live(ti) { return ti; }
    return -1;
}

// True when name is a live task or a declared task (spec 8.1, P4 and P5).
fn is_known(st: Store&, name: const u8[:]) -> bool {
    return known_ti(st, name) >= 0 || decl_find(st, name) >= 0;
}

// The id span of a known name: the task's own span, or the declared one.
fn known_span(st: Store&, name: const u8[:]) -> Span {
    let ti = known_ti(st, name);
    if ti >= 0 { return g_tasks[ti].id; }
    return q_decl[decl_find(st, name)];
}

// The task id of an observation.
fn obs_name(oi: i64) -> Span {
    return g_tasks[g_obs[oi].task].id;
}

// Number of declared names that are not live tasks (they have no observation).
fn decl_only_count(st: Store&) -> i64 {
    var n: i64 = 0;
    for i in q_decl.len {
        if known_ti(st, text(st, q_decl[i])) < 0 { n += 1; }
    }
    return n;
}

// Writes the plan as a JSON object to out (spec 9.6, POLICY.md 8.1).
// Cost: the changes, the postings of the paths they touch, the standing
// observations (dirty, failed, env), the declared names, and the output.
// No step scans every task unless verify is on.
fn plan(st: Store&, q: Query&, root: const u8[:], out: u8[>..]&) {
    // P0: baseline. A store without a baseline never matches (spec 7.1).
    var fb: i64 = 0;
    if !st.has_baseline || text(st, q.baseline) != text(st, st.baseline) { fb = 5; }
    // P0b: context.
    if fb == 0 && !q.has_ctx { fb = 4; }
    build_declared(st);
    if fb > 0 {
        write_fallback(st, fb, q.verify, out);
        return;
    }

    var ignored: Span[>..] = [];
    var kept: Chg[>..] = [];
    var unobserved: Span[>..] = [];
    var deleted: Span[>..] = [];
    var rs: Rs[>..] = [];
    var hits: Post[>..] = [];

    // P11: ignored paths are dropped first.
    for i in q_changes.len {
        let c = q_changes[i];
        if glob_any(st, q_ignore, text(st, c.path)) {
            ignored.push(c.path);
        } else {
            kept.push(c);
        }
    }
    // P1: global inputs.
    for i in kept.len {
        if glob_any(st, q_globals, text(st, kept[i].path)) && fb < 3 { fb = 3; }
    }
    // P2: reserved and listed context keys against the store's context.
    for pass in 2 {
        // pass 0: reserved keys; pass 1: listed keys.
        if pass == 0 {
            let names = ["lockfile", "tsconfig", "pkgjson", "runner", "node", "fmt", "caps"];
            for j in names.len {
                let qi = kv_find(st, q_ctx, 0, q_ctx.len, names[j]);
                let si = if st.ctx_id >= 0 {
                    let cf, cn = ctx_range(st.ctx_id);
                    kv_find(st, g_kvs, cf, cn, names[j])
                } else { -1 };
                if !ctx_equal(st, q, qi, si) && fb < 2 { fb = 2; }
            }
        } else {
            for j in q_keys.len {
                let key = text(st, q_keys[j]);
                if is_reserved(key) { continue; }
                let qi = kv_find(st, q_ctx, 0, q_ctx.len, key);
                let si = if st.ctx_id >= 0 {
                    let cf, cn = ctx_range(st.ctx_id);
                    kv_find(st, g_kvs, cf, cn, key)
                } else { -1 };
                if !ctx_equal(st, q, qi, si) && fb < 2 { fb = 2; }
            }
        }
    }

    if fb == 0 {
        let cons = q.conservative;
        let caps_ok = cap_true(qctx_caps(st, q), "probes") && cap_true(qctx_caps(st, q), "dirs");
        sort(kept) { a, b => chg_less(st, a, b) };
        for i in kept.len {
            let c = kept[i];
            let p = text(st, c.path);
            // P5: deleted or renamed-away paths.
            if c.status == 2 || c.status == 3 {
                let old_span = if c.status == 2 { c.path } else { c.old };
                let old = text(st, old_span);
                let dir = parent_of(old);
                gather(find_path(st, old), 0, hits);
                for k in hits.len {
                    add_reason(st, rs, obs_name(hits[k].obs), "removed_read:", old);
                }
                gather(find_path(st, dir), 1, hits);
                for k in hits.len {
                    add_reason(st, rs, obs_name(hits[k].obs), "removed_listed:", dir);
                }
                if is_known(st, old) { deleted.push(old_span); }
            }
            if c.status == 2 { continue; }
            // P3: readers of the path. P4 and P6 and P7 below.
            let pi = find_path(st, p);
            gather(pi, 0, hits);
            let in_index = hits.len > 0;
            for k in hits.len {
                if g_inps[hits[k].inp].kind == 5 {
                    add_reason(st, rs, obs_name(hits[k].obs), "declared:", p);
                } else {
                    add_reason(st, rs, obs_name(hits[k].obs), "reads:", p);
                }
            }
            if is_known(st, p) && (c.status == 1 || c.status == 0) {
                // P4
                add_reason(st, rs, known_span(st, p), "self_changed", "");
            } else if !in_index && (c.status == 1 || c.status == 3) {
                // P6
                if !cons && caps_ok {
                    let dir = parent_of(p);
                    gather(pi, 2, hits);
                    for k in hits.len {
                        add_reason(st, rs, obs_name(hits[k].obs), "probe:", p);
                    }
                    gather(find_path(st, dir), 1, hits);
                    for k in hits.len {
                        add_reason(st, rs, obs_name(hits[k].obs), "dir:", dir);
                    }
                } else if fb < 1 {
                    fb = 1;
                }
            } else if !in_index && c.status == 0 {
                // P7
                if !cons && caps_ok {
                    unobserved.push(c.path);
                } else if fb < 1 {
                    fb = 1;
                }
            }
        }
    }

    // Fallback: every known task carries "fallback" (spec 9.6).
    if fb > 0 {
        write_fallback(st, fb, q.verify, out);
        return;
    }

    standing_reasons(st, q, rs);
    if q.verify { verify_reasons(st, root, rs); }
    // P8 for declared names with no observation.
    for i in q_decl.len {
        if known_ti(st, text(st, q_decl[i])) < 0 { add_reason(st, rs, q_decl[i], "no_observation", ""); }
    }

    let total = g_live + decl_only_count(st);
    write_plan(st, rs, unobserved, ignored, deleted, total, q.verify, out);
}

// P8, P9 and P2b for the observations that can give a reason without a
// change: dirty, failed, or with env inputs. Dead entries are dropped from
// g_standing as they are met.
fn standing_reasons(st: Store&, q: Query&, rs: Rs[>..]&) {
    var w: i64 = 0;
    for i in g_standing.len {
        let oi = g_standing[i];
        if !obs_live(oi) { continue; }
        g_standing[w] = oi;
        w += 1;
        let o = g_obs[oi];
        let name = obs_name(oi);
        if o.dirty { add_reason(st, rs, name, "dirty_observation", ""); }
        if o.outcome == 1 || o.outcome == 2 { add_reason(st, rs, name, "failed_outcome", ""); }
        for k in o.inp_n {
            let inp = g_inps[o.inp_from + k];
            if inp.kind == 3 {
                let qi = kv_find(st, q_env, 0, q_env.len, text(st, inp.name));
                let cur = if qi >= 0 { text(st, q_env[qi].v) } else { "unset" };
                if cur != text(st, inp.vh) {
                    add_reason(st, rs, name, "env_changed:", text(st, inp.name));
                }
            }
            if inp.kind == 4 && env_all_differs(st, q, inp) {
                add_reason(st, rs, name, "env_all_changed", "");
            }
        }
    }
    g_standing.resize(w);
}

// P10: every live task's recorded files must still hash to what was seen.
// This reads all live observations, so it is linear in the store; verify is
// the mode that pays for hashing files, not the default query.
fn verify_reasons(st: Store&, root: const u8[:], rs: Rs[>..]&) {
    for ti in g_tasks.len {
        if !task_live(ti) { continue; }
        let o = g_obs[g_tasks[ti].latest];
        for k in o.inp_n {
            let inp = g_inps[o.inp_from + k];
            if (inp.kind == 0 || inp.kind == 5) && !file_matches(st, root, text(st, inp.path), text(st, inp.hash)) {
                add_reason(st, rs, g_tasks[ti].id, "stale:", text(st, inp.path));
            }
        }
    }
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

// P10: the worktree file at root/path hashes to hash. A missing file is a
// mismatch. The stat cache (spec 7.6) answers when size and mtime_ns are
// unchanged; otherwise the file is hashed and the cache entry replaced.
fn file_matches(st: Store&, root: const u8[:], path: const u8[:], hash: const u8[:]) -> bool {
    var full: u8[>..] = [];
    full.append(root);
    if root.len > 0 && root[root.len - 1] != '/' { full.push('/'); }
    full.append(path);
    var size: i64 = 0;
    var mtime: i64 = 0;
    if native_stat_file(full, size, mtime) != 1 { return false; }
    var slot: i64 = -1;
    for i in g_cache.len {
        if same(st, g_cache[i].path, path) { slot = i; }
    }
    if slot >= 0 && g_cache[slot].size == size && g_cache[slot].mtime == mtime {
        return text(st, g_cache[slot].hash) == hash;
    }
    var body: u8[>..] = [];
    if !read_file(full, body) { return false; }
    var sha: u8[>..] = [];
    sha_text(body, sha);
    let hs = put(st, sha);
    if slot >= 0 {
        g_cache[slot].size = size;
        g_cache[slot].mtime = mtime;
        g_cache[slot].hash = hs;
    } else {
        g_cache.push(CEnt { path: put(st, path), size: size, mtime: mtime, hash: hs });
    }
    return sha == hash;
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

// Fallback plan: every known task listed with reason "fallback". This one
// path does visit every task, because its output names every task.
fn write_fallback(st: Store&, rank: i64, verify: bool, out: u8[>..]&) {
    var names: Span[>..] = [];
    for i in g_tasks.len {
        if task_live(i) { names.push(g_tasks[i].id); }
    }
    for i in q_decl.len {
        if known_ti(st, text(st, q_decl[i])) < 0 { names.push(q_decl[i]); }
    }
    sort(names) { a, b => compare(text(st, a), text(st, b)) < 0 };
    out.append("{\"protocol\":1,");
    plan_head(st, out);
    out.append("\"tasks\":[");
    for j in names.len {
        if j > 0 { out.push(','); }
        out.append("{\"id\":");
        json::format_string(out, text(st, names[j]));
        out.append(",\"reasons\":[\"fallback\"]}");
    }
    out.append("],\"unobserved\":[],\"ignored\":[],\"deleted_tasks\":[],\"total_tasks\":");
    json::format_int(out, names.len);
    out.append(",\"skipped\":0,\"fallback\":{\"action\":\"run_all\",\"reason\":\"");
    out.append(fallback_name(rank));
    out.append("\"},\"confidence\":\"n/a\",\"verify\":");
    json::format_bool(out, verify);
    out.append("}");
}

// Writes a list of paths or names, sorted, without repeats.
fn write_list(st: Store&, xs: Span[>..]&, out: u8[>..]&) {
    sort(xs) { a, b => compare(text(st, a), text(st, b)) < 0 };
    out.push('[');
    var n: i64 = 0;
    for i in xs.len {
        if i > 0 && same(st, xs[i], text(st, xs[i - 1])) { continue; }
        if n > 0 { out.push(','); }
        n += 1;
        json::format_string(out, text(st, xs[i]));
    }
    out.push(']');
}

// Writes the tasks with reasons (sorted by id, reasons sorted and without
// repeats), then the lists, counts and confidence. rs is sorted here.
fn write_plan(st: Store&, rs: Rs[>..]&, unobserved: Span[>..]&, ignored: Span[>..]&,
              deleted: Span[>..]&, total: i64, verify: bool, out: u8[>..]&) {
    sort(rs) { a, b => rs_less(st, a, b) };
    var high = verify;
    var invalid: i64 = 0;
    out.append("{\"protocol\":1,");
    plan_head(st, out);
    out.append("\"tasks\":[");
    var i: i64 = 0;
    while i < rs.len {
        let nm = text(st, rs[i].name);
        if invalid > 0 { out.push(','); }
        invalid += 1;
        out.append("{\"id\":");
        json::format_string(out, nm);
        out.append(",\"reasons\":[");
        var n: i64 = 0;
        var j = i;
        while j < rs.len && same(st, rs[j].name, nm) {
            if j == i || !same(st, rs[j].text, text(st, rs[j - 1].text)) {
                if n > 0 { out.push(','); }
                n += 1;
                let r = text(st, rs[j].text);
                json::format_string(out, r);
                if r == "no_observation" || r == "dirty_observation" || r.len >= 6 && r[..6] == "stale:" {
                    high = false;
                }
            }
            j += 1;
        }
        out.append("]}");
        i = j;
    }
    out.append("],\"unobserved\":");
    write_list(st, unobserved, out);
    out.append(",\"ignored\":");
    write_list(st, ignored, out);
    out.append(",\"deleted_tasks\":");
    write_list(st, deleted, out);
    out.append(",\"total_tasks\":");
    json::format_int(out, total);
    out.append(",\"skipped\":");
    json::format_int(out, total - invalid);
    out.append(",\"fallback\":null,\"confidence\":\"");
    if high { out.append("high"); } else { out.append("medium"); }
    out.append("\",\"verify\":");
    json::format_bool(out, verify);
    out.append("}");
}
