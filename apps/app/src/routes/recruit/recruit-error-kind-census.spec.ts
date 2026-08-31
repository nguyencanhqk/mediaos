/**
 * S12-RECRUIT-QA-1 — fs-pin census error-kind FE↔BE (bàn giao từ FE-1 review gate 31/08).
 *
 * BE gắn `kind` vào details[0] qua `recruitDetails("<kind>", …)` rải trong `apps/api/src/recruit/`.
 * FE parse ở `recruit-errors.ts`: kind KHÔNG có trong `RECRUIT_ERROR_KINDS` rơi về `errors.generic`
 * — BE thêm kind mới mà FE quên mirror là DRIFT CÂM (user thấy "Có lỗi xảy ra" thay vì message đúng).
 * Spec này grep TOÀN BỘ nguồn BE và ép TẬP kind hai phía BẰNG NHAU hai chiều.
 *
 * Idiom `recruit-wiring.spec.ts`: strip comment trước khi quét (docblock nhắc kind không được tính),
 * census-size guard chống regex mù, so tập hai chiều.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { RECRUIT_ERROR_KINDS } from "./recruit-errors";

const repoRoot = path.resolve(__dirname, "../../../../..");
const beDir = path.join(repoRoot, "apps/api/src/recruit");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("S12-RECRUIT-QA-1 · fs-pin census error-kind FE↔BE", () => {
  it("tập kind BE (recruitDetails) ≡ RECRUIT_ERROR_KINDS của FE — hai chiều", () => {
    const files = fs.readdirSync(beDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));
    // Census guard: đủ bề mặt quét — module recruit có ≥8 file impl (controllers/services/errors/fsm…).
    expect(files.length, "bề mặt quét BE quá mỏng — đường dẫn/glob sai?").toBeGreaterThanOrEqual(8);

    const beKinds = new Set<string>();
    for (const f of files) {
      const src = stripComments(fs.readFileSync(path.join(beDir, f), "utf8"));
      // \s* nuốt cả newline — Prettier wrap `recruitDetails(\n  "kind"` vẫn match.
      for (const m of src.matchAll(/recruitDetails\(\s*"([a-z0-9-]+)"/g)) {
        beKinds.add(m[1]);
      }
    }
    // Census guard: regex trượt (đổi tên helper…) phải ĐỎ, không được xanh rỗng.
    expect(
      beKinds.size,
      "regex recruitDetails không match được gì — helper đổi tên?",
    ).toBeGreaterThanOrEqual(20);

    const fe: readonly string[] = [...RECRUIT_ERROR_KINDS].sort();
    const be = [...beKinds].sort();
    const feOnly = fe.filter((k) => !beKinds.has(k));
    const beOnly = be.filter((k) => !fe.includes(k));
    // Hai chiều: kind BE mới chưa mirror ⇒ beOnly; kind FE mồ côi (BE đã gỡ) ⇒ feOnly.
    expect(
      beOnly,
      "BE có kind FE chưa biết — thêm vào RECRUIT_ERROR_KINDS + KIND_TO_I18N_KEY + vi/recruit.ts",
    ).toEqual([]);
    expect(
      feOnly,
      "FE khai kind BE không còn ném — gỡ khỏi RECRUIT_ERROR_KINDS (tránh mã chết)",
    ).toEqual([]);
  });
});
