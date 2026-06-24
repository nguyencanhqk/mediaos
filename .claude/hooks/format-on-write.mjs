#!/usr/bin/env node
// format-on-write — tự chạy Prettier sau khi Write/Edit/MultiEdit (PostToolUse).
// Chỉ format file mã nguồn/cấu hình; bỏ qua .claude/, node_modules/, dist/.
// Fail-open: lỗi prettier không chặn luồng (exit 0), chỉ ghi cảnh báo.

import process from "node:process";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

// LƯU Ý: KHÔNG format .md/.mdx. Prettier reflow prose + bỏ dấu <> trong link markdown,
// làm file đổi trên đĩa sau mỗi edit → snapshot read của Claude bị "cũ" → edit nối tiếp trượt
// ("Edit failed" hàng loạt khi sửa nhiều chỗ trong 1 doc). Docs do người soạn, không auto-format.
const FMT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|yml|yaml|html)$/i;
const SKIP_PATH = /([\\/]\.claude[\\/]|[\\/]node_modules[\\/]|[\\/]dist[\\/])/i;

async function readStdin() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

try {
  const input = JSON.parse((await readStdin()) || "{}");
  const file = input?.tool_input?.file_path ?? "";
  if (!file || !FMT_EXT.test(file) || SKIP_PATH.test(file)) process.exit(0);

  // Resolve prettier CỤC BỘ — KHÔNG dùng `npx` (npx re-resolve mỗi lần gọi + treo vô hạn
  // trên Windows / khi nhiều edit liên tiếp → chặn PostToolUse → ĐƠ CẢ VÒNG LẶP).
  let prettierBin;
  try {
    prettierBin = createRequire(import.meta.url).resolve("prettier/bin/prettier.cjs");
  } catch {
    process.exit(0); // không có prettier cục bộ → fail-open
  }

  const res = spawnSync(process.execPath, [prettierBin, "--write", file], {
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
    timeout: 15000, // CỨNG: treo >15s → SIGKILL + fail-open, KHÔNG BAO GIỜ chặn vòng lặp
    killSignal: "SIGKILL",
  });
  if (res.error && res.error.code === "ETIMEDOUT") {
    process.stderr.write(`⚠️  format-on-write: prettier timeout >15s, bỏ qua ${file}\n`);
  } else if (res.status !== 0 && res.stderr) {
    process.stderr.write(`⚠️  format-on-write: prettier bỏ qua ${file}\n`);
  }
  process.exit(0);
} catch {
  process.exit(0); // fail-open
}
