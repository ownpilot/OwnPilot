const fs = require("fs");
const content = fs.readFileSync("src/services/tool-executor.test.ts", "utf-8");
console.log("Read " + content.length + " chars");
