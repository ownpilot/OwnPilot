import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      // `verbatimModuleSyntax: true` in tsconfig.base.json requires explicit
      // `import type` for type-only imports. Enforce via lint to catch missing
      // `type` keywords (helps tree-shaking + ESM correctness).
      // `disallowTypeAnnotations: false` lets inline `import('./x').T`
      // type annotations through — those are circular-dep workarounds
      // (see refactor.md §3.4) and should be removed by restructuring, not
      // mechanical lint-fix.
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
          disallowTypeAnnotations: false,
        },
      ],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'prefer-const': 'warn',
      // Forbid silent `.catch(() => {})` and `.catch((_) => {})`.
      // Use `ignoreError(promise, tag)` / `silentCatch(tag)` from
      // `packages/ui/src/utils/ignore-error.ts` instead so swallowed
      // rejections still surface in dev tools with a domain tag.
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "CallExpression[callee.property.name='catch'][arguments.0.type='ArrowFunctionExpression'][arguments.0.body.type='BlockStatement'][arguments.0.body.body.length=0]",
          message:
            'Silent .catch(() => {}) swallows rejections invisibly. Use ignoreError(promise, tag) or silentCatch(tag) from utils/ignore-error.ts.',
        },
      ],
    },
  },
  {
    // Test files: relax `no-explicit-any` so production warnings stay visible
    // in the noise floor. Mock typing is rarely worth the ergonomic cost.
    // Silent catches are still allowed in tests (e.g. seed cleanup) — the
    // ban is on production behaviour.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', '**/test-helpers.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-syntax': 'off',
    },
  }
);
