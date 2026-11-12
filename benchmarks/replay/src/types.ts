import type { Plan } from "@incremental/client";

export interface CliArgs {
  repo?: string;
  commits?: number;
  store?: string;
  out?: string;
  // Repo-relative directories that generated edits may touch (for example library/src/methods).
  sources?: string[];
}

export interface GtResult {
  task: string;
  outcome: "pass" | "fail";
}

export interface Edit {
  // append: add content to the end of an existing file (the monorepo sequence uses it).
  op: "write" | "delete" | "append";
  path: string;
  content?: string;
}

export interface RunReport {
  plan: Plan | null;
  results: Array<{ task: string; outcome: string }>;
  advanced: boolean;
  exit: number;
  total_tasks: number;
  discovered: string[];
  wouldSkip: string[];
  selected: string[];
}

export interface FalseSkip {
  commit: string;
  task: string;
  query: Array<{ id: string; reasons: string[] }>;
}

export interface Flaky {
  commit: string;
  task: string;
}

export interface ReplayReport {
  spec: string;
  benchmark: string;
  engine: string;
  repo: string;
  commits: Array<{ index: number; id: string }>;
  commits_processed: number;
  commits_evaluated: number;
  total_tasks: number;
  task_commit_pairs_examined: number;
  false_skips: FalseSkip[];
  flaky: Flaky[];
  skip_shares: number[];
  median_skip_share: number | null;
  rule_of_three_bound: string;
}
