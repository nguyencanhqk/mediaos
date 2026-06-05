#!/usr/bin/env node
// guard-tenant — MediaOS guardrail (Bất biến #1: company_id ở mọi query)
// PreToolUse hook cho Write/Edit/MultiEdit. ADVISORY (luôn exit 0, không chặn).
// Nhắc khi một file truy vấn DB mà không thấy ngữ cảnh tenant (withTenant/company_id/set_config).
// Heuristic — nhắc nhở, không phải kiểm chứng. Tinh chỉnh theo cấu trúc repo thật.

import process from 'node:process';

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const ALLOW = /(\.example$|(^|[\\/])(__tests__|test|tests|fixtures|mocks|migrations)[\\/])/i;

// Dấu hiệu có truy vấn DB (Drizzle / SQL builder)
const QUERY = /\b(db|tx|trx)\.(select|insert|update|delete|execute|query)\s*\(|drizzle\(|\.from\(/i;
// Dấu hiệu đã có ngữ cảnh tenant
const TENANT = /withTenant|company_id|companyId|set_config\(\s*['"`]app\.current_company_id/i;

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
  if (!CODE_EXT.test(file) || ALLOW.test(file)) process.exit(0);

  const text = collectAddedText(input);
  if (text && QUERY.test(text) && !TENANT.test(text)) {
    process.stderr.write(
      `\n⚠️  guard-tenant WARN trong ${file}: có truy vấn DB nhưng không thấy ngữ cảnh tenant.\n` +
        `   BẤT BIẾN #1 (CLAUDE.md): mọi truy vấn nghiệp vụ phải qua withTenant() / RLS.\n` +
        `   → Đảm bảo chạy trong withTenant(companyId, ...) hoặc transaction đã set 'app.current_company_id'.\n`
    );
  }
  process.exit(0); // advisory: không bao giờ chặn
} catch {
  process.exit(0);
}
