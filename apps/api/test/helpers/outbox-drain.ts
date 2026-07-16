/**
 * drainOutboxUntilSettled — drain outbox trong int-spec AN TOÀN dưới full-suite song song.
 *
 * BỐI CẢNH (CI đỏ 2026-07-15, 2 lần liên tiếp trên master): các spec bridge cũ drain bằng vòng lặp
 * `processBatch()` tới khi `claimed == 0`. Nhưng `outbox_events` là bảng CHUNG và claim dùng
 * FOR UPDATE SKIP LOCKED KHÔNG lọc tenant ⇒ app instance của spec KHÁC chạy song song có thể claim
 * event của spec này trước. Khi đó `claimed == 0` NGAY LẬP TỨC dù event của mình còn 'processing' ở
 * instance khác → assert quá sớm → "expected [] to have a length of 1" (leave-noti-e2e ×2 trên master).
 *
 * FIX: điều kiện dừng ĐÚNG = "mọi event outbox CỦA TENANT MÌNH đã về trạng thái terminal (done/dead)",
 * không phải "mình không claim được gì nữa":
 *   1. mỗi vòng vẫn gọi `processBatch()` (tự chạy reaper + claim + dispatch);
 *   2. đếm event own-tenant còn status IN ('pending','processing') — 0 ⇒ xong;
 *   3. own-tenant 'processing' kẹt quá `requeueGraceMs` (instance khác đã đóng app giữa chừng, reaper
 *      chính thức 5 phút — quá lâu cho test) → trả về 'pending' để vòng sau tự claim lại. AN TOÀN vì
 *      idempotency 2 tầng: processed_events (OutboxWorker) + DedupeKey=eventId (NOTI engine) — event
 *      xử lý lặp KHÔNG tạo notification đôi;
 *   4. quá `timeoutMs` → throw kèm danh sách event còn kẹt (fail-LOUD, không treo vô hạn).
 */

interface DrainWorker {
  processBatch(): Promise<{ claimed: number; deadLettered: number }>;
}

interface DrainQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEUE_GRACE_MS = 2_000;
const POLL_INTERVAL_MS = 100;

export async function drainOutboxUntilSettled(opts: {
  worker: DrainWorker;
  direct: DrainQueryable;
  companyIds: readonly string[];
  timeoutMs?: number;
  requeueGraceMs?: number;
}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requeueGraceMs = opts.requeueGraceMs ?? DEFAULT_REQUEUE_GRACE_MS;
  const ids = [...opts.companyIds];
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    await opts.worker.processBatch();

    const remaining = await opts.direct.query(
      `SELECT id, event_type, status, attempts FROM outbox_events
         WHERE company_id = ANY($1::uuid[]) AND status IN ('pending','processing')`,
      [ids],
    );
    if (remaining.rows.length === 0) return;

    if (Date.now() > deadline) {
      throw new Error(
        `drainOutboxUntilSettled: quá ${timeoutMs}ms vẫn còn ${remaining.rows.length} event chưa terminal: ` +
          JSON.stringify(remaining.rows),
      );
    }

    // Own-tenant 'processing' kẹt (instance khác giữ claim rồi đóng app) → trả 'pending' sớm hơn reaper
    // chính thức (5 phút). Đồng thời kéo available_at về now để event pending-retry (backoff 30s) không
    // bắt test chờ backoff — semantics retry THẬT đã có outbox.int-spec.ts riêng cover.
    await opts.direct.query(
      `UPDATE outbox_events SET status = 'pending', updated_at = now(), available_at = now()
         WHERE company_id = ANY($1::uuid[]) AND status = 'processing'
           AND updated_at < now() - make_interval(secs => $2::float8)`,
      [ids, requeueGraceMs / 1000],
    );
    await opts.direct.query(
      `UPDATE outbox_events SET available_at = now()
         WHERE company_id = ANY($1::uuid[]) AND status = 'pending' AND available_at > now()`,
      [ids],
    );

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
