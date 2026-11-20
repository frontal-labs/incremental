//! Rust client for incremental Protocol v1 (docs/spec/PROTOCOL.md, spec/adapters/rust.md).
//!
//! The client spawns `incremental serve`, sends one JSON object per line and
//! matches each answer by id. It never plans: every answer comes from the engine.
//! Methods take `&mut self`, so requests run one at a time in call order.

mod affected;
mod client;
mod config;
mod error;
mod protocol;
mod transport;

pub use affected::Affected;
pub use client::Incremental;
pub use config::{default_engine, Config};
pub use error::{Error, Result};
