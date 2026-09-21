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
    if (res.exceptionDetails) {
      throw new Error(JSON.stringify(res.exceptionDetails));
    }
    return res.result?.value;
  }
}

async function testAll() {
  const chromePath = findChrome();
  const tmpUserDataDir = path.join(process.cwd(), '.tmp_chrome_pages_' + Date.now());
  fs.mkdirSync(tmpUserDataDir, { recursive: true });

  const child = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--remote-debugging-pipe',
    `--user-data-dir=${tmpUserDataDir}`
  ], {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']
  });

  const cdp = new SimpleCdp(child);

  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    // List of key pages to verify link navigation
    const pagesToTest = [
      { name: '메인 신호등 대시보드', url: 'index.html' },
      { name: '나이스 학군 대시보드', url: 'schoolinfo_dashboard.html' },
      { name: '경찰청 범죄 대시보드', url: 'crime_board.html' },
      { name: 'MCP 도구 대시보드', url: 'MCP/dashboard.html' },
      { name: 'MCP 아키텍처 대시보드', url: 'mcp_architecture_dashboard.html' },
      { name: '송파구 심층 분석', url: 'data/songpa_analysis_dashboard.html' },
      { name: '서울 핵심 5개구 분석', url: 'data/seoul_top5_analysis_dashboard.html' },
      { name: '자치구 심층 분석 (마포구)', url: 'data/district_analysis_dashboard.html?region=마포구' },
      { name: 'Agent·MCP 데이터 흐름도', url: 'project_agent_mcp_dataflow.html' }
    ];

    console.log('=== Testing Page Navigations & Console Errors ===\n');

    for (const p of pagesToTest) {
      const fileUrl = pathToFileURL(path.resolve(p.url.split('?')[0])).href + (p.url.includes('?') ? '?' + p.url.split('?')[1] : '');
      const consoleErrors = [];
      
      // Navigate
      await cdp.send('Page.navigate', { url: fileUrl }, sessionId);
      await new Promise(r => setTimeout(r, 800));

      const title = await cdp.eval('document.title', sessionId);
      const readyState = await cdp.eval('document.readyState', sessionId);
      const bodyChildren = await cdp.eval('document.body ? document.body.children.length : 0', sessionId);

      console.log(`[PASS] ${p.name} (${p.url})`);
      console.log(`       Title: "${title.slice(0, 40)}..."`);
      console.log(`       State: ${readyState}, DOM Elements: ${bodyChildren > 0 ? 'Rendered OK' : 'EMPTY!'}`);
    }

    console.log('\n=== All Pages Navigated Successfully! ===');
    await cdp.send('Target.closeTarget', { targetId });
  } finally {
    child.kill();
    try { fs.rmSync(tmpUserDataDir, { recursive: true, force: true }); } catch (e) {}
  }
}

testAll().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
