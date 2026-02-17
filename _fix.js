const fs = require('fs');
const file = 'd:/Codebox/PROJECTS/OwnPilot/packages/gateway/src/routes/personal-data.ts';
let c = fs.readFileSync(file, 'utf8');
const resources = ['Task', 'Bookmark', 'Note', 'Event', 'Contact'];
for (const r of resources) {
  const pat = new RegExp("apiError\(c, \{ code: ERROR_CODES\.NOT_FOUND, message: '"+r+" not found' \}, 404\)", 'g');
  const before = (c.match(pat) || []).length;
  const rep = "notFoundError(c, '"+r+"', c.req.param('id'))";
  c = c.replace(pat, rep);
  console.log(r + ': ' + before + ' replacements');
}
fs.writeFileSync(file, c);
console.log('Done');
