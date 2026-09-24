// Import cycles are checked on their own (`npm run check:cycles`): the rule resolves every import, which takes minutes.
import base from "./eslint.config.mjs";

const config = [...base, { files: ["src/**/*.{ts,tsx}"], rules: { "import/no-cycle": ["error", { ignoreExternal: true }] } }];
export default config;
