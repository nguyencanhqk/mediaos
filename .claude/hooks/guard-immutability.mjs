#!/usr/bin/env node
// guard-immutability — MediaOS guardrail (Bất biến #2: không hard-delete / append-only)
// PreToolUse hook cho Write/Edit/MultiEdit.
// BLOCK (exit 2) khi có DELETE/TRUNCATE/DROP trên bảng audit/snapshot bất biến.
// WARN (exit 0) khi thấy hard-delete chung trên bảng nghiệp vụ (gợi ý soft-delete).

import process from 'node:process';

// Bảng append-only / bất biến — KHÔNG được UPDATE/DELETE/TRUNCATE
const IMMUTABLE = [
  'audit_logs',
  'payslips',
  'payslip_items',
  'payroll_periods',
  'kpi_results',
  'profit_snapshots',
  'revenue_records',
  'cost_records',
  'cost_allocations',
  'bonus_penalties',
  'evaluation_results',
  'evaluation_scores',
  'defect_histories',
  'outbox_events',
];

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|sql)$/i;
const ALLOW = /(\.example$|(^|[\\/])(migrations|__tests__|test|tests|fixtures|mocks)[\\/])/i;
// Lưu ý: migrations được phép tạo bảng/policy; chỉ chặn xóa dữ liệu, không chặn DDL hợp lệ ở nơi khác.

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
  if (!text) process.exit(0);
  const lower = text.toLowerCase();

  // 1) BLOCK: DELETE/TRUNCATE/DROP TABLE trên bảng bất biến (SQL)
  const sqlHits = [];
  for (const t of IMMUTABLE) {
    const sql = new RegExp(`\\b(delete\\s+from|truncate(\\s+table)?|drop\\s+table(\\s+if\\s+exists)?)\\s+[\"\`']?${t}\\b`, 'i');
    // 2) BLOCK: Drizzle hard-delete: db.delete(<camelCase của bảng>)
    const camel = t.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const drz = new RegExp(`\\.delete\\(\\s*${camel}\\b`, 'i');
    if (sql.test(lower) || drz.test(text)) sqlHits.push(t);
  }
  if (sqlHits.length) {
    process.stderr.write(
      `\n⛔ guard-immutability BLOCK trong ${file}\n` +
        `   Cố xóa/mutate bảng append-only: ${[...new Set(sqlHits)].join(', ')}\n\n` +
        `BẤT BIẾN #2 (CLAUDE.md): bảng audit/snapshot là append-only.\n` +
        `→ Không DELETE/TRUNCATE/DROP. Sửa sai bằng bản ghi đối ứng (reversing entry) + lưu lý do.\n`
    );
    process.exit(2);
  }

  // 3) WARN: hard-delete chung (gợi ý soft-delete) — không chặn
  if (/\bdelete\s+from\s+[a-z_]+/i.test(lower) && !/deleted_at/i.test(lower)) {
    process.stderr.write(
      `\n⚠️  guard-immutability WARN trong ${file}: có 'DELETE FROM' nhưng không thấy 'deleted_at'.\n` +
        `   MediaOS dùng soft-delete cho dữ liệu quan trọng — kiểm tra lại có nên hard-delete không.\n`
    );
  }
  process.exit(0);
} catch {
  process.exit(0); // fail-open
}
