import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          regex: "(?:^|/)queries(?:\\.ts)?$",
          importNames: ["getReadablePackageDetail"],
          message: "Use getPackageDrawerData for the authorized package drawer projection.",
        }],
      }],
    },
  },
  globalIgnores([".next/**", "data/**", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
