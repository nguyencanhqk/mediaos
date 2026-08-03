/**
 * S7-QA-OUTBOXPROBE-1 — MUTEX TOÀN CỤC cho mọi int-spec tự lái `OutboxWorker`.
 *
 * ══ VÌ SAO CẦN ══
 * `outbox_events` là bảng CHUNG và `OutboxWorker.claim()` chọn hàng bằng
 * `WHERE status='pending' AND available_at <= now()` — **KHÔNG lọc tenant, KHÔNG lọc chủ sở hữu**.
 * Vitest chạy mỗi file int-spec trong MỘT FORK RIÊNG, song song, trên CÙNG một lane DB. Hôm nay có 11 file
 * tự gọi `processBatch()`/`drainOutboxUntilSettled()` ⇒ 11 worker độc lập cùng tranh một hàng đợi.
 *
 * Hai chiều hỏng, cả hai đã đỏ THẬT trên master:
 *   (1) **BỊ CƯỚP / BỊ CHIA LÔ** — worker của spec khác claim mất event của mình. Nếu bus của nó KHÔNG có
 *       consumer cho event đó thì `processEvent` đánh `'done'` TERMINAL và IM LẶNG ⇒ event bốc hơi. Nếu nó
 *       CÓ consumer (mọi spec boot `AppModule` đều có đủ bridge) thì event vẫn được xử lý ĐÚNG — nhưng bởi
 *       một tiến trình KHÁC, nên **thứ tự giao chéo-worker không còn bảo đảm gì**.
 *   (2) **ĐI CƯỚP** — chính mình nuốt event của spec khác, y hệt cơ chế trên.
 *
 * ══ BẰNG CHỨNG (đo 2026-08-03, lane `mediaos_obprobe`, 11 file outbox chạy chung) ══
 * `chat-noti-e2e` ca 6b đỏ `expected 2 to be 1`. Log `claim()` kèm `process.pid` cho thấy ba event của CÙNG
 * một phòng bị chia cho HAI tiến trình:
 *     pid=30784 claimed=734bef5d              ← tin #1 (unread_count=1)
 *     pid=40996 claimed=a903418d,dcc733f8     ← tin #2, #3
 * `processed_events.processed_at`: tin #2 lúc .285089 — TRƯỚC tin #1 lúc .289006 ⇒ tin #2 thắng cuộc gộp
 * dedupe và đóng dấu `unread_count=2`. Cả ba hàng đều `attempts=0`, `available_at` NGUYÊN VẸN (= `created_at`,
 * tăng dần đúng thứ tự gửi), cùng một `consumer_name`. Tức: **KHÔNG phải retry, KHÔNG phải `available_at` bị
 * ghi đè, KHÔNG phải hoà tie-break trong-transaction** — đúng một nguyên nhân: hai worker, hai lô claim rời nhau.
 *
 * Đây cũng chính là giới hạn (3) "đa-instance" mà `OutboxWorker.claim()` đã tự khai: bảo đảm thứ tự của
 * KI-059 chỉ có hiệu lực TRONG MỘT LÔ CLAIM CỦA MỘT WORKER. Bản vá KI-059 KHÔNG hỏng — hạ tầng test đang
 * dựng ra đúng cái điều kiện mà bảo đảm ấy không với tới.
 *
 * ══ VÌ SAO KHOÁ, KHÔNG PHẢI NỚI ASSERT / LỌC TENANT ══
 * • Nới assert = đóng đinh lỗ hổng ở tư thế mở (ca 6b chính là NGHIỆM THU của KI-059).
 * • Thêm `AND company_id = ANY(...)` vào `claim()` = đổi code SẢN PHẨM chỉ để chiều test, và đổi luôn hình
 *   dạng câu SQL mà `outbox-fifo.int-spec.ts` sinh ra để ĐO thứ tự ⇒ làm yếu chính cái đai đang canh KI-059.
 * • Khoá tư vấn nằm HOÀN TOÀN ở tầng test: sản phẩm không đổi một dòng, và điều kiện "một worker tại một
 *   thời điểm" đúng bằng ĐỊNH NGHĨA thay vì bằng may rủi.
 *
 * ══ DÙNG NHƯ THẾ NÀO ══
 * Lấy khoá ở CUỐI `beforeAll` ngoài cùng (sau khi boot app + seed xong — boot vẫn chạy song song, chỉ THÂN
 * test mới xếp hàng), trả ở ĐẦU `afterAll` ngoài cùng:
 *
 *   let outboxLock: OutboxWorkerLock | undefined;
 *   beforeAll(async () => {
 *     …boot + seed…
 *     outboxLock = await acquireOutboxWorkerLock("tên-spec");
 *   }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);
 *   afterAll(async () => {
 *     await outboxLock?.release();
 *     …teardown…
 *   });
 *
 * Hook nào có bước xếp hàng PHẢI nới timeout lên `OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS` — mặc định 30s của
 * vitest KHÔNG đủ khi 11 spec nối đuôi nhau.
 *
 * ⚠️ Spec MỚI nào lái worker mà QUÊN lấy khoá sẽ tái sinh y nguyên lỗi ngắt quãng này, và nó xanh khi chạy
 * cô lập nên review rất dễ bỏ lọt. `outbox-worker-lock.unit-spec.ts` là đai chống quên: nó điểm danh mọi
 * file test có `processBatch(`/`drainOutboxUntilSettled(` và bắt file đó phải gọi `acquireOutboxWorkerLock`.
 */

import { Client } from "pg";
import { directUrl } from "./integration-db";

/**
 * Khoá tư vấn tầm-SESSION, dạng 1 tham số (int8) — CÙNG không gian khoá với
 * `pg_advisory_xact_lock(hashtext('ensure_default_company'))` của mig 0473, nên giá trị phải khác nó
 * (đã đối chiếu: hashtext = -2030916760) và khác `ENCRYPTION_KEYS_LOCK_KEY` (962006002).
 * Dạng 2 tham số của `task-file.service.ts` nằm ở không gian khoá khác ⇒ không đụng.
 */
export const OUTBOX_WORKER_LOCK_KEY = 962_059_001; // "059" = KI-059

/** Trần thời gian một spec chịu xếp hàng chờ tới lượt lái worker (11 spec nối đuôi). */
export const OUTBOX_WORKER_LOCK_TIMEOUT_MS = 240_000;

/** Timeout cho hook `beforeAll` có bước xếp hàng. PHẢI lớn hơn `OUTBOX_WORKER_LOCK_TIMEOUT_MS`. */
export const OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS = 300_000;

export interface OutboxWorkerLock {
  /** Trả khoá + đóng kết nối riêng. Gọi lại lần hai là vô hại. */
  release(): Promise<void>;
}

/**
 * Giữ khoá cho tới khi `release()`. Khoá tư vấn tầm-session ⇒ nếu fork chết giữa chừng, Postgres tự trả
 * khoá lúc kết nối đứt (không có nguy cơ kẹt vĩnh viễn cho lượt chạy sau).
 *
 * `lock_timeout` CÓ hiệu lực với `pg_advisory_lock` (đã đo). Nhờ nó, kẹt khoá cho lỗi 55P03 kèm thông điệp
 * chỉ đúng nguyên nhân, thay vì hook treo tới khi vitest bắn "hook timed out" — thứ chẳng nói được gì.
 *
 * @param specLabel tên spec, chỉ để thông điệp lỗi đọc được.
 */
export async function acquireOutboxWorkerLock(specLabel: string): Promise<OutboxWorkerLock> {
  // `Client` chứ KHÔNG phải `Pool`: khoá tầm-session phải sống trên ĐÚNG MỘT kết nối suốt vòng đời spec —
  // pool có thể trả client về rồi cấp lại cho câu khác, và `pg_advisory_unlock` chạy nhầm kết nối là no-op
  // trả `false` IM LẶNG (khoá kẹt tới hết tiến trình). Một kết nối tường minh cũng bớt một bước teardown.
  const client = new Client({ connectionString: directUrl });
  let released = false;

  const teardown = async (): Promise<void> => {
    await client.end();
  };

  await client.connect();
  try {
    // Số nguyên do chính file này định nghĩa (không phải input) ⇒ nội suy an toàn; `SET` không nhận bind param.
    await client.query(`SET lock_timeout = ${Math.trunc(OUTBOX_WORKER_LOCK_TIMEOUT_MS)}`);
    await client.query("SELECT pg_advisory_lock($1)", [OUTBOX_WORKER_LOCK_KEY]);
  } catch (err) {
    await teardown();
    throw new Error(
      `[outbox-worker-lock] '${specLabel}' chờ quá ${OUTBOX_WORKER_LOCK_TIMEOUT_MS}ms vẫn không lấy được ` +
        `khoá ${OUTBOX_WORKER_LOCK_KEY}. Một spec lái outbox khác đang giữ khoá quá lâu (treo trong drain?) ` +
        `hoặc quên gọi release(). Nguyên nhân gốc: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    release: async () => {
      if (released) return;
      released = true;
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [OUTBOX_WORKER_LOCK_KEY]);
      } finally {
        await teardown();
      }
    },
  };
}
