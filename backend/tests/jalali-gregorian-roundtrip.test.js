const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function extractFunction(source, name) {
  const match = new RegExp(`function ${name}\\(`).exec(source);
  assert.ok(match, `${name} missing`);
  let depth = 0;
  for (let i = source.indexOf('{', match.index); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error(`unclosed ${name}`);
}

const ctx = vm.createContext({});
vm.runInContext(extractFunction(appSource, 'div'), ctx);
vm.runInContext(extractFunction(appSource, 'mod'), ctx);
vm.runInContext(extractFunction(appSource, 'gregorianToJalali'), ctx);
vm.runInContext(extractFunction(appSource, 'jalaliToGregorian'), ctx);

test('jan 1 on leap gregorian years round-trip through jalali', () => {
  const leapStarts = [2016, 2020, 2024, 2028];
  for (const gy of leapStarts) {
    const jalali = ctx.gregorianToJalali(gy, 1, 1);
    const back = ctx.jalaliToGregorian(jalali[0], jalali[1], jalali[2]);
    assert.equal(back[0], gy, `ISO ${gy}-01-01 year`);
    assert.equal(back[1], 1);
    assert.equal(back[2], 1);
  }
});

test('every gregorian day 2015-2035 round-trips jalali', () => {
  for (let gy = 2015; gy <= 2035; gy++) {
    const monthDays = [31, gy % 4 === 0 && (gy % 100 !== 0 || gy % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let gm = 1; gm <= 12; gm++) {
      for (let gd = 1; gd <= monthDays[gm - 1]; gd++) {
        const jalali = ctx.gregorianToJalali(gy, gm, gd);
        const back = ctx.jalaliToGregorian(jalali[0], jalali[1], jalali[2]);
        assert.equal(back[0], gy, `${gy}-${gm}-${gd} year`);
        assert.equal(back[1], gm, `${gy}-${gm}-${gd} month`);
        assert.equal(back[2], gd, `${gy}-${gm}-${gd} day`);
      }
    }
  }
});