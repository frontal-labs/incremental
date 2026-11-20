//! Engine process: spawning, one request/answer exchange, and exit handling.

use crate::config::Config;
use crate::error::{Error, Result};
use crate::protocol::STDERR_LINES;
use serde_json::{json, Map, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// A running engine and the reader threads for its stdout and stderr.
#[derive(Debug)]
pub(crate) struct Run {
    pub(crate) child: Child,
    pub(crate) stdin: ChildStdin,
    pub(crate) lines: Receiver<Option<String>>,
    pub(crate) stderr: Arc<Mutex<Vec<String>>>,
    pub(crate) hello: Value,
}

pub(crate) fn spawn(cfg: &Config) -> Result<Run> {
    let (cmd, prefix) = cfg
        .engine
        .split_first()
        .ok_or_else(|| Error::new("internal", "the engine command is empty", None))?;
    let mut child = Command::new(cmd)
        .args(prefix)
        .arg("serve")
        .arg("--store")
        .arg(&cfg.store)
        .arg("--root")
        .arg(&cfg.root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| Error::new("internal", format!("cannot run the engine: {err}"), None))?;
    let stdin = child.stdin.take().expect("stdin is piped");
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");

    let (tx, lines) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout)
            .lines()
            .map_while(std::io::Result::ok)
        {
            if tx.send(Some(line)).is_err() {
                return;
            }
        }
        let _ = tx.send(None);
    });

    let tail = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = Arc::clone(&tail);
    thread::spawn(move || {
        for line in BufReader::new(stderr)
            .lines()
            .map_while(std::io::Result::ok)
        {
            let mut kept = sink.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            kept.push(line);
            let excess = kept.len().saturating_sub(STDERR_LINES);
            kept.drain(..excess);
        }
    });

    Ok(Run {
        child,
        stdin,
        lines,
        stderr: tail,
        hello: Value::Null,
    })
}

// Sends one request and reads lines until the answer with `id` arrives. A
// timeout or the end of the output ends the run; the caller drops it.
pub(crate) fn call(
    run: &mut Run,
    id: u64,
    method: &str,
    params: &Value,
    timeout: Duration,
) -> Result<Value> {
    let line = json!({"id": id, "method": method, "params": params}).to_string();
    // A failed write means the engine is gone. Its end of output is reported below.
    let _ = writeln!(run.stdin, "{line}");
    let _ = run.stdin.flush();

    let deadline = Instant::now() + timeout;
    loop {
        let raw = match run
            .lines
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        {
            Ok(Some(raw)) => raw,
            Ok(None) | Err(RecvTimeoutError::Disconnected) => return Err(exited(run)),
            Err(RecvTimeoutError::Timeout) => {
                kill(&mut run.child);
                let data = json!({"partial": false});
                return Err(Error::new(
                    "timeout",
                    format!("no response within {timeout:?}"),
                    Some(data),
                ));
            }
        };
        let msg: Map<String, Value> = match serde_json::from_str(&raw) {
            Ok(Value::Object(msg)) => msg,
            _ => {
                let text = format!("engine wrote a line that is not a JSON object: {raw:?}");
                return Err(Error::new("bad_response", text, None));
            }
        };
        if msg.get("id") == Some(&json!(id)) {
            if let Some(err) = msg.get("error") {
                return Err(error_of(err));
            }
            return msg.get("result").cloned().ok_or_else(|| {
                Error::new(
                    "bad_response",
                    "response has neither result nor error",
                    None,
                )
            });
        }
        // A store-level failure is printed without an id (CLI style): {"ok": false, "error": {...}}.
        if msg.get("id").is_none_or(|v| v.is_null()) && msg.get("ok") == Some(&Value::Bool(false)) {
            if let Some(err) = msg.get("error") {
                return Err(error_of(err));
            }
        }
        // Any other line belongs to an earlier request and is dropped.
    }
}

fn error_of(err: &Value) -> Error {
    Error {
        code: err
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("internal")
            .to_string(),
        message: err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        data: err.get("data").filter(|data| !data.is_null()).cloned(),
    }
}

// The engine ended while a request was in flight, or before one was sent.
fn exited(run: &mut Run) -> Error {
    let status = wait_exit(&mut run.child, Duration::from_secs(5)).and_then(|status| status.code());
    kill(&mut run.child);
    let stderr = run
        .stderr
        .lock()
        .map(|lines| lines.join("\n"))
        .unwrap_or_default();
    let code = status.map_or_else(|| "unknown".to_string(), |code| code.to_string());
    let data = (!stderr.is_empty()).then(|| Value::String(stderr));
    Error::new(
        "engine_exited",
        format!("engine exited (status {code})"),
        data,
    )
}

pub(crate) fn wait_exit(child: &mut Child, timeout: Duration) -> Option<ExitStatus> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(5)),
            _ => return None,
        }
    }
}

pub(crate) fn kill(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}
