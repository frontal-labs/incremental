//! Example Rust client for incremental Protocol v1.
//! Spawns `incremental serve` and communicates over JSON Lines on stdio.

use serde_json::{json, Value};
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader, Write};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut child = Command::new("incremental")
        .args(["serve", "--store", ".incremental", "--root", "."])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdin = child.stdin.take().expect("stdin piped");
    let stdout = child.stdout.take().expect("stdout piped");
    let mut stdin_lock = stdin;

    // hello handshake
    let hello_req = json!({
        "id": 1,
        "method": "hello",
        "params": {
            "protocol": 1,
            "client": {"name": "incremental-rust-example", "version": "0.1.0"}
        }
    });
    writeln!(stdin_lock, "{}", hello_req)?;
    stdin_lock.flush()?;

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut waiting = true;
    while waiting {
        match lines.next() {
            Some(line) => {
                let resp: Value = serde_json::from_str(&line?)?;
                if resp.get("id") == Some(&json!(1)) {
                    if let Some(err) = resp.get("error") {
                        eprintln!("hello error: {}", err);
                        std::process::exit(1);
                    }
                    println!("Engine: {:?}", resp["result"]["engine"]["name"]);
                    println!("Capabilities: {:?}", resp["result"]["capabilities"]);
                    waiting = false;
                }
            }
            None => waiting = false,
        }
    }

    // affected query
    let baseline = "abc123";
    let affected_req = json!({
        "id": 2,
        "method": "affected",
        "params": {
            "changes": {
                "baseline": baseline,
                "head": baseline,
                "changes": [{"path": "src/math.ts", "status": "modified"}]
            },
            "options": {
                "baseline": baseline,
                "context": {
                    "lockfile": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                    "tsconfig": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                    "pkgjson": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                    "runner": "vitest@4.1.12",
                    "node": "22.11.0",
                    "fmt": 1,
                    "caps": {"probes": true, "dirs": true, "env": true}
                },
                "verify": false,
                "policy": "balanced"
            }
        }
    });
    writeln!(stdin_lock, "{}", affected_req)?;
    stdin_lock.flush()?;

    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut waiting = true;
    while waiting {
        match lines.next() {
            Some(line) => {
                let resp: Value = serde_json::from_str(&line?)?;
                if resp.get("id") == Some(&json!(2)) {
                    if let Some(err) = resp.get("error") {
                        eprintln!("affected error: {}", err);
                        std::process::exit(1);
                    }
                    let plan = &resp["result"];
                    println!("Total tasks: {}", plan["total_tasks"]);
                    println!("Invalid: {}", plan["tasks"].as_array().map(|a| a.len()).unwrap_or(0));
                    println!("Skipped: {}", plan["skipped"]);
                    println!("Confidence: {}", plan["confidence"]);
                    waiting = false;
                }
            }
            None => waiting = false,
        }
    }

    let _ = child.kill();
    Ok(())
}
