import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.js', '**/*.cjs'],
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
    // Gateway source files: prevent importing tool symbols from
    // '@ownpilot/core/agent'. These are now re-exported from
    // '@ownpilot/core/tools' and should be imported from there.
    // Non-tool symbols (Message, Agent, createProvider, etc.) are still
    // allowed from '@ownpilot/core/agent'.
    files: ['packages/gateway/src/**/*.ts', 'packages/gateway/src/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: '@ownpilot/core/agent',
              importNames: [
                'ToolDefinition',
                'ToolExecutor',
                'RegisteredTool',
                'ToolContext',
                'ToolExecutionResult',
                'ToolCall',
                'ToolResult',
                'ToolProvider',
                'ToolMiddleware',
                'ToolSource',
                'ToolConfigRequirement',
                'ExecutionPermissions',
                'ExecutionCategory',
                'PermissionMode',
                'ToolRegistry',
                'createToolRegistry',
                'registerCoreTools',
                'DEFAULT_EXECUTION_PERMISSIONS',
                'qualifyToolName',
                'getBaseName',
                'getNamespace',
                'isQualifiedName',
                'sanitizeToolName',
                'desanitizeToolName',
                'TOOL_GROUPS',
                'DEFAULT_ENABLED_GROUPS',
                'getGroupForTool',
                'findSimilarToolNames',
                'formatFullToolHelp',
                'buildToolHelpText',
                'validateRequiredParams',
                'createPluginSecurityMiddleware',
                'setModuleResolver',
                'tryImport',
                'isCallToolHardBlocked',
                'isToolCallAllowed',
                'TOOL_SEARCH_TAGS',
                'TOOL_MAX_LIMITS',
                'applyToolLimits',
                'isPathAllowedAsync',
                'createDynamicToolRegistry',
                'searchToolsDefinition',
                'getToolHelpDefinition',
                'useToolDefinition',
                'batchUseToolDefinition',
                'registerAllTools',
                'ALL_TOOLS',
                'MEMORY_TOOLS',
                'GOAL_TOOLS',
                'CUSTOM_DATA_TOOLS',
                'PERSONAL_DATA_TOOLS',
                'FILE_SYSTEM_TOOLS',
                'CODE_EXECUTION_TOOLS',
                'WEB_FETCH_TOOLS',
                'DYNAMIC_TOOL_DEFINITIONS',
              ],
              message:
                "Import tool symbols from '@ownpilot/core/tools' instead of '@ownpilot/core/agent'. See packages/core/src/agent/tools/index.ts for the full export surface.",
            },
            {
              name: '@ownpilot/core/services',
              importNames: [
                'IClawService',
                'ClawMode',
                'ClawState',
                'ClawSandboxMode',
                'ClawConfig',
                'CreateClawInput',
                'UpdateClawInput',
                'ClawEscalation',
                'ClawSession',
                'ClawToolCall',
                'ClawCycleResult',
                'ClawHistoryEntry',
                'ClawTask',
                'ClawTaskStatus',
                'ClawPlanHistoryEntry',
                'DEFAULT_CLAW_LIMITS',
                'MAX_CLAW_DEPTH',
                'CLAW_RECENT_FAILURES_MAX',
                'CLAW_REFLECTION_THRESHOLD',
                'CLAW_MAX_TASKS',
                'CLAW_TASK_STALL_THRESHOLD',
                'CLAW_TASK_STALL_AUTO_ESCALATE',
                'CLAW_TASK_STALL_FORCE_BLOCK',
                'CLAW_NEXT_INTENT_MAX',
                'CLAW_PLAN_HISTORY_MAX',
                'getClawService',
                'setClawService',
                'hasClawService',
                'ClawToken',
              ],
              message:
                "Import claw symbols from '@ownpilot/core/services/claw' instead of '@ownpilot/core/services'. Run: node scripts/detect-mock-mismatch.mjs after migrating.",
            },
            {
              name: '@ownpilot/core/services',
              importNames: [
                'ICodingAgentService',
                'BuiltinCodingAgentProvider',
                'CodingAgentProvider',
                'CodingAgentMode',
                'CodingAgentSessionMode',
                'CodingAgentSessionState',
                'CodingAgentTask',
                'CodingAgentResult',
                'CodingAgentStatus',
                'CodingAgentSession',
                'CreateCodingSessionInput',
                'CodingAgentOutputFormat',
                'CodingAgentFileAccess',
                'CodingAgentAutonomy',
                'CodingAgentPermissions',
                'CodingAgentSkill',
                'OrchestrationRunStatus',
                'OrchestrationStep',
                'OrchestrationAnalysis',
                'StartOrchestrationInput',
                'OrchestrationRun',
                'isBuiltinProvider',
                'getCustomProviderName',
                'DEFAULT_CODING_AGENT_PERMISSIONS',
                'getCodingAgentService',
                'setCodingAgentService',
                'hasCodingAgentService',
                'CodingAgentToken',
              ],
              message:
                "Import coding-agent symbols from '@ownpilot/core/services/coding-agent' instead of '@ownpilot/core/services'. Run: node scripts/detect-mock-mismatch.mjs after migrating.",
            },
          ],
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
