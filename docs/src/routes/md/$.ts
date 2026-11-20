import { createFileRoute } from "@tanstack/react-router";

import { api } from "@/lib/api";
import { source, toLocale } from "@/lib/source";

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/u;
const ESM_STATEMENT = /^[ \t]*(?:import|export)\s[^\n]*\n?/gmu;

const toMarkdown = (raw: string): string =>
  raw.replace(FRONTMATTER, "").replace(ESM_STATEMENT, "").trim();

export const GET = async (
  _request: Request,
  splat: string
): Promise<Response> => {
  const [maybeLocale, ...rest] = splat.split("/").filter(Boolean);
  if (rest.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  const locale = toLocale(maybeLocale);
  const { page } = source.getPageByHref(`/${rest.join("/")}`, {
    language: locale,
  });
  if (!page) {
    return new Response("Not found", { status: 404 });
  }

  const body = toMarkdown(await page.data.getText("raw"));
  const description = page.data.description
    ? `> ${page.data.description}\n\n`
    : "";

  return new Response(`# ${page.data.title}\n\n${description}${body}\n`, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};

export const Route = createFileRoute("/md/$")({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        api(request, () => GET(request, params._splat ?? "")),
    },
  },
});
