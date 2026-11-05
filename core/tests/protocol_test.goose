// Protocol tests: in-process tests of the protocol dispatch layer (protocol.goose).
import std;
import os;
import json;
import store;
import protocol;
import native;
import dictionary;

fn check(cond: bool, msg: const u8[:]) {
    if !cond {
        write_stderr("FAIL protocol_test: ");
        write_stderr(msg);
        write_stderr("\n");
        exit(1);
    }
}

fn main() {
    var st = Store { baseline: Span { off: 0, len: 0 }, has_baseline: false,
                     ctx_from: 0, ctx_n: 0, has_ctx: false };
    var sess = Session {
        log_path: "test-log",
        lock_path: "test-lock",
        idx_path: "test-idx",
        cache_path: "test-cache",
        root: ".",
    };
    var body: u8[>..] = [];
    var doc: json::Node[>..] = [];
    var decoded: u8[>..] = [];

    // ---- Test 1: dispatch ping ----
    body.clear();
    let root, err = json::parse("{}", doc, decoded);
    if !root {
        write_stderr("FAIL protocol_test: ping params parse\n");
        exit(1);
    }
    let code = dispatch(sess, st, "ping", root, body);
    check(code == 0, "ping returns 0");
    check(body.len > 0, "ping produces a body");
    write_stdout("  ok dispatch ping\n");

    // ---- Test 2: dispatch shutdown ----
    body.clear();
    let root2, _ = json::parse("{}", doc, decoded);
    let code2 = dispatch(sess, st, "shutdown", root2, body);
    check(code2 == 9, "shutdown returns E_SHUTDOWN (9)");
    write_stdout("  ok dispatch shutdown\n");

    // ---- Test 3: dispatch unknown method ----
    body.clear();
    let root3, _ = json::parse("{}", doc, decoded);
    let code3 = dispatch(sess, st, "no_such_method", root3, body);
    check(code3 == 7, "unknown method returns E_UNKNOWN (7)");
    write_stdout("  ok dispatch unknown method\n");

    // ---- Test 4: dispatch baseline with no baseline set ----
    body.clear();
    let root4, _ = json::parse("{}", doc, decoded);
    let code4 = dispatch(sess, st, "baseline", root4, body);
    check(code4 == 0, "baseline returns 0 when unset");
    write_stdout("  ok dispatch baseline unset\n");

    // ---- Test 5: dispatch observe with missing observation ----
    body.clear();
    let root5, _ = json::parse("{}", doc, decoded);
    let code5 = dispatch(sess, st, "observe", root5, body);
    check(code5 == 2, "observe without observation returns E_INVALID (2)");
    write_stdout("  ok dispatch observe invalid\n");

    // ---- Test 6: dispatch observe_many with missing observations ----
    body.clear();
    let root6, _ = json::parse("{}", doc, decoded);
    let code6 = dispatch(sess, st, "observe_many", root6, body);
    check(code6 == 2, "observe_many without observations returns E_INVALID (2)");
    write_stdout("  ok dispatch observe_many invalid\n");

    // ---- Test 7: dispatch advance with missing target ----
    body.clear();
    let root7, _ = json::parse("{}", doc, decoded);
    let code7 = dispatch(sess, st, "advance", root7, body);
    check(code7 == 2, "advance without target returns E_INVALID (2)");
    write_stdout("  ok dispatch advance invalid\n");

    // ---- Test 8: dispatch forget with missing task ----
    body.clear();
    let root8, _ = json::parse("{}", doc, decoded);
    let code8 = dispatch(sess, st, "forget", root8, body);
    check(code8 == 2, "forget without task returns E_INVALID (2)");
    write_stdout("  ok dispatch forget invalid\n");

    write_stdout("protocol_test: PASS\n");
    exit(0);
}
