#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzipAsync = promisify(zlib.gzip);
const brotliAsync = promisify(zlib.brotliCompress);

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  'app.js',
  'app-extra.js',
  'app-sessions.js',
  'app-finance.js',
  'app-todos.js',
  'app.css',
  'tp-inline-bind.js',
  'sw.js',
  'xlsx.full.min.js',
];

const BROTLI_HIGH = {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
  },
};
const BROTLI_FAST = {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
  },
};
const BROTLI_BY_FILE = {
  'app.js': BROTLI_FAST,
  'xlsx.full.min.js': BROTLI_FAST,
};

function brotliOptsFor(relPath) {
  return BROTLI_BY_FILE[relPath] || BROTLI_HIGH;
}

function stripCompressedArtifacts() {
  for (const rel of TARGETS) {
    for (const ext of ['.br', '.gz']) {
      const out = path.join(ROOT, rel + ext);
      if (fs.existsSync(out)) fs.unlinkSync(out);
    }
  }
}

function needsRebuild(srcPath, outPath) {
  if (!fs.existsSync(outPath)) return true;
  const srcStat = fs.statSync(srcPath);
  const outStat = fs.statSync(outPath);
  return srcStat.mtimeMs > outStat.mtimeMs || srcStat.size === 0;
}

async function compressOne(relPath) {
  const srcPath = path.join(ROOT, relPath);
  if (!fs.existsSync(srcPath)) {
    console.warn('[precompress] skip missing', relPath);
    return null;
  }
  const raw = fs.readFileSync(srcPath);
  const gzPath = srcPath + '.gz';
  const brPath = srcPath + '.br';
  const result = { file: relPath, raw: raw.length };

  if (needsRebuild(srcPath, gzPath)) {
    const gz = await gzipAsync(raw, { level: 9 });
    fs.writeFileSync(gzPath, gz);
    result.gz = gz.length;
  } else {
    result.gz = fs.statSync(gzPath).size;
    result.gzCached = true;
  }

  if (needsRebuild(srcPath, brPath)) {
    const br = await brotliAsync(raw, brotliOptsFor(relPath));
    fs.writeFileSync(brPath, br);
    result.br = br.length;
  } else {
    result.br = fs.statSync(brPath).size;
    result.brCached = true;
  }

  return result;
}

async function main() {
  stripCompressedArtifacts();
  const rows = [];
  for (const file of TARGETS) {
    rows.push(await compressOne(file));
  }
  for (const row of rows.filter(Boolean)) {
    const pctBr = row.raw ? Math.round((100 * row.br) / row.raw) : 0;
    const pctGz = row.raw ? Math.round((100 * row.gz) / row.raw) : 0;
    console.log(
      `[precompress] ${row.file}: raw=${row.raw} gzip=${row.gz}(${pctGz}%)${row.gzCached ? '*' : ''} br=${row.br}(${pctBr}%)${row.brCached ? '*' : ''}`
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[precompress] failed', err);
    process.exit(1);
  });
}

module.exports = { TARGETS, compressOne, main, ROOT, stripCompressedArtifacts };
