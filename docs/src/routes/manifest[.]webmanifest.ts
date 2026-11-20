import { createFileRoute } from "@tanstack/react-router";

import { api, json } from "@/lib/api";

export const GET = (): Response =>
  json({
    background_color: "#000000",
    description:
      "Incremental is the incremental compute engine for dependency-driven systems - record what tasks touch, skip what hasn't changed.",
    display: "standalone",
    icons: [{ sizes: "any", src: "/favicon.ico", type: "image/x-icon" }],
    name: "Incremental Documentation",
    short_name: "Incremental",
    start_url: "/en/",
    theme_color: "#000000",
  });

export const Route = createFileRoute("/manifest.webmanifest")({
  server: {
    handlers: { GET: ({ request }) => api(request, GET) },
  },
});
