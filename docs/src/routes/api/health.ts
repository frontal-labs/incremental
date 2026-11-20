import { createFileRoute } from "@tanstack/react-router";

import { api, json } from "@/lib/api";

export interface HealthResponse {
  status: "ok";
  timestamp: string;
}

export const GET = (): Response =>
  json<HealthResponse>({
    status: "ok",
    timestamp: new Date().toISOString(),
  });

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: ({ request }) => api(request, GET),
    },
  },
});
