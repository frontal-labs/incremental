// Public types of @incremental/client (plans/PLAN.md 9.5, 9.6, 10.1; spec/schemas).

export interface Hello {
  protocol: 1;
  engine: { name: string; version: string };
  capabilities: string[];
  store: string;
}

// Reserved context keys (PLAN 8.4) plus any adapter-defined keys.
export interface Context {
  lockfile: string;
  tsconfig: string;
  pkgjson: string;
  runner: string;
  node: string;
  fmt: number;
  caps: { probes: boolean; dirs: boolean; env: boolean; verify?: boolean };
  [key: string]: unknown;
}

export type Input =
  | { kind: "file"; path: string; hash: string }
  | { kind: "dir"; path: string }
  | { kind: "probe"; path: string }
  | { kind: "declared"; path: string; hash: string }
  | { kind: "env"; name: string; value_hash: string }
  | { kind: "env_all"; snapshot?: Record<string, string> };

export type Output = Record<string, unknown>;

export type Outcome = "pass" | "fail" | "error" | "none";

export interface Observation {
  task: string;
  baseline: string;
  dirty: boolean;
  context: Context;
  inputs: Input[];
  outputs: Output[];
  outcome: Outcome;
  duration_ms?: number;
}

export type ChangeStatus = "modified" | "added" | "deleted" | "renamed";

export interface Change {
  path: string;
  status: ChangeStatus;
  old_path?: string;
}

export interface ChangeSet {
  baseline: string;
  head?: string;
  changes: Change[];
}

// Optional config (PLAN 6.7). Missing fields take the engine defaults.
export interface Config {
  ignore?: string[];
  globalInputs?: string[];
  fallbackContextKeys?: string[];
}

export interface AffectedOptions {
  baseline: string;
  // Required by PLAN 10.1 (P0b). A missing context is answered with a
  // context_missing fallback by the engine, not by the client.
  context: Context;
  verify?: boolean; // default false
  policy?: "balanced" | "conservative"; // default "balanced"
  // Additive fields (docs/spec/POLICY.md section 1, DECISIONS.md D-E1-01).
  env?: Record<string, string>;
  config?: Config;
  declared_tasks?: string[];
}

export interface PlanTask {
  id: string;
  reasons: string[];
}

export interface Fallback {
  action: string;
  reason: string;
}

export interface Plan {
  protocol: 1;
  baseline: string;
  graph_version: string;
  verify: boolean;
  tasks: PlanTask[];
  unobserved: string[];
  ignored: string[];
  deleted_tasks: string[];
  total_tasks: number;
  skipped: number;
  fallback: Fallback | null;
  confidence: "high" | "medium" | "n/a";
}

export interface Explanation {
  task: string;
  observed: boolean;
  outcome?: Outcome;
  dirty?: boolean;
  baseline?: string;
  inputs?: number;
  certificate: boolean;
}

export interface Stats {
  tasks: number;
  observations: number;
  baseline: string | null;
  graph_version: string;
}

export interface CompactResult {
  before_bytes: number;
  after_bytes: number;
}

export interface ConnectOptions {
  // Store directory. Default: $INCREMENTAL_STORE, then <repo>/.incremental.
  store?: string;
  // Command that starts the server; "serve", "--store" and "--root" are
  // appended by the client. Default: [<engine>, "serve"], where <engine> is
  // $INCREMENTAL_ENGINE, then <repo>/core/dist/incremental.
  command?: string[];
  // Per-request timeout in milliseconds. Default: 10000.
  timeoutMs?: number;
  // Restart the server if it dies, and re-run hello. Default: true.
  restart?: boolean;
  // Extra (not in PLAN 10.1): the --root passed to the engine, which is the
  // directory that file inputs are hashed against. Default: process.cwd().
  root?: string;
}
