import { readFileSync } from 'fs';

const cov = JSON.parse(readFileSync('coverage/coverage-final.json'));
const targets = ['plans.ts', 'tools.ts', 'triggers.ts', 'expenses.ts', 'personal-data.ts'];

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
