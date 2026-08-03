import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OUTBOX_WORKER_LOCK_KEY } from "./outbox-worker-lock";

/**
 * S7-QA-OUTBOXPROBE-1 — ĐAI CHỐNG QUÊN cho mutex outbox.
 *
 * Vì sao cần một phép điểm danh thay vì tin vào review: spec lái `OutboxWorker` mà QUÊN lấy khoá vẫn
 * **XANH khi chạy cô lập** — hỏng chỉ lộ ra dưới tải song song, ở một file KHÁC, dưới dạng đỏ ngắt quãng
 * (chính là cách `outbox-fifo` và `chat-noti-e2e` ca 6b đã đỏ). Không có gì trong vòng review bình thường
 * bắt được thiếu sót đó, nên nó phải là một phép đếm tự động.
 *
 * Không cần DB ⇒ chạy trong lượt unit mặc định (`pnpm test`), không nấp sau `skipIf(!hasDb)`.
 */
describe("S7-QA-OUTBOXPROBE-1 — mọi spec lái OutboxWorker phải giữ mutex", () => {
  const TEST_ROOT = "test";
  /** File hạ tầng định nghĩa/kiểm chính cơ chế khoá — không phải spec lái worker. */
  const INFRA = new Set([
    "test/helpers/outbox-drain.ts",
    "test/helpers/outbox-worker-lock.ts",
    "test/helpers/outbox-worker-lock.unit-spec.ts",
  ]);

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
    );

  it("file test nào gọi processBatch/drainOutboxUntilSettled thì phải gọi acquireOutboxWorkerLock", () => {
    const offenders = walk(TEST_ROOT)
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => !INFRA.has(f))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        const drivesWorker = /\.processBatch\(|drainOutboxUntilSettled\(/.test(src);
        return drivesWorker && !/acquireOutboxWorkerLock\(/.test(src);
      });

    expect(
      offenders,
      "spec lái OutboxWorker mà không giữ mutex ⇒ nó sẽ chia lô claim với spec khác trên lane DB dùng " +
        "chung, đẻ ra đỏ NGẮT QUÃNG ở file khác. Xem test/helpers/outbox-worker-lock.ts để biết cách gắn.",
    ).toEqual([]);
  });

  it("khoá dùng MỘT key duy nhất — mọi spec phải xếp cùng một hàng", () => {
    // Hai key khác nhau = hai hàng đợi rời nhau = không loại trừ nhau = mutex vô nghĩa, mà vẫn "trông như"
    // đã khoá ở mọi call-site.
    const keys = new Set(
      walk(TEST_ROOT)
        .map((f) => readFileSync(f, "utf8"))
        .flatMap((src) => src.match(/OUTBOX_WORKER_LOCK_KEY\s*=\s*[\d_]+/g) ?? []),
    );
    expect(keys.size).toBe(1);
    expect(OUTBOX_WORKER_LOCK_KEY).toBe(962_059_001);
  });
});
