import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "spike/**", "playwright-report/**", "test-results/**", "drizzle/**", "next-env.d.ts"] },
  ...coreWebVitals,
  ...typescript,
  { rules: { "@typescript-eslint/no-explicit-any": "error", "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }] } },
];
export default config;
