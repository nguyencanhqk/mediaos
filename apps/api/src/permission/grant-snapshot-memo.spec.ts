import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bumpGrantSnapshotEpoch,
  GRANT_MEMO_MAX_AGE_MS,
  GRANT_MEMO_MAX_ENTRIES,
  GrantSnapshotMemo,
  runWithGrantMemo,
} from "./grant-snapshot-memo";
import { decideStrongestScope } from "./permission.decide";
import type { CompanyRoleGrantWithScope } from "./permission.types";

/**
 * S16-SOCIAL-PERMMEMO-1 — ca U1–U13 của plan §4.1 (DECISIONS-15).
 *
 * Mọi ca dùng inner GIẢ đếm lượt + đồng hồ TIÊM (`now`), KHÔNG fake timers: `vi.useFakeTimers` mặc
 * định không giả `performance`, nên dựa vào nó là đo một đồng hồ khác với đồng hồ memo dùng.
 * Thông điệp `expect(…, msg)` là THÔNG ĐIỆP KỲ VỌNG của bảng mutant §4.4 — đừng đổi chữ.
 */

const C1 = "11111111-1111-1111-1111-111111111111";
const C2 = "22222222-2222-2222-2222-222222222222";
const U1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const U2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function allow(scope = "Company", expiresAt: Date | null = null): CompanyRoleGrantWithScope {
  return {
    action: "view",
    resourceType: "feed",
    isSensitive: false,
    effect: "ALLOW",
    expiresAt,
    dataScope: scope,
  };
}

const VIEW_FEED = { action: "view", resourceType: "feed" };

/** Inner giả: trả `current()` tại thời điểm gọi, đếm lượt theo (company,user). */
function counter(current: (companyId: string, userId: string) => CompanyRoleGrantWithScope[]) {
  const calls: Array<[string, string]> = [];
  const load = (companyId: string, userId: string) => async () => {
    calls.push([companyId, userId]);
    return current(companyId, userId);
  };
  return { calls, load };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Đồng hồ đơn điệu tiêm được. */
function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GrantSnapshotMemo — memo ảnh chụp grant theo request (DECISIONS-15)", () => {
  it("U1 — 3 lượt đọc (c,u) trong 1 ngữ cảnh ⇒ inner = 1", async () => {
    const memo = new GrantSnapshotMemo();
    const inner = counter(() => [allow()]);
    await runWithGrantMemo(async () => {
      for (let i = 0; i < 3; i += 1) {
        expect(await memo.read(C1, U1, inner.load(C1, U1))).toEqual([allow()]);
      }
    });
    expect(inner.calls.length, "cùng (c,u) trong một request PHẢI đọc DB đúng 1 lần").toBe(1);
  });

  it("U2 🔴 deny-path — bump epoch ⇒ lượt sau thấy thu hồi ⇒ decideStrongestScope = null", async () => {
    const memo = new GrantSnapshotMemo();
    let rows = [allow()];
    const inner = counter(() => rows);
    await runWithGrantMemo(async () => {
      const first = await memo.read(C1, U1, inner.load(C1, U1));
      expect(decideStrongestScope(first, VIEW_FEED, new Date())).toBe("Company");
      rows = [];
      bumpGrantSnapshotEpoch();
      const after = await memo.read(C1, U1, inner.load(C1, U1));
      expect(
        decideStrongestScope(after, VIEW_FEED, new Date()),
        "sau bump lượt đọc PHẢI thấy thu hồi",
      ).toBeNull();
    });
    expect(inner.calls.length).toBe(2);
  });

  it("U3 🔴 invalidate từ NGỮ CẢNH KHÁC (mô phỏng outbox) vẫn với tới memo của request", async () => {
    const memo = new GrantSnapshotMemo();
    const inner = counter(() => [allow()]);
    // Continuation đăng ký NGOÀI mọi ngữ cảnh memo ⇒ chạy không có store, như handler outbox do
    // scheduler gọi (plan M8). Cơ chế «xoá store hiện tại» không chạm được request nào từ đây.
    const trigger = deferred<void>();
    const outboxDone = trigger.promise.then(() => bumpGrantSnapshotEpoch());
    await runWithGrantMemo(async () => {
      await memo.read(C1, U1, inner.load(C1, U1));
      trigger.resolve();
      await outboxDone;
      await memo.read(C1, U1, inner.load(C1, U1));
    });
    expect(
      inner.calls.length,
      "invalidate từ outbox (ngoài request) PHẢI với tới memo của request",
    ).toBe(2);
  });

  it("U4 🔴 trần tuổi — +1999ms còn hit; +2000ms đọc lại (biên `<` chính xác)", async () => {
    const c = clock();
    const memo = new GrantSnapshotMemo({ now: c.now });
    const inner = counter(() => [allow()]);
    expect(GRANT_MEMO_MAX_AGE_MS).toBe(2_000);
    await runWithGrantMemo(async () => {
      await memo.read(C1, U1, inner.load(C1, U1));
      c.advance(1_999);
      await memo.read(C1, U1, inner.load(C1, U1));
      expect(inner.calls.length, "trong trần 2000ms PHẢI dùng memo").toBe(1);
      c.advance(1);
      await memo.read(C1, U1, inner.load(C1, U1));
    });
    expect(inner.calls.length, "quá trần 2000ms PHẢI đọc lại DB").toBe(2);
  });

  it("U4b 🔴 tuổi tính từ lúc BẮT ĐẦU load — load chậm 1500ms + 500ms sau ⇒ đọc lại (gate santa L1)", async () => {
    const c = clock();
    const memo = new GrantSnapshotMemo({ now: c.now });
    const calls: number[] = [];
    const slowLoad = async () => {
      calls.push(c.now());
      c.advance(1_500);
      return [allow()];
    };
    await runWithGrantMemo(async () => {
      await memo.read(C1, U1, slowLoad);
      c.advance(500);
      await memo.read(C1, U1, slowLoad);
    });
    expect(calls.length, "tuổi PHẢI tính từ trước load(): 1500+500ms là hết hạn").toBe(2);
  });

  it("U5 🔴 hai actor song song, inner resolve NGƯỢC thứ tự ⇒ mỗi ngữ cảnh nhận đúng grant của mình", async () => {
    const memo = new GrantSnapshotMemo();
    const dA = deferred<CompanyRoleGrantWithScope[]>();
    const dB = deferred<CompanyRoleGrantWithScope[]>();
    let n = 0;
    const loadA = () => {
      n += 1;
      return dA.promise;
    };
    const loadB = () => {
      n += 1;
      return dB.promise;
    };
    const ctxA = runWithGrantMemo(async () => {
      const first = await memo.read(C1, U1, loadA);
      const second = await memo.read(C1, U1, loadA);
      return [first, second];
    });
    const ctxB = runWithGrantMemo(async () => {
      const first = await memo.read(C1, U2, loadB);
      const second = await memo.read(C1, U2, loadB);
      return [first, second];
    });
    dB.resolve([allow("Own")]);
    dA.resolve([allow("Company")]);
    const [ra, rb] = await Promise.all([ctxA, ctxB]);
    expect(ra.flat().map((g) => g.dataScope)).toEqual(["Company", "Company"]);
    expect(rb.flat().map((g) => g.dataScope)).toEqual(["Own", "Own"]);
    expect(n).toBe(2);
  });

  it("U6 — cùng user, hai ngữ cảnh ⇒ inner = 2 (memo KHÔNG xuyên request)", async () => {
    const memo = new GrantSnapshotMemo();
    const inner = counter(() => [allow()]);
    await runWithGrantMemo(() => memo.read(C1, U1, inner.load(C1, U1)));
    await runWithGrantMemo(() => memo.read(C1, U1, inner.load(C1, U1)));
    expect(inner.calls.length, "memo KHÔNG được xuyên request: A=5 lượt").toBe(2);
  });

  it("U7 🔴 ngoài request ⇒ passthrough: N lời gọi = N lượt", async () => {
    const memo = new GrantSnapshotMemo();
    const inner = counter(() => [allow()]);
    for (let i = 0; i < 3; i += 1) await memo.read(C1, U1, inner.load(C1, U1));
    expect(inner.calls.length, "ngoài request PHẢI passthrough: 3 lượt").toBe(3);
  });

  it("U8 🔴 promise reject KHÔNG đầu độc: lượt sau đọc lại; 2 caller đồng thời chung một lỗi", async () => {
    const memo = new GrantSnapshotMemo();
    let calls = 0;
    const flaky = async (): Promise<CompanyRoleGrantWithScope[]> => {
      calls += 1;
      if (calls === 1) throw new Error("db down");
      return [allow()];
    };
    await runWithGrantMemo(async () => {
      await expect(memo.read(C1, U1, flaky)).rejects.toThrow("db down");
      // `.catch` ⇒ promise lỗi bị giữ lại (mutant X6) hiện ra ở assert có thông điệp, không ở dòng await.
      const again = await memo.read(C1, U1, flaky).catch((e: unknown) => e);
      expect(again, "lỗi hạ tầng KHÔNG được đầu độc phần còn lại của request").toEqual([allow()]);
    });
    expect(calls, "lỗi hạ tầng KHÔNG được đầu độc phần còn lại của request").toBe(2);

    let shared = 0;
    const d = deferred<CompanyRoleGrantWithScope[]>();
    const once = () => {
      shared += 1;
      return d.promise;
    };
    await runWithGrantMemo(async () => {
      const p1 = memo.read(C2, U1, once);
      const p2 = memo.read(C2, U1, once);
      d.reject(new Error("boom"));
      await expect(p1).rejects.toThrow("boom");
      await expect(p2).rejects.toThrow("boom");
    });
    expect(shared).toBe(1);
  });

  it("U9 🔴 chéo công ty — (c1,u) rồi (c2,u) ⇒ 2 lượt, kết quả đúng từng công ty", async () => {
    const memo = new GrantSnapshotMemo();
    const inner = counter((companyId) => (companyId === C1 ? [allow("Company")] : []));
    await runWithGrantMemo(async () => {
      const a = await memo.read(C1, U1, inner.load(C1, U1));
      const b = await memo.read(C2, U1, inner.load(C2, U1));
      expect(a).toHaveLength(1);
      expect(b, "memo PHẢI tách công ty: (c1,u)+(c2,u) = 2 lượt đọc").toEqual([]);
    });
    expect(inner.calls.length, "memo PHẢI tách công ty: (c1,u)+(c2,u) = 2 lượt đọc").toBe(2);
    expect(inner.calls.map(([c]) => c)).toEqual([C1, C2]);
  });

  it("U10 — caller sửa kết quả KHÔNG đổi ảnh chụp (kể cả caller đầu tiên)", async () => {
    const memo = new GrantSnapshotMemo();
    const expiry = new Date("2099-01-01T00:00:00Z");
    const inner = counter(() => [allow("Company", new Date(expiry.getTime()))]);
    await runWithGrantMemo(async () => {
      const first = await memo.read(C1, U1, inner.load(C1, U1));
      first.push(allow("System"));
      first[0].effect = "DENY";
      first[0].expiresAt?.setTime(0);
      const second = await memo.read(C1, U1, inner.load(C1, U1));
      expect(second, "caller sửa kết quả KHÔNG được đổi ảnh chụp").toEqual([
        allow("Company", expiry),
      ]);
      second[0].expiresAt?.setTime(0);
      const third = await memo.read(C1, U1, inner.load(C1, U1));
      expect(third[0].expiresAt?.getTime(), "caller sửa kết quả KHÔNG được đổi ảnh chụp").toBe(
        expiry.getTime(),
      );
    });
    expect(inner.calls.length).toBe(1);
  });

  it("U11 — bump TRONG KHI promise đang bay ⇒ lượt tiếp theo đọc lại (epoch chụp lúc BẮT ĐẦU)", async () => {
    const memo = new GrantSnapshotMemo();
    const d = deferred<CompanyRoleGrantWithScope[]>();
    let n = 0;
    const load = () => {
      n += 1;
      return n === 1 ? d.promise : Promise.resolve([]);
    };
    await runWithGrantMemo(async () => {
      const inflight = memo.read(C1, U1, load);
      bumpGrantSnapshotEpoch();
      d.resolve([allow()]);
      await inflight;
      await memo.read(C1, U1, load);
    });
    expect(n, "bump khi đang bay PHẢI làm lượt sau đọc lại").toBe(2);
  });

  it("U12 — trần 64 khoá: khoá 65 passthrough + debug 1 lần; hết tuổi ⇒ tỉa rồi chèn; 2 instance không đọc chéo", async () => {
    expect(GRANT_MEMO_MAX_ENTRIES).toBe(64);
    const debug = vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    const c = clock();
    const memo = new GrantSnapshotMemo({ now: c.now });
    const other = new GrantSnapshotMemo({ now: c.now });
    const inner = counter(() => [allow()]);
    const user = (i: number) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
    await runWithGrantMemo(async () => {
      for (let i = 0; i < 64; i += 1) await memo.read(C1, user(i), inner.load(C1, user(i)));
      expect(inner.calls.length).toBe(64);
      // Tải lại một khoá ĐÃ CÓ (còn tươi) KHÔNG tính thêm và không bị trần chặn.
      await memo.read(C1, user(0), inner.load(C1, user(0)));
      expect(inner.calls.length).toBe(64);

      await memo.read(C1, user(64), inner.load(C1, user(64)));
      await memo.read(C1, user(64), inner.load(C1, user(64)));
      await memo.read(C1, user(65), inner.load(C1, user(65)));
      expect(inner.calls.length, "khoá thứ 65 PHẢI passthrough (không chèn)").toBe(67);
      expect(debug, "vượt trần chỉ debug MỘT lần mỗi store").toHaveBeenCalledTimes(1);

      // Instance khác trong CÙNG ngữ cảnh: không đọc chéo, và có ngăn riêng (không bị trần của memo kia).
      await other.read(C1, user(0), inner.load(C1, user(0)));
      expect(inner.calls.length, "hai instance memo KHÔNG được đọc chéo").toBe(68);

      c.advance(GRANT_MEMO_MAX_AGE_MS);
      await memo.read(C1, user(99), inner.load(C1, user(99)));
      await memo.read(C1, user(99), inner.load(C1, user(99)));
      expect(inner.calls.length, "64 khoá hết tuổi PHẢI bị tỉa để khoá mới được chèn").toBe(69);
    });
  });

  it("U13 🔴 cùng công ty, KHÁC user, CÙNG request ⇒ 2 lượt, kết quả theo user", async () => {
    const memo = new GrantSnapshotMemo();
    const inner = counter((_c, userId) => (userId === U1 ? [allow()] : []));
    await runWithGrantMemo(async () => {
      const actor = await memo.read(C1, U1, inner.load(C1, U1));
      const mentioned = await memo.read(C1, U2, inner.load(C1, U2));
      expect(decideStrongestScope(actor, VIEW_FEED, new Date())).toBe("Company");
      expect(
        decideStrongestScope(mentioned, VIEW_FEED, new Date()),
        "memo PHẢI tách người dùng trong cùng công ty",
      ).toBeNull();
    });
    expect(inner.calls.length, "memo PHẢI tách người dùng trong cùng công ty").toBe(2);
  });
});
