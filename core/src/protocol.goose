// The protocol (docs/spec/PROTOCOL.md): every method is one function, dispatch().
// The serve loop (handle) and the CLI (main.goose) both call it, so the two
// give the same answers byte for byte.
import std;
import os;
import json;
import store;
import policy;
import native;

// Paths of one store, and the worktree root for verify.
struct Session {
    log_path: const u8[:],
    lock_path: const u8[:],
    idx_path: const u8[:],
    cache_path: const u8[:],
    root: const u8[:],
}

// Error codes returned by dispatch. Each maps to a protocol name (spec 9.7)
// and to a CLI exit code.
let E_INVALID: i64 = 2;
let E_STORE: i64 = 3;
let E_INTERNAL: i64 = 4;
let E_LOCK: i64 = 5;
let E_BASELINE: i64 = 6;
let E_UNKNOWN: i64 = 7;
let E_SHUTDOWN: i64 = 9;

fn error_name(code: i64) -> const u8[:] {
    if code == E_STORE { return "store_missing"; }
    if code == E_INTERNAL { return "internal"; }
    if code == E_LOCK { return "lock_busy"; }
    if code == E_BASELINE { return "baseline_conflict"; }
    if code == E_UNKNOWN { return "unknown_method"; }
    return "invalid_params";
}

let default_globals = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "package.json",
    "tsconfig*.json", "vitest.config.*", "vite.config.*"];
let default_keys = ["lockfile", "tsconfig", "pkgjson", "runner", "node", "fmt", "caps"];

// Writes a parsed JSON value back out. Objects keep their member order.
recursive fn write_value(n: json::Node&, out: u8[>..]&) {
    match n.val {
        Arr a => {
            out.push('[');
            var first = true;
            json::each(n) { c =>
                if !first { out.push(','); }
                first = false;
                write_value(c, out);
            };
            out.push(']');
        },
        Obj o => {
            out.push('{');
            var first = true;
            json::each(n) { c =>
                if !first { out.push(','); }
                first = false;
                json::format_string(out, c.key);
                out.push(':');
                write_value(c, out);
            };
            out.push('}');
        },
        Str s => json::format_string(out, s.s),
        Int i => json::format_int(out, i.v),
        Num f => json::format_number(out, f.v),
        Bool b => json::format_bool(out, b.v),
        _ => out.append("null"),
    }
}

// Sets body to an error object and returns its code.
fn fail(code: i64, msg: const u8[:], body: u8[>..]&) -> i64 {
    body.clear();
    body.append("{\"code\":");
    json::format_string(body, error_name(code));
    body.append(",\"message\":");
    json::format_string(body, msg);
    body.append("}");
    return code;
}

// Acquires the store lock. A stale lock (holder gone, or its PID reused) is
// taken over. Retries for about 5 s, then gives up (spec 6.6).
fn lock_acquire(sess: Session&) -> bool {
    let me = native_getpid();
    let start = native_pid_start(me);
    var content: u8[>..] = [];
    format(content, "{\"pid\":", me, ",\"start\":", start, "}");
    for attempt in 50 {
        if native_create_excl(sess.lock_path, content) == 1 { return true; }
        var body: u8[>..] = [];
        if read_file(sess.lock_path, body) {
            var doc: json::Node[>..] = [];
            var decoded: u8[>..] = [];
            let root, err = json::parse(body, doc, decoded);
            var stale = true;
            if root {
                let pid, pok = json::as_i64(json::member(root, "pid"));
                let st0, sok = json::as_i64(json::member(root, "start"));
                if pok && sok && native_pid_alive(pid) == 1 && native_pid_start(pid) == st0 {
                    stale = false;
                }
            }
            if stale { delete_file(sess.lock_path); }
        }
        sleep_ms(100);
    }
    return false;
}

fn lock_release(sess: Session&) {
    delete_file(sess.lock_path);
}

// Appends complete records under the lock, after re-reading the log so the
// records follow everything other writers have appended (spec 6.6).
fn write_records(sess: Session&, st: Store&, recs: const u8[:], body: u8[>..]&) -> i64 {
    if !lock_acquire(sess) { return fail(E_LOCK, "another writer holds the store lock", body); }
    var ok = refresh_log(st, sess.log_path);
    if ok { ok = append_lines(st, sess.log_path, recs); }
    lock_release(sess);
    if !ok { return fail(E_STORE, "could not append to the log", body); }
    return 0;
}

// The "obs" record: the observation's members, with "r":"obs" first.
fn observation_record(obs: json::Node&, rec: u8[>..]&) {
    rec.append("{\"r\":\"obs\"");
    json::each(obs) { c =>
        rec.push(',');
        json::format_string(rec, c.key);
        rec.push(':');
        write_value(c, rec);
    };
    rec.append("}\n");
}

// Required fields of an observation (spec 9.5).
fn observation_valid(obs: json::Node?) -> bool {
    if !obs { return false; }
    let t, tok = json::as_string(json::member(obs, "task"));
    let b, bok = json::as_string(json::member(obs, "baseline"));
    return tok && bok && json::member(obs, "context") != null;
}

// Each member of a context or env object becomes a Kv of canonical text.
fn pairs_into(st: Store&, obj: json::Node?, dst: Kv[>..]&, raw: bool) {
    if !obj { return; }
    json::each(obj) { child =>
        var v: u8[>..] = [];
        let s, sok = json::as_string(child);
        if raw && sok { v.append(s); } else { scalar_text(child, v); }
        dst.push(Kv { k: put(st, child.key), v: put(st, v) });
    };
}

// Each string of a JSON array becomes a Span.
fn strings_into(st: Store&, arr: json::Node?, dst: Span[>..]&) {
    if !arr { return; }
    json::each(arr) { el =>
        let s, ok = json::as_string(el);
        if ok { dst.push(put(st, s)); }
    };
}

// The affected params: a ChangeSet and options (spec 9.3, POLICY.md 1).
fn read_query(st: Store&, params: json::Node?, q: Query&) {
    let options = json::member(params, "options");
    let b, bok = json::as_string(json::member(options, "baseline"));
    q.baseline = put(st, b);
    let ctx = json::member(options, "context");
    q.has_ctx = ctx != null;
    pairs_into(st, ctx, q_ctx, false);
    pairs_into(st, json::member(options, "env"), q_env, true);
    let v, vok = json::as_bool(json::member(options, "verify"));
    q.verify = vok && v;
    let pol, pok = json::as_string(json::member(options, "policy"));
    q.conservative = pok && pol == "conservative";
    let config = json::member(options, "config");
    strings_into(st, json::member(config, "ignore"), q_ignore);
    if json::member(config, "globalInputs") != null {
        strings_into(st, json::member(config, "globalInputs"), q_globals);
    } else {
        for i in default_globals.len { q_globals.push(put(st, default_globals[i])); }
    }
    if json::member(config, "fallbackContextKeys") != null {
        strings_into(st, json::member(config, "fallbackContextKeys"), q_keys);
    } else {
        for i in default_keys.len { q_keys.push(put(st, default_keys[i])); }
    }
    strings_into(st, json::member(options, "declared_tasks"), q_declared);
    let cs = json::member(params, "changes");
    let list = json::member(cs, "changes");
    if list {
        json::each(list) { c =>
            let p, pok2 = json::as_string(json::member(c, "path"));
            let s, sok = json::as_string(json::member(c, "status"));
            var status: i64 = 0;
            if sok {
                if s == "added" { status = 1; }
                else if s == "deleted" { status = 2; }
                else if s == "renamed" { status = 3; }
            }
            let o, ook = json::as_string(json::member(c, "old_path"));
            let old = if ook { put(st, o) } else { Span { off: 0, len: 0 } };
            q_changes.push(Chg { path: put(st, p), status: status, old: old });
        };
    }
}

// Runs one method. params is the request's params object. On success body
// holds the result and 0 is returned. On failure body holds an error object
// and the error code is returned. E_SHUTDOWN after shutdown.
fn dispatch(sess: Session&, st: Store&, method: const u8[:], params: json::Node?, body: u8[>..]&) -> i64 {
    body.clear();
    if method == "ping" {
        body.append("{\"pong\":true}");
        return 0;
    }
    if method == "shutdown" {
        body.append("{\"bye\":true}");
        return E_SHUTDOWN;
    }
    if method == "baseline" {
        body.append("{\"baseline\":");
        if st.has_baseline { json::format_string(body, text(st, st.baseline)); } else { body.append("null"); }
        body.push('}');
        return 0;
    }
    if method == "observe" {
        let obs = json::member(params, "observation");
        if !observation_valid(obs) {
            return fail(E_INVALID, "observation needs task, baseline and context", body);
        }
        guard obs else { return fail(E_INVALID, "observation needs task, baseline and context", body); }
        var rec: u8[>..] = [];
        observation_record(obs, rec);
        let code = write_records(sess, st, rec, body);
        if code != 0 { return code; }
        body.append("{\"accepted\":true}");
        return 0;
    }
    if method == "observe_many" {
        let list = json::member(params, "observations");
        if !list { return fail(E_INVALID, "observe_many needs an observations array", body); }
        var valid = true;
        json::each(list) { o =>
            if !observation_valid(o) { valid = false; }
        };
        if !valid { return fail(E_INVALID, "an observation needs task, baseline and context", body); }
        var rec: u8[>..] = [];
        var n: i64 = 0;
        json::each(list) { o =>
            observation_record(o, rec);
            n += 1;
        };
        let code = write_records(sess, st, rec, body);
        if code != 0 { return code; }
        body.append("{\"accepted\":");
        json::format_int(body, n);
        body.push('}');
        return 0;
    }
    if method == "advance" {
        let to, tok = json::as_string(json::member(params, "to"));
        if !tok { return fail(E_INVALID, "advance needs a target baseline", body); }
        let exp, eok = json::as_string(json::member(params, "expected"));
        var matches = !eok;
        if st.has_baseline { matches = eok && text(st, st.baseline) == exp; }
        if !matches {
            // PLAN 9.1: the error carries what was expected and what the store has.
            body.clear();
            body.append("{\"code\":\"baseline_conflict\",\"message\":\"expected baseline does not match the store\",\"data\":{\"expected\":");
            if eok { json::format_string(body, exp); } else { body.append("null"); }
            body.append(",\"actual\":");
            if st.has_baseline { json::format_string(body, text(st, st.baseline)); } else { body.append("null"); }
            body.append("}}");
            return E_BASELINE;
        }
        var rec: u8[>..] = [];
        rec.append("{\"r\":\"baseline\",\"value\":");
        json::format_string(rec, to);
        rec.append("}\n");
        let code = write_records(sess, st, rec, body);
        if code != 0 { return code; }
        body.append("{\"baseline\":");
        json::format_string(body, to);
        body.push('}');
        return 0;
    }
    if method == "forget" {
        let tid, tok = json::as_string(json::member(params, "task"));
        if !tok { return fail(E_INVALID, "forget needs a task id", body); }
        var rec: u8[>..] = [];
        rec.append("{\"r\":\"forget\",\"task\":");
        json::format_string(rec, tid);
        rec.append("}\n");
        let code = write_records(sess, st, rec, body);
        if code != 0 { return code; }
        body.append("{\"forgotten\":true}");
        return 0;
    }
    if method == "affected" {
        query_reset();
        // Spans made by this query are dropped after it, so a long serve does
        // not grow the arena per query. verify keeps its stat cache spans.
        let mark = g_arena.len;
        var q = Query { baseline: Span { off: 0, len: 0 }, has_ctx: false, verify: false, conservative: false };
        read_query(st, params, q);
        if q.verify { load_stat_cache(st, sess.cache_path); }
        plan(st, q, sess.root, body);
        if q.verify { save_stat_cache(st, sess.cache_path); } else { g_arena.resize(mark); }
        return 0;
    }
    if method == "explain" {
        let tid, tok = json::as_string(json::member(params, "task"));
        if !tok { return fail(E_INVALID, "explain needs a task id", body); }
        let ti = find_task(st, tid);
        body.append("{\"task\":");
        json::format_string(body, tid);
        if ti < 0 || g_tasks[ti].forgotten || g_tasks[ti].latest < 0 {
            body.append(",\"observed\":false,\"certificate\":false}");
            return 0;
        }
        let o = g_obs[g_tasks[ti].latest];
        body.append(",\"observed\":true,\"outcome\":");
        if o.outcome == 0 { json::format_string(body, "pass"); }
        else if o.outcome == 1 { json::format_string(body, "fail"); }
        else if o.outcome == 2 { json::format_string(body, "error"); }
        else { json::format_string(body, "none"); }
        body.append(",\"dirty\":");
        json::format_bool(body, o.dirty);
        body.append(",\"baseline\":");
        json::format_string(body, text(st, o.baseline));
        body.append(",\"inputs\":");
        json::format_int(body, o.inp_n);
        // A certificate needs a clean pass at the store's baseline (PLAN 3.3).
        let cert = !o.dirty && o.outcome == 0 && st.has_baseline && same(st, o.baseline, text(st, st.baseline));
        body.append(",\"certificate\":");
        json::format_bool(body, cert);
        body.push('}');
        return 0;
    }
    if method == "stats" {
        body.append("{\"tasks\":");
        json::format_int(body, g_live);
        body.append(",\"observations\":");
        json::format_int(body, g_live);
        body.append(",\"baseline\":");
        if st.has_baseline { json::format_string(body, text(st, st.baseline)); } else { body.append("null"); }
        body.append(",\"graph_version\":\"");
        graph_version(body);
        body.append("\"}");
        return 0;
    }
    if method == "compact" {
        return compact_log(sess, st, body);
    }
    return fail(E_UNKNOWN, "method is not in protocol v1", body);
}

// Rewrites the log with only what the state needs: the header, the latest
// observation of each live task, the last observation (for the store
// context) with its forget if any, and the baseline (spec 7.4).
fn compact_log(sess: Session&, st: Store&, body: u8[>..]&) -> i64 {
    if !lock_acquire(sess) { return fail(E_LOCK, "another writer holds the store lock", body); }
    if !refresh_log(st, sess.log_path) {
        lock_release(sess);
        return fail(E_STORE, "could not read the log", body);
    }
    let before = g_logbuf.len;
    var out: u8[>..] = [];
    var nl: i64 = -1;
    for i in g_logbuf.len {
        if nl < 0 && g_logbuf[i] == '\n' { nl = i; }
    }
    if nl >= 0 {
        out.append(g_logbuf[..nl + 1]);
    } else {
        out.append("{\"r\":\"hdr\",\"v\":1,\"hash\":\"sha256\"}\n");
    }
    state_records(st, out);
    var ok = write_file_atomic(sess.log_path, out);
    if ok {
        store_reset(st);
        ok = load_log(st, out);
    }
    if ok { ok = write_index(st, sess.idx_path); }
    lock_release(sess);
    if !ok { return fail(E_STORE, "compaction failed", body); }
    body.append("{\"before_bytes\":");
    json::format_int(body, before);
    body.append(",\"after_bytes\":");
    json::format_int(body, out.len);
    body.push('}');
    return 0;
}

// Writes {"id":..,"result":..} or {"id":..,"error":..} as one line.
fn reply(id: i64, has_id: bool, out: u8[>..]&, body: const u8[:], failed: bool) {
    out.append("{\"id\":");
    if has_id { json::format_int(out, id); } else { out.append("null"); }
    if failed { out.append(",\"error\":"); } else { out.append(",\"result\":"); }
    out.append(body);
    out.append("}\n");
}

// Handles one request line, writing the response to out. Returns 0 to
// continue, E_SHUTDOWN after shutdown, 2 when the stream must close after a
// protocol mismatch, and E_STORE when the store cannot be read.
fn handle(sess: Session&, st: Store&, line: const u8[:], out: u8[>..]&) -> i64 {
    // Every request sees the log as it is now, including other writers' records.
    if !refresh_log(st, sess.log_path) {
        var sbody: u8[>..] = [];
        fail(E_STORE, "store is missing or corrupt", sbody);
        reply(0, false, out, sbody, true);
        return E_STORE;
    }
    var doc: json::Node[>..] = [];
    var decoded: u8[>..] = [];
    let root, err = json::parse(line, doc, decoded);
    var body: u8[>..] = [];
    if !root {
        fail(E_INVALID, err, body);
        reply(0, false, out, body, true);
        return 0;
    }
    let id, has_id = json::as_i64(json::member(root, "id"));
    let method, mok = json::as_string(json::member(root, "method"));
    let params = json::member(root, "params");
    if !mok {
        fail(E_INVALID, "missing method", body);
        reply(id, has_id, out, body, true);
        return 0;
    }
    if method == "hello" {
        let proto, pok = json::as_i64(json::member(params, "protocol"));
        if !pok || proto != 1 {
            body.append("{\"code\":\"protocol_mismatch\",\"message\":\"supported protocol versions: [1]\"}");
            reply(id, has_id, out, body, true);
            return 2;
        }
        body.append("{\"protocol\":1,\"engine\":{\"name\":\"backplane-core-goose\",\"version\":\"0.1.0\"},");
        body.append("\"capabilities\":[\"probes\",\"dirs\",\"env\",\"verify\"],\"store\":\".backplane\"}");
        reply(id, has_id, out, body, false);
        return 0;
    }
    var mname: u8[>..] = [];
    mname.append(method);
    let code = dispatch(sess, st, mname, params, body);
    reply(id, has_id, out, body, code != 0 && code != E_SHUTDOWN);
    if code == E_SHUTDOWN { return E_SHUTDOWN; }
    return 0;
}
