#!/usr/bin/env node
// guard-secrets — MediaOS guardrail (Bất biến #3: không secret plaintext)
// PreToolUse hook cho Write/Edit/MultiEdit.
// BLOCK (exit 2) khi phát hiện secret literal trong file mã nguồn.
// Fail-open khi lỗi parse để không chặn nhầm workflow của user.

import process from 'node:process';

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|sql|json|ya?ml|env)$/i;
// Cho phép file ví dụ / mẫu / test fixture
const ALLOW = /(\.example$|\.sample$|\.template$|(^|[\\/])(__tests__|test|tests|fixtures|mocks)[\\/])/i;

// Mẫu secret độ-tin-cậy-cao
const PATTERNS = [
  { re: /AKIA[0-9A-Z]{16}/, msg: 'AWS Access Key ID' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, msg: 'Private key block' },
  { re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/, msg: 'Stripe-style secret key' },
  { re: /\bghp_[A-Za-z0-9]{36,}\b/, msg: 'GitHub token' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, msg: 'Slack token' },
  // gán mật khẩu/secret/khóa với giá trị literal (>=6 ký tự, không phải biến/placeholder)
  {
    re: /\b(?:password|passwd|secret|api[_-]?key|encryption[_-]?key|dek|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["'`](?!.*(?:process\.env|\$\{|<|placeholder|changeme|xxx|example))[^"'`\n]{6,}["'`]/i,
    msg: 'Hardcoded secret literal (password/secret/api_key/dek/...)',
  },
];

async function readStdin() {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function collectAddedText(input) {
  const ti = input?.tool_input ?? {};
  const parts = [];
  if (typeof ti.content === 'string') parts.push(ti.content);
  if (typeof ti.new_string === 'string') parts.push(ti.new_string);
  if (Array.isArray(ti.edits)) for (const e of ti.edits) if (typeof e?.new_string === 'string') parts.push(e.new_string);
  return parts.join('\n');
}

try {
  const input = JSON.parse((await readStdin()) || '{}');
  const file = input?.tool_input?.file_path ?? '';
  if (!SOURCE_EXT.test(file) || ALLOW.test(file)) process.exit(0);

  const text = collectAddedText(input);
  if (!text) process.exit(0);

  const hits = PATTERNS.filter((p) => p.re.test(text)).map((p) => p.msg);
  if (hits.length) {
    process.stderr.write(
      `\n⛔ guard-secrets BLOCK: phát hiện secret trong ${file}\n` +
        hits.map((h) => `   • ${h}`).join('\n') +
        `\n\nBẤT BIẾN #3 (CLAUDE.md): không secret plaintext.\n` +
        `→ Dùng biến môi trường / KMS / Vault. Mật khẩu kênh: envelope encryption phía app.\n` +
        `Nếu là giá trị mẫu, đặt trong file *.example hoặc dùng placeholder (changeme / process.env.X).\n`
    );
    process.exit(2); // block, feedback tới Claude
  }
  process.exit(0);
} catch {
  process.exit(0); // fail-open
}
