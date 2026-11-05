// Compaction test: verifies that compacting the log keeps the latest
// observation per task and that the state reloads correctly.
import std;
import os;
import json;
import store;

fn check(cond: bool, msg: const u8[:]) {
    if !cond {
        write_stderr("FAIL compact_test: ");
        write_stderr(msg);
        write_stderr("\n");
        exit(1);
    }
}

fn main() {
    var st = Store { baseline: Span { off: 0, len: 0 }, has_baseline: false, ctx_id: -1 };

    // Record two observations for the same task (second replaces first)
    var obs1: u8[>..] = [];
    format(obs1, "{\"r\":\"obs\",\"task\":\"ct\",\"baseline\":\"b1\",\"context\":{},\"inputs\":[]}\n");
    let r1 = apply_line(st, obs1, 0);
    check(r1, "obs1 applied");

    var obs2: u8[>..] = [];
    format(obs2, "{\"r\":\"obs\",\"task\":\"ct\",\"baseline\":\"b1\",\"context\":{},\"inputs\":[]}\n");
    let r2 = apply_line(st, obs2, 0);
    check(r2, "obs2 applied");

    let ti = find_task(st, "ct");
    check(ti >= 0, "task ct found");
    check(g_tasks[ti].latest == 1, "latest obs is second one");
    check(g_live == 1, "one live task");
    check(g_obs.len == 2, "two observations recorded");

    // Compact: rewrite log with only latest obs per task + baseline
    var out: u8[>..] = [];
    out.append("{\"r\":\"hdr\",\"v\":1,\"hash\":\"sha256\",\"created\":\"2026-01-01T00:00:00Z\"}\n");
    for i in g_tasks.len {
        let t = g_tasks[i];
        if t.forgotten || t.latest < 0 { continue; }
        out.append(line_text(g_obs[t.latest].line));
        out.push('\n');
    }
    let wrote = write_file_atomic("/tmp/core_compact_test_log", out);
    check(wrote, "compact log written");

    // Reload from compacted log
    store_reset(st);
    var compact_log: u8[>..] = [];
    let read_ok = read_file("/tmp/core_compact_test_log", compact_log);
    check(read_ok, "compact log read");
    let loaded = load_log(st, compact_log);
    check(loaded, "compact log loaded");
    check(g_live == 1, "one live task after compact");
    check(g_obs.len == 1, "one observation after compact (duplicates removed)");

    // Index rebuild from compacted log
    let idx_ok = write_index(st, "/tmp/core_compact_test_idx");
    check(idx_ok, "write_index after compact");

    write_stdout("compact_test: PASS\n");
    exit(0);
}
