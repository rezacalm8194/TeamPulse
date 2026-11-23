#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function listAssetFiles() {
  const fromDir = fs.readdirSync(ROOT).filter((name) => /^app(-[a-z]+)?\.js$/i.test(name));
  const extra = ['app.css', 'tp-inline-bind.js'].filter((name) => fs.existsSync(path.join(ROOT, name)));
  return [...new Set([...fromDir, ...extra])].sort();
}

function assetBytes(rel, abs) {
  const raw = fs.readFileSync(abs);
  if (rel !== 'app.js') return raw;
  const text = raw.toString('utf8');
  return Buffer.from(text.replace(/^const TP_ASSET_V = 'tp[a-f0-9]+';\r?\n/m, ''), 'utf8');
}

function contentVersion() {
  const files = listAssetFiles();
  const hash = crypto.createHash('sha256');
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    hash.update(rel);
    hash.update('\0');
    hash.update(assetBytes(rel, abs));
    hash.update('\0');
  }
  return `tp${hash.digest('hex').slice(0, 10)}`;
}

function readAssetV(source) {
  const m = source.match(/^const TP_ASSET_V = '(tp[a-f0-9]+)';/m);
  return m ? m[1] : '';
}

function updateAppJs(version) {
  const file = path.join(ROOT, 'app.js');
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace(/^const TP_ASSET_V = 'tp[a-f0-9]+';/m, `const TP_ASSET_V = '${version}';`);
  fs.writeFileSync(file, text);
}

function updateSw(version) {
  const file = path.join(ROOT, 'sw.js');
  const cache = `team-pulse-static-v${version.replace(/^tp/, '')}`;
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace(/^const CACHE = 'team-pulse-static-v[a-f0-9]+';/m, `const CACHE = '${cache}';`);
  fs.writeFileSync(file, text);
}

function updateAppHtml(version) {
  const file = path.join(ROOT, 'app.html');
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace(/(\/(?:app\.css|app\.js|tp-inline-bind\.js)\?v=)tp[a-f0-9]+/g, `$1${version}`);
  fs.writeFileSync(file, text);
}

function main() {
  const version = contentVersion();
  const prev = readAssetV(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
  updateAppJs(version);
  updateSw(version);
  updateAppHtml(version);
  if (prev === version) {
    console.log(`[bump-asset-version] unchanged ${version}`);
  } else {
    console.log(`[bump-asset-version] ${prev || '(none)'} -> ${version}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { contentVersion, listAssetFiles, ROOT };