import { createFileRoute } from "@tanstack/react-router";

import { api } from "@/lib/api";
import { llmsTxt } from "@/lib/llms";

export const GET = (): Response =>
  new Response(llmsTxt(), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: { GET: ({ request }) => api(request, GET) },
  },
});
