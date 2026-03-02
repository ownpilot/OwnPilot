/**
 * Agent Soul, Crew, Communication & Heartbeat CLI commands
 *
 * These commands interact with the gateway REST API.
 */

const API_BASE = process.env.OWNPILOT_API_URL || 'http://localhost:8080/api/v1';

async function api(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { success: boolean; data: unknown; error?: unknown };
  if (!json.success) throw new Error(`API error: ${JSON.stringify(json.error)}`);
  return json.data;
}

// ─── Soul commands ──────────────────────────────────────────────────────

export async function soulList(): Promise<void> {
  const data = (await api('/souls')) as {
    items: Array<{
      agentId: string;
      name: string;
      identity: { displayName: string; emoji?: string };
      autonomy: { level: string };
      heartbeat: { enabled: boolean };
      evolution: { version: number };
    }>;
    total: number;
  };
  console.log(`\nAgent Souls (${data.total}):`);
  console.log('─'.repeat(70));
  if (data.items.length === 0) {
    console.log('  No souls configured.\n');
    return;
  }
  for (const s of data.items) {
    const emoji = s.identity.emoji || '🤖';
    const hb = s.heartbeat.enabled ? '♥ on' : '♥ off';
    console.log(`  ${emoji} ${s.identity.displayName || s.name}  (${s.agentId})`);
    console.log(`     Autonomy: ${s.autonomy.level}  |  ${hb}  |  v${s.evolution.version}`);
  }
  console.log();
}

export async function soulGet(agentId: string): Promise<void> {
  if (!agentId) {
    console.error('Usage: ownpilot soul get <agentId>');
    return;
  }
  const soul = (await api(`/souls/${agentId}`)) as Record<string, unknown>;
  console.log(JSON.stringify(soul, null, 2));
}

export async function soulDelete(agentId: string): Promise<void> {
  if (!agentId) {
    console.error('Usage: ownpilot soul delete <agentId>');
    return;
  }
  await api(`/souls/${agentId}`, 'DELETE');
  console.log(`Soul for agent ${agentId} deleted.`);
}

export async function soulFeedback(agentId: string, type: string, content: string): Promise<void> {
  if (!agentId || !type || !content) {
    console.error('Usage: ownpilot soul feedback <agentId> <type> <content>');
    console.error('  Types: praise, correction, directive, personality_tweak');
    return;
  }
  await api(`/souls/${agentId}/feedback`, 'POST', { type, content });
  console.log(`Feedback (${type}) applied to ${agentId}.`);
}

export async function soulVersions(agentId: string): Promise<void> {
  if (!agentId) {
    console.error('Usage: ownpilot soul versions <agentId>');
    return;
  }
  const versions = (await api(`/souls/${agentId}/versions`)) as Array<{
    version: number;
    changelog: string;
    createdAt: string;
  }>;
  console.log(`\nVersions for ${agentId}:`);
  console.log('─'.repeat(50));
  if (versions.length === 0) {
    console.log('  No versions.\n');
    return;
  }
  for (const v of versions) {
    console.log(
      `  v${v.version}  ${new Date(v.createdAt).toLocaleDateString()}  ${v.changelog || ''}`
    );
  }
  console.log();
}

// ─── Crew commands ──────────────────────────────────────────────────────

export async function crewList(): Promise<void> {
  const data = (await api('/crews')) as {
    items: Array<{
      id: string;
      name: string;
      status: string;
      coordinationPattern: string;
      members: Array<{ agentId: string; role: string }>;
    }>;
    total: number;
  };
  console.log(`\nCrews (${data.total}):`);
  console.log('─'.repeat(70));
  if (data.items.length === 0) {
    console.log('  No crews deployed.\n');
    return;
  }
  for (const c of data.items) {
    const icon = c.status === 'active' ? '🟢' : c.status === 'paused' ? '🟡' : '⚫';
    console.log(`  ${icon} ${c.name}  [${c.status}]  (${c.coordinationPattern})`);
    for (const m of c.members) {
      console.log(`     - ${m.agentId}: ${m.role}`);
    }
  }
  console.log();
}

export async function crewGet(id: string): Promise<void> {
  if (!id) {
    console.error('Usage: ownpilot crew get <id>');
    return;
  }
  const crew = (await api(`/crews/${id}`)) as Record<string, unknown>;
  console.log(JSON.stringify(crew, null, 2));
}

export async function crewPause(id: string): Promise<void> {
  if (!id) {
    console.error('Usage: ownpilot crew pause <id>');
    return;
  }
  await api(`/crews/${id}/pause`, 'POST');
  console.log(`Crew ${id} paused.`);
}

export async function crewResume(id: string): Promise<void> {
  if (!id) {
    console.error('Usage: ownpilot crew resume <id>');
    return;
  }
  await api(`/crews/${id}/resume`, 'POST');
  console.log(`Crew ${id} resumed.`);
}

export async function crewDisband(id: string): Promise<void> {
  if (!id) {
    console.error('Usage: ownpilot crew disband <id>');
    return;
  }
  await api(`/crews/${id}`, 'DELETE');
  console.log(`Crew ${id} disbanded.`);
}

export async function crewTemplates(): Promise<void> {
  const templates = (await api('/crews/templates')) as Array<{
    id: string;
    name: string;
    description: string;
    coordinationPattern: string;
    agents: Array<{ displayName: string; role: string }>;
  }>;
  console.log('\nCrew Templates:');
  console.log('─'.repeat(70));
  for (const t of templates) {
    console.log(`  📋 ${t.name}  (${t.id})`);
    console.log(`     ${t.description}`);
    console.log(
      `     Pattern: ${t.coordinationPattern}  |  Agents: ${t.agents.map((a) => a.displayName).join(', ')}`
    );
  }
  console.log();
}

// ─── Message commands ───────────────────────────────────────────────────

export async function msgList(): Promise<void> {
  const data = (await api('/agent-messages?limit=20')) as {
    items: Array<{
      id: string;
      from: string;
      to: string;
      type: string;
      subject: string;
      content: string;
      createdAt: string;
    }>;
    total: number;
  };
  console.log(`\nAgent Messages (showing ${data.items.length} of ${data.total}):`);
  console.log('─'.repeat(70));
  if (data.items.length === 0) {
    console.log('  No messages.\n');
    return;
  }
  for (const m of data.items) {
    const time = new Date(m.createdAt).toLocaleString();
    console.log(`  [${time}]  ${m.from} → ${m.to}  (${m.type})`);
    if (m.subject) console.log(`     Subject: ${m.subject}`);
    console.log(`     ${m.content.slice(0, 120)}${m.content.length > 120 ? '...' : ''}`);
  }
  console.log();
}

export async function msgSend(to: string, content: string): Promise<void> {
  if (!to || !content) {
    console.error('Usage: ownpilot msg send <agentId> <content>');
    return;
  }
  await api('/agent-messages', 'POST', { to, content });
  console.log(`Message sent to ${to}.`);
}

export async function msgAgent(agentId: string): Promise<void> {
  if (!agentId) {
    console.error('Usage: ownpilot msg agent <agentId>');
    return;
  }
  const messages = (await api(`/agent-messages/agent/${agentId}?limit=20`)) as Array<{
    from: string;
    to: string;
    content: string;
    createdAt: string;
  }>;
  console.log(`\nMessages for ${agentId}:`);
  console.log('─'.repeat(50));
  for (const m of messages) {
    const time = new Date(m.createdAt).toLocaleString();
    console.log(`  [${time}]  ${m.from} → ${m.to}`);
    console.log(`     ${m.content.slice(0, 120)}`);
  }
  console.log();
}

// ─── Heartbeat commands ─────────────────────────────────────────────────

export async function heartbeatList(): Promise<void> {
  const data = (await api('/heartbeat-logs?limit=20')) as {
    items: Array<{
      id: string;
      agentId: string;
      triggeredAt: string;
      tasksRun: number;
      tasksSucceeded: number;
      tasksFailed: number;
      totalCost: number;
      error?: string;
    }>;
    total: number;
  };
  console.log(`\nHeartbeat Logs (showing ${data.items.length} of ${data.total}):`);
  console.log('─'.repeat(70));
  if (data.items.length === 0) {
    console.log('  No heartbeat logs.\n');
    return;
  }
  for (const l of data.items) {
    const time = new Date(l.triggeredAt).toLocaleString();
    const status = l.tasksFailed > 0 ? '❌' : l.tasksRun > 0 ? '✅' : '⬜';
    console.log(
      `  ${status} [${time}]  ${l.agentId}  tasks:${l.tasksSucceeded}/${l.tasksRun}  $${l.totalCost.toFixed(4)}`
    );
    if (l.error) console.log(`     Error: ${l.error}`);
  }
  console.log();
}

export async function heartbeatStats(agentId?: string): Promise<void> {
  const stats = (await api(`/heartbeat-logs/stats${agentId ? `?agentId=${agentId}` : ''}`)) as {
    total: number;
    avgTasksRun: number;
    avgCost: number;
    totalCost: number;
    successRate: number;
  };
  console.log(`\nHeartbeat Statistics${agentId ? ` (${agentId})` : ''}:`);
  console.log('─'.repeat(40));
  console.log(`  Total runs:    ${stats.total}`);
  console.log(`  Success rate:  ${(stats.successRate * 100).toFixed(1)}%`);
  console.log(`  Avg tasks:     ${stats.avgTasksRun.toFixed(1)}`);
  console.log(`  Avg cost:      $${stats.avgCost.toFixed(4)}`);
  console.log(`  Total cost:    $${stats.totalCost.toFixed(4)}`);
  console.log();
}

export async function heartbeatAgent(agentId: string): Promise<void> {
  if (!agentId) {
    console.error('Usage: ownpilot heartbeat agent <agentId>');
    return;
  }
  const logs = (await api(`/heartbeat-logs/agent/${agentId}?limit=20`)) as Array<{
    triggeredAt: string;
    tasksRun: number;
    tasksSucceeded: number;
    totalCost: number;
    error?: string;
  }>;
  console.log(`\nHeartbeat logs for ${agentId}:`);
  console.log('─'.repeat(50));
  for (const l of logs) {
    const time = new Date(l.triggeredAt).toLocaleString();
    const status = l.error ? '❌' : '✅';
    console.log(
      `  ${status} [${time}]  ${l.tasksSucceeded}/${l.tasksRun} tasks  $${l.totalCost.toFixed(4)}`
    );
  }
  console.log();
}
