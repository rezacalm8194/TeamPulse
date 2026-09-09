const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fonts = ['Vazirmatn-Regular.woff2', 'Vazirmatn-SemiBold.woff2'];

test('all shells, blog pages, and HTML generators use local fonts only', () => {
  const files = ['app.html', 'index.html', 'privacy.html', 'app.js', 'scripts/generate-blog-articles.js',
    ...fs.readdirSync(path.join(root, 'blog')).filter(f => f.endsWith('.html')).map(f => `blog/${f}`)];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /fonts\.(googleapis|gstatic)\.com/, file);
    assert.doesNotMatch(source, /wght@300;400;500;600;700;800;900/, file);
    if (file === 'app.html') assert.match(source, /Vazirmatn-Regular\.woff2\?v=tp\d+/);
    else assert.match(source, /href="\/fonts\/vazirmatn\.css"/, file);
  }
});

test('shared stylesheet declares exactly two static swap faces backed by WOFF2 files', () => {
  const css = read('fonts/vazirmatn.css');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(m => m[1]);
  assert.equal(faces.length, 2);
  assert.deepEqual(faces.map(face => Number(face.match(/font-weight:\s*(\d+)/)[1])), [400, 600]);
  faces.forEach((face, i) => {
    assert.match(face, /font-family:\s*'Vazirmatn'/);
    assert.match(face, /font-style:\s*normal/);
    assert.match(face, /font-display:\s*swap/);
    assert.ok(face.includes(`/fonts/${fonts[i]}`));
    const data = fs.readFileSync(path.join(root, 'fonts', fonts[i]));
    assert.equal(data.toString('ascii', 0, 4), 'wOF2');
    assert.equal(data.readUInt32BE(8), data.length);
  });
  assert.deepEqual(fs.readdirSync(path.join(root, 'fonts')).filter(f => /\.(woff2?|ttf|otf)$/i.test(f)).sort(), fonts);
  assert.match(read('fonts/OFL.txt'), /SIL OPEN FONT LICENSE Version 1.1/);
});

test('critical shells preload both local fonts with anonymous CORS', () => {
  for (const file of ['index.html']) {
    const links = read(file).match(/<link\b[^>]*>/g);
    for (const font of fonts) {
      const preload = links.find(link => link.includes(`/fonts/${font}`));
      assert.ok(preload, `${file}: ${font}`);
      assert.match(preload, /rel="preload"/);
      assert.match(preload, /as="font"/);
      assert.match(preload, /type="font\/woff2"/);
      assert.match(preload, /\bcrossorigin(?:="anonymous")?\s*>/);
    }
  }
});

test('asset and service worker versions move together while blog caching stays skipped', () => {
  const app = read('app.js');
  const version = app.match(/const TP_ASSET_V = 'tp(\d+)'/)[1];
  assert.ok(app.includes(`/sw.js?v=team-pulse-static-v${version}`));
  assert.ok(read('sw.js').includes(`const CACHE = 'team-pulse-static-v${version}'`));
  const shellVersions = [...read('app.html').matchAll(/\?v=tp(\d+)/g)].map(m => m[1]);
  assert.ok(shellVersions.length > 0);
  assert.ok(shellVersions.every(v => v === version));
  assert.match(read('sw.js'), /url\.pathname\.startsWith\('\/blog'\)/);
});
