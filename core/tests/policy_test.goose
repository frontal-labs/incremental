// Policy tests: in-process tests of the policy engine (policy.goose).
import std;
import os;
import json;
import store;
import policy;
import native;
import dictionary;

fn check(cond: bool, msg: const u8[:]) {
    if !cond {
        write_stderr("FAIL policy_test: ");
        write_stderr(msg);
        write_stderr("\n");
        exit(1);
    }
}

fn main() {
    var st = Store { baseline: Span { off: 0, len: 0 }, has_baseline: false, ctx_id: -1 };
    var out: u8[>..] = [];

    // ---- Test 1: plan with no baseline set -> fallback rank 5 (baseline_mismatch) ----
    query_reset();
    var q = Query { baseline: Span { off: 0, len: 0 }, has_ctx: false,
                    verify: false, conservative: false };
    plan(st, q, ".", out);
    let pos = find(out, "baseline_mismatch");
    check(pos >= 0, "plan with no baseline gives baseline_mismatch fallback");
    check(find(out, "\"fallback\":null") < 0, "fallback is not null when baseline missing");
    write_stdout("  ok plan no-baseline fallback\n");

    // ---- Test 2: plan with baseline mismatch -> fallback rank 5 ----
    out.clear();
    st.has_baseline = true;
    st.baseline = put(st, "baseline-1");
    query_reset();
    var q2 = Query { baseline: put(st, "baseline-2"), has_ctx: false,
                     verify: false, conservative: false };
    plan(st, q2, ".", out);
    let pos2 = find(out, "baseline_mismatch");
    check(pos2 >= 0, "plan with baseline mismatch gives baseline_mismatch fallback");
    write_stdout("  ok plan baseline-mismatch fallback\n");

    // ---- Test 3: plan with baseline match but missing context -> fallback rank 4 (context_missing) ----
    out.clear();
    query_reset();
    var q3 = Query { baseline: put(st, "baseline-1"), has_ctx: false,
                     verify: false, conservative: false };
    plan(st, q3, ".", out);
    let pos3 = find(out, "context_missing");
    check(pos3 >= 0, "plan with missing context gives context_missing fallback");
    write_stdout("  ok plan context-missing fallback\n");

    // ---- Test 4: query_reset clears globals ----
    query_reset();
    check(q_ctx.len == 0, "q_ctx cleared by query_reset");
    check(q_env.len == 0, "q_env cleared by query_reset");
    check(q_changes.len == 0, "q_changes cleared by query_reset");
    check(q_ignore.len == 0, "q_ignore cleared by query_reset");
    check(q_globals.len == 0, "q_globals cleared by query_reset");
    check(q_keys.len == 0, "q_keys cleared by query_reset");
    check(q_declared.len == 0, "q_declared cleared by query_reset");
    check(q_decl.len == 0, "q_decl cleared by query_reset");
    write_stdout("  ok query_reset clears globals\n");

    write_stdout("policy_test: PASS\n");
    exit(0);
}
