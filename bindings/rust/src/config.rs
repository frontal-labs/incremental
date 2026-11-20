//! Engine command, store, root and timing, and how the engine binary is found.

use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Engine command, store, root and timing. `Config::default()` reads
/// `INCREMENTAL_ENGINE` and `INCREMENTAL_STORE`, and uses the enclosing git repository.
#[derive(Debug, Clone)]
pub struct Config {
    /// Command prefix. The client runs `<engine...> serve --store <store> --root <root>`.
    pub engine: Vec<String>,
    pub store: PathBuf,
    pub root: PathBuf,
    /// Budget for each request. A timeout kills the engine.
    pub timeout: Duration,
    /// Start a new engine when the old one has exited.
    pub restart: bool,
}

impl Default for Config {
    fn default() -> Self {
        let root = repo_root();
        Config {
            engine: vec![default_engine(&root).display().to_string()],
            store: env::var_os("INCREMENTAL_STORE")
                .map_or_else(|| root.join(".incremental"), PathBuf::from),
            timeout: Duration::from_secs(10),
            restart: true,
            root,
        }
    }
}

/// The engine binary for this host, in the same order as the Node and Python
/// clients: `INCREMENTAL_ENGINE`, then the prebuilt binary under
/// `packages/engine/prebuilds/<platform>-<arch>/`, then `core/dist/incremental`.
pub fn default_engine(root: &Path) -> PathBuf {
    if let Some(path) = env::var_os("INCREMENTAL_ENGINE") {
        return PathBuf::from(path);
    }
    let prebuilt = root
        .join("packages/engine/prebuilds")
        .join(host_triple())
        .join("incremental");
    if prebuilt.exists() {
        return prebuilt;
    }
    root.join("core/dist/incremental")
}

// The npm-style triple used by packages/engine/prebuilds, e.g. "darwin-arm64".
fn host_triple() -> String {
    let os = match env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let arch = match env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    format!("{os}-{arch}")
}

fn repo_root() -> PathBuf {
    let here = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    match here.ancestors().find(|dir| dir.join(".git").exists()) {
        Some(dir) => dir.to_path_buf(),
        None => here.clone(),
    }
}
