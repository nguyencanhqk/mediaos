/**
 * S16-SOCIAL-STORAGETESTGATE-1 (plan D-10) — TRIPWIRE lời gọi object storage ở hồ sơ `offline`.
 *
 * `vitest.config.ts` khai tệp này trong `setupFiles` ⇒ chạy trước MỖI tệp test của gói api. Khi
 * `STORAGE_TEST_PROFILE=offline` (do `pinTestStorageEnv` ghim — mặc định ở máy dev), nó bọc
 * `S3Client.prototype.send`: mọi lời gọi in MỘT dòng nhãn `[storage-test-call] {"file":…,"command":…}` rồi bị
 * từ chối — không byte nào tới MinIO/R2. `harness/lane-db-guard.mjs` đếm nhãn này: strict ⇒ ĐỎ.
 *
 * Vì sao đo TRỰC TIẾP thay vì tin khoá giả: «0 lời gọi storage khi cổng đóng» (done_when 1) phải đếm được, và
 * lời gọi NGẦM phía server (confirm · PDF phiếu lương · dọn tệp tạm) phải lộ ra kèm tên tệp test.
 *
 * Hồ sơ `live` KHÔNG cài gì. Presign (`getSignedUrl`) không đi qua `send` ⇒ không bị chặn (ký là việc cục bộ).
 * Spec tự `vi.mock("@aws-sdk/client-s3")` nhận bản giả của chính nó — prototype thật ở đây không dính tới.
 *
 * Cài ĐÚNG MỘT LẦN mỗi prototype (dấu `Symbol.for`): gói `@aws-sdk/client-s3` có thể được Node cache dùng chung
 * giữa các tệp test trong cùng worker, còn tệp setup chạy lại cho từng tệp ⇒ không được bọc chồng nhiều lớp.
 * Tên tệp đọc LÚC GỌI (`expect.getState().testPath`) nên luôn là tệp đang chạy.
 */
import { join, relative } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { expect } from "vitest";
import { STORAGE_TEST_PROFILE_ENV, storageCallLine } from "../helpers/storage-test-target";

const API_ROOT = join(__dirname, "../../");
const INSTALLED = Symbol.for("mediaos.test.storageCallTripwire");

/** Lỗi lời gọi storage bị chặn — tên riêng để log/ca test nhận ra, không lẫn với lỗi mạng. */
export class StorageCallBlockedError extends Error {
  constructor(
    readonly file: string,
    readonly command: string,
  ) {
    super(
      `[storage-call-tripwire] chặn ${command} từ ${file}: hồ sơ storage test = offline ` +
        "(S3_* không trỏ bucket test cho phép) — ca chạm storage thật phải qua openStorageTestGate().needStorage",
    );
    this.name = "StorageCallBlockedError";
  }
}

function currentTestFile(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) return "(không rõ tệp test)";
  return relative(API_ROOT, testPath).replace(/\\/g, "/");
}

function commandName(command: unknown): string {
  if (typeof command === "object" && command !== null) {
    const name = (command as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof name === "string" && name.length > 0) return name;
  }
  return typeof command;
}

function blockedSend(command: unknown): Promise<never> {
  const file = currentTestFile();
  const name = commandName(command);
  console.warn(storageCallLine({ file, command: name }));
  return Promise.reject(new StorageCallBlockedError(file, name));
}

function installTripwire(): void {
  const proto = S3Client.prototype as object;
  if (Object.prototype.hasOwnProperty.call(proto, INSTALLED)) return;
  Object.defineProperty(proto, "send", { value: blockedSend, configurable: true, writable: true });
  Object.defineProperty(proto, INSTALLED, { value: true });
}

if (process.env[STORAGE_TEST_PROFILE_ENV] === "offline") {
  installTripwire();
}
