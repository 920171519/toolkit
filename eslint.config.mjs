import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const packageDrawerQueryRestriction = {
  regex: "(?:^|/)queries(?:\\.ts)?$",
  importNames: ["getReadablePackageDetail"],
  message: "Use getPackageDrawerData for the authorized package drawer projection.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [packageDrawerQueryRestriction],
      }],
    },
  },
  {
    files: [
      "app/(workspace)/**/*.{ts,tsx}",
      "app/**/{page,layout}.{ts,tsx}",
      "app/api/reports/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [packageDrawerQueryRestriction, {
          regex: "^(?:node:)?sqlite$|(?:^|/)db(?:\\.ts)?$",
          message: "Read through the corresponding server-side query module.",
        }],
      }],
    },
  },
  globalIgnores([".next/**", "data/**", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
