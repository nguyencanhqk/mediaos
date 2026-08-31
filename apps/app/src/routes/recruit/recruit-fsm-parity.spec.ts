/**
 * S12-RECRUIT-QA-1 — fs-pin CHỐNG DRIFT 4 bảng FSM FE↔BE (bàn giao từ FE-1 review gate 31/08).
 *
 * `recruit-actions.ts` copy literal 4 bảng `*_EDGES` từ `apps/api/src/recruit/recruit-fsm.ts`
 * (apps/app KHÔNG import được apps/api). `recruit-actions.spec.ts` chỉ spot-check hàm — nếu ai đó
 * sửa bảng ĐỒNG THỜI hai phía lệch nhau (hoặc chỉ một phía) thì spec hàm vẫn xanh. Spec này đọc
 * NGUỒN cả hai file, trích đúng 4 object literal và so TỪNG Ô — drift bảng là ĐỎ ngay.
 *
 * Idiom theo `recruit-wiring.spec.ts`: repoRoot resolve 5 cấp; trích block bằng indexOf mốc
 * đầu/cuối (KHÔNG match 1 dòng — Prettier wrap làm assert 1-dòng xanh rỗng); census-size guard
 * TRƯỚC khi so (regex trượt tên ⇒ phải đỏ, không được xanh rỗng); so tập hai chiều.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { availableStageMoveTargets } from "./recruit-actions";

const repoRoot = path.resolve(__dirname, "../../../../..");

const feSrc = fs.readFileSync(path.join(__dirname, "recruit-actions.ts"), "utf8");
const beSrc = fs.readFileSync(path.join(repoRoot, "apps/api/src/recruit/recruit-fsm.ts"), "utf8");

/** Trích object literal `const <name>… = { … };` — mốc "= {" tránh dính type annotation Record<…[]>. */
function extractEdgesLiteral(src: string, constName: string, fileLabel: string): string {
  const declStart = src.indexOf(`const ${constName}`);
  expect(declStart, `${fileLabel}: không tìm thấy "const ${constName}"`).toBeGreaterThanOrEqual(0);
  const bodyStart = src.indexOf("= {", declStart);
  expect(bodyStart, `${fileLabel}: ${constName} không có "= {"`).toBeGreaterThan(declStart);
  const bodyEnd = src.indexOf("};", bodyStart);
  expect(bodyEnd, `${fileLabel}: ${constName} không có "};" đóng`).toBeGreaterThan(bodyStart);
  return src.slice(bodyStart, bodyEnd + 2);
}

/** Parse các hàng `Key: ["A", "B"]` (bỏ line-comment trước — BE có chú thích sau hàng Offer/Rejected). */
function parseEdges(literal: string, constName: string, fileLabel: string): Map<string, string[]> {
  const noComments = literal.replace(/\/\/[^\n]*/g, "");
  const rows = new Map<string, string[]>();
  const ROW_RE = /(\w+):\s*\[([^\]]*)\]/g;
  for (const m of noComments.matchAll(ROW_RE)) {
    const targets = [...m[2].matchAll(/"([A-Za-z]+)"/g)].map((t) => t[1]);
    rows.set(m[1], targets);
  }
  expect(
    rows.size,
    `${fileLabel}: regex hàng không match được gì trong ${constName}`,
  ).toBeGreaterThan(0);
  return rows;
}

const TABLES: ReadonlyArray<{ name: string; states: number }> = [
  { name: "STAGE_EDGES", states: 6 },
  { name: "JOB_EDGES", states: 4 },
  { name: "OFFER_EDGES", states: 5 },
  { name: "INTERVIEW_EDGES", states: 3 },
];

describe("S12-RECRUIT-QA-1 · fs-pin parity 4 bảng FSM FE↔BE", () => {
  for (const { name, states } of TABLES) {
    it(`${name}: FE mirror đúng TỪNG Ô bảng BE (${states} trạng thái)`, () => {
      const fe = parseEdges(extractEdgesLiteral(feSrc, name, "FE recruit-actions.ts"), name, "FE");
      const be = parseEdges(extractEdgesLiteral(beSrc, name, "BE recruit-fsm.ts"), name, "BE");

      // Census guard: đủ số trạng thái ở CẢ HAI phía — thiếu hàng là đỏ, không phải xanh rỗng.
      expect(fe.size, `FE ${name} phải có đúng ${states} trạng thái`).toBe(states);
      expect(be.size, `BE ${name} phải có đúng ${states} trạng thái`).toBe(states);

      // So tập trạng thái hai chiều rồi so đích từng hàng (giữ cả THỨ TỰ — mirror literal).
      expect([...fe.keys()].sort(), `${name}: tập trạng thái FE↔BE lệch`).toEqual(
        [...be.keys()].sort(),
      );
      for (const [state, beTargets] of be) {
        expect(fe.get(state), `${name}.${state}: đích FE↔BE lệch`).toEqual(beTargets);
      }
    });
  }

  it("Hired chỉ đạt qua convert: bảng BE giữ cạnh Offer→Hired, hàm FE lọc Hired khỏi MỌI đích move", () => {
    const be = parseEdges(
      extractEdgesLiteral(beSrc, "STAGE_EDGES", "BE recruit-fsm.ts"),
      "STAGE_EDGES",
      "BE",
    );
    // Cạnh convert-only phải TỒN TẠI trong bảng (BE assert nhánh via='move' chặn riêng, mã 014).
    expect(be.get("Offer"), "BE STAGE_EDGES.Offer phải liệt kê Hired (đường convert)").toContain(
      "Hired",
    );
    // FE không bao giờ chào đích Hired cho move-stage — bất kể from.
    for (const state of be.keys()) {
      expect(
        availableStageMoveTargets(state as never),
        `availableStageMoveTargets(${state}) không được chứa Hired`,
      ).not.toContain("Hired");
    }
  });
});
