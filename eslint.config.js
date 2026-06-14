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
      // and should be removed by restructuring, not mechanical lint-fix.
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
    //
    // no-restricted-syntax is overridden for tests with a narrower rule:
    // flag `vi.mock('@ownpilot/core', ...)` without a sub-path. Source code
    // imports from sub-paths (e.g. '@ownpilot/core/services'), so mocking the
    // bare entry point silently fails — the mock factory is never applied.
    // See docs/ADR/vi-mock-sub-path-alignment.md for details.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', '**/test-helpers.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "CallExpression[callee.object.name='vi'][callee.property.name='mock'][arguments.0.value='@ownpilot/core']",
          message:
            "vi.mock('@ownpilot/core') doesn't intercept sub-path imports (e.g. '@ownpilot/core/services'). Use vi.mock('@ownpilot/core/<sub-path>', ...) instead. Run: node scripts/detect-mock-mismatch.mjs",
        },
      ],
    },
  }
);
