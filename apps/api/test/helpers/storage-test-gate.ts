/**
 * S16-SOCIAL-STORAGETESTGATE-1 (plan D-3) — CỔNG STORAGE DÙNG CHUNG cho int-spec chạm object storage THẬT.
 *
 * `storage-test-target.ts` là phần THUẦN (chốt tên đích, ghim env, định dạng nhãn); file này là phần I/O: dò bucket,
 * in nhãn, bỏ qua ca CÓ nhãn, dọn object theo tiền tố công ty test. Một chỗ thay cho các bản riêng đã từng có
 * (`openTestBucket`/`skipStorageCase` của s16, `skipCase` của s19).
 *
 * KHUÔN (mỗi int-spec storage):
 *   beforeAll NGOÀI CÙNG, TRƯỚC `Test.createTestingModule`:  gate = await openStorageTestGate("test/integration/<tệp>")
 *   mỗi ca storage, dòng đầu:                                 if (!gate.needStorage(ctx, "<mã ca> …")) return;
 *   afterAll:                                                 await gate?.removeObjects([`${companyId}/`])
 *
 * KẾT QUẢ CỦA `resolveStorageTestTarget` ⇒ hành vi:
 *   skip-file    ⇒ NÉM — file đang chạy mà cổng DB của helper đóng nghĩa là hai cổng lệch nhau.
 *   throw        ⇒ NÉM — CI thiếu storage là ĐỎ, không phải bỏ qua.
 *   skip-storage ⇒ một dòng warn CẤP TỆP (KHÔNG mang thẻ — guard không đếm), cổng ĐÓNG: `needStorage` in nhãn
 *                  `[storage-test-skip]` theo TỪNG CA rồi `ctx.skip()`; `s3()` NÉM ⇒ 0 lời gọi storage.
 *   run          ⇒ HeadBucket; NotFound ⇒ CreateBucket (tên đã qua chốt — chỉ tên cho phép); CreateBucket trả
 *                  `BucketAlreadyOwnedByYou` (fork khác vừa tạo) ⇒ HeadBucket lại để xác nhận; mọi lỗi khác ⇒ NÉM
 *                  ở MỌI môi trường. Mở xong ⇒ in nhãn `[storage-test-run]` (guard đếm tệp storage đã CHẠY).
 *
 * ⛔ ĐỪNG nuốt lỗi dò/tạo bucket thành «bỏ qua»: đó đúng là đường «xanh mà không chạy ca nào» WO này đóng lại.
 * ⛔ ĐỪNG nới regex tiền tố của `removeObjects`: tiền tố rỗng/sai ⇒ ListObjects + xoá CẢ bucket.
 */

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  resolveStorageTestTarget,
  storageRunLine,
  storageSkipLine,
  type StorageTestEnv,
} from "./storage-test-target";

const TAG = "[storage-gate]";
/** Tiền tố dọn DUY NHẤT được nhận: `<companyId test>/` — uuid chữ thường, đúng một cấp. */
const REMOVABLE_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/;

/** Mặt S3 tối thiểu cổng cần: `S3Client` thật, hoặc S3 giả tiêm vào ở unit (R3). */
export interface StorageTestS3 {
  send(command: unknown): Promise<unknown>;
  destroy?(): void;
}

/** Phần ngữ cảnh ca mà `needStorage` cần — khớp `TestContext` của vitest và ngữ cảnh giả của R3. */
export interface StorageCaseContext {
  readonly task: { readonly id: string };
  skip(note?: string): void;
}

export interface StorageTestGateOptions<C extends StorageTestS3> {
  /** Mặc định `process.env` (đã ghim bởi `vitest.config.ts` → `pinTestStorageEnv`). */
  env?: StorageTestEnv;
  /** Mặc định `S3Client` thật dựng từ `S3_*` của `env`. */
  makeS3?: () => C;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

interface StorageTestGateCommon<C> {
  /** Ca storage thật gọi ở DÒNG ĐẦU: đóng ⇒ in nhãn skip có `task` rồi `ctx.skip()` (vitest NÉM ở đây) + trả false. */
  needStorage(ctx: StorageCaseContext, caseName: string): boolean;
  /** Client S3 của cổng — NÉM khi cổng đóng (0 lời gọi). */
  s3(): C;
  /** Xoá mọi object dưới từng tiền tố `<uuid>/` trên `bucket` của cổng; tiền tố sai ⇒ NÉM; cổng đóng ⇒ không gọi gì. */
  removeObjects(prefixes: readonly string[]): Promise<void>;
}

export type StorageTestGate<C extends StorageTestS3 = S3Client> = StorageTestGateCommon<C> &
  (
    | { readonly run: true; readonly bucket: string }
    | { readonly run: false; readonly bucket: null; readonly reason: string }
  );

function errName(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === "string" && name.length > 0 ? name : "UnknownError";
}

function isNotFound(err: unknown): boolean {
  const status = (err as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata
    ?.httpStatusCode;
  return ["NotFound", "NoSuchBucket"].includes(errName(err)) || status === 404;
}

function defaultS3(env: StorageTestEnv): S3Client {
  // Cùng khuôn object-storage.service.ts:101 — `secretKey = env.X` nằm trong allowlist «đọc env» của
  // .gitleaks.toml; dạng `secretAccessKey: env.X` thì KHÔNG (trip generic-api-key).
  const accessKey = env.S3_ACCESS_KEY ?? "";
  const secretKey = env.S3_SECRET_KEY ?? "";
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION ?? "us-east-1",
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
}

/** Bucket đã qua chốt TÊN ⇒ bảo đảm nó tồn tại. Chỉ «không tồn tại» mới dẫn tới tạo; còn lại ném. */
async function ensureBucket(client: StorageTestS3, file: string, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch (err) {
    if (!isNotFound(err)) {
      throw new Error(`${TAG} ${file}: HeadBucket "${bucket}" lỗi ${errName(err)}`, { cause: err });
    }
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    return;
  } catch (err) {
    if (errName(err) !== "BucketAlreadyOwnedByYou") {
      throw new Error(`${TAG} ${file}: tạo bucket "${bucket}" lỗi ${errName(err)}`, { cause: err });
    }
  }
  // Fork khác vừa tạo cùng tên — xác nhận lại bằng HeadBucket; lỗi ở đây nổi lên nguyên vẹn.
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
}

function assertRemovable(file: string, prefixes: readonly string[]): void {
  const bad = prefixes.filter((p) => !REMOVABLE_PREFIX.test(p));
  if (bad.length > 0) {
    throw new Error(
      `${TAG} ${file}: removeObjects từ chối tiền tố ${JSON.stringify(bad)} — chỉ nhận "<uuid chữ thường>/"`,
    );
  }
}

async function removeUnderPrefix(client: StorageTestS3, bucket: string, prefix: string) {
  let token: string | undefined;
  do {
    const page = (await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    )) as ListObjectsV2CommandOutput;
    const keys = (page.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => typeof k === "string" && k.startsWith(prefix));
    // Xoá từng khoá (DeleteObject) — không DeleteObjects: tránh lệ thuộc header checksum giữa các bản SDK/storage.
    for (const Key of keys) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

function closedGate<C extends StorageTestS3>(
  file: string,
  reason: string,
  warn: (line: string) => void,
): StorageTestGate<C> {
  return {
    run: false,
    bucket: null,
    reason,
    needStorage(ctx, caseName) {
      warn(storageSkipLine({ file, task: ctx.task.id, caseName, reason }));
      ctx.skip();
      return false;
    },
    s3() {
      throw new Error(`${TAG} ${file}: gọi storage khi cổng đang ĐÓNG (${reason})`);
    },
    async removeObjects(prefixes) {
      assertRemovable(file, prefixes);
    },
  };
}

function openGate<C extends StorageTestS3>(
  file: string,
  bucket: string,
  client: C,
): StorageTestGate<C> {
  return {
    run: true,
    bucket,
    needStorage: () => true,
    s3: () => client,
    async removeObjects(prefixes) {
      assertRemovable(file, prefixes);
      for (const prefix of prefixes) await removeUnderPrefix(client, bucket, prefix);
    },
  };
}

/** Gọi ở beforeAll NGOÀI CÙNG, trước khi dựng app. `file` = đường dẫn tính từ `apps/api` (vào nhãn log). */
export function openStorageTestGate(
  file: string,
  opts?: StorageTestGateOptions<S3Client>,
): Promise<StorageTestGate<S3Client>>;
export function openStorageTestGate<C extends StorageTestS3>(
  file: string,
  opts: StorageTestGateOptions<C> & { makeS3: () => C },
): Promise<StorageTestGate<C>>;
export async function openStorageTestGate(
  file: string,
  opts: StorageTestGateOptions<StorageTestS3> = {},
): Promise<StorageTestGate<StorageTestS3>> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.log(line));
  const warn = opts.warn ?? ((line: string) => console.warn(line));

  const target = resolveStorageTestTarget(env);
  if (target.kind === "skip-file") {
    throw new Error(
      `${TAG} ${file}: hai cổng lệch nhau — file đang chạy nhưng cổng DB của helper đóng (${target.reason})`,
    );
  }
  if (target.kind === "throw") throw new Error(`${TAG} ${file}: ${target.reason}`);
  if (target.kind === "skip-storage") {
    warn(`${TAG} ${file}: ca storage thật sẽ BỎ QUA (có nhãn theo từng ca) — ${target.reason}`);
    return closedGate(file, target.reason, warn);
  }

  const client = opts.makeS3 ? opts.makeS3() : defaultS3(env);
  try {
    await ensureBucket(client, file, target.bucket);
  } catch (err) {
    client.destroy?.();
    throw err;
  }
  log(storageRunLine({ file, bucket: target.bucket }));
  return openGate(file, target.bucket, client);
}
