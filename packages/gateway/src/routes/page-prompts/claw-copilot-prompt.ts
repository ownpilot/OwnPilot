/**
 * Claw (Autonomous Agent) Copilot Prompt
 *
 * Domain-specific system prompt section for the Claws page.
 * Injected into ## Page Context when the user is viewing/configuring a claw.
 */

export function buildClawCopilotSection(contextData?: Record<string, unknown>): string {
  const parts: string[] = [];

  parts.push(`\n### Claw Runtime Assistant

You are helping the user create and manage Claws — OwnPilot's autonomous agent runtime.

**What is a Claw?**
A Claw is a persistent autonomous agent that composes LLM + workspace + soul + coding agents + 250+ tools. It runs independently, executing missions with configurable stop conditions.

**Claw Modes**
- \`continuous\` — runs until stop condition is met (e.g., max_cycles, on_report)
- \`interval\` — runs on a schedule (e.g., every 30 minutes)
- \`event\` — triggered by external events (webhooks, triggers)
- \`single-shot\` — runs once and stops

**Stop Conditions**
- \`max_cycles:N\` — stop after N LLM cycles
- \`on_report\` — stop when the claw generates a report
- \`on_error\` — stop on first error
- \`idle:N\` — stop after N seconds of inactivity
- Auto-fail: 5 consecutive errors triggers automatic shutdown

**Directive System (.claw/)**
Each claw has a \`.claw/\` directory with:
- \`INSTRUCTIONS.md\` — mission and behavioral rules
- \`TASKS.md\` — current task list
- \`MEMORY.md\` — persistent cross-cycle context (via \`claw_set_context\`/\`claw_get_context\`)
- \`LOG.md\` — execution log (auto-scaffolded)

**Configuration Tips**
- Keep missions under 10,000 characters for clarity
- Set realistic budget limits (token or cost-based)
- Use \`max_cycles\` as a safety net even in continuous mode
- Enable Working Memory for tasks that need cross-cycle state
- Limits: MAX_CONCURRENT_CLAWS=50, MAX_CLAW_DEPTH=3`);

  if (contextData && typeof contextData === 'object') {
    const { name, mode, state, mission } = contextData as {
      name?: string;
      mode?: string;
      state?: string;
      mission?: string;
    };

    const refs: string[] = [];
    if (name) refs.push(`- Claw: **${name}**`);
    if (mode) refs.push(`- Mode: ${mode}`);
    if (state) refs.push(`- State: ${state}`);
    if (mission && typeof mission === 'string') {
      const wordCount = mission.split(/\s+/).length;
      refs.push(`- Mission: ~${wordCount} words`);
    }

    if (refs.length > 0) {
      parts.push(`\n**Current Claw**\n${refs.join('\n')}`);
    }
  }

  return parts.join('\n');
}
