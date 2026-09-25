import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { Logger } from "@nestjs/common";
import type { CompanyRoleGrantWithScope } from "./permission.types";

/**
 * grant-snapshot-memo.ts — S16-SOCIAL-PERMMEMO-1 · ADR `DECISIONS-15`.
 *
 * Memo ảnh chụp `getCompanyRoleGrantsWithScope` TRONG MỘT request HTTP. KHÔNG cache giữa các request:
 * mỗi request vẫn đọc DB ở lần đầu cho mỗi (companyId, userId).
 *
 * Bất biến (mỗi dòng có ca test/mutant ở plan §4):
 *   • Khoá = `companyId\u0000userId` — companyId BẮT BUỘC (bất biến #1, U9/X1); userId load-bearing vì một
 *     request có thể hỏi scope của NHIỀU user (người được mention — U13/H8/X13).
 *   • Store ALS RIÊNG, mở bởi `grantMemoMiddleware`. Ngoài store (job, outbox, WS, bootstrap, int-spec
 *     không đăng ký middleware) ⇒ passthrough y hệt trước WO (D-5, U7/H6/X9).
 *   • Thu hồi: EPOCH toàn tiến trình (`bumpGrantSnapshotEpoch`, gọi ở DÒNG ĐẦU `invalidateUser`) + trần
 *     tuổi `GRANT_MEMO_MAX_AGE_MS`. Handler outbox chạy NGOÀI request ⇒ «xoá store hiện tại» không với tới
 *     request nào; epoch thì có (U3/X4). Epoch + `startedAt` chụp TRƯỚC khi gọi `load()` (U11/X10).
 *   • Single-flight theo promise; promise reject bị gỡ khỏi memo ngay (U8/X6).
 *   • Clone mỗi lần trả, kể cả caller đầu — `Date` được sao mới (U10/X7).
 *   • Tối đa `GRANT_MEMO_MAX_ENTRIES` khoá / (request × instance): tỉa entry hết hạn trước; vẫn đầy ⇒
 *     passthrough + `debug` MỘT lần mỗi store. Tệ nhất chỉ mất phần tiết kiệm, KHÔNG BAO GIỜ nới quyền.
 *
 * 🔴 LUẬT (ADR §6.3): code GHI `user_roles`/`role_permissions` rồi ĐỌC scope trong CÙNG request PHẢI gọi
 * `bumpGrantSnapshotEpoch()` SAU commit. Bump trước commit là vô hiệu.
 */
export const GRANT_MEMO_MAX_AGE_MS = 2_000;
export const GRANT_MEMO_MAX_ENTRIES = 64;

type Grants = CompanyRoleGrantWithScope[];

interface Entry {
  readonly promise: Promise<Grants>;
  readonly startedAt: number;
  readonly epoch: number;
}

interface GrantMemoStore {
  readonly perMemo: Map<GrantSnapshotMemo, Map<string, Entry>>;
  capLogged: boolean;
}

const als = new AsyncLocalStorage<GrantMemoStore>();
const logger = new Logger("GrantSnapshotMemo");

/** Toàn tiến trình (plan D-3): nguồn vô hiệu (outbox) không có DI tới instance memo nào. */
let epoch = 0;

/** Chạy `fn` (thường là Express `next()`) trong một ngữ cảnh memo MỚI. */
export function runWithGrantMemo<T>(fn: () => T): T {
  return als.run({ perMemo: new Map(), capLogged: false }, fn);
}

/** Vô hiệu MỌI ảnh chụp đang có trong tiến trình (mọi request đang bay). An toàn gọi ngoài request. */
export function bumpGrantSnapshotEpoch(): void {
  epoch += 1;
}

function cloneGrants(grants: Grants): Grants {
  return grants.map((g) => ({
    ...g,
    expiresAt: g.expiresAt === null ? null : new Date(g.expiresAt.getTime()),
  }));
}

export interface GrantSnapshotMemoOptions {
  /** Đồng hồ ĐƠN ĐIỆU (ms). Mặc định `performance.now()` — đồng hồ tường lùi giờ kéo dài được memo. */
  now?: () => number;
  maxAgeMs?: number;
  maxEntries?: number;
}

export class GrantSnapshotMemo {
  private readonly now: () => number;
  private readonly maxAgeMs: number;
  private readonly maxEntries: number;

  constructor(opts: GrantSnapshotMemoOptions = {}) {
    this.now = opts.now ?? (() => performance.now());
    this.maxAgeMs = opts.maxAgeMs ?? GRANT_MEMO_MAX_AGE_MS;
    this.maxEntries = opts.maxEntries ?? GRANT_MEMO_MAX_ENTRIES;
  }

  async read(companyId: string, userId: string, load: () => Promise<Grants>): Promise<Grants> {
    const store = als.getStore();
    if (store === undefined) return load();

    const mine = this.entriesOf(store);
    const key = `${companyId}\u0000${userId}`;
    const hit = mine.get(key);
    if (hit !== undefined && this.isFresh(hit)) return cloneGrants(await hit.promise);

    this.prune(mine);
    if (mine.size >= this.maxEntries) {
      this.logCapOnce(store);
      return load();
    }
    const entry = this.start(load);
    mine.set(key, entry);
    // Đăng ký NGAY khi tạo ⇒ chạy trước catch của caller: lượt SAU lỗi đọc lại DB (U8).
    entry.promise.catch(() => {
      if (mine.get(key) === entry) mine.delete(key);
    });
    return cloneGrants(await entry.promise);
  }

  private start(load: () => Promise<Grants>): Entry {
    // Chụp TRƯỚC `load()`: bump trong lúc đang bay phải làm entry này hết hiệu lực (U11).
    const startedAt = this.now();
    const epochAtStart = epoch;
    return { promise: load(), startedAt, epoch: epochAtStart };
  }

  private entriesOf(store: GrantMemoStore): Map<string, Entry> {
    let mine = store.perMemo.get(this);
    if (mine === undefined) {
      mine = new Map();
      store.perMemo.set(this, mine);
    }
    return mine;
  }

  private isFresh(entry: Entry): boolean {
    return entry.epoch === epoch && this.now() - entry.startedAt < this.maxAgeMs;
  }

  private prune(mine: Map<string, Entry>): void {
    for (const [key, entry] of mine) {
      if (!this.isFresh(entry)) mine.delete(key);
    }
  }

  private logCapOnce(store: GrantMemoStore): void {
    if (store.capLogged) return;
    store.capLogged = true;
    logger.debug(
      `grant memo đầy ${this.maxEntries} khoá trong một request — passthrough (chỉ mất phần tiết kiệm)`,
    );
  }
}
