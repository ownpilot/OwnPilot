const fs = require('fs');
const p = process.argv[2];
const c = fs.readFileSync(p, 'utf-8');
fs.writeFileSync(process.argv[3], c);
console.log('copied');
