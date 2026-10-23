import { Pool, type PoolClient } from "pg";
import { directUrl } from "./integration-db";
import { countBlockedBy, waitForBlockedBy } from "./lock-wait";

/**
 * S16-SOCIAL-QA-1 (L0) — phần «đua tất định + PRNG» của bộ đồ nghề QA SOCIAL, tách khỏi
 * `social-qa1-kit.ts` để mỗi file < 800 dòng. ĐÓNG BĂNG sau L0: lát sau KHÔNG sửa file này; cần thêm
 * tiện ích thì đặt trong spec của lát hoặc file helper mới mang tên lát.
 *
 * Khuôn đua (plan D7): giữ `FOR UPDATE` trên hàng CHA bằng pool RIÊNG → phóng N request → chờ tới khi
 * đúng N backend bị CHÍNH holder chặn (`pg_blocking_pids`, `lock-wait.ts`) → (tuỳ chọn) đổi dữ liệu
 * trong tx giữ khoá → nhả → thu kết quả. Không `sleep` cố định; hết trần là lỗi HARNESS có nhãn riêng
 * (`Qa1HarnessTimeout`), không bao giờ đọc thành kết quả của sản phẩm.
 *
 * ⚠️ File này KHÔNG dựng request HTTP (không import supertest): request do spec trao vào dưới dạng
 * hàm `fire`.
 * ⚠️ `pg_blocking_pids` lấy khoá toàn instance — không poll dày hơn 25 ms (đã ép ở `lock-wait.ts`),
 * không nhân số ca đua vô tội vạ.
 */

/** Bảng CHA mà các đường ghi SOCIAL khoá hàng — danh sách đóng, tên bảng KHÔNG nhận từ ngoài. */
export const QA1_LOCK_TABLES = [
  "feed_posts",
  "feed_comments",
  "feed_groups",
  "feed_polls",
] as const;
export type Qa1LockTable = (typeof QA1_LOCK_TABLES)[number];

export interface Qa1LockTarget {
  table: Qa1LockTable;
  companyId: string;
  /** Giá trị của cột khoá (mặc định cột `id`). */
  id: string;
  /** `post_id` chỉ hợp lệ với `feed_polls` / `feed_comments` (khoá theo bài cha). Mặc định `id`. */
  by?: "id" | "post_id";
}

/** Hết trần chờ mà số request bị chặn chưa đạt — lỗi của HARNESS, tách khỏi assert sản phẩm. */
export class Qa1HarnessTimeout extends Error {
  constructor(message: string) {
    super(`QA1-HARNESS (không phải kết quả sản phẩm — chạy lại ca): ${message}`);
    this.name = "Qa1HarnessTimeout";
  }
}

export interface HeldRowLock {
  /** pid backend đang giữ khoá — đầu vào của `countBlockedBy`. */
  pid: number;
  /** Client đang ở GIỮA tx giữ khoá: dùng để đổi dữ liệu «trong lúc request đang xếp hàng». */
  client: PoolClient;
  /** Số hàng mà câu `FOR UPDATE` khoá được (0 ⇒ đích không tồn tại — ca dựng sai). */
  lockedRows: number;
  /** Số backend cùng DB đang bị holder này chặn (trực tiếp hoặc bắc cầu). */
  countBlocked(): Promise<number>;
  /** Poll 25 ms tới khi số bị chặn đạt `want`; `false` = hết trần. */
  waitBlocked(want: number, opts: { exact?: boolean; timeoutMs: number }): Promise<boolean>;
  /** Nhả khoá (mặc định ROLLBACK) + đóng pool riêng. Gọi nhiều lần vẫn an toàn. */
  release(mode?: "rollback" | "commit"): Promise<void>;
}

/**
 * Giữ `SELECT … FOR UPDATE` trên MỘT hàng cha bằng pool RIÊNG (`max: 3` — không đụng `directPool()`
 * vốn chỉ có 4 kết nối).
 *
 * @param target bảng (danh sách đóng) + `companyId` + giá trị cột khoá.
 * @param opts.lockTimeout trần chờ của CHÍNH holder khi lấy khoá (mặc định `5s`).
 * @returns `HeldRowLock` — caller PHẢI `release()` trong `finally` (pool riêng đóng ở đó).
 * Bẫy: `lockedRows === 0` nghĩa là không khoá được gì — hàm NÉM để ca không «đua với không khí».
 */
export async function holdRowLock(
  target: Qa1LockTarget,
  opts: { lockTimeout?: "3s" | "5s" | "10s" } = {},
): Promise<HeldRowLock> {
  if (!QA1_LOCK_TABLES.includes(target.table)) {
    throw new Error(`holdRowLock: bảng ngoài danh sách đóng: ${String(target.table)}`);
  }
  const by = target.by ?? "id";
  if (by === "post_id" && target.table !== "feed_polls" && target.table !== "feed_comments") {
    throw new Error(`holdRowLock: bảng ${target.table} không khoá theo post_id`);
  }
  const pool = new Pool({ connectionString: directUrl, max: 3 });
  let client: PoolClient | undefined;
  let released = false;
  const closeAll = async (mode: "rollback" | "commit"): Promise<void> => {
    if (released) return;
    released = true;
    try {
      if (client) {
        await client.query(mode === "commit" ? "COMMIT" : "ROLLBACK").then(
          () => client?.release(),
          (err: Error) => client?.release(err),
        );
      }
    } finally {
      await pool.end();
    }
  };
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(`SET LOCAL lock_timeout = '${opts.lockTimeout ?? "5s"}'`);
    const pid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const locked = await client.query(
      `SELECT 1 FROM ${target.table} WHERE company_id = $1 AND ${by} = $2 FOR UPDATE`,
      [target.companyId, target.id],
    );
    const lockedRows = locked.rowCount ?? 0;
    if (lockedRows === 0) {
      throw new Error(
        `holdRowLock: không hàng nào của ${target.table} khớp ${by}=${target.id} trong công ty ${target.companyId}`,
      );
    }
    return {
      pid,
      client,
      lockedRows,
      countBlocked: () => countBlockedBy(pool, pid),
      waitBlocked: (want, o) => waitForBlockedBy(pool, pid, want, o),
      release: (mode = "rollback") => closeAll(mode),
    };
  } catch (err) {
    await closeAll("rollback");
    throw err;
  }
}

export interface FireUnderLockOptions {
  /**
   * `require-blocked` (mặc định): MỌI request phải xếp hàng sau khoá (đúng `want` backend bị chặn) rồi
   * mới nhả — hết trần ⇒ `Qa1HarnessTimeout`.
   * `observe`: chỉ quan sát — request trả lời TRƯỚC khoá (`queued:false`) hay bị chặn (`queued:true`);
   * không ném khi không bị chặn.
   */
  mode?: "require-blocked" | "observe";
  /** Số backend phải bị chặn (mặc định = số request). */
  want?: number;
  /** So sánh `===` (mặc định `true`) hay `>=`. */
  exact?: boolean;
  /** Trần chờ bị chặn, ms (mặc định 3000; đường poll của sản phẩm có `lock_timeout` 3 s ⇒ truyền ≤ 1500). */
  waitMs?: number;
  /** Chạy TRONG tx giữ khoá, sau khi request đã xếp hàng; có hàm này ⇒ tx được COMMIT khi nhả. */
  whileBlocked?: (client: PoolClient) => Promise<void>;
}

export interface FireUnderLockResult<T> {
  /** Kết quả của từng `fire`, đúng thứ tự truyền vào. */
  results: T[];
  /** Số backend bị holder chặn tại thời điểm quyết định. */
  blocked: number;
  /** Có ít nhất một request xếp hàng sau khoá. */
  queued: boolean;
}

/**
 * Giữ khoá hàng cha → phóng mọi `fire` → chờ chúng BỊ CHẶN → (tuỳ chọn) `whileBlocked` → nhả → trả kết quả.
 *
 * @param target hàng cha cần khoá (xem `holdRowLock`).
 * @param fire mỗi phần tử trả một thenable (vd `() => w.put(tok, url).send(body)`); KHÔNG tự `await` trước.
 * @returns `results` theo thứ tự `fire`, `blocked`, `queued`.
 * Bẫy: (1) request không bao giờ mồ côi — `allSettled` gắn ngay lúc phóng, khoá nhả TRƯỚC khi chờ
 * request; (2) N request cần N kết nối của pool app (max 20) — giữ N ≤ 5; (3) route có `lock_timeout`
 * (poll 3 s) phải được hâm nóng trước và dùng `waitMs` ≤ 1500.
 */
export async function fireUnderLock<T>(
  target: Qa1LockTarget,
  fire: ReadonlyArray<() => PromiseLike<T>>,
  opts: FireUnderLockOptions = {},
): Promise<FireUnderLockResult<T>> {
  const mode = opts.mode ?? "require-blocked";
  const want = opts.want ?? fire.length;
  const exact = opts.exact ?? true;
  const waitMs = opts.waitMs ?? 3_000;
  const hold = await holdRowLock(target);
  let settled: Promise<unknown> | undefined;
  try {
    let responded = 0;
    const pending = fire.map((f) =>
      Promise.resolve(f()).then(
        (r) => {
          responded += 1;
          return r;
        },
        (err: unknown) => {
          responded += 1;
          throw err;
        },
      ),
    );
    settled = Promise.allSettled(pending);

    let blocked = 0;
    if (mode === "require-blocked") {
      const ok = await hold.waitBlocked(want, { exact, timeoutMs: waitMs });
      blocked = await hold.countBlocked();
      if (!ok) {
        throw new Qa1HarnessTimeout(
          `chờ ${want} request xếp hàng sau khoá ${target.table} quá ${waitMs} ms ` +
            `(đang chặn ${blocked}, đã trả lời ${responded}/${fire.length})`,
        );
      }
    } else {
      const deadline = Date.now() + waitMs;
      while (responded < fire.length && blocked === 0 && Date.now() < deadline) {
        blocked = await hold.countBlocked();
        if (blocked === 0 && responded < fire.length) {
          await new Promise((res) => setTimeout(res, 25));
        }
      }
      if (responded < fire.length && blocked === 0) {
        throw new Qa1HarnessTimeout(
          `request không trả lời cũng không bị chặn bởi khoá ${target.table} trong ${waitMs} ms`,
        );
      }
    }

    if (opts.whileBlocked) {
      await opts.whileBlocked(hold.client);
      await hold.release("commit");
    } else {
      await hold.release("rollback");
    }
    const results = await Promise.all(pending);
    return { results, blocked, queued: blocked > 0 };
  } finally {
    await hold.release("rollback");
    if (settled) await settled;
  }
}

/**
 * mulberry32 — PRNG có hạt giống (tái lập 100 %, không đồng hồ); cùng thuật toán với
 * `s15-payroll-qa1-formula.int-spec.ts`.
 *
 * @param seed số nguyên 32-bit (ghi literal trong spec để corpus tất định).
 * @returns hàm sinh số thực trong [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Chạy `fn` trên `items` với độ song song giới hạn, giữ THỨ TỰ kết quả theo `items`.
 *
 * @param limit số worker đồng thời (plan D11: 4).
 * @returns mảng kết quả cùng chỉ số với `items`. Một `fn` ném ⇒ cả lời gọi ném (các worker khác chạy nốt phần đang dở).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return out;
}
