import base from "./eslint.config.mjs";

const config = [
  ...base,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "import/no-cycle": ["error", { ignoreExternal: true }] },
  },
];

export default config;
