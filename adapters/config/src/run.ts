// The config adapter runner (spec/adapters/config.md). Records one observation per task
// with the declared inputs of globalInputs plus the paths the task declares, and queries
// the plan with the config from incremental.config.json. A test drives it through connect().
import type {
  incremental,
  Change,
  Context,
  Observation,
  Outcome,
  Plan,
} from "@frontal-labs/incremental-client";
import { affectedConfig, declaredInputs, globalInputFiles, loadConfig } from "./config.js";

export interface TaskSpec {
  id: string;
  // Repo-relative config paths this task depends on, in addition to the global inputs.
  declares?: string[];
  outcome?: Outcome;
}

export interface RecordOptions {
  root: string;
  baseline: string;
  context: Context;
  tasks: TaskSpec[];
}

// Builds the observations (no client call). Global inputs are declared by every task.
export function observationsFor(opts: RecordOptions): Observation[] {
  const config = loadConfig(opts.root);
  const globals = globalInputFiles(opts.root, config);
  return opts.tasks.map((t) => ({
    task: t.id,
    baseline: opts.baseline,
    dirty: false,
    context: opts.context,
    inputs: declaredInputs(opts.root, [...globals, ...(t.declares ?? [])]),
    outputs: [],
    outcome: t.outcome ?? "pass",
    duration_ms: 0,
  }));
}

export async function recordTasks(client: incremental, opts: RecordOptions): Promise<number> {
  const observations = observationsFor(opts);
  if (observations.length === 0) return 0;
  return (await client.observeMany(observations)).accepted;
}

export interface PlanOptions {
  root: string;
  baseline: string;
  context: Context;
  changes: Change[];
  head?: string;
  declared_tasks?: string[];
}

// The affected query, with the config the engine must compare (globalInputs, ignore,
// fallbackContextKeys) read from incremental.config.json.
export async function planChanges(client: incremental, opts: PlanOptions): Promise<Plan> {
  const config = affectedConfig(loadConfig(opts.root));
  return client.affected(
    {
      baseline: opts.baseline,
      ...(opts.head !== undefined ? { head: opts.head } : {}),
      changes: opts.changes,
    },
    {
      baseline: opts.baseline,
      context: opts.context,
      config,
      ...(opts.declared_tasks !== undefined ? { declared_tasks: opts.declared_tasks } : {}),
    },
  );
}
