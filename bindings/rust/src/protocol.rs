//! Protocol v1 constants and plan checks (PROTOCOL.md).

use crate::error::{Error, Result};
use serde_json::{json, Value};
use std::time::Duration;

pub(crate) const PROTOCOL: u64 = 1;
pub(crate) const CLIENT_NAME: &str = "incremental-rust";
pub(crate) const CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");
pub(crate) const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
pub(crate) const STDERR_LINES: usize = 20;
// Methods that do not change the store. Only these are retried after a restart.
pub(crate) const READ_ONLY: [&str; 6] =
    ["hello", "baseline", "affected", "explain", "stats", "ping"];

// A plan is never returned partially (PROTOCOL.md 9.6).
pub(crate) fn check_plan(plan: Value) -> Result<Value> {
    let lists = ["tasks", "unobserved", "ignored", "deleted_tasks"];
    let fields = ["fallback", "confidence", "graph_version"];
    let complete = lists
        .iter()
        .all(|key| plan.get(*key).is_some_and(|v| v.is_array()))
        && fields.iter().all(|key| plan.get(*key).is_some());
    if complete {
        Ok(plan)
    } else {
        let data = json!({"reason": "partial_plan"});
        Err(Error::new(
            "internal",
            "the engine answered affected with an incomplete plan",
            Some(data),
        ))
    }
}
