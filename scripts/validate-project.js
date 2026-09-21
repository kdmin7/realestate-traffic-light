import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');

const requiredPaths = [
  'index.html',
  'README.md',
  'package.json',
  '.agents/mcp_config.json',
  'MCP/realestate-server.js',
  'MCP/daily_pipeline_sync.js',
  'MCP/update_raw_incremental.js',
];

const missing = requiredPaths.filter((relativePath) => !fs.existsSync(path.join(rootDir, relativePath)));
if (missing.length > 0) {
  console.error('Missing required files:');
  for (const item of missing) {
    console.error(` - ${item}`);
  }
  process.exit(1);
}

const jsFiles = [
  'MCP/realestate-server.js',
  'MCP/daily_pipeline_sync.js',
  'MCP/update_raw_incremental.js',
];

const errors = [];
for (const relativePath of jsFiles) {
  const absolutePath = path.join(rootDir, relativePath);
  const result = spawnSync(process.execPath, ['--check', absolutePath], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    errors.push(`${relativePath}: ${result.stderr || result.stdout || 'syntax check failed'}`);
  }
}

const htmlPath = path.join(rootDir, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
if (!html.includes('부동산 신호등') || !html.includes('<title>')) {
  errors.push('index.html is missing the expected dashboard title/content markers');
}

if (errors.length > 0) {
  console.error('Project validation failed:\n');
  for (const error of errors) {
    console.error(`- ${error.trim()}`);
  }
  process.exit(1);
}

console.log('Project validation passed.');
console.log('Checked files:');
for (const relativePath of requiredPaths) {
  console.log(` - ${relativePath}`);
}
