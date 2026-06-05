#!/usr/bin/env node
// anti-bandaid-guard — ép ROOT-CAUSE (AUTOMATION-PLAYBOOK §0/§4).
// PreToolUse hook cho Write/Edit/MultiEdit.
// BLOCK (exit 2): nuốt lỗi (catch rỗng) · @ts-ignore/@ts-nocheck · eslint-disable · test .only(
// WARN  (exit 0): test .skip( · TODO/FIXME mới (gợi ý truy gốc thay vì hoãn).
// Tự loại trừ .claude/ (tránh hook tự match pattern của chính nó) + file không phải mã nguồn.

import process from "node:process";

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const SKIP_PATH = /([\\/]\.claude[\\/]|[\\/]node_modules[\\/]|[\\/]dist[\\/])/i;
const TEST_PATH = /\.(spec|test|e2e-spec)\.[tj]sx?$/i;

async function readStdin() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function collectAddedText(input) {
  const ti = input?.tool_input ?? {};
  const parts = [];
  if (typeof ti.content === "string") parts.push(ti.content);
  if (typeof ti.new_string === "string") parts.push(ti.new_string);
  if (Array.isArray(ti.edits)) {
    for (const e of ti.edits) if (typeof e?.new_string === "string") parts.push(e.new_string);
  }
  return parts.join("\n");
}

// Dựng regex từ chuỗi để file nguồn của hook không chứa pattern "thô" có thể tự match nơi khác.
const TS_IGNORE = new RegExp("@ts-" + "(ignore|nocheck)");
const ESLINT_OFF = new RegExp("eslint-" + "disable");
const EMPTY_CATCH = /catch\s*\([^)]*\)\s*\{\s*\}/;
const TEST_ONLY = /\b(it|test|describe)\.only\s*\(/;
const TEST_SKIP = /\b(it|test|describe)\.skip\s*\(/;
const TODO_NEW = /\/\/\s*(TODO|FIXME|XXX)\b/i;

try {
  const input = JSON.parse((await readStdin()) || "{}");
  const file = input?.tool_input?.file_path ?? "";
  if (!CODE_EXT.test(file) || SKIP_PATH.test(file)) process.exit(0);

  const text = collectAddedText(input);
  if (!text) process.exit(0);

  const blocks = [];
  if (EMPTY_CATCH.test(text)) blocks.push("catch rỗng (nuốt lỗi) — xử lý hoặc ném lại, đừng nuốt.");
  if (TS_IGNORE.test(text)) blocks.push("@ts-ignore/@ts-nocheck — sửa kiểu cho đúng, đừng tắt type-check.");
  if (ESLINT_OFF.test(text)) blocks.push("eslint-disable — sửa gốc thay vì tắt linter.");
  if (TEST_PATH.test(file) && TEST_ONLY.test(text)) blocks.push(".only( trong test — sẽ ẩn các test khác.");

  if (blocks.length) {
    process.stderr.write(
      `\n⛔ anti-bandaid-guard BLOCK trong ${file}\n` +
        blocks.map((b) => `   • ${b}`).join("\n") +
        `\n\nPLAYBOOK §0: truy NGUYÊN NHÂN GỐC, cấm vá triệu chứng.\n`,
    );
    process.exit(2);
  }

  const warns = [];
  if (TEST_PATH.test(file) && TEST_SKIP.test(text)) warns.push(".skip( trong test — đảm bảo có lý do + vé theo dõi.");
  if (TODO_NEW.test(text)) warns.push("TODO/FIXME mới — vùng nhạy cảm nên truy gốc ngay, đừng hoãn.");
  if (warns.length) {
    process.stderr.write(`\n⚠️  anti-bandaid-guard WARN trong ${file}:\n` + warns.map((w) => `   • ${w}`).join("\n") + "\n");
  }
  process.exit(0);
} catch {
  process.exit(0); // fail-open
}
