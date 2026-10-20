/**
 * S16-SOCIAL-STORAGETESTGATE-1 (plan §4 R3, D-3) — unit của cổng storage dùng chung cho int-spec.
 *
 * Không DB, KHÔNG MẠNG: S3 giả tiêm qua `makeS3`, ghi lại từng lệnh (tên lớp lệnh + input). Ghim:
 *   - cổng đóng ⇒ `needStorage` in ĐÚNG một dòng nhãn có `task` + gọi `ctx.skip`, 0 lời `send`; `s3()` ném;
 *   - cổng mở ⇒ chỉ chạm ĐÚNG bucket cho phép; NotFound ⇒ tạo đúng tên đó; đua tạo (`BucketAlreadyOwnedByYou`) ⇒
 *     xác nhận lại rồi chạy; `BucketAlreadyExists`/lỗi khác ⇒ ném;
 *   - CI lệch / thiếu DB lane ⇒ ném (không skip im lặng);
 *   - `removeObjects` chỉ nhận tiền tố `<uuid>/` và chỉ List/Delete trên bucket của cổng.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { openStorageTestGate } from "../helpers/storage-test-gate";
import {
  STORAGE_SKIP_TAG,
  STORAGE_RUN_TAG,
  STORAGE_TEST_BUCKET_LOCAL,
  type StorageTestEnv,
} from "../helpers/storage-test-target";

const FILE = "test/integration/files-e2e-confirm.int-spec.ts";
const LANE_URL = ["postgres://role", "db.invalid:5432/mediaos_lane"].join("@");
const LANE: StorageTestEnv = {
  DATABASE_URL: LANE_URL,
  DATABASE_DIRECT_URL: LANE_URL,
  LANE_DB: "mediaos_lane",
};
const LOCAL_RUN: StorageTestEnv = { ...LANE, S3_BUCKET: STORAGE_TEST_BUCKET_LOCAL };
const LOCAL_CLOSED: StorageTestEnv = { ...LANE, S3_BUCKET: "mediaos-storage-off" };

type SentCommand = { name: string; input: Record<string, unknown> };
type Scripted = unknown | Error;

function s3Error(name: string, status: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

/** S3 giả: mỗi tên lớp lệnh có một hàng đợi phản hồi; hết hàng ⇒ `{}`. */
function fakeS3(script: Record<string, Scripted[]> = {}) {
  const queues = new Map(Object.entries(script).map(([k, v]) => [k, [...v]]));
  const sent: SentCommand[] = [];
  const client = {
    send: vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = cmd.constructor.name;
      sent.push({ name, input: cmd.input });
      const next = queues.get(name)?.shift();
      if (next instanceof Error) throw next;
      return next ?? {};
    }),
  };
  return { client, sent };
}

function harness(env: StorageTestEnv, script?: Record<string, Scripted[]>) {
  const s3 = fakeS3(script);
  const logs: string[] = [];
  const warns: string[] = [];
  const open = () =>
    openStorageTestGate(FILE, {
      env,
      makeS3: () => s3.client,
      log: (l: string) => logs.push(l),
      warn: (l: string) => warns.push(l),
    });
  return { s3, logs, warns, open };
}

const fakeCtx = (id = "task_e1") => ({ task: { id, name: "E1 PUT rồi confirm" }, skip: vi.fn() });
const tagged = (lines: string[], tag: string) => lines.filter((l) => l.includes(tag));

describe("R3 — openStorageTestGate: cổng ĐÓNG (cục bộ, bucket lệch)", () => {
  it("needStorage ⇒ false, đúng 1 dòng nhãn skip có task + case, gọi ctx.skip, 0 lời send", async () => {
    const h = harness(LOCAL_CLOSED);
    const gate = await h.open();
    expect(gate.run).toBe(false);
    expect(gate.bucket).toBeNull();
    expect(tagged(h.warns, STORAGE_SKIP_TAG)).toHaveLength(0);

    const ctx = fakeCtx();
    expect(gate.needStorage(ctx, "E1 PUT rồi confirm")).toBe(false);
    expect(ctx.skip).toHaveBeenCalledTimes(1);
    const skips = tagged(h.warns, STORAGE_SKIP_TAG);
    expect(skips).toHaveLength(1);
    const payload = JSON.parse(
      skips[0].slice(skips[0].indexOf(STORAGE_SKIP_TAG) + STORAGE_SKIP_TAG.length),
    );
    expect(payload).toMatchObject({ file: FILE, task: "task_e1", case: "E1 PUT rồi confirm" });
    expect(tagged(h.logs, STORAGE_RUN_TAG)).toHaveLength(0);
    expect(h.s3.client.send).not.toHaveBeenCalled();
  });

  it("có đúng một dòng warn CẤP TỆP (không mang thẻ) khi mở cổng đóng", async () => {
    const h = harness(LOCAL_CLOSED);
    await h.open();
    expect(h.warns).toHaveLength(1);
    expect(h.warns[0]).not.toContain(STORAGE_SKIP_TAG);
  });

  it("s3() NÉM khi cổng đóng; removeObjects không gọi gì", async () => {
    const h = harness(LOCAL_CLOSED);
    const gate = await h.open();
    expect(() => gate.s3()).toThrow();
    await gate.removeObjects([`${randomUUID()}/`]);
    expect(h.s3.client.send).not.toHaveBeenCalled();
  });
});

describe("R3 — openStorageTestGate: cổng MỞ", () => {
  it("HeadBucket ok ⇒ run, in 1 nhãn run, needStorage true không skip, chỉ chạm bucket cho phép", async () => {
    const h = harness(LOCAL_RUN);
    const gate = await h.open();
    expect(gate.run).toBe(true);
    expect(gate.bucket).toBe(STORAGE_TEST_BUCKET_LOCAL);
    expect(tagged(h.logs, STORAGE_RUN_TAG)).toHaveLength(1);
    const ctx = fakeCtx();
    expect(gate.needStorage(ctx, "E1")).toBe(true);
    expect(ctx.skip).not.toHaveBeenCalled();
    expect(tagged(h.warns, STORAGE_SKIP_TAG)).toHaveLength(0);
    expect(h.s3.sent.map((c) => c.name)).toEqual(["HeadBucketCommand"]);
    expect(h.s3.sent[0].input.Bucket).toBe(STORAGE_TEST_BUCKET_LOCAL);
    expect(gate.s3()).toBe(h.s3.client);
  });

  it("HeadBucket NotFound ⇒ CreateBucket ĐÚNG tên cho phép, rồi chạy", async () => {
    const h = harness(LOCAL_RUN, { HeadBucketCommand: [s3Error("NotFound", 404)] });
    const gate = await h.open();
    expect(gate.run).toBe(true);
    const creates = h.s3.sent.filter((c) => c.name === "CreateBucketCommand");
    expect(creates).toHaveLength(1);
    expect(creates[0].input.Bucket).toBe(STORAGE_TEST_BUCKET_LOCAL);
    expect(h.s3.sent.every((c) => c.input.Bucket === STORAGE_TEST_BUCKET_LOCAL)).toBe(true);
  });

  it("(M2) fork khác tạo trước: CreateBucket ⇒ BucketAlreadyOwnedByYou ⇒ HeadBucket xác nhận ⇒ chạy", async () => {
    const h = harness(LOCAL_RUN, {
      HeadBucketCommand: [s3Error("NotFound", 404), {}],
      CreateBucketCommand: [s3Error("BucketAlreadyOwnedByYou", 409)],
    });
    const gate = await h.open();
    expect(gate.run).toBe(true);
    expect(h.s3.sent.map((c) => c.name)).toEqual([
      "HeadBucketCommand",
      "CreateBucketCommand",
      "HeadBucketCommand",
    ]);
  });

  it("CreateBucket ⇒ BucketAlreadyExists (bucket của chủ khác) ⇒ NÉM", async () => {
    const h = harness(LOCAL_RUN, {
      HeadBucketCommand: [s3Error("NotFound", 404)],
      CreateBucketCommand: [s3Error("BucketAlreadyExists", 409)],
    });
    await expect(h.open()).rejects.toThrow();
  });

  it("HeadBucket lỗi khác NotFound (403) ⇒ NÉM, không tạo bucket", async () => {
    const h = harness(LOCAL_RUN, { HeadBucketCommand: [s3Error("AccessDenied", 403)] });
    await expect(h.open()).rejects.toThrow();
    expect(h.s3.sent.some((c) => c.name === "CreateBucketCommand")).toBe(false);
  });
});

describe("R3 — openStorageTestGate: lệch cổng ⇒ NÉM, 0 lời gọi", () => {
  it("CI + bucket lệch ⇒ ném", async () => {
    const h = harness({ ...LANE, CI: "true", S3_BUCKET: "mediaos-storage-off" });
    await expect(h.open()).rejects.toThrow();
    expect(h.s3.client.send).not.toHaveBeenCalled();
  });

  it("thiếu DB lane (skip-file) ⇒ ném: cổng tệp phải đóng TRƯỚC khi tới đây", async () => {
    const h = harness({ S3_BUCKET: STORAGE_TEST_BUCKET_LOCAL });
    await expect(h.open()).rejects.toThrow();
    expect(h.s3.client.send).not.toHaveBeenCalled();
  });
});

describe("R3 — removeObjects (M5a): chỉ tiền tố `<uuid>/`, chỉ trên bucket của cổng", () => {
  it.each([
    ["rỗng", ""],
    ["gạch chéo", "/"],
    ["tên lạ", "x/"],
    ["đi ngược", "../"],
    ["uuid thiếu gạch chéo", randomUUID()],
    ["uuid lồng sâu", `${randomUUID()}/a/`],
    ["uuid viết hoa", `${randomUUID().toUpperCase()}/`],
  ])("tiền tố %s ⇒ ném, 0 lời gọi", async (_label, prefix) => {
    const h = harness(LOCAL_RUN);
    const gate = await h.open();
    h.s3.client.send.mockClear();
    await expect(gate.removeObjects([prefix])).rejects.toThrow();
    expect(h.s3.client.send).not.toHaveBeenCalled();
  });

  it("tiền tố hợp lệ ⇒ List đúng Prefix + Delete chỉ khoá dưới tiền tố, mọi lệnh trên bucket cổng", async () => {
    const companyId = randomUUID();
    const prefix = `${companyId}/`;
    const h = harness(LOCAL_RUN, {
      ListObjectsV2Command: [
        { Contents: [{ Key: `${prefix}a.pdf` }, { Key: `${prefix}b.pdf` }], IsTruncated: false },
      ],
    });
    const gate = await h.open();
    await gate.removeObjects([prefix]);
    const after = h.s3.sent.slice(1);
    expect(after.every((c) => c.input.Bucket === STORAGE_TEST_BUCKET_LOCAL)).toBe(true);
    const list = after.find((c) => c.name === "ListObjectsV2Command");
    expect(list?.input.Prefix).toBe(prefix);
    const deletedKeys = after
      .filter((c) => c.name === "DeleteObjectsCommand" || c.name === "DeleteObjectCommand")
      .flatMap((c) =>
        c.name === "DeleteObjectCommand"
          ? [String(c.input.Key)]
          : ((c.input.Delete as { Objects: { Key: string }[] }).Objects ?? []).map((o) => o.Key),
      );
    expect(deletedKeys.sort()).toEqual([`${prefix}a.pdf`, `${prefix}b.pdf`]);
  });
});
