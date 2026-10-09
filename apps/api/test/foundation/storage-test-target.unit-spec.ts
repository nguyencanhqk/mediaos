/**
 * S16-SOCIAL-FILEDISPOSITION-1 (plan §4 ca T1, D12) — unit của HẠ TẦNG TEST: chốt đích storage.
 *
 * Không DB, không storage. Ghim hai cổng của `resolveStorageTestTarget`: ca storage thật chỉ được chạy
 * trên ĐÚNG một tên bucket theo môi trường; mọi tên khác ⇒ không gọi storage lần nào (CI: `throw`,
 * cục bộ: `skip-storage`); thiếu DB lane ⇒ `skip-file` và KHÔNG ném, kể cả ở CI.
 */

import { describe, expect, it } from "vitest";
import {
  STORAGE_TEST_BUCKET_CI,
  STORAGE_TEST_BUCKET_LOCAL,
  isCiEnv,
  resolveStorageTestTarget,
  storageTestDbGateOpen,
  type StorageTestEnv,
} from "../helpers/storage-test-target";

// Ghép chuỗi (không literal connection-string) — fixture không được trông giống secret.
const LANE_URL = ["postgres://role", "db.invalid:5432/mediaos_lane"].join("@");
const LANE: StorageTestEnv = {
  DATABASE_URL: LANE_URL,
  DATABASE_DIRECT_URL: LANE_URL,
  LANE_DB: "mediaos_lane",
};

/** Tên KHÔNG được phép ở cả hai môi trường (gồm các biến thể «gần đúng» của tên cho phép). */
const NEVER_ALLOWED: ReadonlyArray<[label: string, bucket: string | undefined]> = [
  ["bucket phục vụ thật", "mediaos-assets"],
  ["chuỗi rỗng", ""],
  ["thiếu khoá", undefined],
  ["tên lạ có hậu tố -test", "x-test"],
  ["tên cho phép + hậu tố", `${STORAGE_TEST_BUCKET_LOCAL}-2`],
  ["tiền tố + tên cho phép", `my-${STORAGE_TEST_BUCKET_LOCAL}`],
  ["tên cho phép viết hoa", STORAGE_TEST_BUCKET_LOCAL.toUpperCase()],
  ["tên cho phép có khoảng trắng", ` ${STORAGE_TEST_BUCKET_LOCAL} `],
  ["tên CI + hậu tố", `${STORAGE_TEST_BUCKET_CI}-2`],
];

describe("T1 — resolveStorageTestTarget (chốt đích storage của ca test)", () => {
  it("hai tên cho phép là hằng cố định và không tên nào là bucket phục vụ thật", () => {
    expect(STORAGE_TEST_BUCKET_LOCAL).toBe("mediaos-fdisp-test");
    expect(STORAGE_TEST_BUCKET_CI).toBe("mediaos-test");
    expect([STORAGE_TEST_BUCKET_LOCAL, STORAGE_TEST_BUCKET_CI]).not.toContain("mediaos-assets");
  });

  describe("cổng 2 — CỤC BỘ (không CI)", () => {
    it.each(NEVER_ALLOWED)("TỪ CHỐI %s ⇒ skip-storage (không gọi storage)", (_label, bucket) => {
      const target = resolveStorageTestTarget({ ...LANE, S3_BUCKET: bucket });
      expect(target.kind).toBe("skip-storage");
    });

    it("TỪ CHỐI tên của CI (`mediaos-test`) khi KHÔNG ở CI ⇒ skip-storage", () => {
      const target = resolveStorageTestTarget({ ...LANE, S3_BUCKET: STORAGE_TEST_BUCKET_CI });
      expect(target.kind).toBe("skip-storage");
    });

    it("CHO PHÉP đúng `mediaos-fdisp-test` ⇒ run trên đúng bucket đó", () => {
      const target = resolveStorageTestTarget({ ...LANE, S3_BUCKET: STORAGE_TEST_BUCKET_LOCAL });
      expect(target).toEqual({ kind: "run", bucket: "mediaos-fdisp-test" });
    });

    it.each(["false", "0", "", "no"])("`CI=%s` vẫn là cục bộ (không mở tên của CI)", (ci) => {
      const env = { ...LANE, CI: ci };
      expect(isCiEnv(env)).toBe(false);
      expect(resolveStorageTestTarget({ ...env, S3_BUCKET: STORAGE_TEST_BUCKET_CI }).kind).toBe(
        "skip-storage",
      );
      expect(resolveStorageTestTarget({ ...env, S3_BUCKET: STORAGE_TEST_BUCKET_LOCAL }).kind).toBe(
        "run",
      );
    });
  });

  describe("cổng 2 — CI", () => {
    it.each(["true", "1", "TRUE", " true "])("`CI=%s` được coi là CI", (ci) => {
      expect(isCiEnv({ CI: ci })).toBe(true);
    });

    it.each(NEVER_ALLOWED)("TỪ CHỐI %s ⇒ throw (thiếu storage ở CI là ĐỎ)", (_label, bucket) => {
      const target = resolveStorageTestTarget({ ...LANE, CI: "true", S3_BUCKET: bucket });
      expect(target.kind).toBe("throw");
    });

    it("TỪ CHỐI tên cục bộ (`mediaos-fdisp-test`) khi ở CI ⇒ throw", () => {
      const target = resolveStorageTestTarget({
        ...LANE,
        CI: "true",
        S3_BUCKET: STORAGE_TEST_BUCKET_LOCAL,
      });
      expect(target.kind).toBe("throw");
    });

    it("CHO PHÉP đúng `mediaos-test` ⇒ run trên đúng bucket đó", () => {
      const target = resolveStorageTestTarget({
        ...LANE,
        CI: "true",
        S3_BUCKET: STORAGE_TEST_BUCKET_CI,
      });
      expect(target).toEqual({ kind: "run", bucket: "mediaos-test" });
    });
  });

  describe("cổng 1 — DB lane, đứng TRƯỚC cổng bucket", () => {
    it("hình job CI không có storage: `CI=true`, có Postgres, THIẾU `LANE_DB`, THIẾU `S3_*` ⇒ skip-file, KHÔNG ném", () => {
      const env: StorageTestEnv = {
        CI: "true",
        DATABASE_URL: LANE_URL,
        DATABASE_DIRECT_URL: LANE_URL,
      };
      expect(() => resolveStorageTestTarget(env)).not.toThrow();
      expect(resolveStorageTestTarget(env).kind).toBe("skip-file");
      expect(storageTestDbGateOpen(env)).toBe(false);
    });

    it("`CI=true`, không DB, không gì cả ⇒ skip-file, KHÔNG ném", () => {
      expect(() => resolveStorageTestTarget({ CI: "true" })).not.toThrow();
      expect(resolveStorageTestTarget({ CI: "true" }).kind).toBe("skip-file");
    });

    it.each<[string, StorageTestEnv]>([
      ["cục bộ, env trống", {}],
      ["có LANE_DB nhưng thiếu cả hai URL", { LANE_DB: "mediaos_lane" }],
      ["thiếu DATABASE_DIRECT_URL", { DATABASE_URL: LANE_URL, LANE_DB: "mediaos_lane" }],
      ["thiếu DATABASE_URL", { DATABASE_DIRECT_URL: LANE_URL, LANE_DB: "mediaos_lane" }],
      [
        "URL rỗng (resolver fail-closed)",
        { DATABASE_URL: "", DATABASE_DIRECT_URL: "", LANE_DB: "" },
      ],
    ])("%s ⇒ skip-file", (_label, env) => {
      expect(resolveStorageTestTarget(env).kind).toBe("skip-file");
    });

    it("thứ tự cổng: thiếu DB lane thắng một bucket SAI ở CI ⇒ skip-file chứ không throw", () => {
      const target = resolveStorageTestTarget({ CI: "true", S3_BUCKET: "mediaos-assets" });
      expect(target.kind).toBe("skip-file");
    });

    it("thứ tự cổng: thiếu DB lane thắng cả một bucket ĐÚNG ⇒ skip-file chứ không run", () => {
      const target = resolveStorageTestTarget({ S3_BUCKET: STORAGE_TEST_BUCKET_LOCAL });
      expect(target.kind).toBe("skip-file");
    });

    it("đủ DB lane ⇒ cổng 1 mở", () => {
      expect(storageTestDbGateOpen(LANE)).toBe(true);
    });
  });

  it("hàm toàn phần: không tổ hợp nào ném, và lý do không khớp nêu được tên đã thấy lẫn tên cho phép", () => {
    const target = resolveStorageTestTarget({ ...LANE, S3_BUCKET: "mediaos-assets" });
    expect(target.kind).toBe("skip-storage");
    if (target.kind !== "skip-storage") return;
    expect(target.reason).toContain("mediaos-assets");
    expect(target.reason).toContain(STORAGE_TEST_BUCKET_LOCAL);
  });
});
