/**
 * S20-FE-COMPANYTZ-1 (US-X-92, tiêu chí 6) — RATCHET tĩnh: màn TASK · GOAL · ME không tự viết tên múi
 * giờ IANA.
 *
 * Mốc nghiệp vụ («hôm nay», «quý này», hạn 17:00) phải đi qua `companyTimeZone()` của web-core: khi
 * `/auth/me` trả `company.timezone`, chỉ thân một hàm đổi. Một tên múi giờ viết cứng ở màn nào đó sẽ
 * không đổi theo và lặng lẽ lệch với cờ quá hạn do server tính.
 *
 * Luật DƯƠNG, quét cả comment: mọi token dạng `Vùng/Thành_phố` thuộc các vùng IANA đều bị cấm trong mã
 * không phải spec. Comment cũng tính — tài liệu nêu tên múi giờ cụ thể là chỗ người sau chép lại thành
 * literal. File spec được miễn (ca test cần neo múi cụ thể).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname, "..");
const SCANNED_DIRS = ["routes/tasks", "routes/goals", "routes/me"] as const;

/** Vùng IANA (tzdb `zone1970.tab` + `Etc`). */
const IANA_ZONE_TOKEN =
  /\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Za-z0-9_+-]+/g;

const isSpecFile = (path: string): boolean => /\.spec\.tsx?$/.test(path);
const isSourceFile = (path: string): boolean => /\.tsx?$/.test(path);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (isSourceFile(full) && !isSpecFile(full)) {
      out.push(full);
    }
  }
  return out;
}

function findZoneLiterals(files: readonly string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(IANA_ZONE_TOKEN)) {
        hits.push(`${relative(SRC_ROOT, file)}:${index + 1} → ${match[0]}`);
      }
    });
  }
  return hits;
}

describe("company-tz-literal — TASK · GOAL · ME không viết cứng múi giờ", () => {
  it.each(SCANNED_DIRS)("%s có mã nguồn để quét (chống xanh rỗng)", (dir) => {
    expect(listSourceFiles(join(SRC_ROOT, dir)).length).toBeGreaterThan(0);
  });

  it("bộ nhận dạng bắt đúng tên múi giờ (tự kiểm)", () => {
    const sample = ["Asia", "Ho_Chi_Minh"].join("/");
    expect(`timeZone: "${sample}"`.match(IANA_ZONE_TOKEN)).toEqual([sample]);
    expect(["America", "Port-au-Prince"].join("/").match(IANA_ZONE_TOKEN)).toHaveLength(1);
    expect("src/routes/tasks/TaskListPage.tsx".match(IANA_ZONE_TOKEN)).toBeNull();
  });

  it("không có tên múi giờ IANA nào ngoài file spec — dùng `companyTimeZone()` của web-core", () => {
    const files = SCANNED_DIRS.flatMap((dir) => listSourceFiles(join(SRC_ROOT, dir)));
    expect(findZoneLiterals(files)).toEqual([]);
  });
});
