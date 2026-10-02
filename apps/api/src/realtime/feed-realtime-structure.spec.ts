import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S16-SOCIAL-BE-2C — ràng buộc CẤU TRÚC của cạnh `realtime/** → social/**` (plan §4.3, §5 S1/S2, R6).
 *
 * Gateway `/ws` cần liệt kê nhóm của user lúc connect. Cạnh đó PHẢI đi qua đúng một MODULE LÁ
 * (`social-group-rooms.module` — 0 import, chỉ cấp `SocialGroupRoomsReader`), không bao giờ qua
 * `SocialModule`/service SOCIAL: `SocialModule` import `RealtimeEmitterModule`, và một cạnh
 * `Realtime → SocialModule` là thứ đã từng làm Nest sập lúc bootstrap (docblock `social.module.ts`).
 * Không ca runtime nào bắt được một import «tiện tay» thêm vào — chỉ quét nguồn mới gác nổi
 * (khuôn `chat-realtime-structure.spec.ts`).
 */

const SRC = join(__dirname, "..");
const REALTIME_DIR = join(SRC, "realtime");
const SOCIAL_DIR = join(SRC, "social");

/** Bỏ comment — luật nói về CODE, không về văn xuôi giải thích luật. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const read = (dir: string, file: string): string =>
  stripComments(readFileSync(join(dir, file), "utf8"));

/**
 * Mọi module specifier mà file KÉO VÀO: `import … from "…"` (kể cả `import type` / `export … from`),
 * `import "…"` (side-effect), `import("…")` (động) và `require("…")`.
 *
 * FULL gate lượt 1 (typescript-reviewer LOW): bản đầu chỉ khớp `from "…"` ⇒ một `await import(
 * "../social/social-groups.service")` «cho khỏi vòng DI» trong gateway dựng lại ĐÚNG cạnh Realtime→SOCIAL
 * mà module lá tồn tại để chặn, và S1 vẫn xanh. Ca «bộ quét» bên dưới ghim cả bốn dạng.
 */
const importsOf = (code: string): string[] =>
  [
    ...code.matchAll(
      /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm,
    ),
  ].map((m) => m[1] as string);

const LEAF_READER = "social-group-rooms.reader.ts";
const LEAF_MODULE = "social-group-rooms.module.ts";

describe("bộ quét import — ghim CẢ BỐN dạng kéo module vào (nếu không, S1/S2 mù)", () => {
  it("`from` · side-effect · `import()` động · `require()` đều được thấy", () => {
    const code = [
      `import { A } from "../social/a";`,
      `import type { B } from "../social/b";`,
      `import "../social/c";`,
      `const d = await import("../social/d");`,
      `const e = require("../social/e");`,
      `export { F } from "../social/f";`,
    ].join("\n");
    expect(importsOf(code).sort()).toEqual([
      "../social/a",
      "../social/b",
      "../social/c",
      "../social/d",
      "../social/e",
      "../social/f",
    ]);
  });
});

describe("S1 — realtime/** chỉ chạm social/** qua MODULE LÁ liệt kê nhóm", () => {
  it("gateway + RealtimeModule import từ `../social/` ĐÚNG reader/module lá (neo dương: có import thật)", () => {
    const gateway = importsOf(read(REALTIME_DIR, "realtime.gateway.ts"));
    const module = importsOf(read(REALTIME_DIR, "realtime.module.ts"));

    // Neo dương — không có nó, «chỉ import lá» xanh RỖNG khi chưa ai import gì.
    expect(gateway).toContain("../social/social-group-rooms.reader");
    expect(module).toContain("../social/social-group-rooms.module");

    for (const [file, specs] of [
      ["realtime.gateway.ts", gateway],
      ["realtime.module.ts", module],
    ] as const) {
      const social = specs.filter((s) => s.startsWith("../social/"));
      for (const s of social) {
        expect(s, `${file} import social/** ngoài module lá`).toMatch(
          /^\.\.\/social\/social-group-rooms\.(reader|module)$/,
        );
      }
    }
  });

  it("emitter vẫn là LÁ — KHÔNG import social/** (định tuyến suy từ payload, không tra nhóm)", () => {
    for (const file of ["realtime-emitter.service.ts", "realtime-emitter.module.ts"]) {
      const specs = importsOf(read(REALTIME_DIR, file));
      expect(specs.length, `${file}: positive control — có import thật`).toBeGreaterThan(0);
      expect(
        specs.filter((s) => s.startsWith("../social/")),
        `${file} import social/**`,
      ).toEqual([]);
    }
  });
});

describe("S2 — reader/module liệt kê nhóm THẬT SỰ là lá", () => {
  it("cả hai file tồn tại", () => {
    expect(existsSync(join(SOCIAL_DIR, LEAF_READER))).toBe(true);
    expect(existsSync(join(SOCIAL_DIR, LEAF_MODULE))).toBe(true);
  });

  it("reader chỉ import @nestjs/common · drizzle-orm · ../db/** · ./social-group-predicates (neo: CÓ vị từ dùng chung)", () => {
    const specs = importsOf(read(SOCIAL_DIR, LEAF_READER));
    // Một luật một bản: reader PHẢI dùng lại `activeGroupMemberExists`, không chép vị từ.
    expect(specs).toContain("./social-group-predicates");
    for (const s of specs) {
      expect(s, `${LEAF_READER} import ngoài allowlist`).toMatch(
        /^(@nestjs\/common|drizzle-orm|\.\.\/db\/[\w./-]+|\.\/social-group-predicates)$/,
      );
    }
  });

  it("module lá chỉ import @nestjs/common + reader, và KHÔNG khai `imports:` nào", () => {
    const code = read(SOCIAL_DIR, LEAF_MODULE);
    const specs = importsOf(code);
    expect(specs).toContain("./social-group-rooms.reader");
    for (const s of specs) {
      expect(s, `${LEAF_MODULE} import ngoài allowlist`).toMatch(
        /^(@nestjs\/common|\.\/social-group-rooms\.reader)$/,
      );
    }
    expect(code, "module lá không được import module nào").not.toMatch(/\bimports\s*:/);
  });

  it("không file lá nào import service/module SOCIAL hay gateway/module realtime", () => {
    for (const file of [LEAF_READER, LEAF_MODULE]) {
      const specs = importsOf(read(SOCIAL_DIR, file));
      expect(
        specs.filter(
          (s) =>
            /social-[\w-]+\.service$/.test(s) ||
            /social\.module$/.test(s) ||
            /realtime\.(gateway|module)$/.test(s),
        ),
        `${file} import ngược`,
      ).toEqual([]);
    }
  });
});

/** Mọi file .ts (bỏ spec) dưới `apps/api/src`, đường dẫn tương đối dùng `/`, đã bỏ comment. */
function allSources(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
        out.push({
          rel: p.slice(SRC.length + 1).replace(/\\/g, "/"),
          text: stripComments(readFileSync(p, "utf8")),
        });
      }
    }
  };
  walk(SRC);
  return out;
}

/**
 * S3 — FULL gate lượt 1 (silent-failure-hunter LOW): room nhóm bám membership CHỈ vì mọi lời ghi
 * `feed_group_members` hôm nay đi qua 5 route của `SocialGroupsService`, và cả 5 gọi
 * `syncFeedGroupMembership` (AC1–AC6 ghim TỪNG route). Không gì nối «ghi membership» với «đồng bộ room»
 * về CẤU TRÚC: một writer MỚI ở chỗ khác (khôi phục nhóm, dọn thành viên khi nghỉ việc, import hàng loạt)
 * biên dịch được, xanh mọi ca, và để socket của người bị gỡ ở lại room nhóm kín tới khi disconnect.
 * Hai tập dưới đây biến writer mới thành một quyết định NHÌN THẤY ĐƯỢC: mở rộng tập ⇒ phải trả lời «room
 * của người đó được đồng bộ ở đâu?».
 */
describe("S3 — lời GHI `feed_group_members` chỉ có MỘT cửa (đồng bộ room nằm ở cửa đó)", () => {
  const sources = allSources();
  const WRITE =
    /\.(?:insert|update|delete)\(\s*feedGroupMembers\b|\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?feed_group_members\b/i;

  it("file GHI bảng `feed_group_members` (drizzle hoặc SQL thô) = ĐÚNG repository thành viên nhóm", () => {
    const writers = sources.filter((s) => WRITE.test(s.text)).map((s) => s.rel);
    expect(writers).toEqual(["social/social-group-members.repository.ts"]);
  });

  it("file dùng `SocialGroupMembersRepository` = repository · service nhóm (5 route, mỗi route đồng bộ room) · module", () => {
    const users = sources
      .filter((s) => /\bSocialGroupMembersRepository\b/.test(s.text))
      .map((s) => s.rel)
      .sort();
    expect(users).toEqual([
      "social/social-group-members.repository.ts",
      "social/social-groups.service.ts",
      "social/social.module.ts",
    ]);
    // Neo dương: service — cửa DUY NHẤT — thật sự gọi đồng bộ room.
    const service = sources.find((s) => s.rel === "social/social-groups.service.ts");
    expect(service?.text).toContain("syncFeedGroupMembership(");
  });
});
