import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const emptyStringToUndefined = (value: unknown) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
};

const optionalString = z.preprocess(
  emptyStringToUndefined,
  z.string().optional()
);
const optionalUrl = z.preprocess(emptyStringToUndefined, z.url().optional());
const optionalBoolean = z.preprocess(
  emptyStringToUndefined,
  z.stringbool().optional()
);
const optionalInteger = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().positive().optional()
);
const optionalUrlArray = z.preprocess((value: unknown) => {
  if (typeof value !== "string") {
    return value;
  }

  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}, z.array(z.url()).optional());

/** Environment values used by the OSS site and its worker. */
export const env = createEnv({
  clientPrefix: "NEXT_PUBLIC_",
  isServer: typeof window === "undefined" || process.env.NODE_ENV === "test",
  client: {
    NEXT_PUBLIC_APP_URL: z
      .preprocess(emptyStringToUndefined, z.url().optional())
      .default("https://app.incremental.dev"),
    NEXT_PUBLIC_AUTH_URL: z
      .preprocess(emptyStringToUndefined, z.url().optional())
      .default("https://auth.incremental.dev"),
    NEXT_PUBLIC_AVATAR_URL: z
      .preprocess(emptyStringToUndefined, z.url().optional())
      .default("https://avatar.incremental.dev"),
    NEXT_PUBLIC_CDN_URL: z
      .preprocess(emptyStringToUndefined, z.url().optional())
      .default("https://cdn.incremental.dev"),
    NEXT_PUBLIC_COMMUNITY_URL: z
      .preprocess(emptyStringToUndefined, z.url().optional())
      .default("https://community.incremental.dev"),
    NEXT_PUBLIC_DEPLOYMENT_ENV: z.preprocess(
      emptyStringToUndefined,
      z.enum(["development", "preview", "production"]).optional()
    ),
    NEXT_PUBLIC_STATUS_PAGE_URL: z
      .preprocess(emptyStringToUndefined, z.url().optional())
      .default("https://incremental-status.com"),
    NEXT_PUBLIC_STUDIO_URL: z
      .preprocess(emptyStringToUndefined, z.url().optional())
      .default("https://platform.incremental.dev"),
    NEXT_PUBLIC_SUPPORT_URL: z
      .preprocess(emptyStringToUndefined, z.url().optional())
      .default("https://support.incremental.dev"),
    NEXT_PUBLIC_URL: z
      .preprocess(emptyStringToUndefined, z.url().optional())
      .default("https://docs.incremental.dev"),
  },

  runtimeEnv: {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    ARCJET_KEY: process.env.ARCJET_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    CSP_REPORT_ONLY: process.env.CSP_REPORT_ONLY,
    CSP_REPORT_URI: process.env.CSP_REPORT_URI,
    DEPLOYMENT_COMMIT_SHA: process.env.DEPLOYMENT_COMMIT_SHA,
    DEPLOYMENT_ENV: process.env.DEPLOYMENT_ENV,
    DEPLOYMENT_REGION: process.env.DEPLOYMENT_REGION,
    HOSTNAME: process.env.HOSTNAME,
    LOG_LEVEL: process.env.LOG_LEVEL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_AUTH_URL: process.env.NEXT_PUBLIC_AUTH_URL,
    NEXT_PUBLIC_AVATAR_URL: process.env.NEXT_PUBLIC_AVATAR_URL,
    NEXT_PUBLIC_CDN_URL: process.env.NEXT_PUBLIC_CDN_URL,
    NEXT_PUBLIC_COMMUNITY_URL: process.env.NEXT_PUBLIC_COMMUNITY_URL,
    NEXT_PUBLIC_DEPLOYMENT_ENV: process.env.NEXT_PUBLIC_DEPLOYMENT_ENV,
    NEXT_PUBLIC_STATUS_PAGE_URL: process.env.NEXT_PUBLIC_STATUS_PAGE_URL,
    NEXT_PUBLIC_STUDIO_URL: process.env.NEXT_PUBLIC_STUDIO_URL,
    NEXT_PUBLIC_SUPPORT_URL: process.env.NEXT_PUBLIC_SUPPORT_URL,
    NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
    NODE_ENV: process.env.NODE_ENV,
    OG_IMAGE_SERVICE_URL: process.env.OG_IMAGE_SERVICE_URL,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    PORT: process.env.PORT,
    RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
    RATE_LIMIT_REQUESTS_PER_MINUTE: process.env.RATE_LIMIT_REQUESTS_PER_MINUTE,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  },

  server: {
    ALLOWED_ORIGINS: optionalUrlArray.default(["https://incremental.dev"]),
    ARCJET_KEY: optionalString,
    CRON_SECRET: optionalString,
    CSP_REPORT_ONLY: optionalBoolean.default(false),
    CSP_REPORT_URI: optionalString,
    DEPLOYMENT_COMMIT_SHA: optionalString,
    DEPLOYMENT_ENV: z.preprocess(
      emptyStringToUndefined,
      z.enum(["development", "preview", "production"]).optional()
    ),
    DEPLOYMENT_REGION: optionalString,
    HOSTNAME: optionalString,
    LOG_LEVEL: z
      .preprocess(
        emptyStringToUndefined,
        z.enum(["debug", "info", "warn", "error", "off"]).optional()
      )
      .default("info"),
    OG_IMAGE_SERVICE_URL: z
      .preprocess(emptyStringToUndefined, z.url().optional())
      .default("https://og-image.incremental.dev"),
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
    OTEL_EXPORTER_OTLP_HEADERS: optionalString,
    OTEL_SERVICE_NAME: z.string().trim().default("oss"),
    PORT: optionalInteger,
    RATE_LIMIT_ENABLED: optionalBoolean.default(true),
    RATE_LIMIT_REQUESTS_PER_MINUTE: optionalInteger.default(60),
    UPSTASH_REDIS_REST_TOKEN: optionalString,
    UPSTASH_REDIS_REST_URL: optionalUrl,
  },

  shared: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },
});
