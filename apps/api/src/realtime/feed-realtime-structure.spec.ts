import { existsSync, readFileSync } from "node:fs";
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

/** Mọi module specifier của các câu `import … from "…"` (kể cả `import type`). */
const importsOf = (code: string): string[] =>
  [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] as string);

const LEAF_READER = "social-group-rooms.reader.ts";
const LEAF_MODULE = "social-group-rooms.module.ts";

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
