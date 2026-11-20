import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import rehypePrettyCode from "rehype-pretty-code";

import { shikiTheme, transformers } from "./src/lib/code.ts";
import { contentMetaSchema, docsSchema } from "./src/lib/schemas.ts";

/**
 * The developer reference: SDKs, tools, and the HTTP API.
 *
 * It shares `docsSchema` because it is the same kind of page as a
 * documentation page — the two surfaces differ in audience and hostname, not
 * in frontmatter.
 */
export const developers = defineDocs({
  dir: "content",
  docs: { schema: docsSchema },
  meta: { schema: contentMetaSchema },
});

export default defineConfig({
  mdxOptions: {
    providerImportSource: "@/components/mdx",
    rehypePlugins: (plugins) => {
      plugins.shift();
      plugins.push([
        rehypePrettyCode,
        {
          // One CSS-variables theme: tokens resolve to the `--shiki-token-*`
          // custom properties cortex.css maps onto the design-system palette,
          // so MDX fences swap with the theme through CSS.
          theme: shikiTheme,
          transformers,
        },
      ]);

      return plugins;
    },
  },
});
