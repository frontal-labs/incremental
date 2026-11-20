import type { Thing, WithContext } from "schema-dts";

interface JsonLdProps {
  code: Record<string, unknown> | WithContext<Thing>;
  id?: string;
}

const escapeJsonForHtml = (json: string): string =>
  json
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/<\/script/gi, "<\\/script")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

const createJsonLdId = (html: string): string => {
  let hash = 0;

  for (const character of html) {
    hash = (hash * 31 + character.charCodeAt(0)) % 4_294_967_296;
  }

  return `json-ld-${hash.toString(36)}`;
};

/**
 * Renders structured data as a plain `<script>` in the server HTML.
 *
 * Deliberately not `next/script`: every strategy it offers — including
 * `beforeInteractive` — serialises the tag into the `self.__next_s` queue and
 * injects it from JavaScript on the client. A `type="application/ld+json"`
 * block is inert data, so it gains nothing from that machinery and loses the
 * only thing that matters: presence in the initial HTML. Crawlers that don't
 * execute JavaScript — Bing, most AI/agent fetchers, social unfurlers — saw no
 * structured data at all while this went through `next/script`.
 */
export function JsonLd({ code, id }: JsonLdProps) {
  const html = escapeJsonForHtml(JSON.stringify(code));
  const scriptId = id ?? createJsonLdId(html);

  return (
    <script
      dangerouslySetInnerHTML={{ __html: html }}
      id={scriptId}
      type="application/ld+json"
    />
  );
}
