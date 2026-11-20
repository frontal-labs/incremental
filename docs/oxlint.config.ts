import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

const projectIgnorePatterns = [
  ...core.ignorePatterns,
  "**/.agents",
  "**/.claude",
  "**/.cursor",
  "**/.source",
  "**/public",
  "**/skills",
  "**/src/components",
  "**/src/hooks",
  "**/src/lib",
  "**/types",
  "**/ui.lock.json",
];

// Keep the existing project baseline when an Oxlint rule has no equivalent in
// the project configuration. Correctness and accessibility rules remain
// enabled through the Ultracite presets.
const compatibilityRules = {
  "consistent-type-specifier-style": "off",
  complexity: "off",
  "func-style": "off",
  "import/no-named-as-default": "off",
  "no-inline-comments": "off",
  "no-use-before-define": "off",
  "no-warning-comments": "off",
  "prefer-named-capture-group": "off",
  "prefer-destructuring": "off",
  "promise/prefer-await-to-callbacks": "off",
  "promise/prefer-await-to-then": "off",
  "require-await": "off",
  "require-unicode-regexp": "off",
  "sort-keys": "off",
  "typescript/consistent-type-imports": "off",
  "typescript/no-non-null-assertion": "off",
  "react/function-component-definition": "off",
  "unicorn/consistent-function-scoping": "off",
  "unicorn/import-style": "off",
  "unicorn/no-array-sort": "off",
  "unicorn/no-await-expression-member": "off",
  "unicorn/no-useless-fallback-in-spread": "off",
  "unicorn/no-useless-spread": "off",
  "unicorn/prefer-import-meta-properties": "off",
  "unicorn/prefer-string-replace-all": "off",
  "unicorn/prefer-type-error": "off",
  "unicorn/require-array-join-separator": "off",
  "unicorn/require-module-specifiers": "off",
  "unicorn/text-encoding-identifier-case": "off",
  "jsdoc/check-property-names": "off",
  "jsdoc/require-param-description": "off",
  "jsdoc/require-property-description": "off",
  "jsdoc/require-returns-description": "off",
} as const;

export default defineConfig({
  extends: [core, react],
  ignorePatterns: projectIgnorePatterns,
  plugins: ["vitest"],
  overrides: [
    {
      files: ["scripts/**/*"],
      rules: {
        "no-await-in-loop": "off",
      },
    },
    {
      files: [
        "**/*.{test,spec,test-d,spec-d}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
        "**/__tests__/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
      ],
      rules: {
        "vitest/no-disabled-tests": "error",
        "vitest/no-duplicate-hooks": "error",
        "vitest/no-focused-tests": "error",
        "vitest/no-standalone-expect": "error",
        "vitest/require-mock-type-parameters": "off",
        "vitest/require-to-throw-message": "off",
        "vitest/valid-title": "off",
        "typescript/no-explicit-any": "off",
      },
    },
    {
      files: ["e2e/fixtures/**/*"],
      rules: {
        "react-hooks/rules-of-hooks": "off",
      },
    },
  ],
  rules: compatibilityRules,
});
