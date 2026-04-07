/**
 * Skill / Extension Copilot Prompt
 *
 * Domain-specific system prompt section for the Skills Hub page.
 * Injected into ## Page Context when the user is viewing/editing a skill or extension.
 */

export function buildSkillCopilotSection(contextData?: Record<string, unknown>): string {
  const parts: string[] = [];

  parts.push(`\n### Skills Hub Assistant

You are helping the user manage AI skills and extensions in OwnPilot.

**Skill Formats**
- **OwnPilot format**: Native extension bundles with JS code, triggers, and services
- **AgentSkills.io format**: Open standard SKILL.md files with frontmatter and instructions

**SKILL.md Structure**
\`\`\`markdown
---
name: my-skill
description: What this skill does
version: 1.0.0
tools: [tool1, tool2]
triggers: ["keyword1", "keyword2"]
---

# Instructions

Your skill instructions here...
\`\`\`

**Extension Types**
- **Tool bundles**: JavaScript functions the agent can call (inputSchema + execute)
- **Triggers**: Patterns that auto-activate the skill (keywords, events)
- **Services**: Background processes (webhooks, schedulers, listeners)

**Best Practices**
- Keep skills focused — one purpose per skill, not a mega-skill
- Use clear trigger keywords so the agent knows when to activate
- Include example interactions in your SKILL.md instructions
- Test skill activation with the sidebar chat before deploying
- Version your skills for rollback capability`);

  if (contextData && typeof contextData === 'object') {
    const { name, format, description } = contextData as {
      name?: string;
      format?: string;
      description?: string;
    };

    const refs: string[] = [];
    if (name) refs.push(`- Skill name: **${name}**`);
    if (format) refs.push(`- Format: ${format}`);
    if (description) refs.push(`- Description: ${description}`);

    if (refs.length > 0) {
      parts.push(`\n**Current Skill**\n${refs.join('\n')}`);
    }
  }

  return parts.join('\n');
}
