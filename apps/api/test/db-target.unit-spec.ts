import { describe, expect, it } from "vitest";
import {
  assertNotProtectedDb,
  parseDbName,
  PROTECTED_DB_NAMES,
  resolveTestDbUrls,
  TEST_LANE_STAMP,
} from "./db-target";

/**
 * S6-SEC-DBFENCE-1 (KI-028) — RED-proof của hàng rào lớp 1, chạy trong `pnpm test` (KHÔNG cần DB).
 *
 * Mỗi `it` dưới đây tương ứng một vector ĐÃ THẬT SỰ xảy ra trên PROD (truy nguyên 72/74 company về
 * đúng spec sinh ra chúng, 2026-07-28):
 *   V1 — không LANE_DB ⇒ cũ: fallback `"mediaos"` (= PROD) · nay: rỗng ⇒ int-spec skip.
 *   V2 — có LANE_DB nhưng connection vẫn về `mediaos` (LANE_DB=mediaos, hoặc DATABASE_URL tường minh
 *        trong shell/.env thắng precedence) ⇒ nay: THROW.
 */
describe("S6-SEC-DBFENCE-1 · resolveTestDbUrls (hàng rào lớp 1)", () => {
  const base: NodeJS.ProcessEnv = {};

  describe("V1 — thiếu LANE_DB", () => {
    it("KHÔNG fallback về 'mediaos': trả 3 URL RỖNG (⇒ hasDb=false ⇒ int-spec SKIP)", () => {
      const urls = resolveTestDbUrls({ ...base });

      expect(urls).toEqual({
        DATABASE_URL: "",
        DATABASE_DIRECT_URL: "",
        DATABASE_WORKER_URL: "",
      });
      // Chính là biểu thức trong test/helpers/integration-db.ts.
      expect(Boolean(urls.DATABASE_DIRECT_URL && urls.DATABASE_URL)).toBe(false);
      // Chốt hồi quy tường minh cho chuỗi đã gây ra KI-028.
      expect(JSON.stringify(urls)).not.toContain("/mediaos");
    });

    it("chuỗi rỗng/khoảng trắng cũng coi như KHÔNG set", () => {
      expect(resolveTestDbUrls({ ...base, LANE_DB: "   " }).DATABASE_URL).toBe("");
    });
  });

  describe("V2 — DB đích là DB được bảo vệ ⇒ THROW", () => {
    it.each(PROTECTED_DB_NAMES)("LANE_DB='%s' (không CI) bị chặn", (name) => {
      expect(() => resolveTestDbUrls({ ...base, LANE_DB: name })).toThrow(/DATABASE ĐƯỢC BẢO VỆ/);
    });

    it("DATABASE_URL tường minh trỏ PROD bị chặn dù LANE_DB trỏ lane hợp lệ (precedence trap)", () => {
      expect(() =>
        resolveTestDbUrls({
          ...base,
          LANE_DB: "mediaos_lane1",
          DATABASE_URL: "postgres://mediaos_app:pw@localhost:5432/mediaos",
        }),
      ).toThrow(/DATABASE ĐƯỢC BẢO VỆ/);
    });

    it("DATABASE_DIRECT_URL (đường seed của mọi spec) trỏ PROD bị chặn", () => {
      expect(() =>
        resolveTestDbUrls({
          ...base,
          DATABASE_DIRECT_URL: "postgres://mediaos:pw@localhost:5432/mediaos",
        }),
      ).toThrow(/DATABASE ĐƯỢC BẢO VỆ/);
    });

    it("thông điệp lỗi chỉ ra ĐÚNG biến và ĐÚNG cách sửa", () => {
      let msg = "";
      try {
        resolveTestDbUrls({ ...base, LANE_DB: "mediaos" });
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toContain("LANE_DB → mediaos");
      expect(msg).toContain("scripts/lane-db-setup.sh");
    });

    it("dev-online `mediaos_dev` cũng nằm trong danh sách bảo vệ", () => {
      expect(PROTECTED_DB_NAMES).toContain("mediaos_dev");
    });
  });

  describe("đường HỢP LỆ vẫn thông", () => {
    it("LANE_DB=mediaos_<lane> ⇒ 3 URL trỏ đúng lane, đúng role tách quyền", () => {
      const urls = resolveTestDbUrls({ ...base, LANE_DB: "mediaos_check" });

      expect(parseDbName(urls.DATABASE_URL)).toBe("mediaos_check");
      expect(parseDbName(urls.DATABASE_DIRECT_URL)).toBe("mediaos_check");
      expect(parseDbName(urls.DATABASE_WORKER_URL)).toBe("mediaos_check");
      expect(urls.DATABASE_URL).toContain("//mediaos_app:");
      expect(urls.DATABASE_DIRECT_URL).toContain("//mediaos:");
      expect(urls.DATABASE_WORKER_URL).toContain("//mediaos_worker:");
    });

    it("PG_HOSTPORT được tôn trọng", () => {
      const urls = resolveTestDbUrls({ ...base, LANE_DB: "mediaos_x", PG_HOSTPORT: "db:5555" });
      expect(urls.DATABASE_URL).toContain("@db:5555/");
    });

    it("CI: DB ephemeral trùng tên `mediaos` được cho qua (lớp 2 con dấu vẫn canh)", () => {
      const urls = resolveTestDbUrls({
        ...base,
        CI: "true",
        LANE_DB: "mediaos",
        DATABASE_URL: "postgres://mediaos_app:ci@localhost:5432/mediaos",
        DATABASE_DIRECT_URL: "postgres://mediaos:ci@localhost:5432/mediaos",
        DATABASE_WORKER_URL: "postgres://mediaos_worker:ci@localhost:5432/mediaos",
      });
      expect(parseDbName(urls.DATABASE_URL)).toBe("mediaos");
    });

    it("URL tường minh THẮNG LANE_DB (giữ nguyên precedence CI đang dựa vào)", () => {
      const urls = resolveTestDbUrls({
        ...base,
        LANE_DB: "mediaos_lane1",
        DATABASE_URL: "postgres://u:p@localhost:5432/mediaos_explicit",
      });
      expect(parseDbName(urls.DATABASE_URL)).toBe("mediaos_explicit");
      expect(parseDbName(urls.DATABASE_DIRECT_URL)).toBe("mediaos_lane1");
    });

    it("TEST_DB_DENYLIST nới/thu được danh sách bảo vệ", () => {
      expect(() =>
        resolveTestDbUrls({ ...base, LANE_DB: "mediaos_x", TEST_DB_DENYLIST: "mediaos_x" }),
      ).toThrow(/DATABASE ĐƯỢC BẢO VỆ/);
      expect(() =>
        resolveTestDbUrls({ ...base, LANE_DB: "mediaos", TEST_DB_DENYLIST: "chi_cai_khac" }),
      ).not.toThrow();
    });
  });

  describe("parseDbName", () => {
    it.each([
      ["postgres://u:p@h:5432/mediaos", "mediaos"],
      ["postgres://u:p@h:5432/mediaos_lane", "mediaos_lane"],
      ["", null],
      ["khong-phai-url", null],
    ])("%s → %s", (url, expected) => {
      expect(parseDbName(url)).toBe(expected);
    });
  });

  describe("assertNotProtectedDb", () => {
    it("chốt trực tiếp trên bộ URL đã dựng sẵn", () => {
      const urls = {
        DATABASE_URL: "postgres://u:p@h:5432/mediaos_ok",
        DATABASE_DIRECT_URL: "postgres://u:p@h:5432/mediaos",
        DATABASE_WORKER_URL: "postgres://u:p@h:5432/mediaos_ok",
      };
      expect(() => assertNotProtectedDb(urls, {})).toThrow(/DATABASE_DIRECT_URL → mediaos/);
    });
  });

  it("con dấu lane là hằng số dùng chung với global-setup + lane-db-setup.sh", () => {
    expect(TEST_LANE_STAMP).toBe("mediaos-test-lane");
  });
});
