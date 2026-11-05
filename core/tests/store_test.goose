// Store tests: in-process tests of the core store module (store.goose).
import std;
import os;
import json;
import store;
import native;
import dictionary;

fn check(cond: bool, msg: const u8[:]) {
    if !cond {
        write_stderr("FAIL store_test: ");
        write_stderr(msg);
        write_stderr("\n");
        exit(1);
    }
}

fn main() {
    var st = Store { baseline: Span { off: 0, len: 0 }, has_baseline: false,
                     ctx_from: 0, ctx_n: 0, has_ctx: false };

    // ---- Test 1: store_reset initializes clean state ----
    store_reset(st);
    check(!st.has_baseline, "no baseline after reset");
    check(!st.has_ctx, "no context after reset");
    check(g_live == 0, "no live tasks after reset");
    write_stdout("  ok store_reset\n");

    // ---- Test 2: apply_line accepts a valid obs record ----
    var line: u8[>..] = [];
    format(line, "{\"r\":\"obs\",\"task\":\"task-a\",\"baseline\":\"b1\",\"context\":{},\"inputs\":[]}\n");
    let ok = apply_line(st, line, 0);
    check(ok, "apply_line accepts valid obs");
    let ti = find_task(st, "task-a");
    check(ti >= 0, "task-a found after obs");
    check(task_live(ti), "task-a is live");
    write_stdout("  ok apply_line obs\n");

    // ---- Test 3: apply_line accepts a forget record ----
    var forget: u8[>..] = [];
    format(forget, "{\"r\":\"forget\",\"task\":\"task-a\"}\n");
    let ok2 = apply_line(st, forget, 0);
    check(ok2, "apply_line accepts forget");
    check(!task_live(ti), "task-a not live after forget");
    write_stdout("  ok apply_line forget\n");

    // ---- Test 4: apply_line accepts a baseline record ----
    var base: u8[>..] = [];
    format(base, "{\"r\":\"baseline\",\"value\":\"base-1\"}\n");
    let ok3 = apply_line(st, base, 0);
    check(ok3, "apply_line accepts baseline");
    check(st.has_baseline, "baseline is set after baseline record");
    check(same(st, st.baseline, "base-1"), "baseline value is base-1");
    write_stdout("  ok apply_line baseline\n");

    // ---- Test 5: load_log parses a multi-record log ----
    store_reset(st);
    var log: u8[>..] = [];
    format(log, "{\"r\":\"hdr\",\"v\":1,\"hash\":\"sha256\",\"created\":\"2026-01-01T00:00:00Z\"}\n");
    format(log, "{\"r\":\"obs\",\"task\":\"task-x\",\"baseline\":\"b1\",\"context\":{},\"inputs\":[]}\n");
    format(log, "{\"r\":\"obs\",\"task\":\"task-y\",\"baseline\":\"b1\",\"context\":{},\"inputs\":[]}\n");
    let loaded = load_log(st, log);
    check(loaded, "load_log succeeds");
    check(g_live == 2, "two live tasks after load_log");
    write_stdout("  ok load_log\n");

    // ---- Test 6: find_task returns -1 for unknown task ----
    let unknown = find_task(st, "task-nonexistent");
    check(unknown < 0, "unknown task not found");
    write_stdout("  ok find_task unknown\n");

    // ---- Test 7: write_index / load_index round-trip ----
    store_reset(st);
    var log2: u8[>..] = [];
    format(log2, "{\"r\":\"obs\",\"task\":\"task-idx\",\"baseline\":\"b1\",\"context\":{},\"inputs\":[]}\n");
    load_log(st, log2);
    let idx_ok = write_index(st, "/tmp/core_store_test_idx");
    check(idx_ok, "write_index succeeds");

    var st2 = Store { baseline: Span { off: 0, len: 0 }, has_baseline: false,
                      ctx_from: 0, ctx_n: 0, has_ctx: false };
    let loaded2 = load_index(st2, "/tmp/core_store_test_idx", log2);
    check(loaded2, "load_index succeeds");
    check(g_live == 1, "one live task after load_index");
    write_stdout("  ok write_index/load_index\n");

    // ---- Test 8: load_stat_cache with missing file yields empty cache ----
    load_stat_cache(st, "/tmp/core_store_test_cache_missing.json");
    check(g_cache.len == 0, "empty stat cache for missing file");
    write_stdout("  ok load_stat_cache missing\n");

    // ---- Test 9: apply_from ignores a truncated final line ----
    store_reset(st);
    var tail_log: u8[>..] = [];
    format(tail_log, "{\"r\":\"obs\",\"task\":\"complete\",\"baseline\":\"b1\",\"context\":{},\"inputs\":[]}\n");
    format(tail_log, "{\"r\":\"obs\",\"task\":\"truncated\",\"baseline\":\"b1\",\"context\":{},\"inputs\":[]");
    let off, ok4 = apply_from(st, tail_log, 0);
    check(ok4, "apply_from succeeds");
    check(g_live == 1, "only the complete observation is counted");
    check(off > 0, "apply_from advanced past the complete line");
    write_stdout("  ok apply_from truncated tail\n");

    write_stdout("store_test: PASS\n");
    exit(0);
}
