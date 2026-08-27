#!/usr/bin/env node
const path = require('path');
const db = require(path.join(__dirname, '..', 'config', 'database'));
const { collectStorageReport } = require('../utils/storageReport');

const report = collectStorageReport(db);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
