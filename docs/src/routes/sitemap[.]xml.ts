import { createFileRoute } from "@tanstack/react-router";

import { api } from "@/lib/api";
import { siteRoutes } from "@/lib/routes";
import { canonicalUrlForRoute } from "@/lib/urls";

const deploymentLastModified =
  process.env.DEPLOYMENT_COMMIT_DATE ?? new Date().toISOString();

const escapeXml = (value: string): string =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");

export const GET = async (): Promise<Response> => {
  const routes = await siteRoutes();
  const urls = routes.flatMap((route) =>
    route.locales.map((locale) => {
      const languages = [
        ...route.locales.map((alternate) =>
          canonicalUrlForRoute(route.path, alternate)
        ),
        canonicalUrlForRoute(route.path, "en"),
      ];
      const alternates = languages
        .map(
          (alternate) =>
            `<xhtml:link rel="alternate" href="${escapeXml(alternate)}"/>`
        )
        .join("");
      return `<url><loc>${escapeXml(
        canonicalUrlForRoute(route.path, locale)
      )}</loc><lastmod>${escapeXml(
        route.lastModified ?? deploymentLastModified
      )}</lastmod>${alternates}</url>`;
    })
  );
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join(
      ""
    )}</urlset>`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: { GET: ({ request }) => api(request, GET) },
  },
});
