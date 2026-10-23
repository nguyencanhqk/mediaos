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

/* ══ S16-SOCIAL-STORAGETESTGATE-1 (plan D-1) — GHIM `S3_*` của `test.env` ══════════════════════════════════════
 *
 * VÌ SAO: `AppModule` nạp `.env` lúc import và chỉ lấp khoá CHƯA có trong `process.env` (plan §1.1). Khoá `S3_*`
 * nào worker không có chuỗi cụ thể ⇒ `.env` lấp ⇒ spec ghi lên bucket phục vụ thật. `vitest.config.ts` vì thế
 * ghim ĐỦ 7 khoá của `env.schema.ts` + `STORAGE_TEST_PROFILE`, MỌI giá trị là chuỗi (không `undefined`).
 *
 * QUY TẮC DƯƠNG: hồ sơ `live` CHỈ khi cả ba cùng đúng — (1) `S3_BUCKET` BẰNG ĐÚNG tên cho phép của môi trường
 * (cùng chuẩn với `resolveStorageTestTarget`) · (2) host của `S3_ENDPOINT` (qua `new URL`, giao thức http/https,
 * không userinfo) ∈ {localhost, 127.0.0.1} VÀ cổng ∈ `STORAGE_TEST_ALLOWED_PORTS` (S16-SOCIAL-STORAGEPORTPIN-1) ·
 * (3) có đủ hai khoá. Mọi trường hợp khác ⇒ `offline`: endpoint
 * loopback, khoá GIẢ, bucket chặn ⇒ lời gọi lỡ tay bị từ chối xác thực, và tripwire D-10
 * (`test/setup/storage-call-tripwire.ts`) chặn trước khi có byte nào rời tiến trình.
 *
 * ⛔ ĐỪNG thêm nhánh «chép bucket của shell cho tiện»: đó chính là đường bucket PROD / token R2 PROD lọt vào test.
 */

/**
 * Cổng DUY NHẤT hồ sơ `live` nhận trên endpoint loopback — khai ở ĐÂY, một chỗ (S16-SOCIAL-STORAGEPORTPIN-1).
 * Đo 23/10/2026: MinIO test cục bộ (`docker-compose.yml` `MINIO_PORT` mặc định · `harness/check.sh`
 * `STORAGE_LIVE_ENDPOINT`) và CI (`.github/workflows/api.yml` `S3_ENDPOINT`) đều `9000`; `9001` là console MinIO.
 * So nguyên văn với `URL.port` — URL bỏ cổng mặc định (80/443, kể cả ghi tường minh) thành chuỗi rỗng ⇒ không khớp.
 * Unit-spec đối chiếu endpoint của check.sh + job CI với danh sách này: đổi cổng ở đó ⇒ đổi ở đây cùng lượt.
 */
export const STORAGE_TEST_ALLOWED_PORTS: readonly string[] = Object.freeze(["9000"]);

/** Bucket CHẶN của hồ sơ `offline` — không bao giờ được tạo; mọi ca storage thấy tên này ⇒ cổng đóng. */
export const STORAGE_TEST_SENTINEL_BUCKET = "mediaos-storage-off";

export type StorageTestProfile = "live" | "offline";

/** Biến env mà `vitest.config.ts` ghim — tripwire D-10 đọc nó để biết có cài bẫy hay không. */
export const STORAGE_TEST_PROFILE_ENV = "STORAGE_TEST_PROFILE";

/**
 * Bảy khoá `S3_*` của `env.schema.ts` + hồ sơ — mỗi khoá LUÔN là chuỗi không rỗng. Giao với `Record<string,string>`
 * để `vitest.config.ts` trải thẳng vào `test.env` và ca test duyệt khoá đọc từ schema theo tên.
 */
export type PinnedStorageEnv = Readonly<Record<string, string>> &
  Readonly<{
    S3_ENDPOINT: string;
    S3_REGION: string;
    S3_ACCESS_KEY: string;
    S3_SECRET_KEY: string;
    S3_BUCKET: string;
    S3_FORCE_PATH_STYLE: string;
    S3_PRESIGN_TTL_SEC: string;
    STORAGE_TEST_PROFILE: StorageTestProfile;
  }>;

const OFFLINE_ENDPOINT = "http://localhost:9000";
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);
// Khoá GIẢ của hồ sơ offline — ghép chuỗi (CLAUDE.md §5: literal trông như khoá trip gitleaks).
const OFFLINE_ACCESS_KEY = ["storage", "test", "offline", "access"].join("-");
const OFFLINE_SECRET_KEY = ["storage", "test", "offline", "secret"].join("-");
// Mặc định + miền hợp lệ theo `env.schema.ts:202-209`.
const DEFAULT_REGION = "us-east-1";
const DEFAULT_FORCE_PATH_STYLE = "true";
const DEFAULT_PRESIGN_TTL_SEC = "300";
const MAX_PRESIGN_TTL_SEC = 3600;

function isAllowedLoopbackEndpoint(raw: string | undefined): raw is string {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false; // không phải URL tuyệt đối ⇒ không chứng minh được là loopback ⇒ offline
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  return LOOPBACK_HOSTS.has(url.hostname) && STORAGE_TEST_ALLOWED_PORTS.includes(url.port);
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function pinRegion(raw: string | undefined): string {
  return nonEmpty(raw) ? raw : DEFAULT_REGION;
}

function pinForcePathStyle(raw: string | undefined): string {
  return raw === "true" || raw === "false" ? raw : DEFAULT_FORCE_PATH_STYLE;
}

function pinPresignTtl(raw: string | undefined): string {
  if (raw === undefined || !/^[0-9]+$/.test(raw)) return DEFAULT_PRESIGN_TTL_SEC;
  const n = Number(raw);
  return n >= 1 && n <= MAX_PRESIGN_TTL_SEC ? String(n) : DEFAULT_PRESIGN_TTL_SEC;
}

/** Hàm THUẦN: đọc `env` (thường là `process.env` của shell lúc dựng config), trả bản ghim mới — không đổi đầu vào. */
export function pinTestStorageEnv(env: StorageTestEnv): PinnedStorageEnv {
  const allowedBucket = isCiEnv(env) ? STORAGE_TEST_BUCKET_CI : STORAGE_TEST_BUCKET_LOCAL;
  const endpoint = env.S3_ENDPOINT;
  const accessKey = env.S3_ACCESS_KEY;
  const secretKey = env.S3_SECRET_KEY;
  const live =
    env.S3_BUCKET === allowedBucket &&
    isAllowedLoopbackEndpoint(endpoint) &&
    nonEmpty(accessKey) &&
    nonEmpty(secretKey);

  const common = {
    S3_REGION: pinRegion(env.S3_REGION),
    S3_FORCE_PATH_STYLE: pinForcePathStyle(env.S3_FORCE_PATH_STYLE),
    S3_PRESIGN_TTL_SEC: pinPresignTtl(env.S3_PRESIGN_TTL_SEC),
  };
  if (live) {
    return {
      ...common,
      S3_ENDPOINT: endpoint,
      S3_ACCESS_KEY: accessKey,
      S3_SECRET_KEY: secretKey,
      S3_BUCKET: allowedBucket,
      STORAGE_TEST_PROFILE: "live",
    };
  }
  return {
    ...common,
    S3_ENDPOINT: OFFLINE_ENDPOINT,
    S3_ACCESS_KEY: OFFLINE_ACCESS_KEY,
    S3_SECRET_KEY: OFFLINE_SECRET_KEY,
    S3_BUCKET: STORAGE_TEST_SENTINEL_BUCKET,
    STORAGE_TEST_PROFILE: "offline",
  };
}

/* ══ S16-SOCIAL-STORAGETESTGATE-1 (plan D-4) — NHÃN LOG cho `harness/lane-db-guard.mjs` ═══════════════════════
 *
 * Mỗi nhãn = thẻ cố định + MỘT khối JSON trên cùng dòng. Guard (`parseStorageMarkers`) khử trùng lặp skip theo
 * (file, task), run theo file, call đếm từng dòng. `task` = `ctx.task.id` (ổn định khi chạy lại cùng tệp, phân
 * biệt `it.each`/ca trùng tên); `case` chỉ để người đọc. Dòng cảnh báo CẤP TỆP không mang thẻ ⇒ không bị đếm.
 * ⚠️ Đổi thẻ/khoá ở đây ⇒ đổi CÙNG LÚC ở `harness/lane-db-guard.mjs` (R2 khứ hồi qua CLI canh điều này).
 */
export const STORAGE_SKIP_TAG = "[storage-test-skip]";
export const STORAGE_RUN_TAG = "[storage-test-run]";
export const STORAGE_CALL_TAG = "[storage-test-call]";

/** Ca storage bị bỏ qua (warn, trong `needStorage` trước `ctx.skip()`). */
export function storageSkipLine(args: {
  file: string;
  task: string;
  caseName: string;
  reason: string;
}): string {
  const body = { file: args.file, task: args.task, case: args.caseName, reason: args.reason };
  return `${STORAGE_SKIP_TAG} ${JSON.stringify(body)}`;
}

/** Tệp storage đã CHẠY trên bucket cho phép (log, beforeAll). */
export function storageRunLine(args: { file: string; bucket: string }): string {
  return `${STORAGE_RUN_TAG} ${JSON.stringify({ file: args.file, bucket: args.bucket })}`;
}

/** Lời gọi storage bị tripwire D-10 chặn ở hồ sơ `offline`. */
export function storageCallLine(args: { file: string; command: string }): string {
  return `${STORAGE_CALL_TAG} ${JSON.stringify({ file: args.file, command: args.command })}`;
}
