import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import { defineConfig } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    plugins: { 
      "@next/next": nextPlugin,
      js
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
    },
    extends: ["js/recommended", "plugin:@next/next/recommended"],
    languageOptions: {
      globals: globals.node,
    },
  },
  tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
]);
