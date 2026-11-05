//! Every case in conformance/cases/*.json, run through the Rust client. Mirrors
//! bindings/python/tests/_conformance.py: the same stores, comparisons and
//! determinism checks. Expectations come from the case files only.

mod common;

use incremental::Incremental;
use common::*;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

#[test]
fn conformance_cases() {
    let cases = load_cases();
    let mut failures = Vec::new();
    for case in &cases {
        match panic::catch_unwind(AssertUnwindSafe(|| run_case(case))) {
            Ok(diffs) if diffs.is_empty() => {}
            Ok(diffs) => failures.push(format!("{} {}: {}", case_id(case), case["desc"], diffs.join("; "))),
            Err(_) => failures.push(format!("{} panicked", case_id(case))),
        }
    }
    eprintln!("conformance: {} cases, {} passed, {} failed", cases.len(), cases.len() - failures.len(), failures.len());
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn run_case(case: &Value) -> Vec<String> {
    if case["determinism"] == "index" {
        return run_index(case);
    }
    if case["kind"] == "concurrency" {
        return run_concurrency(case);
    }
    if case.get("action").is_some() {
        if case["action"]["method"] == "hello" {
            return run_hello_action(case);
        }
        return run_action(case);
    }
    if case.get("raw_lines").is_some() {
        return run_raw_lines(case);
    }
    if case.get("post_raw_log").is_some() {
        return run_post_raw_log(case);
    }
    run_query(case)
}

fn run_query(case: &Value) -> Vec<String> {
    let store = seeded_store(case);
    let plan = query_plan(case, &store);
    let mut diffs = mismatches(&plan, &case["expect"]);
    match case["determinism"].as_str() {
        Some("repeat") => {
            let mut client = open(case, &store);
            let first = client.affected(&query_changes(case), &query_options(case)).expect("affected");
            let second = client.affected(&query_changes(case), &query_options(case)).expect("affected");
            client.close();
            if dumps(&first) != dumps(&second) {
                diffs.push("repeat: bytes differ".to_string());
            }
        }
        Some("shuffle") => {
            let mut changes = query_changes(case);
            changes["changes"].as_array_mut().expect("changes").reverse();
            let mut client = open(case, &store);
            let other = client.affected(&changes, &query_options(case)).expect("affected");
            client.close();
            if dumps(&plan) != dumps(&other) {
                diffs.push("shuffle: bytes differ from reversed input order".to_string());
            }
        }
        Some("cache") => {
            let cache = store.join("stat.cache");
            let cached = cache.exists();
            let mut client = open(case, &store);
            let again = client.affected(&query_changes(case), &query_options(case)).expect("affected");
            client.close();
            if cache.exists() {
                fs::remove_file(&cache).expect("remove stat.cache");
            }
            let cold = query_plan(case, &store);
            if !cached {
                diffs.push("cache: stat.cache was not written by verify".to_string());
            }
            if dumps(&again) != dumps(&plan) || dumps(&cold) != dumps(&plan) {
                diffs.push("cache: answer changed with the cache".to_string());
            }
        }
        _ => {}
    }
    cleanup(&store);
    diffs
}

// An action case: one client call that must fail with the expected code, and
// optionally the baseline afterwards.
fn run_action(case: &Value) -> Vec<String> {
    let store = seeded_store(case);
    let mut client = open(case, &store);
    let want = case["expect"]["error"].as_str().expect("expected error");
    let act = &case["action"];
    let mut diffs = Vec::new();
    match dispatch(&mut client, act["method"].as_str().expect("method"), &act["params"]) {
        Ok(_) => diffs.push(format!("error: want {want} got no error")),
        Err(err) if err.code != want => diffs.push(format!("error: want {want} got {}", err.code)),
        Err(_) => {}
    }
    if let Some(after) = case["expect"].get("baseline_after") {
        let got = client.baseline().expect("baseline")["baseline"].clone();
        if &got != after {
            diffs.push(format!("baseline_after: want {after} got {got}"));
        }
    }
    client.close();
    cleanup(&store);
    diffs
}

// hello with protocol 2 goes below the client, which always sends protocol 1.
fn run_hello_action(case: &Value) -> Vec<String> {
    let store = new_store(case_id(case));
    let mut eng = RawEngine::serve(&store, &repo());
    let want = case["expect"]["error"].as_str().expect("expected error");
    let params = &case["action"]["params"];
    eng.send(&json!({"id": 1, "method": "hello", "params": params}).to_string());
    let mut diffs = Vec::new();
    match eng.read(Duration::from_secs(5)) {
        Some(reply) if reply.get("result").is_some() => {
            diffs.push("hello with protocol 2 was accepted".to_string());
        }
        Some(reply) => {
            let code = reply["error"]["code"].as_str().unwrap_or("none");
            if code != want {
                diffs.push(format!("error: want {want} got {code}"));
            }
        }
        None => diffs.push("error: no response".to_string()),
    }
    let status = eng.wait_exit(Duration::from_secs(5));
    if status != Some(2) {
        diffs.push(format!("exit status: want 2 got {status:?}"));
    }
    cleanup(&store);
    diffs
}

// The first raw line is malformed; the second is a valid ping with id 7.
fn run_raw_lines(case: &Value) -> Vec<String> {
    let store = seeded_store(case);
    let mut eng = RawEngine::serve(&store, &repo());
    let hello = json!({"protocol": 1, "client": {"name": "conformance", "version": "0.0.0"}});
    eng.send(&json!({"id": 1, "method": "hello", "params": hello}).to_string());
    eng.read(Duration::from_secs(5)).expect("hello answer");
    let raw = case["raw_lines"].as_array().expect("raw_lines");
    let want = case["expect"]["responses"].as_array().expect("responses");
    let mut diffs = Vec::new();
    eng.send(raw[0].as_str().expect("raw line"));
    let first = eng.read(Duration::from_secs(5)).expect("response 0");
    if !first["id"].is_null() || first["error"]["code"] != want[0]["error_code"] {
        diffs.push(format!("response 0: got {first}"));
    }
    eng.send(raw[1].as_str().expect("raw line"));
    let second = eng.read(Duration::from_secs(5)).expect("response 1");
    if second["id"] != want[1]["id"] || dumps(&second["result"]) != dumps(&want[1]["result"]) {
        diffs.push(format!("response 1: got {second}"));
    }
    cleanup(&store);
    diffs
}

fn run_post_raw_log(case: &Value) -> Vec<String> {
    let store = seeded_store(case);
    let mut log = OpenOptions::new().append(true).open(store.join("tg.log")).expect("open tg.log");
    log.write_all(case["post_raw_log"].as_str().expect("post_raw_log").as_bytes()).expect("append tg.log");
    drop(log);
    let plan = query_plan(case, &store);
    cleanup(&store);
    mismatches(&plan, &case["expect"])
}

fn run_index(case: &Value) -> Vec<String> {
    let store = seeded_store(case);
    let idx = store.join("tg.idx");
    let saved = fs::read(&idx).expect("tg.idx written at exit");
    let plan_once = || query_plan(case, &store);

    let a = plan_once(); // from the index
    fs::remove_file(&idx).expect("remove tg.idx");
    let b = plan_once(); // rebuilt from the log

    let mut client = open(case, &store);
    client
        .observe(&json!({"task": "packages/core/src/extra.test.ts", "baseline": "b1", "dirty": false,
                         "outcome": "pass", "context": context_ok(), "inputs": []}))
        .expect("observe");
    client.close();
    fs::write(&idx, &saved).expect("restore stale tg.idx");
    let cdelta = plan_once(); // stale index plus the log tail
    fs::remove_file(&idx).expect("remove tg.idx");
    let d = plan_once(); // rebuilt after the same log growth

    let mut diffs = Vec::new();
    if dumps(&a) != dumps(&b) {
        diffs.push("index plan differs from rebuilt plan".to_string());
    }
    if dumps(&cdelta) != dumps(&d) {
        diffs.push("delta plan differs from rebuilt plan".to_string());
    }
    diffs.extend(mismatches(&a, &case["expect"]));
    cleanup(&store);
    diffs
}

fn run_concurrency(case: &Value) -> Vec<String> {
    let store = seeded_store(case);
    let writers = case["writers"].as_u64().expect("writers");
    let per = case["per_writer"].as_u64().expect("per_writer");
    let store_ref = store.as_path();
    let mut diffs: Vec<String> = thread::scope(|s| {
        let handles: Vec<_> = (0..writers).map(|w| s.spawn(move || writer(case, store_ref, w, per))).collect();
        handles.into_iter().flat_map(|h| h.join().expect("writer thread")).collect()
    });

    let mut client = open(case, &store);
    let stats = client.stats().expect("stats");
    client.close();
    let accepted = writers * per;
    if stats["tasks"] != case["expect"]["tasks"] {
        diffs.push(format!("tasks: want {} got {} (accepted {accepted})", case["expect"]["tasks"], stats["tasks"]));
    }
    if stats["observations"] != case["expect"]["observations"] {
        diffs.push(format!("observations: want {} got {}", case["expect"]["observations"], stats["observations"]));
    }
    cleanup(&store);
    diffs
}

fn writer(case: &Value, store: &Path, w: u64, per: u64) -> Vec<String> {
    let mut errors = Vec::new();
    let mut client = match Incremental::connect(config(case, store)) {
        Ok(client) => client,
        Err(err) => return vec![format!("writer {w}: {err}")],
    };
    for i in 0..per {
        let obs = json!({"task": format!("packages/core/src/gen/w{w}_{i}.test.ts"), "baseline": "b1",
                         "dirty": false, "context": context_ok(), "inputs": [], "outputs": [],
                         "outcome": "pass", "duration_ms": 1});
        match client.observe(&obs) {
            Ok(ack) if ack == json!({"accepted": true}) => {}
            Ok(ack) => errors.push(format!("writer {w}: ack {ack}")),
            Err(err) => {
                errors.push(format!("writer {w}: {err}"));
                break;
            }
        }
    }
    client.close();
    errors
}

// A raw engine process for the protocol-level cases. Lines are read on a thread.
struct RawEngine {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
}

impl RawEngine {
    fn serve(store: &Path, root: &Path) -> Self {
        let mut child = Command::new(engine())
            .arg("serve")
            .arg("--store")
            .arg(store)
            .arg("--root")
            .arg(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn engine");
        let stdin = child.stdin.take().expect("stdin");
        let stdout = child.stdout.take().expect("stdout");
        let (tx, lines) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        RawEngine { child, stdin, lines }
    }

    // Writes one line as given (the newline is added here).
    fn send(&mut self, line: &str) {
        writeln!(self.stdin, "{line}").expect("write line");
        self.stdin.flush().expect("flush");
    }

    fn read(&self, timeout: Duration) -> Option<Value> {
        let line = self.lines.recv_timeout(timeout).ok()?;
        Some(serde_json::from_str(&line).expect("engine line is JSON"))
    }

    fn wait_exit(&mut self, timeout: Duration) -> Option<i32> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Ok(Some(status)) = self.child.try_wait() {
                return status.code();
            }
            if Instant::now() >= deadline {
                return None;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for RawEngine {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
