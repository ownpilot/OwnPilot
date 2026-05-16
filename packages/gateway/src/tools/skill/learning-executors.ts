/**
 * Skill Learning Executors
 *
 * Persistent learning trail tied to the `skill_usage` table:
 *  - skill_record_usage         — log learned/referenced/adapted events
 *  - skill_get_learning_stats   — summary + top-skills + recent activity
 *  - skill_compare              — side-by-side tool/category/usage diff
 *  - skill_suggest_learning     — mission-keyword scored recommendations
 *
 * No filesystem access — these read/write the DB only.
 */

import { getErrorMessage } from '@ownpilot/core';
import { getExtensionService } from '../../services/extension-service.js';
import { getAdapter } from '../../db/adapters/index.js';

type ExecResult = { success: boolean; result?: unknown; error?: string };

export async function executeRecordUsage(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  try {
    const skillId = String(args.skillId ?? '');
    const usageType = String(args.usageType ?? '') as 'learned' | 'referenced' | 'adapted';
    const notes = String(args.notes ?? '');

    if (!skillId) return { success: false, error: 'skillId is required' };
    if (!['learned', 'referenced', 'adapted'].includes(usageType)) {
      return {
        success: false,
        error: 'usageType must be one of: learned, referenced, adapted',
      };
    }

    const service = getExtensionService();
    const pkg = service.getById(skillId) ?? service.getAll().find((p) => p.name === skillId);
    if (!pkg) return { success: false, error: `Skill not found: ${skillId}` };

    const adapter = await getAdapter();
    await adapter.execute(
      `INSERT INTO skill_usage (agent_id, skill_id, skill_name, usage_type, content, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        pkg.id,
        pkg.name,
        usageType,
        notes || null,
        JSON.stringify({ timestamp: new Date().toISOString() }),
      ]
    );

    return {
      success: true,
      result: {
        message: `Recorded ${usageType} usage of skill "${pkg.name}"`,
        skillId: pkg.id,
        skillName: pkg.name,
        usageType,
        notes: notes || undefined,
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function executeGetLearningStats(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  try {
    const skillId = args.skillId as string | undefined;
    const limit = Math.min(parseInt(String(args.limit ?? '20'), 10), 100);

    const adapter = await getAdapter();

    const typeCountsRows = skillId
      ? await adapter.query<{ usage_type: string; count: string }>(
          `SELECT usage_type, COUNT(*) as count FROM skill_usage WHERE agent_id = $1 AND skill_id = $2 GROUP BY usage_type`,
          [userId, skillId]
        )
      : await adapter.query<{ usage_type: string; count: string }>(
          `SELECT usage_type, COUNT(*) as count FROM skill_usage WHERE agent_id = $1 GROUP BY usage_type`,
          [userId]
        );

    const topSkillsRows = await adapter.query<{
      skill_id: string;
      skill_name: string;
      total_uses: string;
      learned_count: string;
      referenced_count: string;
      adapted_count: string;
    }>(
      `SELECT skill_id, skill_name, COUNT(*) as total_uses,
              COUNT(*) FILTER (WHERE usage_type = 'learned') as learned_count,
              COUNT(*) FILTER (WHERE usage_type = 'referenced') as referenced_count,
              COUNT(*) FILTER (WHERE usage_type = 'adapted') as adapted_count
       FROM skill_usage
       WHERE agent_id = $1
       GROUP BY skill_id, skill_name
       ORDER BY total_uses DESC
       LIMIT 10`,
      [userId]
    );

    const recentRows = skillId
      ? await adapter.query<Record<string, unknown>>(
          `SELECT * FROM skill_usage WHERE agent_id = $1 AND skill_id = $2 ORDER BY created_at DESC LIMIT $3`,
          [userId, skillId, limit]
        )
      : await adapter.query<Record<string, unknown>>(
          `SELECT * FROM skill_usage WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2`,
          [userId, limit]
        );

    return {
      success: true,
      result: {
        summary: {
          totalUsage: typeCountsRows.reduce((sum, r) => sum + parseInt(r.count), 0),
          learned: parseInt(typeCountsRows.find((r) => r.usage_type === 'learned')?.count ?? '0'),
          referenced: parseInt(
            typeCountsRows.find((r) => r.usage_type === 'referenced')?.count ?? '0'
          ),
          adapted: parseInt(typeCountsRows.find((r) => r.usage_type === 'adapted')?.count ?? '0'),
        },
        topSkills: topSkillsRows.map((s) => ({
          skillId: s.skill_id,
          skillName: s.skill_name,
          totalUses: parseInt(s.total_uses),
          learned: parseInt(s.learned_count),
          referenced: parseInt(s.referenced_count),
          adapted: parseInt(s.adapted_count),
        })),
        recentActivity: recentRows.map((r) => ({
          id: String(r.id),
          skillId: String(r.skill_id),
          skillName: String(r.skill_name),
          usageType: String(r.usage_type),
          notes: r.content ? String(r.content) : undefined,
          createdAt: r.created_at ? String(r.created_at) : undefined,
        })),
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function executeCompare(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  try {
    const skillId1 = String(args.skillId1 ?? '');
    const skillId2 = String(args.skillId2 ?? '');

    if (!skillId1 || !skillId2) {
      return { success: false, error: 'Both skillId1 and skillId2 are required' };
    }

    const service = getExtensionService();
    const pkg1 = service.getById(skillId1) ?? service.getAll().find((p) => p.name === skillId1);
    const pkg2 = service.getById(skillId2) ?? service.getAll().find((p) => p.name === skillId2);

    if (!pkg1) return { success: false, error: `Skill not found: ${skillId1}` };
    if (!pkg2) return { success: false, error: `Skill not found: ${skillId2}` };

    const tools1 = pkg1.manifest.tools.map((t) => t.name).sort();
    const tools2 = pkg2.manifest.tools.map((t) => t.name).sort();
    const commonTools = tools1.filter((t) => tools2.includes(t));
    const uniqueToSkill1 = tools1.filter((t) => !tools2.includes(t));
    const uniqueToSkill2 = tools2.filter((t) => !tools1.includes(t));

    const category1 = pkg1.category ?? 'uncategorized';
    const category2 = pkg2.category ?? 'uncategorized';

    const adapter = await getAdapter();
    const usageRow1 = await adapter.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM skill_usage WHERE agent_id = $1 AND skill_id = $2`,
      [userId, pkg1.id]
    );
    const usageRow2 = await adapter.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM skill_usage WHERE agent_id = $1 AND skill_id = $2`,
      [userId, pkg2.id]
    );

    return {
      success: true,
      result: {
        skill1: {
          id: pkg1.id,
          name: pkg1.name,
          description: pkg1.description,
          format: pkg1.manifest.format ?? 'ownpilot',
          category: category1,
          toolCount: tools1.length,
          version: pkg1.version,
          yourUsageCount: parseInt(usageRow1?.count ?? '0'),
        },
        skill2: {
          id: pkg2.id,
          name: pkg2.name,
          description: pkg2.description,
          format: pkg2.manifest.format ?? 'ownpilot',
          category: category2,
          toolCount: tools2.length,
          version: pkg2.version,
          yourUsageCount: parseInt(usageRow2?.count ?? '0'),
        },
        comparison: {
          sameCategory: category1 === category2,
          category: category1 === category2 ? category1 : `${category1} vs ${category2}`,
          commonTools,
          uniqueToSkill1,
          uniqueToSkill2,
          toolSimilarity:
            tools1.length > 0 || tools2.length > 0
              ? Math.round((commonTools.length / Math.max(tools1.length, tools2.length)) * 100)
              : 0,
        },
        recommendation:
          commonTools.length > 0
            ? `These skills share ${commonTools.length} tools. Skill 1 has ${uniqueToSkill1.length} unique tools, Skill 2 has ${uniqueToSkill2.length} unique tools.`
            : 'These skills have different tool sets and may serve different purposes.',
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function executeSuggestLearning(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  try {
    const mission = String(args.mission ?? '');

    const service = getExtensionService();
    const allSkills = service.getAll();

    const adapter = await getAdapter();
    const learnedRows = await adapter.query<{ skill_id: string }>(
      `SELECT DISTINCT skill_id FROM skill_usage WHERE agent_id = $1 AND usage_type = 'learned'`,
      [userId]
    );
    const learnedSkillIds = new Set(learnedRows.map((s) => s.skill_id));

    const missionKeywords = mission.toLowerCase().split(/\s+/).filter(Boolean);
    const keywordCategories: Record<string, string[]> = {
      data: ['data-analysis', 'database', 'csv', 'json', 'api'],
      web: ['web-scraping', 'browser', 'http', 'api'],
      search: ['search', 'web-search', 'google', 'bing'],
      email: ['email', 'gmail', 'smtp', 'imap'],
      file: ['file-system', 'storage', 's3', 'dropbox'],
      code: ['coding', 'developer', 'git', 'github', 'programming'],
      ai: ['ai', 'llm', 'openai', 'anthropic', 'claude'],
      communication: ['slack', 'discord', 'telegram', 'messaging'],
    };

    const scoredSkills = allSkills.map((skill) => {
      let score = 0;
      const skillName = skill.name.toLowerCase();
      const skillDesc = (skill.description ?? '').toLowerCase();
      const category = (skill.category ?? '').toLowerCase();
      const isLearned = learnedSkillIds.has(skill.id);

      if (isLearned) score -= 10;

      for (const [keyword, categories] of Object.entries(keywordCategories)) {
        if (missionKeywords.some((m) => m.includes(keyword))) {
          if (categories.some((c) => category.includes(c) || skillName.includes(c))) score += 5;
          if (categories.some((c) => skillDesc.includes(c))) score += 3;
        }
      }
      for (const keyword of missionKeywords) {
        if (skillName.includes(keyword)) score += 4;
        if (skillDesc.includes(keyword)) score += 2;
      }
      score += (skill.toolCount ?? 0) * 0.5;

      return { skill, score, isLearned };
    });

    const suggestions = scoredSkills
      .filter((s) => s.score > 0 || !s.isLearned)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return {
      success: true,
      result: {
        mission: mission || undefined,
        totalInstalled: allSkills.length,
        learnedCount: learnedSkillIds.size,
        suggestions: suggestions.map((s) => ({
          skillId: s.skill.id,
          name: s.skill.name,
          description: s.skill.description,
          format: s.skill.manifest.format ?? 'ownpilot',
          category: s.skill.category,
          toolCount: s.skill.toolCount,
          isLearned: s.isLearned,
          relevanceScore: Math.round(s.score),
          reason: s.isLearned
            ? 'Already learned — revisit to deepen knowledge'
            : s.score > 5
              ? 'Highly relevant to your mission'
              : s.score > 0
                ? 'May be useful for your tasks'
                : 'Available to explore',
        })),
        note:
          suggestions.length === 0
            ? 'No specific matches found. Use skill_list_installed to browse all available skills.'
            : `Found ${suggestions.filter((s) => !s.isLearned).length} new skills to learn. Use skill_parse_content and skill_read_reference to study them.`,
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}
