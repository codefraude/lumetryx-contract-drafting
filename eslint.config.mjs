import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
import stylistic from "@stylistic/eslint-plugin";

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
