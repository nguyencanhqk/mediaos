import type { Pool } from "pg";

/**
 * S16-SOCIAL-GROUPTOCTOU-1 — vị từ chờ khoá DÙNG CHUNG cho mọi harness đua «giữ khoá hàng → phóng
 * request → chờ request BỊ CHẶN → đổi dữ liệu → nhả» (plan `docs/plans/S16-SOCIAL-GROUPTOCTOU-1.md`
 * §5.1, đo §2 M19–M30).
 *
 * ┌─ VÌ SAO KHÔNG KHỚP CHỮ CÂU LỆNH (`wait_event_type='Lock' AND query ILIKE '%feed_%'`) ───────────┐
 * │ Vị từ khớp chữ đếm MỌI backend đang chờ khoá có chữ đó — kể cả waiter của spec KHÁC chạy song  │
 * │ song trên cùng DB (vitest chạy file song song mặc định) và, nếu thiếu `datname`, cả waiter của │
 * │ lane DB khác trên cùng instance (`pg_stat_activity` nhìn toàn cluster — M19). Đo TẤT ĐỊNH (M20): │
 * │ hai waiter ngoại làm vị từ cũ = 2 khi CHƯA có request nào được phóng ⇒ ca đua tiến SỚM, xanh-  │
 * │ rỗng. Dưới tải cả bộ SOCIAL (M25) tiền đề đó xảy ra thật ở 10,4% lượt.                        │
 * │ Ở đây chỉ đếm backend bị CHÍNH `holderPid` chặn — cạnh chặn thật (`pg_blocking_pids`), độc lập │
 * │ chữ câu lệnh: phủ cả chờ `SELECT … FOR UPDATE` lẫn chờ `UPDATE` (M22).                          │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ VÌ SAO BẮC CẦU (đệ quy), KHÔNG MỘT BẬC ────────────────────────────────────────────────────────┐
 * │ Waiter bậc 2 bị waiter bậc 1 chặn, KHÔNG bị holder: `pg_blocking_pids(W2) = [W1]` (M20). Hàng   │
 * │ đợi trên CÙNG một hàng cũng vậy — request thứ hai chờ `tuple` do request thứ nhất giữ (M29). Vị │
 * │ từ một bậc dừng ở 1 và không bao giờ đạt n=2 của các ca hai-request (be3a R6/R7, be3c D6/D7).   │
 * │ `UNION` (không `UNION ALL`) khử trùng nên đệ quy tự dừng.                                       │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `directPool()` có `max: 4` (`integration-db.ts`). Ca nào giữ NHIỀU client cùng lúc (holder +
 * waiter tự dựng) phải lấy chúng từ pool RIÊNG rồi `end()` trong `finally` — giữ đủ 4 client của
 * `direct` rồi gọi hàm ở đây là câu đếm thứ 5 TREO tới hết `testTimeout` (M26).
 *
 * ⚠️ `pg_blocking_pids()` lấy LWLock của lock manager TOÀN instance (instance này cũng phục vụ DB
 * PROD). Câu đếm vì vậy CHỐT trước tập ứng viên — backend CÙNG DB đang chờ khoá nặng
 * (`wait_event_type='Lock'`; chỉ chúng mới có thể bị chặn) — trong CTE `MATERIALIZED`, rồi mới gọi
 * hàm trên tập đó. Bản đầu gọi hàm cho MỌI backend của cluster: planner đặt filter chứa hàm lên
 * function scan `pg_stat_get_activity`, TRƯỚC phép nối lọc `datname` (database-reviewer, FULL gate
 * lượt 1 — `EXPLAIN (ANALYZE, VERBOSE)`: «Rows Removed by Filter» = mọi backend của 2 DB).
 */

const POLL_MS = 25;

/** Bao đóng bắc cầu của «bị `$1` chặn», chỉ trong DB hiện tại. KHÔNG đọc `query`. */
const BLOCKED_BY_SQL = `WITH RECURSIVE lane AS MATERIALIZED (
    SELECT a.pid FROM pg_stat_activity a
     WHERE a.datname = current_database() AND a.wait_event_type = 'Lock'
  ), blocked(pid) AS (
    SELECT l.pid FROM lane l WHERE $1::int = ANY(pg_blocking_pids(l.pid))
    UNION
    SELECT l.pid FROM lane l JOIN blocked b ON b.pid = ANY(pg_blocking_pids(l.pid))
  ) SELECT count(*)::int AS n FROM blocked`;

/** Số backend CÙNG DB bị `holderPid` chặn trực tiếp hoặc bắc cầu. */
export async function countBlockedBy(pool: Pool, holderPid: number): Promise<number> {
  const r = await pool.query<{ n: number }>(BLOCKED_BY_SQL, [holderPid]);
  return r.rows[0].n;
}

/**
 * Poll mỗi 25ms tới khi `countBlockedBy` thoả (`exact ? n === want : n >= want`).
 *
 * @returns `false` khi hết `timeoutMs` — caller PHẢI `expect(…).toBe(true)` có nhãn; hết trần là ĐỎ
 *   rõ ràng («không chồng lấp được»), không bao giờ là xanh.
 */
export async function waitForBlockedBy(
  pool: Pool,
  holderPid: number,
  want: number,
  opts: { exact?: boolean; timeoutMs: number },
): Promise<boolean> {
  const exact = opts.exact ?? false;
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    const n = await countBlockedBy(pool, holderPid);
    if (exact ? n === want : n >= want) return true;
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
  return false;
}
