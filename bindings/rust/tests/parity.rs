//! G6: byte-identical plans. For every query case, the Rust client's plan,
//! serialized compactly, equals the body of the engine's `serve` result, and
//! (where the CLI takes the same inputs) the CLI stdout minus its newline.
//! Mirrors bindings/python/tests/test_parity.py.

mod common;

use common::*;
use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::Write;
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;
use std::process::{Command, Stdio};

const SERVE_PREFIX: &[u8] = br#"{"id":500,"result":"#;

#[derive(Default)]
struct Counts {
    serve: usize,
    cli_eligible: usize,
    cli: usize,
}

#[test]
fn serve_and_cli_bytes_match_client() {
    let cases: Vec<Value> = load_cases().into_iter().filter(|case| case.get("query").is_some()).collect();
    assert_eq!(cases.len(), 36, "expected the 36 query cases of conformance/cases");

    let mut counts = Counts::default();
    let mut failures = Vec::new();
    for case in &cases {
        match panic::catch_unwind(AssertUnwindSafe(|| check_case(case, &mut counts))) {
            Ok(diffs) if diffs.is_empty() => {}
            Ok(diffs) => failures.push(format!("{}: {}", case_id(case), diffs.join("; "))),
            Err(_) => failures.push(format!("{}: panicked", case_id(case))),
        }
    }
    eprintln!(
        "G6 counts: query cases {}, serve parity {}, CLI-eligible {}, CLI parity {}",
        cases.len(),
        counts.serve,
        counts.cli_eligible,
        counts.cli
    );
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn check_case(case: &Value, counts: &mut Counts) -> Vec<String> {
    let store = seeded_store(case);
    if let Some(log) = case.get("post_raw_log").and_then(Value::as_str) {
        let mut file = OpenOptions::new().append(true).open(store.join("tg.log")).expect("open tg.log");
        file.write_all(log.as_bytes()).expect("append tg.log");
    }
    let mut diffs = Vec::new();

    let plan = dumps(&query_plan(case, &store)).into_bytes();
    let body = serve_body(case, &store);
    if plan != body {
        diffs.push("client plan bytes differ from the serve result body".to_string());
    } else {
        counts.serve += 1;
    }

    if case["query"].get("context").is_some() {
        counts.cli_eligible += 1;
        let cli = cli_stdout(case, &store);
        // The CLI has no env, config or declared_tasks flags; the client gets the same omissions.
        let mut opts = query_options(case);
        opts.env = None;
        opts.config = None;
        opts.declared_tasks = None;
        let mut client = open(case, &store);
        let plan = client.affected(&query_changes(case), &opts).expect("affected");
        client.close();
        let want = format!("{}\n", dumps(&plan)).into_bytes();
        if want != cli {
            diffs.push("client plan bytes differ from CLI stdout".to_string());
        } else {
            counts.cli += 1;
        }
    }
    cleanup(&store);
    diffs
}

// The result body of the serve response to the same `affected` request.
fn serve_body(case: &Value, store: &Path) -> Vec<u8> {
    let hello = json!({"id": 1, "method": "hello", "params": {"protocol": 1, "client": {"name": "g6", "version": "0"}}});
    let req = json!({"id": 500, "method": "affected",
                     "params": {"changes": query_changes(case), "options": query_options(case).options()}});
    let input = format!("{hello}\n{req}\n");
    let mut child = Command::new(engine())
        .arg("serve")
        .arg("--store")
        .arg(store)
        .arg("--root")
        .arg(worktree(case))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn engine");
    let mut stdin = child.stdin.take().expect("stdin");
    stdin.write_all(input.as_bytes()).expect("write requests");
    drop(stdin);
    let out = child.wait_with_output().expect("engine output");

    let found: Vec<&[u8]> = out.stdout.split(|b| *b == b'\n').filter(|line| line.starts_with(SERVE_PREFIX)).collect();
    assert!(
        found.len() == 1 && found[0].ends_with(b"}"),
        "no single result line for id 500: {}",
        String::from_utf8_lossy(&out.stdout)
    );
    found[0][SERVE_PREFIX.len()..found[0].len() - 1].to_vec()
}

fn cli_stdout(case: &Value, store: &Path) -> Vec<u8> {
    let dir = store.parent().expect("store parent");
    let changes = dir.join("changes.json");
    let context = dir.join("context.json");
    std::fs::write(&changes, dumps(&query_changes(case))).expect("write changes");
    std::fs::write(&context, dumps(&case["query"]["context"])).expect("write context");

    let q = &case["query"];
    let mut cmd = Command::new(engine());
    cmd.arg("affected")
        .arg("--changes")
        .arg(&changes)
        .arg("--baseline")
        .arg(q["baseline"].as_str().expect("baseline"))
        .arg("--context")
        .arg(&context)
        .arg("--store")
        .arg(store)
        .arg("--root")
        .arg(worktree(case))
        .arg("--policy")
        .arg(case["mode"].as_str().expect("mode"));
    if q.get("verify").and_then(Value::as_bool).unwrap_or(false) {
        cmd.arg("--verify");
    }
    let out = cmd.output().expect("run CLI");
    assert!(out.status.success(), "cli exit {:?}: {}", out.status.code(), String::from_utf8_lossy(&out.stderr));
    out.stdout
}
