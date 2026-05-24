/**
 * CLI Tools Catalog
 *
 * Hardcoded registry of well-known CLI tools organized by category.
 * Each entry defines the binary, risk level, install methods, and defaults.
 *
 * This is the "allowlist" — only tools from this catalog or user-registered
 * custom providers (cli_providers table) can be executed.
 */

import type { CliToolCatalogEntry } from '@ownpilot/core';

// =============================================================================
// CATALOG
// =============================================================================

export const CLI_TOOLS_CATALOG: readonly CliToolCatalogEntry[] = [
  // =========================================================================
  // LINTERS
  // =========================================================================
  {
    name: 'eslint',
    displayName: 'ESLint',
    description: 'JavaScript and TypeScript linter',
    binaryName: 'eslint',
    category: 'linter',
    riskLevel: 'low',
    defaultPolicy: 'allowed',
    installMethods: ['npm-global', 'pnpm-global', 'npx'],
    npxPackage: 'eslint',
    npmPackage: 'eslint',
    website: 'https://eslint.org',
    tags: ['javascript', 'typescript', 'lint', 'code-quality'],
  },
  {
    name: 'biome',
    displayName: 'Biome',
    description: 'Fast formatter and linter for JS/TS/JSON/CSS',
    binaryName: 'biome',
    category: 'linter',
    riskLevel: 'low',
    defaultPolicy: 'allowed',
    installMethods: ['npm-global', 'pnpm-global', 'npx'],
    npxPackage: '@biomejs/biome',
    npmPackage: '@biomejs/biome',
    website: 'https://biomejs.dev',
    tags: ['formatter', 'linter', 'javascript', 'typescript'],
  },
  {
    name: 'stylelint',
    displayName: 'Stylelint',
    description: 'CSS/SCSS/Less linter',
    binaryName: 'stylelint',
    category: 'linter',
    riskLevel: 'low',
    defaultPolicy: 'allowed',
    installMethods: ['npm-global', 'pnpm-global', 'npx'],
    npxPackage: 'stylelint',
    npmPackage: 'stylelint',
    website: 'https://stylelint.io',
    tags: ['css', 'scss', 'lint', 'style'],
  },
  {
    name: 'markdownlint',
    displayName: 'markdownlint',
    description: 'Markdown linter and style checker',
    binaryName: 'markdownlint',
    category: 'linter',
    riskLevel: 'low',
    defaultPolicy: 'allowed',
    installMethods: ['npm-global', 'pnpm-global', 'npx'],
    npxPackage: 'markdownlint-cli',
    npmPackage: 'markdownlint-cli',
    website: 'https://github.com/DavidAnson/markdownlint',
    tags: ['markdown', 'lint', 'docs'],
  },

  // =========================================================================
  // FORMATTERS
  // =========================================================================
  {
    name: 'prettier',
    displayName: 'Prettier',
    description: 'Opinionated code formatter (can modify files with --write)',
    binaryName: 'prettier',
    category: 'formatter',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['npm-global', 'pnpm-global', 'npx'],
    npxPackage: 'prettier',
    npmPackage: 'prettier',
    website: 'https://prettier.io',
    tags: ['format', 'style', 'javascript', 'typescript', 'css', 'html'],
  },

  // =========================================================================
  // BUILD TOOLS
  // =========================================================================
  {
    name: 'tsc',
    displayName: 'TypeScript Compiler',
    description: 'TypeScript type checker and compiler',
    binaryName: 'tsc',
    category: 'build',
    riskLevel: 'low',
    defaultPolicy: 'allowed',
    installMethods: ['npm-global', 'pnpm-global', 'npx'],
    npxPackage: 'typescript',
    npmPackage: 'typescript',
    website: 'https://www.typescriptlang.org',
    tags: ['typescript', 'compiler', 'typecheck'],
  },
  {
    name: 'vite',
    displayName: 'Vite',
    description: 'Fast frontend build tool and dev server',
    binaryName: 'vite',
    category: 'build',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['npm-global', 'pnpm-global', 'npx'],
    npxPackage: 'vite',
    npmPackage: 'vite',
    website: 'https://vitejs.dev',
    tags: ['build', 'frontend', 'bundler'],
  },
  {
    name: 'turbo',
    displayName: 'Turborepo',
    description: 'Monorepo build system for TypeScript/JavaScript',
    binaryName: 'turbo',
    category: 'build',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['npm-global', 'pnpm-global', 'npx'],
    npxPackage: 'turbo',
    npmPackage: 'turbo',
    website: 'https://turbo.build',
    tags: ['build', 'monorepo', 'ci'],
  },
  {
    name: 'esbuild',
    displayName: 'esbuild',
    description: 'Extremely fast JavaScript/TypeScript bundler',
    binaryName: 'esbuild',
    category: 'build',
    riskLevel: 'low',
    defaultPolicy: 'allowed',
    installMethods: ['npm-global', 'pnpm-global', 'npx'],
    npxPackage: 'esbuild',
    npmPackage: 'esbuild',
    website: 'https://esbuild.github.io',
    tags: ['build', 'bundler', 'javascript', 'typescript'],
  },
  {
    name: 'webpack',
    displayName: 'webpack',
    description: 'Module bundler for JavaScript applications',
    binaryName: 'webpack',
    category: 'build',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['npm-global', 'pnpm-global', 'npx'],
    npxPackage: 'webpack-cli',
    npmPackage: 'webpack-cli',
    website: 'https://webpack.js.org',
    tags: ['build', 'bundler', 'javascript'],
  },

  // =========================================================================
  // TEST RUNNERS
  // =========================================================================
  {
    name: 'vitest',
    displayName: 'Vitest',
    description: 'Vite-native test framework',
    binaryName: 'vitest',
    category: 'test',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['npm-global', 'pnpm-global', 'npx'],
    npxPackage: 'vitest',
    npmPackage: 'vitest',
    website: 'https://vitest.dev',
    tags: ['test', 'javascript', 'typescript', 'vite'],
  },
  {
    name: 'jest',
    displayName: 'Jest',
    description: 'JavaScript testing framework',
    binaryName: 'jest',
    category: 'test',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['npm-global', 'pnpm-global', 'npx'],
    npxPackage: 'jest',
    npmPackage: 'jest',
    website: 'https://jestjs.io',
    tags: ['test', 'javascript', 'typescript'],
  },
  {
    name: 'pytest',
    displayName: 'pytest',
    description: 'Python testing framework',
    binaryName: 'pytest',
    category: 'test',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['system'],
    website: 'https://pytest.org',
    tags: ['test', 'python'],
  },

  // =========================================================================
  // PACKAGE MANAGERS
  // =========================================================================
  {
    name: 'npm',
    displayName: 'npm',
    description: 'Node.js package manager',
    binaryName: 'npm',
    category: 'package-manager',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['system'],
    website: 'https://www.npmjs.com',
    tags: ['package', 'node', 'javascript'],
  },
  {
    name: 'pnpm',
    displayName: 'pnpm',
    description: 'Fast, disk space efficient package manager',
    binaryName: 'pnpm',
    category: 'package-manager',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['npm-global', 'system'],
    npmPackage: 'pnpm',
    website: 'https://pnpm.io',
    tags: ['package', 'node', 'javascript'],
  },
  {
    name: 'yarn',
    displayName: 'Yarn',
    description: 'JavaScript package manager',
    binaryName: 'yarn',
    category: 'package-manager',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['npm-global', 'system'],
    npmPackage: 'yarn',
    website: 'https://yarnpkg.com',
    tags: ['package', 'node', 'javascript'],
  },
  {
    name: 'bun',
    displayName: 'Bun',
    description: 'All-in-one JavaScript runtime and package manager',
    binaryName: 'bun',
    category: 'package-manager',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['system'],
    website: 'https://bun.sh',
    tags: ['package', 'runtime', 'javascript', 'typescript'],
  },

  // =========================================================================
  // CONTAINERS
  // =========================================================================
  {
    name: 'docker',
    displayName: 'Docker',
    description: 'Container runtime and build tool',
    binaryName: 'docker',
    category: 'container',
    riskLevel: 'high',
    defaultPolicy: 'blocked',
    installMethods: ['system', 'manual'],
    website: 'https://docker.com',
    tags: ['container', 'devops', 'deploy'],
  },
  {
    name: 'docker-compose',
    displayName: 'Docker Compose',
    description: 'Multi-container orchestration',
    binaryName: 'docker-compose',
    category: 'container',
    riskLevel: 'high',
    defaultPolicy: 'blocked',
    installMethods: ['system', 'manual'],
    versionFlag: 'version',
    website: 'https://docs.docker.com/compose',
    tags: ['container', 'devops', 'orchestration'],
  },

  // =========================================================================
  // VERSION CONTROL
  // =========================================================================
  {
    name: 'git',
    displayName: 'Git',
    description: 'Distributed version control system',
    binaryName: 'git',
    category: 'version-control',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['system'],
    website: 'https://git-scm.com',
    tags: ['vcs', 'version-control', 'scm'],
  },
  {
    name: 'gh',
    displayName: 'GitHub CLI',
    description: 'GitHub command-line tool',
    binaryName: 'gh',
    category: 'version-control',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['system', 'manual'],
    website: 'https://cli.github.com',
    tags: ['github', 'pr', 'issue', 'release'],
  },

  // =========================================================================
  // UTILITIES
  // =========================================================================
  {
    name: 'node',
    displayName: 'Node.js',
    description: 'JavaScript runtime',
    binaryName: 'node',
    category: 'utility',
    riskLevel: 'high',
    defaultPolicy: 'blocked',
    installMethods: ['system'],
    versionFlag: '-v',
    website: 'https://nodejs.org',
    tags: ['runtime', 'javascript'],
  },
  {
    name: 'python',
    displayName: 'Python',
    description: 'Python interpreter',
    binaryName: 'python',
    category: 'utility',
    riskLevel: 'high',
    defaultPolicy: 'blocked',
    installMethods: ['system'],
    website: 'https://python.org',
    tags: ['runtime', 'python'],
  },
  {
    name: 'jq',
    displayName: 'jq',
    description: 'Command-line JSON processor',
    binaryName: 'jq',
    category: 'utility',
    riskLevel: 'low',
    defaultPolicy: 'allowed',
    installMethods: ['system', 'manual'],
    website: 'https://jqlang.github.io/jq',
    tags: ['json', 'transform', 'query'],
  },
  {
    name: 'curl',
    displayName: 'curl',
    description: 'Command-line HTTP client',
    binaryName: 'curl',
    category: 'utility',
    riskLevel: 'medium',
    defaultPolicy: 'prompt',
    installMethods: ['system'],
    versionFlag: '-V',
    website: 'https://curl.se',
    tags: ['http', 'api', 'download'],
  },
  {
    name: 'ripgrep',
    displayName: 'ripgrep',
    description: 'Fast line-oriented search tool (rg)',
    binaryName: 'rg',
    category: 'utility',
    riskLevel: 'low',
    defaultPolicy: 'allowed',
    installMethods: ['system', 'manual'],
    website: 'https://github.com/BurntSushi/ripgrep',
    tags: ['search', 'grep', 'find'],
  },
];

// =============================================================================
// LOOKUP MAP
// =============================================================================

/** O(1) lookup by tool name */
export const CLI_TOOLS_BY_NAME = new Map<string, CliToolCatalogEntry>(
  CLI_TOOLS_CATALOG.map((t) => [t.name, t])
);
