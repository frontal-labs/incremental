import { createFileRoute } from "@tanstack/react-router";

import { api, json } from "@/lib/api";
import { search } from "@/lib/search";

const MAX_QUERY_LENGTH = 120;

export const GET = (request: Request): Response => {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  if (query.length > MAX_QUERY_LENGTH) {
    return json(
      {
        error: `Search queries must be ${
          MAX_QUERY_LENGTH
        } characters or fewer.`,
      },
      { status: 400 }
    );
  }

  return json(
    { results: query ? search(query) : [] },
    { headers: { "Cache-Control": "no-store" } }
  );
};

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: ({ request }) => api(request, () => GET(request)),
    },
  },
});
