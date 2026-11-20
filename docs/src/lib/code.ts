import { transformerNotationWordHighlight } from "@shikijs/transformers";
import type { ShikiTransformer } from "shiki";
import { createCssVariablesTheme } from "shiki";

/**
 * Shiki stops tokenizing a line after `tokenizeTimeLimit` (500ms by default)
 * and paints the remainder with whatever scope it was in. A cold TypeScript
 * grammar on a loaded machine can exceed that on its first scan, which shows
 * up as half a block rendered in one colour. Highlighting runs at build time,
 * so there is nothing to protect; disable the limit.
 */
const noTokenizeTimeLimit: ShikiTransformer = {
  name: "no-tokenize-time-limit",
  preprocess(_code, options) {
    options.tokenizeTimeLimit = 0;
  },
};

export const transformers = [
  noTokenizeTimeLimit,
  {
    code(node) {
      if (node.tagName === "code") {
        const raw = this.source;
        node.properties.__raw__ = raw;

        if (raw.startsWith("npm install")) {
          node.properties.__npm__ = raw;
          node.properties.__yarn__ = raw.replace("npm install", "yarn add");
          node.properties.__pnpm__ = raw.replace("npm install", "pnpm add");
          node.properties.__bun__ = raw.replace("npm install", "bun add");
        }

        if (raw.startsWith("npx create-")) {
          node.properties.__npm__ = raw;
          node.properties.__yarn__ = raw.replace("npx create-", "yarn create ");
          node.properties.__pnpm__ = raw.replace("npx create-", "pnpm create ");
          node.properties.__bun__ = raw.replace("npx", "bunx --bun");
        }

        // npm create.
        if (raw.startsWith("npm create")) {
          node.properties.__npm__ = raw;
          node.properties.__yarn__ = raw.replace("npm create", "yarn create");
          node.properties.__pnpm__ = raw.replace("npm create", "pnpm create");
          node.properties.__bun__ = raw.replace("npm create", "bun create");
        }

        // npx.
        if (raw.startsWith("npx")) {
          node.properties.__npm__ = raw;
          node.properties.__yarn__ = raw.replace("npx", "yarn dlx");
          node.properties.__pnpm__ = raw.replace("npx", "pnpm dlx");
          node.properties.__bun__ = raw.replace("npx", "bunx --bun");
        }

        // npm run.
        if (raw.startsWith("npm run")) {
          node.properties.__npm__ = raw;
          node.properties.__yarn__ = raw.replace("npm run", "yarn");
          node.properties.__pnpm__ = raw.replace("npm run", "pnpm");
          node.properties.__bun__ = raw.replace("npm run", "bun");
        }
      }
    },
  },
  transformerNotationWordHighlight(),
] as ShikiTransformer[];

/**
 * The one Shiki theme this package uses. Every token colour is a
 * `var(--shiki-token-*)` reference, and cortex.css maps those onto the design
 * system's code tokens. It is handed to rehype-pretty-code in the OSS reference
 * so MDX
 * fences use the same palette too.
 */
export const shikiTheme = createCssVariablesTheme({
  name: "cortex",
  variablePrefix: "--shiki-",
  fontStyle: true,
});
