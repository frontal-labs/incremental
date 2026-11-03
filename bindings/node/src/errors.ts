// Error codes of backplane Protocol v1 (plans/PLAN.md 9.7).
export type ErrorCode =
  | "invalid_params"
  | "unknown_method"
  | "protocol_mismatch"
  | "store_missing"
  | "store_corrupt"
  | "lock_busy"
  | "baseline_conflict"
  | "timeout"
  | "internal";

const CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "invalid_params",
  "unknown_method",
  "protocol_mismatch",
  "store_missing",
  "store_corrupt",
  "lock_busy",
  "baseline_conflict",
  "timeout",
  "internal",
]);

// Every rejection of the client is a backplaneError. A code the client does
// not know is reported as "internal"; the engine's own code is kept in data.
export class backplaneError extends Error {
  readonly code: ErrorCode;
  readonly data: unknown;

  constructor(code: string, message: string, data?: unknown) {
    super(message);
    this.name = "backplaneError";
    if (CODES.has(code)) {
      this.code = code as ErrorCode;
      this.data = data;
    } else {
      this.code = "internal";
      this.data = { engineCode: code, ...(isRecord(data) ? data : {}) };
    }
  }
}

export function isBackplaneError(e: unknown): e is backplaneError {
  return e instanceof backplaneError;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
