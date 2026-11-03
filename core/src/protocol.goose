import std;
import os;
import json;
// The protocol loop (spec/PROTOCOL.md): one JSON request per line in,
// one response per line out. Every method is a function in this file, and
// the CLI (main.goose) reaches them through the same handle().
import store;
import policy;
import native;

// Paths and identity of one store, plus the worktree root for verify.
struct Session { log_path: const u8[:], lock_path: const u8[:], root: const u8[:] }

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

// Parses an integer field, reporting whether it was present and an integer.
fn int_field(n: json::Node?, key: const u8[:]) -> i64, bool {
    return json::as_i64(json::member(n, key));
}

// Acquires the store lock. A stale lock (holder gone, or its PID reused)
// is taken over. Retries for about 5 s, then fails (spec 6.6).
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
            if root {
                let pid, pok = int_field(root, "pid");
                let st0, sok = int_field(root, "start");
                let alive = pok && native_pid_alive(pid) == 1;
                let same_start = pok && sok && native_pid_start(pid) == st0;
                if !pok || !alive || !same_start {
                    delete_file(sess.lock_path);
                }
            } else {
                delete_file(sess.lock_path);
            }
        }
        sleep_ms(100);
    }
    return false;
}

fn lock_release(sess: Session&) {
    delete_file(sess.lock_path);
}

// Appends one observation record under the lock, then applies it.
fn write_locked(sess: Session&, st: Store&, rec: const u8[:]) -> bool {
    if !lock_acquire(sess) { return false; }
    let ok = append_record(st, sess.log_path, rec);
    lock_release(sess);
    return ok;
}

// Builds the "obs" record: the observation's members, plus "r":"obs".
fn observation_record(obs: json::Node&, rec: u8[>..]&) {
    rec.append("{\"r\":\"obs\"");
    json::each(obs) { c =>
        rec.push(',');
        json::format_string(rec, c.key);
        rec.push(':');
        write_value(c, rec);
    };
    rec.push('}');
}

// Checks the required fields of an observation (spec 9.5). Nothing is
// written unless this passes.
fn observation_valid(obs: json::Node?) -> bool {
    let t, tok = json::as_string(json::member(obs, "task"));
    let b, bok = json::as_string(json::member(obs, "baseline"));
    let c, cok = json::as_string(json::member(obs, "outcome"));
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

// Writes a result or an error into out, as one response line body.
// kind: 0 result, 1 error. body is the result or the error code.
fn reply(id: i64, has_id: bool, out: u8[>..]&, body: const u8[:], kind: i64) {
    out.append("{\"id\":");
    if has_id { json::format_int(out, id); } else { out.append("null"); }
    if kind == 0 {
        out.append(",\"result\":");
        out.append(body);
    } else {
        out.append(",\"error\":");
        out.append(body);
    }
    out.append("}\n");
}

// An error object: {"code":..,"message":..}.
fn error_body(code: const u8[:], msg: const u8[:], out: u8[>..]&) {
    out.append("{\"code\":");
    json::format_string(out, code);
    out.append(",\"message\":");
    json::format_string(out, msg);
    out.append("}");
}

// Handles one request line, writing the response to out. Returns 0 to
// continue, 1 after shutdown, 2 when the stream must close (protocol
// mismatch).
fn handle(sess: Session&, st: Store&, line: const u8[:], out: u8[>..]&) -> i64 {
    var doc: json::Node[>..] = [];
    var decoded: u8[>..] = [];
    let root, err = json::parse(line, doc, decoded);
    if !root {
        var eb: u8[>..] = [];
        error_body("invalid_params", err, eb);
        reply(0, false, out, eb, 1);
        return 0;
    }
    let id, has_id = json::as_i64(json::member(root, "id"));
    let method, mok = json::as_string(json::member(root, "method"));
    let params = json::member(root, "params");
    var body: u8[>..] = [];
    var failed: i64 = 0;
    if !mok {
        error_body("invalid_params", "missing method", body);
        reply(id, has_id, out, body, 1);
        return 0;
    }

    if method == "hello" {
        let proto, pok = json::as_i64(json::member(params, "protocol"));
        if !pok || proto != 1 {
            error_body("protocol_mismatch", "supported protocol versions: [1]", body);
            reply(id, has_id, out, body, 1);
            return 2;
        }
        body.append("{\"protocol\":1,\"engine\":{\"name\":\"backplane-core-goose\",\"version\":\"0.1.0\"},");
        body.append("\"capabilities\":[\"probes\",\"dirs\",\"env\",\"verify\"],\"store\":\".backplane\"}");
    } else if method == "ping" {
        body.append("{\"pong\":true}");
    } else if method == "shutdown" {
        body.append("{\"bye\":true}");
        reply(id, has_id, out, body, 0);
        return 1;
    } else if method == "baseline" {
        body.append("{\"baseline\":");
        if st.has_baseline { json::format_string(body, text(st, st.baseline)); } else { body.append("null"); }
        body.push('}');
    } else if method == "observe" {
        let obs = json::member(params, "observation");
        if !observation_valid(obs) || !obs {
            error_body("invalid_params", "observation needs task, baseline, outcome and context", body);
            failed = 1;
        } else {
            var rec: u8[>..] = [];
            observation_record(obs, rec);
            if !write_locked(sess, st, rec) {
                error_body("lock_busy", "another writer holds the store lock", body);
                failed = 1;
            } else {
                body.append("{\"accepted\":true}");
            }
        }
    } else if method == "advance" {
        let to, tok = json::as_string(json::member(params, "to"));
        let exp, eok = json::as_string(json::member(params, "expected"));
        var matches = !eok;
        if st.has_baseline { matches = eok && text(st, st.baseline) == exp; }
        if !tok || !matches {
            error_body("baseline_conflict", "expected baseline does not match the store", body);
            failed = 1;
        } else {
            var rec: u8[>..] = [];
            rec.append("{\"r\":\"baseline\",\"value\":");
            json::format_string(rec, to);
            rec.push('}');
            if !write_locked(sess, st, rec) {
                error_body("lock_busy", "another writer holds the store lock", body);
                failed = 1;
            } else {
                body.append("{\"baseline\":");
                json::format_string(body, to);
                body.push('}');
            }
        }
    } else if method == "forget" {
        let tid, tok = json::as_string(json::member(params, "task"));
        if !tok {
            error_body("invalid_params", "forget needs a task id", body);
            failed = 1;
        } else {
            var rec: u8[>..] = [];
            rec.append("{\"r\":\"forget\",\"task\":");
            json::format_string(rec, tid);
            rec.push('}');
            if !write_locked(sess, st, rec) {
                error_body("lock_busy", "another writer holds the store lock", body);
                failed = 1;
            } else {
                let ti = find_task(st, tid);
                if ti >= 0 { g_tasks[ti].forgotten = true; }
                body.append("{\"forgotten\":true}");
            }
        }
    } else if method == "affected" {
        query_reset();
        var q = Query { baseline: Span { off: 0, len: 0 }, has_ctx: false, verify: false, conservative: false };
        read_query(st, params, q);
        plan(st, q, sess.root, body);
    } else if method == "stats" {
        var live: i64 = 0;
        for i in g_tasks.len {
            if !g_tasks[i].forgotten && g_tasks[i].latest >= 0 { live += 1; }
        }
        body.append("{\"tasks\":");
        json::format_int(body, live);
        body.append(",\"observations\":");
        json::format_int(body, g_obs.len);
        body.append(",\"baseline\":");
        if st.has_baseline { json::format_string(body, text(st, st.baseline)); } else { body.append("null"); }
        body.append("}");
    } else {
        error_body("unknown_method", "method is not in protocol v1", body);
        failed = 1;
    }
    reply(id, has_id, out, body, failed);
    return 0;
}
