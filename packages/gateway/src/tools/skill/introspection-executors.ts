/**
 * Skill Introspection Executors
 *
 * Reading a skill's on-disk content so the agent can learn from it:
 *  - skill_parse_content   — SKILL.md frontmatter + body
 *  - skill_read_reference  — references/{file}
 *  - skill_read_script     — scripts/{file}
 *  - skill_list_resources  — directory listing
 *
 * All file reads go through `isWithinDirectory` to block path traversal.
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { getErrorMessage } from '@ownpilot/core';
import { getExtensionService } from '../../services/extension-service.js';
import { parseSkillMdFrontmatter, scanSkillDirectory } from '../../services/agentskills-parser.js';
import { isWithinDirectory } from '../../utils/file-safety.js';
import { resolveSkillDirectory } from './helpers.js';

type ExecResult = { success: boolean; result?: unknown; error?: string };

export async function executeParseContent(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const skillId = String(args.skillId ?? '');
    if (!skillId) {
      return { success: false, error: 'skillId is required' };
    }

    const service = getExtensionService();
    const pkg = service.getById(skillId) ?? service.getAll().find((p) => p.name === skillId);

    if (!pkg) {
      return { success: false, error: `Skill not found: ${skillId}` };
    }

    // For agentskills format: instructions are already parsed in the manifest
    const fmt = pkg.manifest.format ?? 'ownpilot';
    if (fmt === 'agentskills') {
      const inMemoryInstructions = pkg.manifest.system_prompt || pkg.manifest.instructions;
      if (inMemoryInstructions) {
        return {
          success: true,
          result: {
            id: pkg.id,
            name: pkg.name,
            format: 'agentskills',
            frontmatter: {
              name: pkg.name,
              version: pkg.version,
              description: pkg.description,
              category: pkg.category,
            },
            instructions: inMemoryInstructions,
            instructionLength: inMemoryInstructions.length,
            source: 'manifest',
          },
        };
      }
    }

    // Fall back to reading the SKILL.md file from disk
    const skillDir = await resolveSkillDirectory(pkg);
    if (!skillDir) {
      return {
        success: false,
        error: `Cannot locate skill directory for "${pkg.name}". The skill may not have file resources accessible on disk.`,
      };
    }

    const skillMdPath = join(skillDir, 'SKILL.md');
    if (!existsSync(skillMdPath)) {
      return { success: false, error: `SKILL.md not found in skill directory: ${skillDir}` };
    }

    const content = readFileSync(skillMdPath, 'utf-8');
    const { frontmatter, body } = parseSkillMdFrontmatter(content);

    return {
      success: true,
      result: {
        id: pkg.id,
        name: pkg.name,
        format: fmt,
        frontmatter,
        instructions: body,
        instructionLength: body.length,
        source: 'file',
        note: 'Use skill_list_resources to discover scripts and references, then skill_read_reference/skill_read_script to learn from them',
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function executeReadReference(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const skillId = String(args.skillId ?? '');
    const referencePath = String(args.referencePath ?? '');

    if (!skillId) return { success: false, error: 'skillId is required' };
    if (!referencePath) return { success: false, error: 'referencePath is required' };

    const service = getExtensionService();
    const pkg = service.getById(skillId) ?? service.getAll().find((p) => p.name === skillId);
    if (!pkg) return { success: false, error: `Skill not found: ${skillId}` };

    const skillDir = await resolveSkillDirectory(pkg);
    if (!skillDir) {
      return { success: false, error: `Cannot locate skill directory for "${pkg.name}"` };
    }

    const filePath = resolve(skillDir, referencePath);
    if (!isWithinDirectory(skillDir, filePath)) {
      return { success: false, error: 'Invalid reference path: path traversal detected' };
    }
    if (!existsSync(filePath)) {
      return { success: false, error: `Reference file not found: ${referencePath}` };
    }

    const content = readFileSync(filePath, 'utf-8');

    return {
      success: true,
      result: {
        skillId: pkg.id,
        skillName: pkg.name,
        referencePath,
        content,
        contentLength: content.length,
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function executeReadScript(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const skillId = String(args.skillId ?? '');
    const scriptPath = String(args.scriptPath ?? '');

    if (!skillId) return { success: false, error: 'skillId is required' };
    if (!scriptPath) return { success: false, error: 'scriptPath is required' };

    const service = getExtensionService();
    const pkg = service.getById(skillId) ?? service.getAll().find((p) => p.name === skillId);
    if (!pkg) return { success: false, error: `Skill not found: ${skillId}` };

    const skillDir = await resolveSkillDirectory(pkg);
    if (!skillDir) {
      return { success: false, error: `Cannot locate skill directory for "${pkg.name}"` };
    }

    const filePath = resolve(skillDir, scriptPath);
    if (!isWithinDirectory(skillDir, filePath)) {
      return { success: false, error: 'Invalid script path: path traversal detected' };
    }
    if (!existsSync(filePath)) {
      return { success: false, error: `Script file not found: ${scriptPath}` };
    }

    const content = readFileSync(filePath, 'utf-8');

    return {
      success: true,
      result: {
        skillId: pkg.id,
        skillName: pkg.name,
        scriptPath,
        content,
        contentLength: content.length,
        note: 'Study this code to understand how the skill implements its functionality',
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function executeListResources(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const skillId = String(args.skillId ?? '');
    if (!skillId) return { success: false, error: 'skillId is required' };

    const service = getExtensionService();
    const pkg = service.getById(skillId) ?? service.getAll().find((p) => p.name === skillId);
    if (!pkg) return { success: false, error: `Skill not found: ${skillId}` };

    const skillDir = await resolveSkillDirectory(pkg);
    if (!skillDir) {
      return { success: false, error: `Cannot locate skill directory for "${pkg.name}"` };
    }

    const resources = scanSkillDirectory(skillDir);

    return {
      success: true,
      result: {
        id: pkg.id,
        name: pkg.name,
        skillDirectory: skillDir,
        scripts: resources.scriptPaths,
        references: resources.referencePaths,
        assets: resources.assetPaths,
        hasSkillMd: existsSync(join(skillDir, 'SKILL.md')),
        summary: {
          scriptCount: resources.scriptPaths.length,
          referenceCount: resources.referencePaths.length,
          assetCount: resources.assetPaths.length,
        },
        note: 'Use skill_parse_content to read SKILL.md, skill_read_script to study code, skill_read_reference to learn from documentation',
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}
