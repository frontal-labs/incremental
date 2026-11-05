export declare const ADAPTER: string;
export declare const FIXTURE: string;
export declare const CASES: string;
export declare const RUN_JS: string;
export declare const PRELOAD: string;
export declare const ENGINE: string;
export declare const FIXTURE_TESTS: string[];
export interface Change {
  path: string;
  status: string;
  old_path?: string;
}
export interface Reason {
  id: string;
  reasons: string[];
}
export interface Edit {
  op: "write" | "delete" | "env";
  path?: string;
  content?: string;
  name?: string;
  value?: string;
}
export interface Expect {
  tasks: Reason[];
  unobserved: string[];
  ignored: string[];
  deleted_tasks: string[];
  fallback: {
    action: string;
    reason: string;
  } | null;
  confidence: string;
  ran: string[];
  exit: number;
  advanced: boolean;
  outcomes?: Record<string, string>;
}
export interface Step {
  edit?: Edit[];
  query?: {
    changes: Change[];
    verify: boolean;
    policy: string;
  };
  expect: Expect;
}
export interface CaseFile extends Step {
  id: string;
  desc: string;
  mode: string;
  spec_12_3?: string;
  then?: Step[];
}
export declare function tmp(prefix: string): string;
export declare function git(dir: string, args: string[]): string;
export declare function makeRepo(dir: string): void;
export declare function commitAll(dir: string): void;
export declare function applyEdits(dir: string, edits: Edit[]): Record<string, string>;
export interface CliResult {
  status: number | null;
  out: Record<string, unknown> | null;
  stderr: string;
}
export declare function runCli(
  dir: string,
  store: string,
  extra?: string[],
  env?: Record<string, string>,
): CliResult;
export declare function stats(store: string): {
  tasks: number;
  observations: number;
  baseline: string | null;
};
export declare function sortChanges(cs: Change[]): Change[];
export declare function normTasks(tasks: Reason[]): Reason[];
export declare function loadCases(): CaseFile[];
export declare function fixtureReady(): void;
//# sourceMappingURL=helpers.d.ts.map
