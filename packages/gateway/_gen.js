const fs = require("fs");
const Q = String.fromCharCode(39);
let content = fs.readFileSync("src/services/tool-executor.test.ts", "utf-8");
console.log("Read", content.split("
").length, "lines");
