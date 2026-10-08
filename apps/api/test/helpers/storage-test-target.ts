/**
 * S16-SOCIAL-FILEDISPOSITION-1 (plan D12) — CHỐT ĐÍCH STORAGE cho ca test chạm object storage THẬT.
 *
 * Hàm THUẦN: chỉ đọc một bản `env` truyền vào, không I/O, không ném. Người gọi (int-spec) quyết định
 * làm gì với kết quả — xem `test/integration/s16-filedisposition-storage.int-spec.ts`.
 *
 * VÌ SAO CÓ FILE NÀY
 * Máy dev chỉ có MỘT server object storage và đó là server đang phục vụ thật. Các int-spec storage có
 * sẵn dùng `process.env.S3_BUCKET ??= …` rồi nuốt mọi lỗi dò thành «storage chưa sẵn sàng» ⇒ (a) ghi
 * vào bất kỳ bucket nào env đang trỏ tới, (b) bỏ qua trong im lặng — một lượt «xanh» không chạy ca
 * nào đọc y hệt một lượt đã chạy. Ca của WO này GHI ĐÈ object nên không được phép có cả hai.
 *
 * HAI CỔNG, THEO THỨ TỰ (cùng nguyên tắc với `test/db-target.ts`: chốt trên TÊN ĐÍCH đã resolve):
 *
 *   1. Cổng DB — thiếu DB lane (`DATABASE_URL` + `DATABASE_DIRECT_URL` + `LANE_DB`) ⇒ `skip-file`.
 *      Đứng TRƯỚC cổng bucket: job CI không có `LANE_DB`/`S3_*` phải SKIP cả file, không được ĐỎ.
 *
 *   2. Cổng bucket — `S3_BUCKET` đã resolve phải BẰNG ĐÚNG một tên cho phép (so bằng nguyên văn; không
 *      regex, không tiền tố/hậu tố, không trim, không đổi hoa-thường — đó chính là chuỗi
 *      `ObjectStorageService` sẽ dùng):
 *        • CI (`CI` = `true`/`1`)  ⇒ chỉ `mediaos-test`
 *        • cục bộ                  ⇒ chỉ `mediaos-fdisp-test`
 *      Không khớp: CI ⇒ `throw` (thiếu storage ở CI là ĐỎ, không phải bỏ qua); cục bộ ⇒ `skip-storage`
 *      (ca storage thật bỏ qua CÓ cảnh báo, ca chỉ-DB vẫn chạy).
 *
 * ⛔ ĐỪNG nới nhánh «CI ⇒ throw» để chữa một lượt CI đỏ: đỏ ở job không có storage nghĩa là cổng 1
 *    đặt sai chỗ, không phải cổng 2 quá chặt.
 */

/** Bucket DUY NHẤT ca storage thật được ghi khi chạy cục bộ. */
export const STORAGE_TEST_BUCKET_LOCAL = "mediaos-fdisp-test";

/** Bucket DUY NHẤT ca storage thật được ghi ở CI (storage tạm của job). */
export const STORAGE_TEST_BUCKET_CI = "mediaos-test";

export type StorageTestTarget =
  /** Cổng 1 đóng — cả file không chạy. */
  | { kind: "skip-file"; reason: string }
  /** Cổng 2 đóng ở máy cục bộ — ca storage thật bỏ qua CÓ cảnh báo; ca chỉ-DB vẫn chạy. */
  | { kind: "skip-storage"; reason: string }
  /** Cổng 2 đóng ở CI — người gọi PHẢI ném (đỏ). */
  | { kind: "throw"; reason: string }
  /** Cả hai cổng mở — chỉ được gọi storage trên đúng `bucket` này. */
  | { kind: "run"; bucket: string };

export type StorageTestEnv = Readonly<Record<string, string | undefined>>;

/** Cùng định nghĩa với `test/db-target.ts`: chỉ nhận đúng `true`/`1` (`CI=0`, `CI=false` là cục bộ). */
export function isCiEnv(env: StorageTestEnv): boolean {
  return ["true", "1"].includes((env.CI ?? "").trim().toLowerCase());
}

/** Cổng 1 — tương đương `hasDb && LANE_DB` của các int-spec khác, tính trên `env` truyền vào. */
export function storageTestDbGateOpen(env: StorageTestEnv): boolean {
  return Boolean(env.DATABASE_DIRECT_URL && env.DATABASE_URL) && Boolean(env.LANE_DB);
}

export function resolveStorageTestTarget(env: StorageTestEnv): StorageTestTarget {
  if (!storageTestDbGateOpen(env)) {
    return {
      kind: "skip-file",
      reason: "thiếu DB lane (DATABASE_URL + DATABASE_DIRECT_URL + LANE_DB) — cả file không chạy",
    };
  }

  const ci = isCiEnv(env);
  const allowed = ci ? STORAGE_TEST_BUCKET_CI : STORAGE_TEST_BUCKET_LOCAL;
  const resolved = env.S3_BUCKET;
  if (resolved === allowed) return { kind: "run", bucket: allowed };

  const seen = resolved === undefined ? "(không đặt)" : `"${resolved}"`;
  const reason = `S3_BUCKET đã resolve = ${seen}, khác tên DUY NHẤT cho phép "${allowed}" (${ci ? "CI" : "cục bộ"})`;
  return ci ? { kind: "throw", reason } : { kind: "skip-storage", reason };
}
