/**
 * S14-SEC-CAPWILDCARD-1 (plan §9.1c) — cổng ratchet TĨNH: không spec nào của `apps/api` được khẳng định một
 * khoá capability CHỨA `*` là `true`.
 *
 * Hợp đồng `DECISIONS-13` §4: khoá `capabilities` KHÔNG BAO GIỜ chứa `*`. Trước WO này, 9 ca ở
 * `auth-me-capabilities.int.spec.ts` GHIM `caps["*:*"] === true` — tức một bộ test xanh đang canh giữ đúng
 * cái lỗ (memory `tests-can-pin-a-hole-open`). Cổng này chặn khuôn đó quay lại.
 *
 * Phạm vi: chỉ KHẲNG ĐỊNH `expect(<x>[<khoá có *>]).toBe(true)` (literal hoặc hằng tên `WILDCARD…`).
 * Map caps làm ĐẦU VÀO (vd spec FE/`hasAnyCapability` nạp `{"*:*": true}` để canh nhánh fallback phòng
 * thủ) KHÔNG bị chặn — đó là phòng thủ theo tầng, không phải khẳng định đầu ra BE.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const API_ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["src", "test"].map((d) => join(API_ROOT, d));
const SPEC_FILE_RE = /\.(spec|int-spec|unit-spec|e2e-spec)\.ts$|\.int\.spec\.ts$/;

/** `[ "…*…" ])` hoặc `[WILDCARD…])` (có thể kèm thông điệp) rồi `.toBe(true)`. */
const STAR_KEY_TRUE_RE =
  /\[\s*(?:["'`][^"'`\n]*\*[^"'`\n]*["'`]|WILDCARD[A-Z_]*)\s*\]\s*(?:,[^)\n]*)?\)\s*\.toBe\(\s*true\s*\)/;

function specFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...specFiles(full));
    else if (SPEC_FILE_RE.test(name)) out.push(full);
  }
  return out;
}

describe("S14-SEC-CAPWILDCARD-1 §9.1c — cấm ghim khoá capability chứa '*' là true", () => {
  it("regex bắt đúng khuôn cũ (tự kiểm cổng — chống xanh-rỗng)", () => {
    expect(STAR_KEY_TRUE_RE.test(`expect(caps[WILDCARD_CAP_KEY]).toBe(true);`)).toBe(true);
    expect(STAR_KEY_TRUE_RE.test(`expect(caps["*:*"]).toBe(true);`)).toBe(true);
    expect(STAR_KEY_TRUE_RE.test(`expect(caps["view:*"], "msg").toBe(true);`)).toBe(true);
    expect(STAR_KEY_TRUE_RE.test(`expect(caps["view:user"]).toBe(true);`)).toBe(false);
    expect(STAR_KEY_TRUE_RE.test(`expect("*:*" in caps).toBe(false);`)).toBe(false);
  });

  it("0 spec trong apps/api khẳng định khoá chứa '*' là true", () => {
    // Loại chính tệp này: ca tự kiểm ở trên chứa đúng khuôn bị cấm dưới dạng chuỗi mẫu.
    const files = SCAN_DIRS.flatMap(specFiles).filter((f) => f !== __filename);
    expect(files.length, "phải quét được spec (chống xanh-rỗng)").toBeGreaterThan(100);

    const hits: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (STAR_KEY_TRUE_RE.test(line)) hits.push(`${relative(API_ROOT, file)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
