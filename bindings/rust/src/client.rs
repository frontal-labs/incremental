//! The `Incremental` client: one engine process, one request at a time.

use crate::affected::Affected;
use crate::config::Config;
use crate::error::{Error, Result};
use crate::protocol::{
    check_plan, CLIENT_NAME, CLIENT_VERSION, PROTOCOL, READ_ONLY, STARTUP_TIMEOUT,
};
use crate::transport::{call, kill, spawn, wait_exit, Run};
use serde_json::{json, Value};

/// A client for one engine process. The process is started by `connect` and
/// restarted on the next call if it died (when `Config::restart` is set).
#[derive(Debug)]
pub struct Incremental {
    cfg: Config,
    run: Option<Run>,
    started: bool,
    next_id: u64,
}

impl Incremental {
    /// Starts the engine and runs the `hello` handshake.
    pub fn connect(cfg: Config) -> Result<Self> {
        let mut client = Incremental {
            cfg,
            run: None,
            started: false,
            next_id: 1,
        };
        client.ensure()?;
        Ok(client)
    }

    /// The `hello` result: `{protocol, engine, capabilities, store}`.
    pub fn hello(&mut self) -> Result<Value> {
        Ok(self.ensure()?.hello.clone())
    }

    pub fn observe(&mut self, observation: &Value) -> Result<Value> {
        self.request("observe", &json!({"observation": observation}))
    }

    /// Atomic: either all observations are stored or none. Returns `{accepted: n}`.
    pub fn observe_many(&mut self, observations: &[Value]) -> Result<Value> {
        self.request("observe_many", &json!({"observations": observations}))
    }

    pub fn baseline(&mut self) -> Result<Value> {
        self.request("baseline", &json!({}))
    }

    /// Fails with `baseline_conflict` unless `expected` equals the current baseline.
    pub fn advance(&mut self, to: &str, expected: Option<&str>) -> Result<Value> {
        self.request("advance", &json!({"to": to, "expected": expected}))
    }

    /// Returns the plan (PROTOCOL.md 9.6). A partial plan is an error.
    pub fn affected(&mut self, changes: &Value, options: &Affected) -> Result<Value> {
        let plan = self.request(
            "affected",
            &json!({"changes": changes, "options": options.options()}),
        )?;
        check_plan(plan)
    }

    pub fn explain(&mut self, task: &str) -> Result<Value> {
        self.request("explain", &json!({"task": task}))
    }

    pub fn forget(&mut self, task: &str) -> Result<Value> {
        self.request("forget", &json!({"task": task}))
    }

    pub fn stats(&mut self) -> Result<Value> {
        self.request("stats", &json!({}))
    }

    /// Forwarded to the engine, which may refuse (`compact` is not in this milestone).
    pub fn compact(&mut self) -> Result<Value> {
        self.request("compact", &json!({}))
    }

    pub fn ping(&mut self) -> Result<Value> {
        self.request("ping", &json!({}))
    }

    /// Sends `shutdown`, waits up to the request timeout for the exit, then kills the engine.
    pub fn close(self) {
        drop(self);
    }

    fn take_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    // The running engine, starting one when there is none or the last one exited.
    fn ensure(&mut self) -> Result<&mut Run> {
        let exited = match self.run.as_mut() {
            Some(run) => matches!(run.child.try_wait(), Ok(Some(_))),
            None => true,
        };
        if exited {
            self.run = None;
            if self.started && !self.cfg.restart {
                return Err(Error::new(
                    "engine_exited",
                    "the engine exited and restart is disabled",
                    None,
                ));
            }
            let run = self.start()?;
            self.run = Some(run);
        }
        Ok(self.run.as_mut().expect("engine is running"))
    }

    fn start(&mut self) -> Result<Run> {
        let mut run = spawn(&self.cfg)?;
        self.started = true;
        let params = json!({"protocol": PROTOCOL, "client": {"name": CLIENT_NAME, "version": CLIENT_VERSION}});
        let id = self.take_id();
        let hello = match call(&mut run, id, "hello", &params, STARTUP_TIMEOUT) {
            Ok(hello) => hello,
            Err(err) => {
                kill(&mut run.child);
                return Err(err);
            }
        };
        match hello.get("protocol").and_then(Value::as_u64) {
            Some(PROTOCOL) => {}
            Some(_) => {
                kill(&mut run.child);
                return Err(Error::new(
                    "protocol_mismatch",
                    "the engine does not speak protocol 1",
                    Some(hello),
                ));
            }
            None => {
                kill(&mut run.child);
                return Err(Error::new(
                    "internal",
                    "the engine answered hello with no protocol",
                    None,
                ));
            }
        }
        run.hello = hello;
        Ok(run)
    }

    fn request(&mut self, method: &str, params: &Value) -> Result<Value> {
        match self.exchange(method, params) {
            Err(err)
                if err.code == "engine_exited"
                    && self.cfg.restart
                    && READ_ONLY.contains(&method) =>
            {
                self.exchange(method, params)
            }
            other => other,
        }
    }

    fn exchange(&mut self, method: &str, params: &Value) -> Result<Value> {
        let id = self.take_id();
        let timeout = self.cfg.timeout;
        let run = self.ensure()?;
        let result = call(run, id, method, params, timeout);
        if matches!(&result, Err(err) if err.code == "timeout" || err.code == "engine_exited") {
            self.run = None;
        }
        result
    }

    fn stop(&mut self) {
        let Some(mut run) = self.run.take() else {
            return;
        };
        if matches!(run.child.try_wait(), Ok(None)) {
            let id = self.take_id();
            // The engine writes its index image before it exits, so give it time.
            let _ = call(&mut run, id, "shutdown", &json!({}), self.cfg.timeout);
        }
        if wait_exit(&mut run.child, self.cfg.timeout).is_none() {
            kill(&mut run.child);
        }
    }
}

impl Drop for Incremental {
    fn drop(&mut self) {
        self.stop();
    }
}
