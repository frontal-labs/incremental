import { createFileRoute } from "@tanstack/react-router";

import { env } from "@/config/env";
import { api, json } from "@/lib/api";

const isAuthorized = (request: Request): boolean =>
  Boolean(
    env.CRON_SECRET &&
    request.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`
  );

export const GET = (request: Request): Response => {
  if (!isAuthorized(request)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  return json({ ok: true, at: new Date().toISOString() });
};

export const Route = createFileRoute("/api/revalidate")({
  server: {
    handlers: {
      GET: ({ request }) => api(request, () => GET(request)),
    },
  },
});
