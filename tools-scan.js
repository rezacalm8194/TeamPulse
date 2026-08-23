const fs = require("fs");
const s = fs.readFileSync("app.js", "utf8");
const re = /\bon([a-z]+)=(["'`])([\s\S]*?)\2/gi;
let m;
const complex = [];
while ((m = re.exec(s))) {
  const code = m[3];
  const fn = code.match(/^[\s]*([A-Za-z_$][\w$.]*)\s*\(/);
  if (!fn) {
    const line = s.slice(0, m.index).split("\n").length;
    complex.push(line + ": " + code.slice(0, 180).replace(/\n/g, " "));
  }
}
console.log("complex count", complex.length);
console.log(complex.join("\n"));
