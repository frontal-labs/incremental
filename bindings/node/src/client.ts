// @incremental/client: process supervision and the protocol v1 methods
// (plans/PLAN.md 10.1, 9.3, 9.8). The client spawns `incremental serve`, speaks
// one JSON object per line, matches answers by id, and runs requests one at a
// time in arrival order.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { incrementalError } from "./errors.js";
import type {
  AffectedOptions,
  ChangeSet,
  CompactResult,
  ConnectOptions,
  Explanation,
  Hello,
  Observation,
  Plan,
  Stats,
} from "./types.js";

export const CLIENT_VERSION = "0.1.0";
const DEFAULT_TIMEOUT_MS = 10_000;
// The handshake covers process start-up, which is not a protocol request, so
// it has its own budget (the server-side budget of PLAN 9.8).
const STARTUP_TIMEOUT_MS = 10_000;
const CLOSE_GRACE_MS = 2_000;
// Methods that do not change the store. Only these are retried after the
// server dies mid-request; a write may or may not have happened.
const READ_ONLY = new Set(["hello", "baseline", "affected", "explain", "stats", "ping"]);

export interface incremental {
  readonly protocol: 1;
  // Process id of the current server, or undefined while none is running.
  // Extra to PLAN 10.1; used by supervision tests.
  readonly pid: number | undefined;
  hello(): Promise<Hello>;
  observe(obs: Observation): Promise<{ accepted: true }>;
  observeMany(obs: Observation[]): Promise<{ accepted: number }>;
  baseline(): Promise<{ baseline: string | null }>;
  advance(to: string, expected: string | null): Promise<{ baseline: string }>;
  affected(changes: ChangeSet, options: AffectedOptions): Promise<Plan>;
  explain(task: string): Promise<Explanation>;
  forget(task: string): Promise<{ forgotten: true }>;
  stats(): Promise<Stats>;
  compact(): Promise<CompactResult>;
  close(): Promise<void>;
}

// The repository root: the nearest ancestor of this file that holds
// tsconfig.base.json. Falls back to the working directory outside the repo.
export function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(dir, "tsconfig.base.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
}

export function defaultEngine(): string {
  return process.env.INCREMENTAL_ENGINE || path.join(repoRoot(), "core", "dist", "incremental");
}

export function defaultStore(): string {
  return path.resolve(process.env.INCREMENTAL_STORE || path.join(repoRoot(), ".incremental"));
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: incrementalError) => void;
  timer: NodeJS.Timeout;
}

interface Run {
  proc: ChildProcessWithoutNullStreams;
  buf: string;
  pending: Map<number, Pending>;
  // A store-level failure printed without an id (spec 10.2), e.g. store_missing.
  fatal: { code: string; message: string; data?: unknown } | null;
  stderr: string;
  done: boolean;
  hello: Hello | null;
  exited: Promise<void>;
  signalExit: () => void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isExitedError(e: unknown): boolean {
  return e instanceof incrementalError && isRecord(e.data) && e.data.reason === "exited";
}

// A plan is never returned partially: all fields of PLAN 9.6 must be present.
function checkPlan(v: unknown): Plan {
  const complete =
    isRecord(v) &&
    Array.isArray(v.tasks) &&
    Array.isArray(v.unobserved) &&
    Array.isArray(v.ignored) &&
    Array.isArray(v.deleted_tasks) &&
    "fallback" in v &&
    "confidence" in v &&
    "graph_version" in v;
  if (!complete) {
    throw new incrementalError("internal", "the server answered affected with an incomplete plan", {
      reason: "partial_plan",
    });
  }
  return v as unknown as Plan;
}

class IncrementalClient implements incremental {
  readonly protocol = 1 as const;
  private readonly command: string[];
  private readonly store: string;
  private readonly root: string;
  private readonly timeoutMs: number;
  private readonly restart: boolean;
  private current: Run | null = null;
  private started = false;
  private closed = false;
  private nextId = 1;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(command: string[], store: string, root: string, timeoutMs: number, restart: boolean) {
    this.command = command;
    this.store = store;
    this.root = root;
    this.timeoutMs = timeoutMs;
    this.restart = restart;
  }

  get pid(): number | undefined {
    return this.current?.proc.pid;
  }

  // Requests run one at a time, in the order they were called.
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  hello(): Promise<Hello> {
    return this.enqueue(async () => {
      const run = await this.ensure();
      if (run.hello === null) throw new incrementalError("internal", "no handshake", { reason: "bad_handshake" });
      return run.hello;
    });
  }

  observe(obs: Observation): Promise<{ accepted: true }> {
    return this.request("observe", { observation: obs }) as Promise<{ accepted: true }>;
  }

  observeMany(obs: Observation[]): Promise<{ accepted: number }> {
    return this.request("observe_many", { observations: obs }) as Promise<{ accepted: number }>;
  }

  baseline(): Promise<{ baseline: string | null }> {
    return this.request("baseline") as Promise<{ baseline: string | null }>;
  }

  advance(to: string, expected: string | null): Promise<{ baseline: string }> {
    return this.request("advance", { to, expected }) as Promise<{ baseline: string }>;
  }

  affected(changes: ChangeSet, options: AffectedOptions): Promise<Plan> {
    const opts: Record<string, unknown> = {
      baseline: options.baseline,
      context: options.context,
      verify: options.verify ?? false,
      policy: options.policy ?? "balanced",
    };
    if (options.env !== undefined) opts.env = options.env;
    if (options.config !== undefined) opts.config = options.config;
    if (options.declared_tasks !== undefined) opts.declared_tasks = options.declared_tasks;
    return this.request("affected", { changes, options: opts }).then(checkPlan);
  }

  explain(task: string): Promise<Explanation> {
    return this.request("explain", { task }) as Promise<Explanation>;
  }

  forget(task: string): Promise<{ forgotten: true }> {
    return this.request("forget", { task }) as Promise<{ forgotten: true }>;
  }

  stats(): Promise<Stats> {
    return this.request("stats") as Promise<Stats>;
  }

  compact(): Promise<CompactResult> {
    return this.request("compact") as Promise<CompactResult>;
  }

  close(): Promise<void> {
    return this.enqueue(async () => {
      this.closed = true;
      const run = this.current;
      if (run === null) return;
      this.current = null;
      try {
        await this.send(run, "shutdown", undefined, this.timeoutMs);
      } catch {
        // The server may already be gone; the kill below covers a hang.
      }
      const timer = setTimeout(() => this.kill(run), CLOSE_GRACE_MS);
      await run.exited;
      clearTimeout(timer);
    });
  }

  // Called once by connect(), before any other request.
  async init(): Promise<void> {
    await this.enqueue(async () => {
      await this.ensure();
    });
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    return this.enqueue(() => this.exchange(method, params));
  }

  // Sends one request; on a server death, read-only requests are sent again
  // once to a restarted server.
  private async exchange(method: string, params: unknown): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const run = await this.ensure();
      try {
        return await this.send(run, method, params, this.timeoutMs);
      } catch (e) {
        const retry =
          isExitedError(e) && READ_ONLY.has(method) && this.restart && attempt === 0 && !this.closed;
        if (!retry) throw e;
      }
    }
  }

  // The running server, starting one (with hello) when there is none.
  private async ensure(): Promise<Run> {
    if (this.closed) throw new incrementalError("internal", "the client is closed", { reason: "closed" });
    if (this.current !== null) return this.current;
    if (this.started && !this.restart) {
      throw new incrementalError("internal", "the server exited and restart is disabled", { reason: "exited" });
    }
    return this.start();
  }

  private async start(): Promise<Run> {
    const run = this.spawnRun();
    this.current = run;
    this.started = true;
    let hello: unknown;
    try {
      hello = await this.send(
        run,
        "hello",
        { protocol: 1, client: { name: "incremental-node", version: CLIENT_VERSION } },
        STARTUP_TIMEOUT_MS,
      );
    } catch (e) {
      this.kill(run);
      throw e;
    }
    if (!isRecord(hello) || typeof hello.protocol !== "number") {
      this.kill(run);
      throw new incrementalError("internal", "the server answered hello with no protocol", { reason: "bad_handshake" });
    }
    if (hello.protocol !== 1) {
      this.kill(run);
      throw new incrementalError("protocol_mismatch", "the server does not speak protocol 1", hello);
    }
    run.hello = hello as unknown as Hello;
    return run;
  }

  private spawnRun(): Run {
    const [cmd = "", ...args] = this.command;
    const proc = spawn(cmd, [...args, "--store", this.store, "--root", this.root], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let signalExit: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => {
      signalExit = resolve;
    });
    const run: Run = {
      proc,
      buf: "",
      pending: new Map(),
      fatal: null,
      stderr: "",
      done: false,
      hello: null,
      exited,
      signalExit,
    };
    // A write after the server died fails with EPIPE; the "close" event
    // rejects whatever was pending, so the error itself is ignored here.
    proc.stdin.on("error", () => undefined);
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => this.onStdout(run, chunk));
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      run.stderr = (run.stderr + chunk).slice(-4000);
    });
    proc.on("error", (err) => {
      run.fatal ??= { code: "internal", message: `cannot run the engine: ${err.message}` };
      this.finish(run, null, null);
    });
    proc.on("close", (code, signal) => this.finish(run, code, signal));
    return run;
  }

  private onStdout(run: Run, chunk: string): void {
    run.buf += chunk;
    let nl = run.buf.indexOf("\n");
    while (nl >= 0) {
      const line = run.buf.slice(0, nl).trim();
      run.buf = run.buf.slice(nl + 1);
      if (line.length > 0) this.onLine(run, line);
      nl = run.buf.indexOf("\n");
    }
  }

  private onLine(run: Run, line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // not a protocol line; stderr keeps the diagnostics
    }
    if (!isRecord(msg)) return;
    if (typeof msg.id === "number") {
      const p = run.pending.get(msg.id);
      if (p === undefined) return; // answer to a request that already timed out
      run.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (isRecord(msg.error)) {
        p.reject(new incrementalError(String(msg.error.code), String(msg.error.message), msg.error.data));
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    if (msg.id === undefined && isRecord(msg.error)) {
      run.fatal = {
        code: String(msg.error.code),
        message: String(msg.error.message),
        data: msg.error.data,
      };
    }
  }

  private send(run: Run, method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        run.pending.delete(id);
        reject(new incrementalError("timeout", `${method} did not answer within ${timeoutMs} ms`, {
          partial: false,
          timeoutMs,
          method,
        }));
        // The server may still be working on this request. Stop it so that the
        // next request starts from a fresh server.
        this.kill(run);
      }, timeoutMs);
      run.pending.set(id, { method, resolve, reject, timer });
      const line = params === undefined ? { id, method } : { id, method, params };
      run.proc.stdin.write(JSON.stringify(line) + "\n");
    });
  }

  private kill(run: Run): void {
    if (this.current === run) this.current = null;
    if (!run.done) run.proc.kill("SIGKILL");
  }

  private finish(run: Run, code: number | null, signal: NodeJS.Signals | null): void {
    if (run.done) return;
    run.done = true;
    if (this.current === run) this.current = null;
    for (const p of run.pending.values()) {
      clearTimeout(p.timer);
      p.reject(
        run.fatal !== null
          ? new incrementalError(run.fatal.code, run.fatal.message, run.fatal.data)
          : new incrementalError("internal", `the server exited before answering ${p.method}`, {
              reason: "exited",
              exitCode: code,
              signal,
              stderr: run.stderr.trim(),
            }),
      );
    }
    run.pending.clear();
    run.signalExit();
  }
}

// Starts a server for the store and completes the handshake. Rejects with a
// incrementalError (for example store_missing) when the server cannot start.
export async function connect(opts: ConnectOptions = {}): Promise<incremental> {
  const command = opts.command ?? [defaultEngine(), "serve"];
  if (command.length === 0) {
    throw new incrementalError("invalid_params", "command must name the server executable");
  }
  const client = new IncrementalClient(
    command,
    path.resolve(opts.store || defaultStore()),
    path.resolve(opts.root ?? process.cwd()),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    opts.restart ?? true,
  );
  await client.init();
  return client;
}
