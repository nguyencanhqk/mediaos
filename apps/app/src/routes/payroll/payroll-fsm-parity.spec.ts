/**
 * S13-PAYROLL-FE-1 — **fs-pin FSM FE↔BE**: bảng chuyển tiếp copy-literal trong `payroll-actions.ts`
 * phải khớp TỪNG Ô với `apps/api/src/payroll/payroll-fsm.ts` (nguồn sự thật).
 *
 * Vì sao đọc bằng `fs` chứ không import: `apps/app` KHÔNG import được `apps/api` (hai package rời).
 * Copy literal là bắt buộc, nên phải có cổng bắt drift — thiếu nó thì BE thêm/bớt một cạnh FSM và FE
 * lặng lẽ hiện sai bộ nút cho tới khi người dùng ăn 409. Khuôn `recruit-fsm-parity.spec.ts`.
 *
 * ⚠️ Regex neo vào HÌNH DẠNG của file BE (`{ action: "x", from: "A", to: "B" }` và khối
 * `IN_PLACE_ACTIONS`). Nếu BE đổi cách viết mà spec vẫn xanh vì regex khớp 0 dòng thì đó là xanh-RỖNG —
 * nên ca đầu tiên neo SỐ LƯỢNG đọc được, không chỉ so tập hợp.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { IN_PLACE_ACTIONS, PERIOD_TRANSITIONS } from "./payroll-actions";

const repoRoot = path.resolve(__dirname, "../../../../..");
const beSrc = fs.readFileSync(path.join(repoRoot, "apps/api/src/payroll/payroll-fsm.ts"), "utf8");

/** `{ action: "collect", from: "Draft", to: "CollectingData" },` — đọc TỪ FILE BE thật. */
const EDGE_RE = /\{\s*action:\s*"([a-z-]+)",\s*from:\s*"(\w+)",\s*to:\s*"(\w+)"\s*\}/g;

/** Khối `IN_PLACE_ACTIONS = { collect: "CollectingData", … }`. */
function readBeInPlace(): Record<string, string> {
  const block = beSrc.match(/IN_PLACE_ACTIONS[^=]*=\s*\{([\s\S]*?)\};/);
  const out: Record<string, string> = {};
  if (!block) return out;
  for (const m of block[1].matchAll(/"?([a-z-]+)"?:\s*"(\w+)"/g)) out[m[1]] = m[2];
  return out;
}

describe("PAYROLL FSM parity — FE mirror khớp payroll-fsm.ts của BE", () => {
  const beEdges = [...beSrc.matchAll(EDGE_RE)].map((m) => ({
    action: m[1],
    from: m[2],
    to: m[3],
  }));

  it("đọc được ĐÚNG 10 cạnh từ file BE (regex census không mù)", () => {
    expect(beEdges).toHaveLength(10);
  });

  it("tập cạnh FE === tập cạnh BE, từng ô", () => {
    const key = (e: { action: string; from: string; to: string }) =>
      `${e.action}:${e.from}->${e.to}`;
    expect([...PERIOD_TRANSITIONS].map(key).sort()).toEqual(beEdges.map(key).sort());
  });

  it("bảng hành động TẠI CHỖ khớp BE (3 hành động, đúng trạng thái)", () => {
    const be = readBeInPlace();
    expect(Object.keys(be)).toHaveLength(3);
    expect(be).toEqual({ ...IN_PLACE_ACTIONS });
  });

  it("`collect` tại chỗ ở CollectingData — chốt chống 'sửa cho khớp văn xuôi §13.1'", () => {
    expect(readBeInPlace().collect).toBe("CollectingData");
    expect(IN_PLACE_ACTIONS.collect).toBe("CollectingData");
  });

  it("BE vẫn chặn reopen khi đã sinh phiếu (assertReopenAllowed còn sống)", () => {
    // FE mirror điều kiện này trong `isReopenBlocked`; nếu BE gỡ hàm thì mirror thành cổng MỘT PHÍA.
    expect(beSrc).toContain("assertReopenAllowed");
    expect(beSrc).toContain("payslipsGeneratedAt");
  });
});
