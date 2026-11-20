//! Options of an `affected` call.

use serde_json::{json, Value};

/// The options of an `affected` call (PROTOCOL.md 9.3). `context`, `env`,
/// `config` and `declared_tasks` are sent only when set.
#[derive(Debug, Clone)]
pub struct Affected {
    pub baseline: String,
    pub context: Option<Value>,
    pub verify: bool,
    pub policy: String,
    pub env: Option<Value>,
    pub config: Option<Value>,
    pub declared_tasks: Option<Value>,
}

impl Affected {
    pub fn new(baseline: impl Into<String>) -> Self {
        Affected {
            baseline: baseline.into(),
            context: None,
            verify: false,
            policy: "balanced".to_string(),
            env: None,
            config: None,
            declared_tasks: None,
        }
    }

    /// The `options` object of the request.
    pub fn options(&self) -> Value {
        let mut opts =
            json!({"baseline": self.baseline, "verify": self.verify, "policy": self.policy});
        let map = opts.as_object_mut().expect("options is an object");
        let extra = [
            ("context", &self.context),
            ("env", &self.env),
            ("config", &self.config),
            ("declared_tasks", &self.declared_tasks),
        ];
        for (key, value) in extra {
            if let Some(value) = value {
                map.insert(key.to_string(), value.clone());
            }
        }
        opts
    }
}
