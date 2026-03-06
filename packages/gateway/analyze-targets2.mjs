import { readFileSync } from 'fs';

const cov = JSON.parse(readFileSync('coverage/coverage-final.json'));
const targets = [
  'personal-data.ts',
  'debug.ts',
  'health.ts',
  'settings.ts',
  'dashboard.ts',
  'plugins.ts',
  'tools.ts',
  'agent-service.ts',
  'workflow-service.ts',
  'background-agent-manager.ts',
];

for (const [path, data] of Object.entries(cov)) {
  const name = path.split(/[\\/]/).pop();
  if (!targets.includes(name)) continue;
  const stmts = data.s;
  const stmtMap = data.statementMap;
  const uncov = [
    ...new Set(
      Object.entries(stmts)
        .filter(([, v]) => v === 0)
        .map(([k]) => stmtMap[k].start.line)
    ),
  ].sort((a, b) => a - b);
  const pct = (
    (Object.values(stmts).filter((v) => v > 0).length / Object.keys(stmts).length) *
    100
  ).toFixed(1);
  console.log(name + ': ' + pct + '% uncovered: ' + uncov.join(','));
}
