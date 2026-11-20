import { createFileRoute } from "@tanstack/react-router";

import { api } from "@/lib/api";
import { siteUrls } from "@/lib/routes";

export const GET = async (): Promise<Response> => {
  const urls = await siteUrls();
  return new Response(
    [
      "# Incremental Sitemap",
      "",
      "A complete list of public Incremental website routes.",
      "",
      ...urls.map((url) => `- [${url}](${url})`),
      "",
    ].join("\n"),
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/markdown; charset=utf-8",
      },
    }
  );
};

export const Route = createFileRoute("/sitemap.md")({
  server: {
    handlers: { GET: ({ request }) => api(request, GET) },
  },
});
