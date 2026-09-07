import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
  });
}
const NEIS_KEY = env.NEIS_API_KEY || process.env.NEIS_API_KEY;

async function checkSchools() {
  const url = `https://open.neis.go.kr/hub/schoolInfo?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=1000&SCHUL_KND_SC_NM=${encodeURIComponent('고등학교')}&LCTN_SC_NM=${encodeURIComponent('서울특별시')}`;
  const res = await fetch(url);
  const data = await res.json();
  const rows = data?.schoolInfo?.[1]?.row || [];
  const mapo = rows.filter(r => (r.ORG_RDNMA || r.ORG_RDNZC || '').includes('마포구'));
  console.log('마포구 총 고교:', mapo.length);
  console.log(mapo.map(s => ({
    name: s.SCHUL_NM,
    kind: s.HS_GNRL_BUSNS_SC_NM || s.HS_PURPS_SMS_NM || '일반고',
    purpose: s.HS_PURPS_SMS_NM,
    addr: s.ORG_RDNMA
  })));
}
checkSchools();
