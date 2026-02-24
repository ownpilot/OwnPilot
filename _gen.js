const fs = require('fs');
const Q = String.fromCharCode(39);
function q(s) {
  return Q + s + Q;
}
const p = process.argv[2];
const c = fs.readFileSync(process.argv[3], 'utf8').replace(/QQQQ/g, Q);
fs.writeFileSync(p, c);
console.log('Written ' + c.length + ' chars to ' + p);
