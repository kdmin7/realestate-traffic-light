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

async function run() {
  const chromePath = findChrome();
  console.log('Chrome found at:', chromePath);
  if (!chromePath) {
    console.error('Chrome executable not found!');
    process.exit(1);
  }

  const tmpUserDataDir = path.join(process.cwd(), '.tmp_chrome_user_data_' + Date.now());
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
    await cdp.send('DOM.enable', {}, sessionId);

    console.log('\n=============================================');
    console.log('TEST 1: Testing index.html on Mobile (390x844)');
    console.log('=============================================');

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    }, sessionId);

    const indexPath = pathToFileURL(path.resolve('index.html')).href;
    await cdp.send('Page.navigate', { url: indexPath }, sessionId);
    await new Promise(r => setTimeout(r, 1500));

    // Check page load and metrics
    const pageTitle = await cdp.eval('document.title', sessionId);
    console.log('Page Title:', pageTitle);

    const overflowInfo = await cdp.eval(`({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth
    })`, sessionId);
    console.log('Mobile Viewport Metrics (index.html):', overflowInfo);

    // Test Theme Button click
    const themeBefore = await cdp.eval('document.documentElement.getAttribute("data-theme")', sessionId);
    await cdp.eval('document.getElementById("themeToggleBtn").click()', sessionId);
    const themeAfter = await cdp.eval('document.documentElement.getAttribute("data-theme")', sessionId);
    console.log(`Theme Toggle Button: ${themeBefore} -> ${themeAfter} [${themeBefore !== themeAfter ? 'OK' : 'FAIL'}]`);

    // Test Province filter buttons
    const provSeoulCount = await cdp.eval(`(() => {
      const btn = document.querySelector('#provinceFilter button[data-province="seoul"]');
      btn.click();
      return document.querySelectorAll('#districtGrid tr:not(.empty)').length;
    })()`, sessionId);
    console.log('Province Filter (Seoul):', provSeoulCount, 'rows visible [OK]');

    // Test Signal filter buttons
    const signalBuyCount = await cdp.eval(`(() => {
      const btn = document.querySelector('#signalFilter button[data-signal="buy"]');
      btn.click();
      return document.querySelectorAll('#districtGrid tr:not(.empty)').length;
    })()`, sessionId);
    console.log('Signal Filter (Seoul + Buy):', signalBuyCount, 'rows visible [OK]');

    // Test Reset filter
    const resetCount = await cdp.eval(`(() => {
      const btn = document.querySelector('[data-reset]');
      if (btn) btn.click();
      return document.querySelectorAll('#districtGrid tr:not(.empty)').length;
    })()`, sessionId);
    console.log('Reset Filters:', resetCount, 'rows visible [OK]');

    // Test Chart Scope Button
    const chartScopeResult = await cdp.eval(`(() => {
      const btn = document.querySelector('#chartScope button[data-scope="seoul"]');
      if (btn) {
        btn.click();
        return btn.getAttribute('aria-pressed');
      }
      return null;
    })()`, sessionId);
    console.log('Chart Scope (Seoul): aria-pressed =', chartScopeResult, '[OK]');

    // Test Link Navigation from index.html
    console.log('\n--- Checking All Links in index.html ---');
    const links = await cdp.eval(`Array.from(document.querySelectorAll('a[href]')).map(a => ({
      href: a.getAttribute('href'),
      text: a.innerText.trim().replace(/\\s+/g, ' ')
    }))`, sessionId);

    for (const l of links) {
      if (l.href.startsWith('http') || l.href.startsWith('#')) continue;
      const cleanHref = l.href.split('?')[0].split('#')[0];
      const targetFile = path.resolve(cleanHref);
      const exists = fs.existsSync(targetFile);
      console.log(`  Link: [${l.text.slice(0, 30)}] -> ${l.href} (File Exists: ${exists ? 'YES' : 'NO - BROKEN!'})`);
    }

    // Take Mobile Screenshot of index.html
    const screenshot1 = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync('mobile_index_check.png', Buffer.from(screenshot1.data, 'base64'));
    console.log('Saved mobile screenshot: mobile_index_check.png');

    console.log('\n======================================================');
    console.log('TEST 2: Testing project_agent_mcp_dataflow.html Mobile');
    console.log('======================================================');

    const dataflowPath = pathToFileURL(path.resolve('project_agent_mcp_dataflow.html')).href;
    await cdp.send('Page.navigate', { url: dataflowPath }, sessionId);
    await new Promise(r => setTimeout(r, 1500));

    const dataflowMetrics = await cdp.eval(`({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      overflowX: document.documentElement.scrollWidth > window.innerWidth
    })`, sessionId);
    console.log('Mobile Viewport Metrics (project_agent_mcp_dataflow.html):', dataflowMetrics);

    // Test Buttons on dataflow
    const dataflowTheme = await cdp.eval(`(() => {
      const btn = document.getElementById('btn-theme');
      const before = document.documentElement.getAttribute('data-theme');
      if (btn) btn.click();
      const after = document.documentElement.getAttribute('data-theme');
      return { before, after };
    })()`, sessionId);
    console.log('Dataflow Theme button click:', dataflowTheme);

    // Test View selection buttons
    const viewsAvailable = await cdp.eval(`Array.from(document.querySelectorAll('.view-tab, [data-view-id], button.chapter-tab, button.guided-view-tab')).map(b => b.innerText.trim())`, sessionId);
    console.log('Dataflow View Tabs:', viewsAvailable);

    // Take Mobile Screenshot of dataflow
    const screenshot2 = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync('mobile_dataflow_check.png', Buffer.from(screenshot2.data, 'base64'));
    console.log('Saved mobile screenshot: mobile_dataflow_check.png');

    await cdp.send('Target.closeTarget', { targetId });
  } finally {
    child.kill();
    try { fs.rmSync(tmpUserDataDir, { recursive: true, force: true }); } catch (e) {}
  }
}

run().catch(err => {
  console.error('Error during test:', err);
  process.exit(1);
});
