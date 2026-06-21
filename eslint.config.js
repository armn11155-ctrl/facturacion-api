import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      // Patrón común en este código: catch silencioso para lookups opcionales
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // pdf.js usa page.evaluate() de puppeteer → contexto de navegador
    files: ["src/services/pdf.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    ignores: ["node_modules/**", "src/db/**"],
  },
];
