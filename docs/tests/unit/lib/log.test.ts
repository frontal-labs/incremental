import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  env: {
    DEPLOYMENT_COMMIT_SHA: undefined,
    DEPLOYMENT_ENV: undefined,
    DEPLOYMENT_REGION: undefined,
    LOG_LEVEL: "info",
    NODE_ENV: "test",
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    OTEL_EXPORTER_OTLP_HEADERS: undefined,
    OTEL_SERVICE_NAME: "test-service",
  },
}));

const { createOtlpLogPayload, redact } = await import("@/lib/log");
type LogRecord = import("@/lib/log").LogRecord;

describe("structured logger", () => {
  it("redacts sensitive values recursively", () => {
    expect(
      redact({
        Authorization: "Bearer private-token",
        nested: [{ password: "secret" }],
        safe: "value",
      })
    ).toEqual({
      Authorization: "[REDACTED]",
      nested: [{ password: "[REDACTED]" }],
      safe: "value",
    });
  });

  it("serializes errors and structured context as OTLP log records", () => {
    const record: LogRecord = {
      context: {
        error: new Error("request failed"),
        requestId: "req-123",
        retryable: false,
      },
      level: "error",
      message: "Request failed",
      timestamp: "2026-08-21T12:00:00.000Z",
    };

    const payload = createOtlpLogPayload([record]);
    const resourceLogs = payload.resourceLogs as {
      scopeLogs: { logRecords: Record<string, unknown>[] }[];
    }[];
    const logRecord = resourceLogs[0]?.scopeLogs[0]?.logRecords[0];

    expect(logRecord).toMatchObject({
      body: { stringValue: "Request failed" },
      severityText: "ERROR",
      timeUnixNano: "1787313600000000000",
    });
    expect(logRecord?.attributes).toEqual(
      expect.arrayContaining([
        {
          key: "requestId",
          value: { stringValue: "req-123" },
        },
        {
          key: "retryable",
          value: { boolValue: false },
        },
      ])
    );
  });
});
