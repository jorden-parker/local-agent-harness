import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "prototypes", "docs"] },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["bin/*.js", "eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }] },
  },
  { files: ["eslint.config.js", "bin/*.js"], extends: [tseslint.configs.disableTypeChecked] },
);
