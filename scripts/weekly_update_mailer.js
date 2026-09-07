import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', 'MCP', '.env');

// .env 로드
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const TARGET_EMAIL = 'kdmin7@gmail.com';
const BOARD_PATH = path.join(__dirname, '..', 'data', 'seoul_25districts_traffic_light_board.html');

console.log(`[주간 자동화] 서울 25개 자치구 신호등 게시판 업데이트 및 발송 시작 -> ${TARGET_EMAIL}`);

// 1. 게시판 파일 존재 확인
if (!fs.existsSync(BOARD_PATH)) {
  console.error(`❌ 게시판 파일이 없습니다: ${BOARD_PATH}`);
  process.exit(1);
}

const htmlContent = fs.readFileSync(BOARD_PATH, 'utf8');

// 2. 이메일 발송 설정 (Nodemailer)
const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

if (!smtpUser || !smtpPass) {
  console.log(`⚠️ MCP/.env 파일에 SMTP_USER / SMTP_PASS (또는 EMAIL_USER / EMAIL_PASS) 설정이 없습니다.`);
  console.log(`💡 MCP/.env 파일에 SMTP_USER=your_email@gmail.com 및 SMTP_PASS=your_app_password 를 추가하시면 지정하신 ${TARGET_EMAIL} 주소로 이메일이 자동 전송됩니다.`);
  process.exit(0);
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
});

const EMAIL_TEMPLATE_PATH = path.join(__dirname, '..', 'data', 'seoul_25districts_mckinsey_email.html');
const BOARD_PATH_MCKINSEY = path.join(__dirname, '..', 'data', 'seoul_25districts_mckinsey_board.html');
const BOARD_PATH_AGENTS = path.join(__dirname, '..', 'data', 'agent_bulletin_board.html');

console.log(`[McKinsey Executive 2페이지 발송] 서울 25개 자치구 신호등 게시판 -> ${TARGET_EMAIL}`);

const emailBodyHtml = fs.readFileSync(EMAIL_TEMPLATE_PATH, 'utf8');

const mailOptions = {
  from: `"부동산 신호등 파이프라인" <${smtpUser}>`,
  to: TARGET_EMAIL,
  subject: `26년 33주차 서울 25구 부동산 매수 타이밍`,
  html: emailBodyHtml,
  attachments: [
    {
      filename: 'seoul_25districts_mckinsey_board.html',
      path: BOARD_PATH_MCKINSEY,
    },
    {
      filename: 'agent_bulletin_board.html',
      path: BOARD_PATH_AGENTS,
    },
  ],
};

transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.error(`❌ 이메일 전송 실패: ${error.message}`);
  } else {
    console.log(`✅ 이메일 전송 성공! Message ID: ${info.messageId}`);
  }
});
