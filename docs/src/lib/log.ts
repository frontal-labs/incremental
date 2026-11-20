import { env } from "@/config/env";

type LogContext = Record<string, unknown>;
type LogLevelName = "debug" | "error" | "info" | "warn";
type OtlpValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: OtlpValue[] } }
  | { kvlistValue: { values: OtlpKeyValue[] } };
interface OtlpKeyValue {
  key: string;
  value: OtlpValue;
}

const REDACTED = "[REDACTED]";
const REDACTED_KEYS = new Set([
  "apikey",
  "authorization",
  "cookie",
  "credentials",
  "password",
  "secret",
  "token",
]);
const MAX_REDACT_DEPTH = 8;
const MAX_BATCH_SIZE = 50;
const OTLP_LOGS_PATH = "/v1/logs";

const severityNumbers: Record<LogLevelName, number> = {
  debug: 5,
  error: 17,
  info: 9,
  warn: 13,
};

const severityText: Record<LogLevelName, string> = {
  debug: "DEBUG",
  error: "ERROR",
  info: "INFO",
  warn: "WARN",
};

export interface LogRecord {
  context: LogContext;
  level: LogLevelName;
  message: string;
  timestamp: string;
}

/** Recursively replaces sensitive context keys with a censor marker. */
export const redact = (value: unknown, depth = 0): unknown => {
  if (
    value === null ||
    typeof value !== "object" ||
    depth >= MAX_REDACT_DEPTH
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return redact(
      {
        cause: value.cause,
        message: value.message,
        name: value.name,
        stack: value.stack,
      },
      depth + 1
    );
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value as LogContext).map(([key, val]) => [
      key,
      REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(val, depth + 1),
    ])
  );
};

const toSerializableValue = (value: unknown, depth = 0): unknown => {
  if (depth >= MAX_REDACT_DEPTH) {
    return "[MAX_DEPTH]";
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toSerializableValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as LogContext).map(([key, entry]) => [
        key,
        toSerializableValue(entry, depth + 1),
      ])
    );
  }

  return String(value);
};

const toOtlpValue = (value: unknown): OtlpValue => {
  if (typeof value === "boolean") {
    return { boolValue: value };
  }

  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((entry) => toOtlpValue(entry)),
      },
    };
  }

  if (value && typeof value === "object") {
    return {
      kvlistValue: {
        values: Object.entries(value as LogContext).map(([key, entry]) => ({
          key,
          value: toOtlpValue(entry),
        })),
      },
    };
  }

  return { stringValue: value === null ? "null" : String(value) };
};

const toAttributes = (context: LogContext): OtlpKeyValue[] =>
  Object.entries(context).map(([key, value]) => ({
    key,
    value: toOtlpValue(toSerializableValue(redact(value))),
  }));

const toUnixNano = (timestamp: string): string =>
  String(BigInt(new Date(timestamp).getTime()) * 1_000_000n);

export const createOtlpLogPayload = (
  records: readonly LogRecord[]
): Record<string, unknown> => ({
  resourceLogs: [
    {
      resource: {
        attributes: toAttributes({
          "deployment.environment":
            env.DEPLOYMENT_ENV ?? env.NEXT_PUBLIC_DEPLOYMENT_ENV ?? env.NODE_ENV,
          "service.name": env.OTEL_SERVICE_NAME,
          ...(env.DEPLOYMENT_COMMIT_SHA
            ? { "service.version": env.DEPLOYMENT_COMMIT_SHA }
            : {}),
          ...(env.DEPLOYMENT_REGION
            ? { "cloud.region": env.DEPLOYMENT_REGION }
            : {}),
        }),
      },
      scopeLogs: [
        {
          logRecords: records.map((record) => ({
            attributes: toAttributes({
              level: record.level,
              ...record.context,
            }),
            body: { stringValue: record.message },
            observedTimeUnixNano: toUnixNano(record.timestamp),
            severityNumber: severityNumbers[record.level],
            severityText: severityText[record.level],
            timeUnixNano: toUnixNano(record.timestamp),
          })),
          scope: { name: env.OTEL_SERVICE_NAME },
        },
      ],
    },
  ],
});

const getLogsEndpoint = (endpoint: string): string => {
  const url = new URL(endpoint);
  if (url.pathname.endsWith(OTLP_LOGS_PATH)) {
    return url.toString();
  }

  url.pathname = `${url.pathname.replace(/\/$/, "")}${OTLP_LOGS_PATH}`;
  return url.toString();
};

const parseHeaders = (value?: string): Record<string, string> => {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");
        return separator === -1
          ? [entry, ""]
          : [
              entry.slice(0, separator).trim(),
              entry.slice(separator + 1).trim(),
            ];
      })
  );
};

const remoteEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT
  ? getLogsEndpoint(env.OTEL_EXPORTER_OTLP_ENDPOINT)
  : undefined;
const remoteHeaders = parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS);
const queue: LogRecord[] = [];
let activeFlush: Promise<void> | undefined;
const logLevelRank: Record<LogLevelName, number> = {
  debug: 10,
  error: 40,
  info: 20,
  warn: 30,
};

const writeToConsole = (record: LogRecord): void => {
  const output = JSON.stringify({
    ...record,
    context: toSerializableValue(redact(record.context)),
  });
  globalThis.console[record.level](output);
};

const sendBatch = async (records: readonly LogRecord[]): Promise<void> => {
  if (!remoteEndpoint) {
    for (const record of records) {
      writeToConsole(record);
    }
    return;
  }

  try {
    const response = await fetch(remoteEndpoint, {
      body: JSON.stringify(createOtlpLogPayload(records)),
      headers: {
        "content-type": "application/json",
        ...remoteHeaders,
      },
      method: "POST",
    });

    if (!response.ok) {
      // Avoid recursively logging exporter failures through the same exporter.
      globalThis.console.error(
        `Telemetry log export failed with status ${response.status}`
      );
    }
  } catch {
    // Telemetry delivery must never break the application request.
  }
};

export const flushLogs = async (): Promise<void> => {
  if (activeFlush) {
    await activeFlush;
    return;
  }

  activeFlush = (async () => {
    while (queue.length > 0) {
      const batch = queue.splice(0, MAX_BATCH_SIZE);
      // Batches must be sent in order so a flush drains the queue reliably.
      // oxlint-disable-next-line no-await-in-loop -- log batches are intentionally ordered
      await sendBatch(batch);
    }
  })().finally(() => {
    activeFlush = undefined;
  });

  await activeFlush;
};

const writeLog = (
  level: LogLevelName,
  message: string,
  context?: LogContext
): void => {
  if (
    env.LOG_LEVEL === "off" ||
    logLevelRank[level] < logLevelRank[env.LOG_LEVEL as LogLevelName]
  ) {
    return;
  }

  queue.push({
    context: (redact(context ?? {}) as LogContext) ?? {},
    level,
    message,
    timestamp: new Date().toISOString(),
  });

  // Keep normal request handling non-blocking. Route handlers that may be
  // frozen after returning can await flushLogs through withLogFlush.
  flushLogs().catch(() => undefined);
};

/** Flushes queued records before a short-lived process or Edge isolate exits. */
export const withLogFlush =
  <TArgs extends unknown[], TResponse extends Response>(
    handler: (...args: TArgs) => Promise<TResponse> | TResponse
  ) =>
  async (...args: TArgs): Promise<TResponse> => {
    try {
      return await handler(...args);
    } finally {
      await flushLogs();
    }
  };

export const log = {
  debug: (message: string, context?: LogContext): void =>
    writeLog("debug", message, context),
  error: (message: string, context?: LogContext): void =>
    writeLog("error", message, context),
  info: (message: string, context?: LogContext): void =>
    writeLog("info", message, context),
  warn: (message: string, context?: LogContext): void =>
    writeLog("warn", message, context),
};
