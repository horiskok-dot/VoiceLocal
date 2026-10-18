const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AsrWorker } = require('../electron/asr-worker.cjs');

async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('ASR request was not sent');
}

test('an aborted transcription cannot break the next ASR worker', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-asr-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'mock-asr.cjs');
  fs.writeFileSync(script, `
    process.stdout.write(JSON.stringify({ ready: true }) + '\\n');
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const message = JSON.parse(line);
      setTimeout(() => process.stdout.write(JSON.stringify({ id: message.id, text: message.path }) + '\\n'), 20);
    });
  `);
  const worker = new AsrWorker(process.execPath, script);
  t.after(() => worker.stop());
  const controller = new AbortController();
  const first = worker.transcribe('first.wav', controller.signal);
  await until(() => worker.pending.size === 1);
  controller.abort();
  await assert.rejects(first, error => error.name === 'AbortError');
  assert.equal(await worker.transcribe('second.wav'), 'second.wav');
});

test('cancelling while the ASR model starts stops that request', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-asr-start-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'slow-asr.cjs');
  fs.writeFileSync(script, "setTimeout(() => process.stdout.write(JSON.stringify({ready:true}) + '\\n'), 3000); setInterval(() => {}, 1000);");
  const worker = new AsrWorker(process.execPath, script);
  t.after(() => worker.stop());
  const controller = new AbortController();
  const pending = worker.transcribe('first.wav', controller.signal);
  await until(() => !!worker.child);
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(worker.child, null);
});
