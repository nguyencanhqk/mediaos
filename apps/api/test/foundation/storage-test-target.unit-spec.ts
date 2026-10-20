/**
 * S16-SOCIAL-FILEDISPOSITION-1 (plan §4 ca T1, D12) — unit của HẠ TẦNG TEST: chốt đích storage.
 *
 * Không DB, không storage. Ghim hai cổng của `resolveStorageTestTarget`: ca storage thật chỉ được chạy
 * trên ĐÚNG một tên bucket theo môi trường; mọi tên khác ⇒ không gọi storage lần nào (CI: `throw`,
 * cục bộ: `skip-storage`); thiếu DB lane ⇒ `skip-file` và KHÔNG ném, kể cả ở CI.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  STORAGE_RUN_TAG,
  STORAGE_SKIP_TAG,
  STORAGE_TEST_BUCKET_CI,
  STORAGE_TEST_BUCKET_LOCAL,
  STORAGE_TEST_SENTINEL_BUCKET,
  isCiEnv,
  pinTestStorageEnv,
  resolveStorageTestTarget,
  storageRunLine,
  storageSkipLine,
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

/**
 * S16-SOCIAL-STORAGETESTGATE-1 (plan §4 R2, D-1/D-4) — `pinTestStorageEnv`: `vitest.config.ts` ghim ĐỦ khoá `S3_*` vào
 * `test.env` để `.env` (nạp lúc import AppModule, chỉ lấp khoá VẮNG) không bao giờ đưa bucket/khoá PROD vào worker.
 * Hồ sơ `live` CHỈ khi bucket cho phép + endpoint loopback + đủ hai khoá; còn lại `offline` (khoá giả, bucket chặn).
 */
const API_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const GUARD_CLI = fileURLToPath(new URL("../../../../harness/lane-db-guard.mjs", import.meta.url));
/** Danh sách khoá `S3_*` đọc từ NGUỒN env.schema — thêm khoá mới mà quên ghim ⇒ ca «đủ khoá» đỏ. */
const SCHEMA_S3_KEYS = [
  ...readFileSync(join(API_ROOT, "src/config/env.schema.ts"), "utf8").matchAll(
    /^\s*(S3_[A-Z_]+)\s*:/gm,
  ),
].map((m) => m[1]);

// Ghép chuỗi (CLAUDE.md §5) — giá trị trông như khoá thật của máy dev, phải KHÔNG BAO GIỜ lọt qua hồ sơ offline.
const REAL_ACCESS = ["dev", "root", "user"].join("-");
const REAL_SECRET = ["dev", "root", "secret", "value"].join("-");
const LOOPBACK = "http://localhost:9000";
const liveInput = (over: Record<string, string | undefined> = {}): StorageTestEnv => ({
  S3_ENDPOINT: LOOPBACK,
  S3_ACCESS_KEY: REAL_ACCESS,
  S3_SECRET_KEY: REAL_SECRET,
  S3_BUCKET: STORAGE_TEST_BUCKET_LOCAL,
  ...over,
});

function expectOffline(out: Record<string, string>): void {
  expect(out.STORAGE_TEST_PROFILE).toBe("offline");
  expect(out.S3_BUCKET).toBe(STORAGE_TEST_SENTINEL_BUCKET);
  expect(out.S3_ENDPOINT).toBe(LOOPBACK);
  for (const k of ["S3_ACCESS_KEY", "S3_SECRET_KEY"] as const) {
    expect(typeof out[k]).toBe("string");
    expect(out[k].length).toBeGreaterThan(0);
    expect([REAL_ACCESS, REAL_SECRET]).not.toContain(out[k]);
  }
}

describe("R2 — pinTestStorageEnv (ghim S3_* của test.env, quy tắc dương)", () => {
  it("bucket chặn có tên cố định, khác mọi tên cho phép", () => {
    expect(STORAGE_TEST_SENTINEL_BUCKET).toBe("mediaos-storage-off");
  });

  it("shell trống (cục bộ) ⇒ offline", () => {
    expectOffline(pinTestStorageEnv({}));
  });

  it("cục bộ trỏ bucket phục vụ thật + endpoint thật ⇒ offline, khoá thật KHÔNG đi qua", () => {
    expectOffline(pinTestStorageEnv(liveInput({ S3_BUCKET: "mediaos-assets" })));
  });

  it("mediaos-fdisp-test + localhost + đủ khoá ⇒ live, chép nguyên văn", () => {
    const out = pinTestStorageEnv(liveInput());
    expect(out.STORAGE_TEST_PROFILE).toBe("live");
    expect(out.S3_BUCKET).toBe(STORAGE_TEST_BUCKET_LOCAL);
    expect(out.S3_ENDPOINT).toBe(LOOPBACK);
    expect(out.S3_ACCESS_KEY).toBe(REAL_ACCESS);
    expect(out.S3_SECRET_KEY).toBe(REAL_SECRET);
  });

  it("127.0.0.1 ⇒ live", () => {
    expect(
      pinTestStorageEnv(liveInput({ S3_ENDPOINT: "http://127.0.0.1:9000" })).STORAGE_TEST_PROFILE,
    ).toBe("live");
  });

  it.each([
    ["endpoint R2", "https://acct.r2.cloudflarestorage.com"],
    ["host giả dạng localhost", "http://localhost.evil.test:9000"],
    ["host có userinfo", "http://localhost@evil.test:9000"],
    ["endpoint không phải URL", "localhost:9000"],
    ["endpoint rỗng", ""],
  ])("bucket cho phép nhưng %s ⇒ offline", (_label, endpoint) => {
    expectOffline(pinTestStorageEnv(liveInput({ S3_ENDPOINT: endpoint })));
  });

  it.each([
    ["thiếu access key", { S3_ACCESS_KEY: undefined }],
    ["thiếu secret key", { S3_SECRET_KEY: "" }],
    ["thiếu endpoint", { S3_ENDPOINT: undefined }],
  ])("%s ⇒ offline", (_label, over) => {
    expectOffline(pinTestStorageEnv(liveInput(over)));
  });

  it.each([
    ["viết hoa", STORAGE_TEST_BUCKET_LOCAL.toUpperCase()],
    ["khoảng trắng", ` ${STORAGE_TEST_BUCKET_LOCAL} `],
    ["hậu tố", `${STORAGE_TEST_BUCKET_LOCAL}-2`],
    ["tên CI khi chạy cục bộ", STORAGE_TEST_BUCKET_CI],
  ])("tên bucket %s ⇒ offline", (_label, bucket) => {
    expectOffline(pinTestStorageEnv(liveInput({ S3_BUCKET: bucket })));
  });

  it("CI + mediaos-test + loopback + khoá ⇒ live", () => {
    const out = pinTestStorageEnv(liveInput({ CI: "true", S3_BUCKET: STORAGE_TEST_BUCKET_CI }));
    expect(out.STORAGE_TEST_PROFILE).toBe("live");
    expect(out.S3_BUCKET).toBe(STORAGE_TEST_BUCKET_CI);
  });

  it("CI thiếu storage ⇒ offline, rồi resolveStorageTestTarget ⇒ throw (ĐỎ, không bỏ qua)", () => {
    const out = pinTestStorageEnv({ CI: "true" });
    expectOffline(out);
    expect(resolveStorageTestTarget({ ...LANE, CI: "true", ...out }).kind).toBe("throw");
  });

  it("cục bộ offline ⇒ resolveStorageTestTarget ⇒ skip-storage (ca chỉ-DB vẫn chạy)", () => {
    expect(resolveStorageTestTarget({ ...LANE, ...pinTestStorageEnv({}) }).kind).toBe(
      "skip-storage",
    );
  });

  it.each([
    ["offline", {}],
    ["live", liveInput()],
  ])(
    "hồ sơ %s: ĐỦ mọi khoá S3_* của env.schema, mỗi khoá là chuỗi không rỗng (không để .env lấp)",
    (_p, input) => {
      expect(SCHEMA_S3_KEYS.length).toBeGreaterThanOrEqual(7);
      const out = pinTestStorageEnv(input);
      for (const key of SCHEMA_S3_KEYS) {
        expect(typeof out[key], key).toBe("string");
        expect(out[key].length, key).toBeGreaterThan(0);
      }
    },
  );

  it("khoá phụ vắng/sai ⇒ mặc định hợp lệ theo schema; hợp lệ ⇒ chép", () => {
    const bad = pinTestStorageEnv(
      liveInput({ S3_PRESIGN_TTL_SEC: "abc", S3_FORCE_PATH_STYLE: "yes" }),
    );
    expect(bad.S3_REGION).toBe("us-east-1");
    expect(bad.S3_FORCE_PATH_STYLE).toBe("true");
    expect(bad.S3_PRESIGN_TTL_SEC).toBe("300");
    const good = pinTestStorageEnv(
      liveInput({ S3_REGION: "auto", S3_FORCE_PATH_STYLE: "false", S3_PRESIGN_TTL_SEC: "600" }),
    );
    expect([good.S3_REGION, good.S3_FORCE_PATH_STYLE, good.S3_PRESIGN_TTL_SEC]).toEqual([
      "auto",
      "false",
      "600",
    ]);
  });

  it("thuần: không đổi đầu vào, không ném với đầu vào đã freeze", () => {
    const input = Object.freeze({ ...liveInput({ S3_BUCKET: "mediaos-assets" }) });
    const snapshot = { ...input };
    expect(() => pinTestStorageEnv(input)).not.toThrow();
    expect(input).toEqual(snapshot);
  });
});

describe("R2 — nhãn log D-4 khứ hồi qua guard (.mjs) — chống trôi định dạng giữa TS và harness", () => {
  const FILE = "test/integration/files-e2e-confirm.int-spec.ts";

  it("thẻ cố định", () => {
    expect(STORAGE_SKIP_TAG).toBe("[storage-test-skip]");
    expect(STORAGE_RUN_TAG).toBe("[storage-test-run]");
  });

  it("storageSkipLine / storageRunLine: thẻ + một khối JSON parse được, có `task`", () => {
    const skip = storageSkipLine({
      file: FILE,
      task: "a1_0_2",
      caseName: "E1 PUT rồi confirm",
      reason: "lệch",
    });
    expect(skip.startsWith(`${STORAGE_SKIP_TAG} `)).toBe(true);
    expect(JSON.parse(skip.slice(STORAGE_SKIP_TAG.length))).toEqual({
      file: FILE,
      task: "a1_0_2",
      case: "E1 PUT rồi confirm",
      reason: "lệch",
    });
    const run = storageRunLine({ file: FILE, bucket: STORAGE_TEST_BUCKET_LOCAL });
    expect(JSON.parse(run.slice(STORAGE_RUN_TAG.length))).toEqual({
      file: FILE,
      bucket: STORAGE_TEST_BUCKET_LOCAL,
    });
  });

  it("dòng skip do TS sinh ⇒ guard CLI đếm STORAGE:skips=1 và strict + LANE_DB ⇒ LEVEL:red", () => {
    const dir = mkdtempSync(join(tmpdir(), "storage-label-roundtrip-"));
    const log = join(dir, "test.log");
    const line = storageSkipLine({ file: FILE, task: "a1_0_2", caseName: "E1", reason: "lệch" });
    writeFileSync(
      log,
      [
        `stderr | ${FILE} > E1`,
        line,
        " Test Files  1 passed (1)",
        "      Tests  3 passed | 1 skipped (4)",
      ].join("\n"),
      "utf8",
    );
    const res = spawnSync(process.execPath, [GUARD_CLI, log, "--lane-db-set=1", "--strict=1"], {
      encoding: "utf8",
    });
    expect(res.stdout).toMatch(/^STORAGE:skips=1 /m);
    expect(res.stdout).toMatch(/^LEVEL:red$/m);
  });
});
