import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ".vercel/**",
      "contracts/ton/build/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: { globals: { ...globals.es2024, ...globals.node } },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@pokepets/api",
                "@pokepets/api/*",
                "@pokepets/api-contracts/*",
                "@supabase/*",
              ],
              message: "Web 只能依赖公开 API 契约。",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["api/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@pokepets/api",
              message: "API 入口只能依赖 @pokepets/api/entrypoints。",
            },
          ],
          patterns: [
            {
              group: [
                "../packages/*/src/*",
                "../apps/*",
                "@pokepets/api/src/*",
                "@pokepets/api-contracts/*",
              ],
              message: "API 入口只能依赖 @pokepets/api/entrypoints。",
            },
          ],
        },
      ],
    },
  },
);
