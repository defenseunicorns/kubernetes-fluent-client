import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default [{
    ignores: ["**/node_modules", "**/dist", "**/__mocks__", "e2e/crds", "e2e/crds"],
}, ...compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:jsdoc/recommended-typescript-error",
), {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        globals: {
            ...Object.fromEntries(Object.entries(globals.browser).map(([key]) => [key, "off"])),
        },

        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "script",

        parserOptions: {
            project: ["tsconfig.json"],
        },
    },

    rules: {
        "class-methods-use-this": "warn",
        "consistent-this": "warn",
        "no-invalid-this": "warn",

        "@typescript-eslint/no-floating-promises": ["warn", {
            ignoreVoid: true,
        }],

        "jsdoc/tag-lines": ["error", "any", {
            startLines: 1,
        }],
    },
}];