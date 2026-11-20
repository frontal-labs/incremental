//! The protocol error type.

use serde_json::Value;
use std::fmt;

/// A protocol error (`code`, `message`, `data`), or a client-side error such as `timeout`.
#[derive(Debug, Clone, PartialEq)]
pub struct Error {
    pub code: String,
    pub message: String,
    pub data: Option<Value>,
}

impl Error {
    pub(crate) fn new(code: &str, message: impl Into<String>, data: Option<Value>) -> Self {
        Error {
            code: code.to_string(),
            message: message.into(),
            data,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;
