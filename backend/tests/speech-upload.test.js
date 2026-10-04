const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { createSpeechConcurrencyGuard } = require('../utils/speechConcurrency');

const speech = fs.readFileSync(path.join(__dirname, '../routes/speech.js'), 'utf8');

function mockRes() {
  const res = new EventEmitter();
  res.statusCode = null;
  res.body = null;
  res.status = function status(code) {
    this.statusCode = code;
    return this;
  };
  res.json = function json(body) {
    this.body = body;
    return this;
  };
  return res;
}

test('speech transcribe uses disk storage, not memory buffers', () => {
  assert.match(speech, /multer\.diskStorage/);
  assert.match(speech, /teampulse-speech/);
  assert.doesNotMatch(speech, /memoryStorage/);
  assert.doesNotMatch(speech, /req\.file\.buffer/);
  assert.match(speech, /speechConcurrencyGuard/);
});

test('speech concurrency guard admits up to max then returns 429 speech_busy', () => {
  const guard = createSpeechConcurrencyGuard(2);
  const first = mockRes();
  const second = mockRes();
  let admitted = 0;
  guard({}, first, () => { admitted += 1; });
  guard({}, second, () => { admitted += 1; });
  assert.equal(admitted, 2);
  assert.equal(guard._active(), 2);

  const rejected = mockRes();
  let extra = false;
  guard({}, rejected, () => { extra = true; });
  assert.equal(extra, false);
  assert.equal(rejected.statusCode, 429);
  assert.equal(rejected.body.error, 'speech_busy');

  first.emit('finish');
  assert.equal(guard._active(), 1);

  const third = mockRes();
  guard({}, third, () => { admitted += 1; });
  assert.equal(admitted, 3);

  second.emit('close');
  third.emit('finish');
  assert.equal(guard._active(), 0);
});

test('speech concurrency guard does not double-release the same response', () => {
  const guard = createSpeechConcurrencyGuard(1);
  const res = mockRes();
  guard({}, res, () => {});
  res.emit('finish');
  res.emit('close');
  assert.equal(guard._active(), 0);

  const next = mockRes();
  let admitted = false;
  guard({}, next, () => { admitted = true; });
  assert.equal(admitted, true);
  next.emit('finish');
});
