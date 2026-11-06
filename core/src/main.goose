// The incremental command line: a thin binding over protocol v1 (spec 10.2).
// Each command builds the params of one method and calls dispatch(), the same
// function the serve loop uses, so CLI and protocol answers are identical.
import std;
import os;
import json;
import store;
import protocol;
import policy;
import native;

let version_line = "incremental-core-goose 0.1.0";

// Paths of the store, built once and kept for the whole run.
var p_log: u8[>..] = [];
var p_lock: u8[>..] = [];
var p_idx: u8[>..] = [];
var p_cache: u8[>..] = [];
var p_root: u8[>..] = [];

fn set_paths(store_dir: const u8[:], root: const u8[:]) {
    p_log.clear(); p_log.append(store_dir); p_log.append("/tg.log");
    p_lock.clear(); p_lock.append(store_dir); p_lock.append("/tg.lock");
    p_idx.clear(); p_idx.append(store_dir); p_idx.append("/tg.idx");
    p_cache.clear(); p_cache.append(store_dir); p_cache.append("/stat.cache");
    p_root.clear(); p_root.append(root);
}

fn session() -> Session {
    return Session { log_path: p_log, lock_path: p_lock, idx_path: p_idx, cache_path: p_cache, root: p_root };
}

// Index of the argument after name, or -1 when it is absent or has no value.
fn opt_index(av: u8[:][>..]&, name: const u8[:]) -> i64 {
    for i in av.len - 1 {
        if av[i + 1] == name && i + 2 < av.len { return i + 2; }
    }
    return -1;
}

fn has_flag(av: u8[:][>..]&, name: const u8[:]) -> bool {
    for i in av.len {
        if av[i] == name { return true; }
    }
    return false;
}

// Reads a file argument, or standard input for "-".
fn read_input(path: const u8[:], out: u8[>..]&) -> bool {
    if path == "-" {
        read_stdin(out);
        return true;
    }
    return read_file(path, out);
}

// Loads the store: the index image if it is valid for the log, else a full
// replay (spec 6.4). Returns 0, or E_STORE when the log is missing or corrupt.
fn open_store(st: Store&, sess: Session&) -> i64 {
    let tr = trace_on();
    var tp = native_cpu_ns();
    var log: u8[>..] = [];
    if !read_file(sess.log_path, log) { return E_STORE; }
    tp = trace_phase(tr, "log_read", tp);
    if !load_index(st, sess.idx_path, log) {
        tp = trace_phase(tr, "idx_rejected", tp);
        if !load_log(st, log) { return E_STORE; }
        tp = trace_phase(tr, "log_replay", tp);
    }
    // The state now holds exactly the log as read: the first request need not read it again.
    mark_log(sess.log_path);
    return 0;
}

// Maps an error code to the CLI exit status (spec 9.7).
fn exit_code(code: i64) -> i64 {
    if code == E_STORE { return 3; }
    if code == E_INTERNAL { return 4; }
    if code == E_LOCK { return 5; }
    if code == E_BASELINE { return 6; }
    return 2;
}

// Runs one method from its params text, prints the result or the error the
// way spec 10.2 says, and returns the exit status.
fn run_method(sess: Session&, st: Store&, method: const u8[:], params_text: const u8[:]) -> i64 {
    var doc: json::Node[>..] = [];
    var decoded: u8[>..] = [];
    let root, err = json::parse(params_text, doc, decoded);
    var body: u8[>..] = [];
    if !root {
        fail(E_INVALID, err, body);
        write_error(body);
        return 2;
    }
    let code = dispatch(sess, st, method, root, body);
    if code != 0 {
        write_error(body);
        return exit_code(code);
    }
    write_stdout(body);
    write_stdout("\n");
    return 0;
}

// {"ok":false,"error":{...}} on stdout and one line on stderr.
fn write_error(body: const u8[:]) {
    var line: u8[>..] = [];
    line.append("{\"ok\":false,\"error\":");
    line.append(body);
    line.append("}\n");
    write_stdout(line);
    var msg: u8[>..] = [];
    msg.append("incremental: ");
    msg.append(body);
    msg.append("\n");
    write_stderr(msg);
}

// Creates the store directory, any missing parents, and an empty log with a
// header. Safe to run twice (spec 7.1).
fn init_store(store_dir: const u8[:]) -> i64 {
    var cur: u8[>..] = [];
    for i in store_dir.len {
        if i > 0 && store_dir[i] == '/' { make_dir(store_dir[..i]); }
    }
    make_dir(store_dir);
    if file_exists(p_log) { return 0; }
    var created: u8[>..] = [];
    native_utc_rfc3339(created);
    var hdr: u8[>..] = [];
    format(hdr, "{\"r\":\"hdr\",\"v\":1,\"hash\":\"sha256\",\"created\":\"", created, "\"}\n");
    if !write_file(p_log, hdr) { return 4; }
    return 0;
}

// The params text of a method from the command's arguments.
fn params_observe(av: u8[:][>..]&, out: u8[>..]&) -> bool {
    let i = opt_index(av, "--file");
    if i < 0 { return false; }
    var obs: u8[>..] = [];
    if !read_input(av[i], obs) { return false; }
    out.append("{\"observation\":");
    out.append(obs);
    out.append("}");
    return true;
}

fn params_affected(av: u8[:][>..]&, out: u8[>..]&) -> bool {
    let ci = opt_index(av, "--changes");
    let bi = opt_index(av, "--baseline");
    let xi = opt_index(av, "--context");
    if ci < 0 || bi < 0 || xi < 0 { return false; }
    var changes: u8[>..] = [];
    var ctx: u8[>..] = [];
    if !read_input(av[ci], changes) { return false; }
    if !read_file(av[xi], ctx) { return false; }
    var env: u8[>..] = [];
    let ei = opt_index(av, "--env");
    if ei >= 0 {
        if !read_file(av[ei], env) { return false; }
    } else {
        env.append("{}");
    }
    var config: u8[>..] = [];
    var cfg_path: u8[>..] = [];
    cfg_path.append(p_root);
    cfg_path.append("/incremental.config.json");
    if !read_file(cfg_path, config) { config.append("null"); }
    let pi = opt_index(av, "--policy");
    var policy_name: u8[>..] = [];
    if pi >= 0 { policy_name.append(av[pi]); } else { policy_name.append("balanced"); }
    var baseline: u8[>..] = [];
    json::format_string(baseline, av[bi]);
    out.append("{\"changes\":");
    out.append(changes);
    out.append(",\"options\":{\"baseline\":");
    out.append(baseline);
    out.append(",\"context\":");
    out.append(ctx);
    out.append(",\"env\":");
    out.append(env);
    out.append(",\"verify\":");
    out.append(if has_flag(av, "--verify") { "true" } else { "false" });
    out.append(",\"policy\":\"");
    out.append(policy_name);
    out.append("\",\"config\":");
    out.append(config);
    out.append("}}");
    return true;
}

// A method param with one string value, or null when the flag is absent.
fn params_one(av: u8[:][>..]&, flag: const u8[:], key: const u8[:], out: u8[>..]&) -> bool {
    let i = opt_index(av, flag);
    if i < 0 { return false; }
    out.append("{\"");
    out.append(key);
    out.append("\":");
    json::format_string(out, av[i]);
    out.append("}");
    return true;
}

fn main() {
    let av = args();
    if av.len < 2 {
        write_stderr("usage: incremental <command> [options]\n");
        exit(2);
    }
    let cmd = av[1];
    var store_dir: u8[>..] = [];
    let si = opt_index(av, "--store");
    if si >= 0 {
        store_dir.append(av[si]);
    } else {
        var from_env: u8[>..] = [];
        if env("INCREMENTAL_STORE", from_env) { store_dir.append(from_env); } else { store_dir.append(".incremental"); }
    }
    var root: u8[>..] = [];
    let ri = opt_index(av, "--root");
    if ri >= 0 { root.append(av[ri]); } else { root.append("."); }
    set_paths(store_dir, root);

    if cmd == "version" {
        write_stdout(version_line);
        write_stdout("\n");
        return;
    }
    if cmd == "init" {
        let code = init_store(store_dir);
        if code != 0 {
            write_stderr("incremental: init failed\n");
            exit(code);
        }
        return;
    }

    var st = Store { baseline: Span { off: 0, len: 0 }, has_baseline: false, ctx_id: -1 };
    let sess = session();
    let opened = open_store(st, sess);
    if opened != 0 {
        var body: u8[>..] = [];
        fail(E_STORE, "store is missing or corrupt", body);
        write_error(body);
        exit(3);
    }

    if cmd == "serve" {
        var status: i64 = 0;
        var running = true;
        while running {
            var line: u8[>..] = [];
            if read_line(line) {
                if line.len != 0 {
                    var out: u8[>..] = [];
                    status = handle(sess, st, line, out);
                    write_stdout(out);
                    flush_stdout();
                    if status == 0 {
                        // keep serving
                    } else {
                        running = false;
                    }
                }
            } else {
                running = false;
            }
        }
        write_index(st, sess.idx_path);
        // A protocol mismatch closes the stream with exit status 2 (9.7).
        if status == 2 { exit(2); }
        if status == E_STORE { exit(3); }
        return;
    }

    var params: u8[>..] = [];
    var method: u8[>..] = [];
    var ok = true;
    if cmd == "observe" {
        method.append("observe");
        ok = params_observe(av, params);
    } else if cmd == "affected" {
        method.append("affected");
        ok = params_affected(av, params);
    } else if cmd == "advance" {
        method.append("advance");
        let ti = opt_index(av, "--to");
        let ei = opt_index(av, "--expected");
        ok = ti >= 0;
        params.append("{\"to\":");
        if ti >= 0 { json::format_string(params, av[ti]); }
        params.append(",\"expected\":");
        if ei >= 0 && av[ei] != "null" { json::format_string(params, av[ei]); } else { params.append("null"); }
        params.append("}");
    } else if cmd == "explain" {
        method.append("explain");
        ok = params_one(av, "--task", "task", params);
    } else if cmd == "forget" {
        method.append("forget");
        ok = params_one(av, "--task", "task", params);
    } else if cmd == "stats" {
        method.append("stats");
        params.append("{}");
    } else if cmd == "compact" {
        method.append("compact");
        params.append("{}");
    } else {
        write_stderr("incremental: unknown command\n");
        exit(2);
    }
    if !ok {
        var body: u8[>..] = [];
        fail(E_INVALID, "missing or unreadable argument", body);
        write_error(body);
        exit(2);
    }
    let status = run_method(sess, st, method, params);
    if status == 0 && cmd != "stats" { write_index(st, sess.idx_path); }
    exit(status);
}
