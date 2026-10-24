import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import { importX, createNodeResolver } from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import jsxA11y from '@htmlacademy/eslint-plugin-jsx-a11y';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['.next/**', 'node_modules/**'],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    plugins: importX.flatConfigs.recommended.plugins,
    settings: {
      ...importX.flatConfigs.typescript.settings,
      'import-x/resolver-next': [
        createTypeScriptImportResolver(),
        createNodeResolver(),
      ],
    },
    rules: {
      ...importX.flatConfigs.recommended.rules,
      ...importX.flatConfigs.typescript.rules,
      'import-x/no-named-as-default-member': 'off',
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: jsxA11y.flatConfigs.recommended.plugins,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.flat.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  }
);
