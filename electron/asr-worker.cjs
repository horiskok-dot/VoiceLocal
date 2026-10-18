const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

function abortError() { return new DOMException('Задача отменена', 'AbortError'); }

class AsrWorker {
  constructor(executable, modelDirectory) {
    this.executable = executable;
    this.modelDirectory = modelDirectory;
    this.child = null;
    this.starting = null;
    this.pending = new Map();
  }

  start() {
    if (this.child && !this.starting) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const child = spawn(this.executable, [this.modelDirectory], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
      });
      this.child = child;
      let buffer = '', errors = '', ready = false;
      const timeout = setTimeout(() => child.kill(), 30000);
      const fail = error => {
        clearTimeout(timeout);
        if (!ready) reject(error);
        if (this.child !== child) return;
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
        this.child = null; this.starting = null;
      };
      child.stderr.on('data', data => { errors = (errors + String(data)).slice(-1500); });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', data => {
        if (this.child !== child) return;
        buffer += data;
        for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          if (message.ready === true && !ready) {
            ready = true; clearTimeout(timeout); this.starting = null; resolve();
          } else if (message.ready === false && !ready) {
            child.kill(); fail(new Error(message.error || 'Голосовая модель не загрузилась'));
          } else if (message.id && this.pending.has(message.id)) {
            const request = this.pending.get(message.id);
            this.pending.delete(message.id);
            message.error ? request.reject(new Error(message.error)) : request.resolve(String(message.text || ''));
          }
        }
      });
      child.once('error', fail);
      child.once('exit', code => fail(new Error(`Голосовая модель остановилась (${code}): ${errors}`)));
    });
    return this.starting;
  }

  async transcribe(file, signal) {
    if (signal?.aborted) throw signal.reason || abortError();
    const starting = this.start();
    if (signal) {
      const abort = () => this.stop();
      signal.addEventListener('abort', abort, { once: true });
      try { await starting; }
      catch (error) { throw signal.aborted ? signal.reason || abortError() : error; }
      finally { signal.removeEventListener('abort', abort); }
    } else await starting;
    if (signal?.aborted) throw signal.reason || abortError();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      let ended = false;
      const finish = (error, value) => {
        if (ended) return;
        ended = true; clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        this.pending.delete(id);
        error ? reject(error) : resolve(value);
      };
      const abort = () => { finish(signal.reason || abortError()); this.stop(); };
      const timeout = setTimeout(() => { finish(new Error('Распознавание речи превысило 5 минут')); this.stop(); }, 300000);
      this.pending.set(id, { resolve: value => finish(null, value), reject: error => finish(error) });
      signal?.addEventListener('abort', abort, { once: true });
      this.child.stdin.write(JSON.stringify({ id, path: file }) + '\n', 'utf8', error => {
        if (error) finish(error);
      });
    });
  }

  stop() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.starting = null;
    for (const request of this.pending.values()) request.reject(abortError());
    this.pending.clear();
    child.kill();
  }
}

module.exports = { AsrWorker };
