import { createFileRoute } from "@tanstack/react-router";

import { api } from "@/lib/api";
import { withLogFlush } from "@/lib/log";

const OG_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">',
  '<rect width="1200" height="630" fill="#000"/>',
  '<g fill="#fff">',
  '<path d="M160 270h40v40h-40zM200 310h40v40h-40zM240 270h40v40h-40zM200 350h40v40h-40z"/>',
  '<text x="320" y="370" font-family="Arial,sans-serif" font-size="100" font-weight="600">Incremental</text>',
  "</g>",
  "</svg>",
].join("");

export const GET = withLogFlush(
  async (): Promise<Response> =>
    new Response(OG_SVG, {
      headers: { "Content-Type": "image/svg+xml" },
    })
);

export const Route = createFileRoute("/api/og")({
  server: {
    handlers: {
      GET: ({ request }) => api(request, GET),
    },
  },
});
