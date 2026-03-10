/**
 * WorktreeManager — Git worktree lifecycle management for parallel CC execution.
 *
 * Provides create/list/remove/merge operations for git worktrees,
 * enabling isolated branch execution when multiple CC processes
 * work on the same project simultaneously.
 *
 * Opt-in via X-Worktree header — normal single-CC flow is unchanged.
 */

import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  baseBranch: string;
  createdAt: Date;
  projectDir: string;
  conversationId?: string;
}

export interface MergeResult {
  success: boolean;
  strategy: 'fast-forward' | 'merge-commit' | 'conflict';
  conflictFiles?: string[];
  commitHash?: string;
}

interface CreateOptions {
  name?: string;
  baseBranch?: string;
  conversationId?: string;
}

interface MergeOptions {
  strategy?: 'auto' | 'fast-forward-only';
  deleteAfter?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_WORKTREES_PER_PROJECT = 5;
const WORKTREE_DIR = '.claude/worktrees';

// ---------------------------------------------------------------------------
// WorktreeManager
// ---------------------------------------------------------------------------

export class WorktreeManager {
  /** In-memory registry of managed worktrees */
  private worktrees = new Map<string, WorktreeInfo>(); // key: `${projectDir}::${name}`

  /**
   * Create a new git worktree for isolated execution.
   */
  async create(projectDir: string, options: CreateOptions = {}): Promise<WorktreeInfo> {
    // Validate name length before anything else
    if (options.name && options.name.length > 100) {
      throw new Error('Worktree name too long (max 100 characters)');
    }

    // Verify it's a git repo
    await this.execGit(['rev-parse', '--is-inside-work-tree'], projectDir);

    const name = options.name
      ? this.sanitizeName(options.name)
      : this.generateName();

    const key = `${projectDir}::${name}`;

    // Check duplicate
    if (this.worktrees.has(key)) {
      throw new Error(`Worktree '${name}' already exists in ${projectDir}`);
    }

    // Check max limit per project
    const projectCount = this.countForProject(projectDir);
    if (projectCount >= MAX_WORKTREES_PER_PROJECT) {
      throw new Error(`Max worktrees (${MAX_WORKTREES_PER_PROJECT}) exceeded for project`);
    }

    // Resolve base branch
    const headBranch = (await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD'], projectDir)).trim();
    const baseBranch = options.baseBranch ?? (headBranch || 'main');

    const worktreePath = `${projectDir}/${WORKTREE_DIR}/${name}`;
    const branch = `bridge/wt-${name}`;

    // Ensure parent dir exists
    await mkdir(`${projectDir}/${WORKTREE_DIR}`, { recursive: true });

    // Create worktree with new branch
    await this.execGit(['worktree', 'add', worktreePath, '-b', branch], projectDir);

    const info: WorktreeInfo = {
      name,
      path: worktreePath,
      branch,
      baseBranch,
      createdAt: new Date(),
      projectDir,
      conversationId: options.conversationId,
    };

    this.worktrees.set(key, info);
    return info;
  }

  /**
   * List worktrees for a project (or all if no projectDir given).
   */
  async list(projectDir?: string): Promise<WorktreeInfo[]> {
    const entries = Array.from(this.worktrees.values());
    if (!projectDir) return entries;
    return entries.filter(w => w.projectDir === projectDir);
  }

  /**
   * Get a specific worktree by project and name.
   */
  async get(projectDir: string, name: string): Promise<WorktreeInfo | null> {
    return this.worktrees.get(`${projectDir}::${name}`) ?? null;
  }

  /**
   * Remove a worktree and clean up its branch.
   */
  async remove(projectDir: string, name: string): Promise<void> {
    const key = `${projectDir}::${name}`;
    const info = this.worktrees.get(key);
    if (!info) {
      throw new Error(`Worktree '${name}' not found in ${projectDir}`);
    }

    // Remove git worktree
    try {
      await this.execGit(['worktree', 'remove', info.path, '--force'], projectDir);
    } catch {
      // If git worktree remove fails, try rm
      await rm(info.path, { recursive: true, force: true });
      await this.execGit(['worktree', 'prune'], projectDir);
    }

    // Delete branch
    try {
      await this.execGit(['branch', '-d', info.branch], projectDir);
    } catch {
      // Branch may already be deleted or not fully merged — force delete
      try {
        await this.execGit(['branch', '-D', info.branch], projectDir);
      } catch {
        // Best effort — branch may not exist
      }
    }

    this.worktrees.delete(key);
  }

  /**
   * Merge worktree branch back to its base branch.
   */
  async mergeBack(projectDir: string, name: string, options: MergeOptions = {}): Promise<MergeResult> {
    const key = `${projectDir}::${name}`;
    const info = this.worktrees.get(key);
    if (!info) {
      throw new Error(`Worktree '${name}' not found in ${projectDir}`);
    }

    try {
      // Attempt merge from main repo (not from worktree)
      await this.execGit(['merge', '--no-edit', info.branch], projectDir);

      const result: MergeResult = {
        success: true,
        strategy: 'merge-commit', // simplified — could detect ff
      };

      // Clean up if requested
      if (options.deleteAfter) {
        await this.remove(projectDir, name);
      }

      return result;
    } catch (err) {
      // Merge conflict
      // Get conflicting files
      let conflictFiles: string[] = [];
      try {
        const diffOutput = await this.execGit(
          ['diff', '--name-only', '--diff-filter=U'],
          projectDir
        );
        conflictFiles = diffOutput.trim().split('\n').filter(Boolean);
      } catch {
        // Best effort
      }

      // Abort the merge
      try {
        await this.execGit(['merge', '--abort'], projectDir);
      } catch {
        // May not be in merging state
      }

      return {
        success: false,
        strategy: 'conflict',
        conflictFiles,
      };
    }
  }

  /**
   * Prune orphaned git worktrees and clean up internal registry.
   * Reconciles in-memory registry with git's actual worktree list.
   */
  async pruneOrphans(projectDir: string): Promise<string[]> {
    const pruned: string[] = [];

    // Step 1: Run git worktree prune (cleans up git's own tracking)
    try {
      await this.execGit(['worktree', 'prune'], projectDir);
    } catch {
      // Non-git dir — skip
    }

    // Step 2: Get git's actual worktree list
    let gitWorktreePaths: Set<string>;
    try {
      const output = await this.execGit(['worktree', 'list', '--porcelain'], projectDir);
      gitWorktreePaths = new Set(
        output.split('\n')
          .filter(line => line.startsWith('worktree '))
          .map(line => line.slice('worktree '.length).trim())
      );
    } catch {
      // Can't get git list — don't prune in-memory (be conservative)
      return pruned;
    }

    // Step 3: Cross-reference in-memory registry vs git reality
    for (const [key, info] of this.worktrees) {
      if (info.projectDir !== projectDir) continue;
      if (!gitWorktreePaths.has(info.path)) {
        // Git no longer knows about this path — it's orphaned
        this.worktrees.delete(key);
        pruned.push(info.name);
      }
    }

    return pruned;
  }

  /**
   * Remove worktrees older than maxAgeMs that are still in registry.
   * Useful for cleaning up abandoned worktrees after bridge restart.
   *
   * @param projectDir - project to clean up
   * @param maxAgeMs - max age in milliseconds (default: 24 hours)
   * @returns names of cleaned up worktrees
   */
  async cleanupStale(projectDir: string, maxAgeMs = 24 * 60 * 60 * 1000): Promise<string[]> {
    const cleaned: string[] = [];
    const now = Date.now();

    for (const [key, info] of this.worktrees) {
      if (info.projectDir !== projectDir) continue;
      const age = now - info.createdAt.getTime();
      if (age > maxAgeMs) {
        try {
          await this.remove(projectDir, info.name);
          cleaned.push(info.name);
        } catch {
          // Best effort — remove from registry anyway
          this.worktrees.delete(key);
          cleaned.push(info.name);
        }
      }
    }

    return cleaned;
  }

  /**
   * Populate the in-memory registry from existing git worktrees on disk.
   * Safe to call on non-git directories — resolves with empty array.
   */
  async initialize(projectDir: string): Promise<WorktreeInfo[]> {
    try {
      const output = await this.execGit(['worktree', 'list', '--porcelain'], projectDir);
      const lines = output.trim().split('\n');
      const results: WorktreeInfo[] = [];

      let currentPath = '';
      let currentBranch = '';

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          currentPath = line.slice('worktree '.length).trim();
          currentBranch = '';
        } else if (line.startsWith('branch ')) {
          currentBranch = line.slice('branch '.length).trim().replace('refs/heads/', '');
        } else if (line === '' && currentPath) {
          // End of a worktree entry — register managed ones (bridge/wt- prefix)
          if (currentBranch.startsWith('bridge/wt-')) {
            const name = currentBranch.replace('bridge/wt-', '');
            const key = `${projectDir}::${name}`;
            if (!this.worktrees.has(key)) {
              const info: WorktreeInfo = {
                name,
                path: currentPath,
                branch: currentBranch,
                baseBranch: 'main',
                createdAt: new Date(),
                projectDir,
              };
              this.worktrees.set(key, info);
              results.push(info);
            }
          }
          currentPath = '';
          currentBranch = '';
        }
      }

      return results;
    } catch {
      // Non-git dir or git not available — return empty
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async execGit(args: string[], cwd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      execFile('git', args, { cwd }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  private generateName(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return `wt-${id}`;
  }

  private sanitizeName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private countForProject(projectDir: string): number {
    let count = 0;
    for (const info of this.worktrees.values()) {
      if (info.projectDir === projectDir) count++;
    }
    return count;
  }

  /**
   * Find worktree linked to a conversation.
   */
  findByConversation(conversationId: string): WorktreeInfo | null {
    for (const info of this.worktrees.values()) {
      if (info.conversationId === conversationId) return info;
    }
    return null;
  }
}

// Singleton instance
export const worktreeManager = new WorktreeManager();
