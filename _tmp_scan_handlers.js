const fs = require('fs');
const s = fs.readFileSync('app.js', 'utf8');
const re = /\bon([a-z]+)=(["'`])([\s\S]*?)\2/gi;
const events = {};
const fns = {};
let n = 0;
let m;
while ((m = re.exec(s))) {
  n += 1;
  events[m[1]] = (events[m[1]] || 0) + 1;
  const code = m[3];
  const fn = code.match(/^[\s]*([A-Za-z_$][\w$.]*)\s*\(/);
  const key = fn ? fn[1] : '(complex)';
  fns[key] = (fns[key] || 0) + 1;
}
console.log('handlers', n);
console.log('events', JSON.stringify(events));
console.log(
  Object.entries(fns)
    .sort((a, b) => b[1] - a[1])
    .map((x) => x.join('\t'))
    .join('\n')
);
