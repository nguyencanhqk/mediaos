#!/usr/bin/env node
// stop-gate — cổng "đừng tuyên bố thắng sớm" (Stop hook). Lấy ý từ harness kit Next.js:
// kết phiên KHÔNG nên xảy ra khi code vừa sửa còn đỏ lint/typecheck.
//
// Khác repo mẫu (greenfield, quét cả repo): MediaOS là repo SỐNG. Gate này CHỈ kiểm tra các workspace
// ĐÃ ĐỔI trong working tree (git porcelain) — cùng triết lý "chỉ check thứ bạn chạm" của typecheck-changed.mjs.
//
// MODE:
//   'block'    (mặc định) — workspace đã đổi mà đỏ ⇒ exit 2: chặn kết phiên, đẩy stderr về cho Claude sửa.
//   'advisory'            — chỉ in cảnh báo, vẫn cho kết phiên (exit 0).
//
// BASELINE_RED = workspace đang đỏ SẴN (nợ kỹ thuật chưa dọn). Dù MODE='block', các workspace này CHỈ
// cảnh báo (không chặn) — để không bẫy người đụng chúng vì lỗi họ không gây ra. Dọn xanh xong thì XOÁ khỏi
// đây ⇒ block thật. (Kiểm tra hiện trạng: `pnpm lint` / `pnpm typecheck`.)

const MODE = "block";
const BASELINE_RED = new Set();   // ◀ từ new Set(["@mediaos/api", "@mediaos/mobile"]) → rỗng


import process from "node:process";
import { spawnSync } from "node:child_process";

const WIN = process.platform === "win32";

async function readStdin() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

// apps/<x> | packages/<x>  →  @mediaos/<x>   (đúng quy ước đặt tên package trong monorepo)
function workspaceOf(path) {
  const m = path.match(/^(?:apps|packages)\/([^/]+)\//);
  return m ? `@mediaos/${m[1]}` : null;
}

// Chạy lint + typecheck cho 1 nhóm workspace (turbo bỏ qua task không định nghĩa, có cache). Trả {ok, out}.
function runTurbo(filters) {
  const args = ["exec", "turbo", "run", "lint", "typecheck"];
  for (const f of filters) args.push("--filter", f);
  const res = spawnSync("pnpm", args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: WIN,
  });
  return { ok: res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim() };
}

function tail(out) {
  return out.split("\n").slice(-20).join("\n");
}

try {
  const input = JSON.parse((await readStdin()) || "{}");
  if (input?.stop_hook_active) process.exit(0); // tránh lặp vô hạn

  const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8", shell: WIN });
  if (status.status !== 0) process.exit(0); // không phải repo git → fail-open

  const filters = new Set();
  for (const line of (status.stdout || "").split("\n")) {
    const path = line.slice(3).trim().replace(/^"|"$/g, "");
    if (!path || !/\.(ts|tsx|mjs|cjs|js|jsx)$/i.test(path)) continue;
    const ws = workspaceOf(path);
    if (ws) filters.add(ws);
  }
  if (filters.size === 0) process.exit(0); // không đổi code app/package → không gì để gate

  // Đường nhanh: chạy 1 lượt cho TẤT CẢ workspace đã đổi. Xanh → cho kết phiên ngay.
  const all = runTurbo([...filters]);
  if (all.ok) process.exit(0);

  // Có đỏ — quy trách: workspace KHÔNG nằm trong baseline-red có đỏ không?
  const blocking = [...filters].filter((f) => !BASELINE_RED.has(f));
  const blockingRed = blocking.length > 0 && !runTurbo(blocking).ok;

  if (MODE === "block" && blockingRed) {
    process.stderr.write(
      `\n⛔ stop-gate: lint/typecheck ĐỎ ở workspace vừa sửa (${blocking.join(", ")}). Chưa được kết phiên.\n` +
        `   Truy root-cause — KHÔNG @ts-ignore / eslint-disable / sửa test cho khớp bug.\n\n${tail(all.out)}\n`,
    );
    process.exit(2);
  }

  // Chỉ workspace baseline-red đỏ (hoặc MODE='advisory') → cảnh báo nhưng vẫn cho dừng.
  const reds = [...filters].filter((f) => BASELINE_RED.has(f));
  process.stderr.write(
    `\n⚠️  stop-gate (advisory): lint/typecheck đỏ ở workspace nợ-baseline (${reds.join(", ") || "?"}).\n` +
      `   Đây là nợ đã biết — dọn xanh rồi xoá khỏi BASELINE_RED trong stop-gate.mjs để chặn thật.\n`,
  );
  process.exit(0);
} catch {
  process.exit(0); // fail-open: harness lỗi không bao giờ được bẫy người dùng
}
