const fs = require('fs');
let content = fs.readFileSync('agent-routes.ts', 'utf8');

// Replace all getByAgentId(agentId) with getByAgentId(agentId, userId)
content = content.replace(/const soul = await repo\.getByAgentId\(agentId\);/g, 'const soul = await repo.getByAgentId(agentId, userId);');

// Add userId declaration in GET routes
content = content.replace(
  /soulAgentRoutes\.get\('/:agentId\/(\w+)', async \(c\) => \{\s+try \{/g,
  "soulAgentRoutes.get('/:agentId/$1', async (c) => {\n    try {\n    const userId = getUserId(c);"
);

// Add userId declaration in POST routes
content = content.replace(
  /soulAgentRoutes\.post\('/:agentId\/(\w+)', async \(c\) => \{\s+try \{/g,
  "soulAgentRoutes.post('/:agentId/$1', async (c) => {\n    try {\n    const userId = getUserId(c);"
);

// Add userId declaration in PUT routes
content = content.replace(
  /soulAgentRoutes\.put\('/:agentId\/(\w+)', async \(c\) => \{\s+try \{/g,
  "soulAgentRoutes.put('/:agentId/$1', async (c) => {\n    try {\n    const userId = getUserId(c);"
);

fs.writeFileSync('agent-routes.ts', content);
console.log('Done. Modified:', content.includes('const userId = getUserId(c);'));