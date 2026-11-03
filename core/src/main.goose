import std;
import os;
// The backplane command line: a thin binding over protocol v1 (spec 10.2).
// `serve` runs the protocol over stdio. The other commands are not yet
// implemented in this build and say so.
import store;
import protocol;
import native;

let version_line = "backplane-core-goose 0.1.0";

// Opens the store: reads the log and applies every record (spec 7.1).
// Returns 0 on success, 3 for store_missing or store_corrupt.
fn open_store(st: Store&, log_path: const u8[:]) -> i64 {
    var log: u8[>..] = [];
    if !read_file(log_path, log) { return 3; }
    if !load_log(st, log) { return 3; }
    return 0;
}

// Creates the store directory and any missing parents, like mkdir -p.
fn make_dirs(path: const u8[:]) {
    for i in path.len {
        if i > 0 && path[i] == '/' { make_dir(path[..i]); }
    }
    make_dir(path);
}

fn init_store(store_dir: const u8[:]) -> i64 {
    make_dirs(store_dir);
    var log_path: u8[>..] = [];
    format(log_path, store_dir, "/tg.log");
    if file_exists(log_path) { return 0; }
    var created: u8[>..] = [];
    native_utc_rfc3339(created);
    var hdr: u8[>..] = [];
    format(hdr, "{\"r\":\"hdr\",\"v\":1,\"hash\":\"sha256\",\"created\":\"", created, "\"}\n");
    if !write_file(log_path, hdr) { return 4; }
    return 0;
}

fn main() {
    let argc = arg_count();
    var cmd: u8[>..] = [];
    if argc >= 2 { arg(1, cmd); }
    var store_dir: u8[>..] = [];
    var root: u8[>..] = [];
    root.push('.');
    var have_store = false;
    var i: i64 = 2;
    while i < argc {
        var a: u8[>..] = [];
        arg(i, a);
        if (a == "--store" || a == "--root") && i + 1 < argc {
            var v: u8[>..] = [];
            arg(i + 1, v);
            if a == "--store" { store_dir.clear(); store_dir.append(v); have_store = true; } else { root.clear(); root.append(v); }
            i += 2;
        } else {
            i += 1;
        }
    }
    if !have_store {
        var env_store: u8[>..] = [];
        if env("BACKPLANE_STORE", env_store) { store_dir.clear(); store_dir.append(env_store); } else { store_dir.append(".backplane"); }
    }

    if cmd == "version" {
        print(version_line);
        return;
    }
    if cmd == "init" {
        let code = init_store(store_dir);
        if code != 0 { write_stderr("backplane: init failed\n"); exit(code); }
        return;
    }
    if cmd == "serve" {
        var log_path: u8[>..] = [];
        format(log_path, store_dir, "/tg.log");
        var lock_path: u8[>..] = [];
        format(lock_path, store_dir, "/tg.lock");
        var st = Store { baseline: Span { off: 0, len: 0 }, has_baseline: false, ctx_from: 0, ctx_n: 0, has_ctx: false };
        let code = open_store(st, log_path);
        if code != 0 {
            write_stderr("{\"ok\":false,\"error\":{\"code\":\"store_missing\"}}\n");
            exit(code);
        }
        let sess = Session { log_path: log_path, lock_path: lock_path, root: root };
        var status: i64 = 0;
        while true {
            var line: u8[>..] = [];
            if !read_line(line) { break; }
            if line.len == 0 { continue; }
            var out: u8[>..] = [];
            status = handle(sess, st, line, out);
            write_stdout(out);
            flush_stdout();
            if status != 0 { break; }
        }
        // A protocol mismatch closes the stream with exit status 2 (CLI, 9.7).
        if status == 2 { exit(2); }
        return;
    }
    write_stderr("usage: backplane <init|serve|version> [--store PATH] [--root PATH]\n");
    exit(2);
}
