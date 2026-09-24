import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/** An import rule for one layer; see docs/ARCHITECTURE.md. For a file matched by several, the last one applies. */
const layer = (files, patterns) => ({ files, rules: { "no-restricted-imports": ["error", { patterns }] } });
const serverCode = { regex: "^@/server/", message: "Server code stays on the server: reach it through an API route, or move shared types into a contract." };
const otherFeatures = {
  regex: "^@/features/(?!documents/)",
  message: "A feature depends only on the documents feature; the workspace composes features together.",
};

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
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  // Production code proves its types (schemas at trust boundaries, narrowing elsewhere) instead of asserting them. `as const` stays allowed.
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "error", "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }] },
  },
  layer(["src/features/**"], [serverCode, otherFeatures]),
  layer(["src/features/workspace/**"], [serverCode]),
  layer(["src/shared/**"], [serverCode, { regex: "^@/features/", message: "Shared UI knows nothing about features." }]),
  layer(["src/lib/**"], [serverCode, { regex: "^@/(features|shared)/", message: "lib holds framework-free helpers only." }]),
  layer(
    ["src/server/**", "scripts/**"],
    [
      { regex: "^(react|react-dom|@tanstack/.+|@/shared/.+|@/lib/.+)$", message: "Server code never imports browser code." },
      { regex: "^@/features/(?!documents/progress$|[a-z]+/contracts)", message: "The server may use feature contracts (and progress rules) only." },
    ],
  ),
  // Contracts (and the progress rules) are imported by both sides, so they depend on zod and other contracts only.
  layer(
    ["src/features/*/contracts.ts", "src/features/*/contracts/**", "src/features/documents/progress.ts"],
    [{ regex: "^(?!zod$|\\.{1,2}/|@/features/[a-z]+/contracts)", message: "Contracts use zod and other contracts only." }],
  ),
];
export default config;
