import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findChrome } from './.agents/skills/archify/bin/visual-check.mjs';

class SimpleCdp {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.buffer = '';
    this.pending = new Map();
    this.writePipe = child.stdio[3];
    this.readPipe = child.stdio[4];
    this.readPipe.setEncoding('utf8');
    this.readPipe.on('data', (chunk) => this.consume(chunk));
  }
  consume(chunk) {
    this.buffer += chunk;
    let boundary;
    while ((boundary = this.buffer.indexOf('\0')) >= 0) {
      const raw = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 1);
      if (!raw) continue;
      try {
        const message = JSON.parse(raw);
        if (message.id && this.pending.has(message.id)) {
          const { resolve, reject } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result || {});
        }
      } catch (e) {}
    }
  }
  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writePipe.write(`${JSON.stringify(message)}\0`);
    });
  }
  async eval(expression, sessionId) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    }, sessionId);
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result?.value;
  }
}

async function run() {
  const chromePath = findChrome();
  const tmpDir = path.join(process.cwd(), '.tmp_chrome_scroll_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  const child = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-pipe',
    `--user-data-dir=${tmpDir}`
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const cdp = new SimpleCdp(child);

  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);

    // 1. index.html scrolled to board
    const indexPath = pathToFileURL(path.resolve('index.html')).href;
    await cdp.send('Page.navigate', { url: indexPath }, sessionId);
    await new Promise(r => setTimeout(r, 1200));

    await cdp.eval('document.getElementById("board").scrollIntoView(true)', sessionId);
    await new Promise(r => setTimeout(r, 400));
    const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync('mobile_index_board.png', Buffer.from(shot1.data, 'base64'));
    console.log('Saved mobile_index_board.png');

    // 2. index.html scrolled to resources
    await cdp.eval('document.querySelector(".resources").scrollIntoView(true)', sessionId);
    await new Promise(r => setTimeout(r, 400));
    const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync('mobile_index_resources.png', Buffer.from(shot2.data, 'base64'));
    console.log('Saved mobile_index_resources.png');

    await cdp.send('Target.closeTarget', { targetId });
  } finally {
    child.kill();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
}
run();
