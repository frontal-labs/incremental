import { createFileRoute } from "@tanstack/react-router";

import { siteUrls } from "@/config/config";
import { api } from "@/lib/api";

export const GET = (): Response =>
  new Response(
    [
      "User-agent: *",
      "Allow: /",
      "Allow: /api/og",
      "Disallow: /api/",
      "Disallow: /*/search",
      "",
      `Host: ${siteUrls.website}`,
      `Sitemap: ${siteUrls.website}/sitemap.xml`,
      "",
    ].join("\n"),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: { GET: ({ request }) => api(request, GET) },
  },
});
