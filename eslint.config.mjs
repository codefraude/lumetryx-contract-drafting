import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
import stylistic from "@stylistic/eslint-plugin";

/**
 * An import rule for one layer; see docs/ARCHITECTURE.md.
 * For a file matched by several, the last one applies.
 */
const layer = (files, patterns) => {
  return {
    files,
    rules: { "no-restricted-imports": ["error", { patterns }] },
  };
};

const serverCode = {
  regex: "^@/server/",
  message:
    "Server code stays on the server: reach it through an API route, or move shared types into a contract.",
};
const otherFeatures = {
  regex: "^@/features/(?!documents/)",
  message:
    "A feature depends only on the documents feature; the workspace composes features together.",
};

/**
 * Statements that span several lines: each one is set apart by a blank line.
 */
const multiline = [
  "block-like",
  "multiline-expression",
  "multiline-export",
  "multiline-type",
  "interface",
  "class",
];

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "spike/**",
      "playwright-report/**",
      "test-results/**",
      "tests/output/**",
      ".remember/**",
      "drizzle/**",
      "next-env.d.ts",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    plugins: { "@stylistic": stylistic },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // Layout Prettier leaves alone: braces on every branch, blank
      // lines around blocks, after declarations and before return.
      curly: ["error", "all"],
      "@stylistic/padding-line-between-statements": [
        "error",
        {
          blankLine: "always",
          prev: ["directive", "import"],
          next: "*",
        },
        {
          blankLine: "any",
          prev: "import",
          next: "import",
        },
        {
          blankLine: "always",
          prev: ["const", "let"],
          next: "*",
        },
        {
          blankLine: "any",
          prev: ["const", "let"],
          next: ["const", "let"],
        },
        {
          blankLine: "always",
          prev: "*",
          next: multiline,
        },
        {
          blankLine: "always",
          prev: multiline,
          next: "*",
        },
        {
          blankLine: "always",
          prev: "*",
          next: "return",
        },
        {
          blankLine: "never",
          prev: ["case", "default"],
          next: ["case", "default"],
        },
      ],
      "@stylistic/lines-between-class-members": [
        "error",
        {
          enforce: [
            {
              blankLine: "always",
              prev: "*",
              next: "method",
            },
            {
              blankLine: "always",
              prev: "method",
              next: "*",
            },
          ],
        },
      ],
      // An object or type literal with more than
      // one member gets one member per line.
      "@stylistic/object-curly-newline": [
        "error",
        {
          ObjectExpression: {
            multiline: true,
            minProperties: 2,
            consistent: true,
          },
          TSTypeLiteral: {
            multiline: true,
            minProperties: 2,
            consistent: true,
          },
        },
      ],
      // A named function gets a block body; only
      // inline callbacks may stay one-line arrows.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            ":matches(VariableDeclarator, PropertyDefinition) > ArrowFunctionExpression[expression=true]",
          message:
            "Give a named function a block body: `const name = () => { ... };`.",
        },
        {
          selector:
            "VariableDeclarator > :matches(ObjectExpression, TSAsExpression > ObjectExpression, TSSatisfiesExpression > ObjectExpression) > Property > ArrowFunctionExpression[expression=true]",
          message: "Give a named function a block body: `name: () => { ... }`.",
        },
      ],
    },
  },
  // Production code proves its types (schemas at trust boundaries, narrowing
  // elsewhere) instead of asserting them. `as const` stays allowed.
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
    },
  },
  layer(["src/features/**"], [serverCode, otherFeatures]),
  layer(["src/features/workspace/**"], [serverCode]),
  layer(
    ["src/shared/**"],
    [
      serverCode,
      {
        regex: "^@/features/",
        message: "Shared UI knows nothing about features.",
      },
    ],
  ),
  layer(
    ["src/lib/**"],
    [
      serverCode,
      {
        regex: "^@/(features|shared)/",
        message: "lib holds framework-free helpers only.",
      },
    ],
  ),
  layer(
    ["src/server/**", "scripts/**"],
    [
      {
        regex: "^(react|react-dom|@tanstack/.+|@/shared/.+|@/lib/.+)$",
        message: "Server code never imports browser code.",
      },
      {
        regex: "^@/features/(?!documents/progress$|[a-z]+/contracts)",
        message:
          "The server may use feature contracts (and progress rules) only.",
      },
    ],
  ),
  // Contracts (and the progress rules) are imported by both
  // sides, so they depend on zod and other contracts only.
  layer(
    [
      "src/features/*/contracts.ts",
      "src/features/*/contracts/**",
      "src/features/documents/progress.ts",
    ],
    [
      {
        regex: "^(?!zod$|\\.{1,2}/|@/features/[a-z]+/contracts)",
        message: "Contracts use zod and other contracts only.",
      },
    ],
  ),
];

export default config;
