//! Shared helpers for the conformance and parity tests. Mirrors
//! bindings/python/tests/_support.py and _conformance.py.
#![allow(dead_code)]

use incremental::{Affected, Incremental, Config, Result};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

pub const COMPARED: [&str; 6] = ["tasks", "unobserved", "ignored", "deleted_tasks", "fallback", "confidence"];

pub fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("repo root")
}

pub fn engine() -> String {
    let path = std::env::var("INCREMENTAL_ENGINE")
        .unwrap_or_else(|_| repo().join("core/dist/incremental").display().to_string());
    assert!(Path::new(&path).exists(), "engine missing at {path}: run make build");
    path
}

/// The byte form used for plans: compact, key order kept.
pub fn dumps(value: &Value) -> String {
    serde_json::to_string(value).expect("serializable")
}

pub fn context_ok() -> Value {
    json!({"lockfile": "sha256:l1", "tsconfig": "sha256:t1", "pkgjson": "sha256:p1",
           "runner": "vitest@4.1.12", "node": "22.11.0", "fmt": 1,
           "caps": {"probes": true, "dirs": true, "env": true}})
}

pub fn load_cases() -> Vec<Value> {
    let dir = repo().join("conformance/cases");
    let mut paths: Vec<PathBuf> = fs::read_dir(&dir)
        .expect("read conformance/cases")
        .map(|entry| entry.expect("dir entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    paths.sort();
    paths
        .iter()
        .map(|path| serde_json::from_str(&fs::read_to_string(path).expect("read case")).expect("case JSON"))
        .collect()
}

pub fn case_id(case: &Value) -> &str {
    case["id"].as_str().expect("case id")
}

pub fn worktree(case: &Value) -> PathBuf {
    repo().join("conformance/worktrees").join(case.get("worktree").and_then(Value::as_str).unwrap_or("base"))
}

/// A fresh store made by the engine's own `init` command, in a unique temp directory.
pub fn new_store(name: &str) -> PathBuf {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let base = std::env::temp_dir().join(format!("bp-rs-{}-{n}", std::process::id()));
    let store = base.join(name);
    let out = Command::new(engine()).arg("init").arg("--store").arg(&store).output().expect("run init");
    assert!(out.status.success(), "init failed: {}", String::from_utf8_lossy(&out.stderr));
    store
}

pub fn cleanup(store: &Path) {
    if let Some(base) = store.parent() {
        let _ = fs::remove_dir_all(base);
    }
}

pub fn config(case: &Value, store: &Path) -> Config {
    Config { engine: vec![engine()], store: store.to_path_buf(), root: worktree(case), ..Config::default() }
}

pub fn open(case: &Value, store: &Path) -> Incremental {
    Incremental::connect(config(case, store)).expect("connect")
}

/// Replays one protocol message (`method`, `params` as keyword arguments) through the client.
pub fn dispatch(client: &mut Incremental, method: &str, params: &Value) -> Result<Value> {
    match method {
        "observe" => client.observe(&params["observation"]),
        "observe_many" => client.observe_many(params["observations"].as_array().expect("array")),
        "advance" => client.advance(params["to"].as_str().expect("to"), params["expected"].as_str()),
        "forget" => client.forget(params["task"].as_str().expect("task")),
        "baseline" => client.baseline(),
        "stats" => client.stats(),
        "explain" => client.explain(params["task"].as_str().expect("task")),
        "compact" => client.compact(),
        "ping" => client.ping(),
        other => panic!("no client method {other}"),
    }
}

fn seed_messages(path: &Path) -> Vec<Value> {
    let text = fs::read_to_string(path).expect("read seed store");
    text.lines().filter(|line| !line.trim().is_empty()).map(|line| serde_json::from_str(line).expect("seed line")).collect()
}

/// A store seeded the way conformance/run.mjs seeds it: the base log, then the case's appended messages.
pub fn seeded_store(case: &Value) -> PathBuf {
    let store = new_store(case_id(case));
    let mut seed = seed_messages(&repo().join(case["store"]["from"].as_str().expect("store.from")));
    if let Some(extra) = case["store"].get("append").and_then(Value::as_array) {
        seed.extend(extra.iter().cloned());
    }
    let mut client = open(case, &store);
    for message in &seed {
        dispatch(&mut client, message["method"].as_str().expect("method"), &message["params"]).expect("seed message");
    }
    client.close();
    store
}

pub fn query_changes(case: &Value) -> Value {
    let q = &case["query"];
    json!({"baseline": q["baseline"], "changes": q["changes"]})
}

/// The `affected` options of a query case (`mode` is the policy, `config` is case-level).
pub fn query_options(case: &Value) -> Affected {
    let q = &case["query"];
    let mut opts = Affected::new(q["baseline"].as_str().expect("baseline"));
    opts.verify = q.get("verify").and_then(Value::as_bool).unwrap_or(false);
    opts.policy = case["mode"].as_str().expect("mode").to_string();
    opts.context = q.get("context").cloned();
    opts.env = q.get("env").cloned();
    opts.declared_tasks = q.get("declared_tasks").cloned();
    opts.config = case.get("config").cloned();
    opts
}

/// One plan from a fresh client, closed afterwards so the engine writes its index.
pub fn query_plan(case: &Value, store: &Path) -> Value {
    let mut client = open(case, store);
    let plan = client.affected(&query_changes(case), &query_options(case)).expect("affected");
    client.close();
    plan
}

/// Compares the fields conformance/run.mjs compares. Returns one line per mismatch.
pub fn mismatches(plan: &Value, expect: &Value) -> Vec<String> {
    let mut out = Vec::new();
    for key in COMPARED {
        if expect.get(key).is_none() {
            continue;
        }
        let want = dumps(&expect[key]);
        let got = dumps(plan.get(key).unwrap_or(&Value::Null));
        if want != got {
            out.push(format!("{key}: want {want} got {got}"));
        }
    }
    out
}
