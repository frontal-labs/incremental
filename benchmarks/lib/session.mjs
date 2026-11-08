// Shared helpers for the engine benchmarks (warm-plan, shared-file):
// the protocol v1 stdio session, the root context and the statistics.

import { join } from "node:path";

export const ENGINE = join(process.cwd(), "core", "dist", "incremental");

export const ROOT_CTX = {
  lockfile: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  tsconfig: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  pkgjson: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  runner: "vitest@0.0.0",
  node: process.version,
  fmt: 1,
  caps: { probes: true, dirs: true, env: true },
};

export function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function percentile(xs, p) {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)];
}

export function stats(xs) {
  return {
    min: Math.min(...xs),
    max: Math.max(...xs),
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    median: median(xs),
  };
}

// One stdio protocol v1 session against a spawned `incremental serve` process.
export class Session {
  constructor(proc) {
    this.proc = proc;
    this.buf = "";
    this.pending = new Map();
    this.nextId = 1;
    this.exited = new Promise((res) => {
      proc.once("close", res);
    });
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (c) => this.onData(c));
    proc.stderr.on("data", () => {});
    proc.on("error", (e) => {
      this._fail(`engine error: ${e.message}`);
    });
  }
  onData(c) {
    this.buf += c;
    let nl = this.buf.indexOf("\n");
    while (nl >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      nl = this.buf.indexOf("\n");
      if (line.trim()) {
        try {
          this.onLine(JSON.parse(line));
        } catch {
          /* non-protocol line; ignore */
        }
      }
    }
  }
  onLine(msg) {
    const p = this.pending && this.pending.get(msg.id);
    if (p) {
      this.pending.delete(p.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(String(msg.error)));
      else p.resolve(msg.result);
    }
  }
  _fail(msg) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(msg));
    }
    this.pending.clear();
  }
  request(method, params, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout on ${method}`));
        try {
          this.proc.kill("SIGKILL");
        } catch {}
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      } catch (e) {
        reject(e);
      }
    });
  }
  async close() {
    try {
      await this.request("shutdown", {});
    } catch {}
    await this.exited;
    try {
      this.proc.kill("SIGKILL");
    } catch {}
  }
}
