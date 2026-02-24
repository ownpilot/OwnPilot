
const fs = require('fs');
const path = 'src/services/tool-executor.test.ts';
const content = fs.readFileSync('_tool_executor_test_content.txt', 'utf-8');
fs.writeFileSync(path, content, 'utf-8');
console.log('Written ' + content.split(String.fromCharCode(10)).length + ' lines to ' + path);
