import { describe, expect, it, vi } from "vitest";
import { CachedPermissionRepository } from "./permission.cache";
import type { CompanyRoleGrant, IPermissionRepository } from "./permission.types";
import type { ValkeyService } from "./valkey.service";
import { currentEnvScope, permCapKey, permObjKey } from "../common/valkey/valkey-key";
import { runWithGrantMemo } from "./grant-snapshot-memo";

/**
 * S10-FND-VALKEYSCOPE-1 — `perm:cap` là 253/288 khoá đang sống trên Valkey PROD và là cache QUYẾT ĐỊNH
 * QUYỀN (đứng TRƯỚC RLS, nên DB không cứu được nếu khoá sai). Hai thứ file này đóng đinh:
 *   1. đường XOÁ dùng ĐÚNG chuỗi mà đường GHI tạo ra — lệch một chữ = grant cũ sống hết TTL 300s, IM LẶNG;
 *   2. khoá mang `envScope` — PROD và dev-online (bản clone cùng companyId/userId) không đọc trúng nhau.
 */

const CO = "11111111-1111-1111-1111-111111111111";
const U = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** Fake ValkeyService dạng Map — GHI LẠI chuỗi khoá THẬT (không mock capKey, nếu không là tautology). */
function fakeValkey() {
  const store = new Map<string, string>();
  const deleted: string[][] = [];
  return {
    store,
    deleted,
    isEnabled: () => true,
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string): Promise<boolean> {
      store.set(key, value);
      return true;
    },
    async del(...keys: string[]): Promise<boolean> {
      deleted.push(keys);
      for (const k of keys) store.delete(k);
      return true;
    },
  } as unknown as ValkeyService & { store: Map<string, string>; deleted: string[][] };
}

function fakeInner(grants: CompanyRoleGrant[] = []) {
  return {
    getCompanyRoleGrants: vi.fn(async () => grants),
    getObjectGrants: vi.fn(async () => []),
  } as unknown as IPermissionRepository;
}

describe("CachedPermissionRepository — khoá scoped + invalidate trúng đích", () => {
  it("🔴 ghi-rồi-invalidate: DEL nhận ĐÚNG chuỗi mà SET vừa tạo", async () => {
    const v = fakeValkey();
    const repo = new CachedPermissionRepository(fakeInner(), v);

    await repo.getCompanyRoleGrants(U, CO);
    const written = [...v.store.keys()];
    expect(written).toHaveLength(1);

    await repo.invalidateUser(CO, U);
    // Nếu ca này đỏ: `capKey` đã đổi mà `invalidateUser` thì không ⇒ grant CŨ sống tới hết 300s =
    // leo thang quyền im lặng (không log, không exception).
    expect(v.deleted[0]).toContain(written[0]);
    expect(v.store.size).toBe(0);
  });

  it("DEL đúng MỘT khoá — chu kỳ chuyển tiếp legacy đã gỡ (S10-FND-VALKEYSCOPE-2)", async () => {
    const v = fakeValkey();
    const repo = new CachedPermissionRepository(fakeInner(), v);
    await repo.invalidateUser(CO, U);
    // So chuỗi THẬT chứ không `toContain`: `toContain` vẫn xanh khi vế legacy còn sót lại.
    expect(v.deleted[0]).toEqual([permCapKey(CO, U)]);
  });

  it("khoá GHI mang envScope của tiến trình", async () => {
    const v = fakeValkey();
    const repo = new CachedPermissionRepository(fakeInner(), v);
    await repo.getCompanyRoleGrants(U, CO);
    const key = [...v.store.keys()][0];
    expect(key).toBe(permCapKey(CO, U));
    expect(key).toContain(currentEnvScope());
  });

  it("KHÔNG đọc trúng entry của môi trường khác (PROD ↔ dev-online cùng companyId/userId)", async () => {
    const v = fakeValkey();
    const inner = fakeInner();
    const repo = new CachedPermissionRepository(inner, v);

    // Gieo sẵn một entry của môi trường KHÁC với nội dung "sai" — nếu cache đọc trúng nó thì quyền của
    // một môi trường quyết định quyền ở môi trường kia.
    const otherScope =
      currentEnvScope() === "production:mediaos" ? "development:mediaos_dev" : "production:mediaos";
    v.store.set(permCapKey(CO, U, otherScope), JSON.stringify([{ permissionCode: "x.y.z" }]));

    await repo.getCompanyRoleGrants(U, CO);
    // Phải đi xuống DB (miss), không phục vụ từ khoá của môi trường kia.
    expect(inner.getCompanyRoleGrants).toHaveBeenCalledTimes(1);
  });

  it("objKey cũng scoped", async () => {
    const v = fakeValkey();
    const repo = new CachedPermissionRepository(fakeInner(), v);
    await repo.getObjectGrants(U, CO, "task", "r1");
    expect([...v.store.keys()][0]).toBe(permObjKey(CO, U, "task", "r1"));
  });
});

/**
 * S16-SOCIAL-PERMMEMO-1 — ca C1–C4 (plan §4.2, DECISIONS-15). Đo ĐƯỜNG NỐI cache ↔ memo: cơ chế
 * epoch/trần tuổi đã có ca riêng ở `grant-snapshot-memo.spec.ts`; ở đây chỉ đo rằng
 * `CachedPermissionRepository` thật sự đi qua memo, và `invalidateUser` thật sự bump.
 */
describe("CachedPermissionRepository — memo grant-kèm-scope theo request (ADR-15)", () => {
  function scopedInner() {
    return {
      getCompanyRoleGrants: vi.fn(async () => [] as CompanyRoleGrant[]),
      getCompanyRoleGrantsWithScope: vi.fn(async () => [
        {
          action: "view",
          resourceType: "feed",
          isSensitive: false,
          effect: "ALLOW" as const,
          expiresAt: null,
          dataScope: "Company",
        },
      ]),
      getObjectGrants: vi.fn(async () => []),
    } as unknown as IPermissionRepository & {
      getCompanyRoleGrants: ReturnType<typeof vi.fn>;
      getCompanyRoleGrantsWithScope: ReturnType<typeof vi.fn>;
    };
  }

  it("C1 — trong ngữ cảnh memo: N lời gọi ⇒ inner 1 lần", async () => {
    const inner = scopedInner();
    const repo = new CachedPermissionRepository(inner, fakeValkey());
    await runWithGrantMemo(async () => {
      for (let i = 0; i < 3; i += 1) await repo.getCompanyRoleGrantsWithScope(U, CO);
    });
    expect(
      inner.getCompanyRoleGrantsWithScope,
      "getCompanyRoleGrantsWithScope PHẢI đi qua memo trong request",
    ).toHaveBeenCalledTimes(1);
  });

  it("C2 🔴 invalidateUser ⇒ lượt sau đọc lại DB", async () => {
    const inner = scopedInner();
    const repo = new CachedPermissionRepository(inner, fakeValkey());
    await runWithGrantMemo(async () => {
      await repo.getCompanyRoleGrantsWithScope(U, CO);
      await repo.invalidateUser(CO, U);
      await repo.getCompanyRoleGrantsWithScope(U, CO);
    });
    expect(
      inner.getCompanyRoleGrantsWithScope,
      "sau invalidateUser lượt đọc PHẢI thấy thu hồi",
    ).toHaveBeenCalledTimes(2);
  });

  it("C3 🔴 Valkey DEL lỗi ⇒ invalidateUser ném NHƯNG memo vẫn đã bị vô hiệu", async () => {
    const inner = scopedInner();
    const v = fakeValkey();
    (v as unknown as { del: () => Promise<boolean> }).del = async () => false;
    const repo = new CachedPermissionRepository(inner, v);
    await runWithGrantMemo(async () => {
      await repo.getCompanyRoleGrantsWithScope(U, CO);
      await expect(repo.invalidateUser(CO, U)).rejects.toThrow(/Valkey DEL failed/);
      await repo.getCompanyRoleGrantsWithScope(U, CO);
    });
    expect(
      inner.getCompanyRoleGrantsWithScope,
      "DEL lỗi vẫn PHẢI vô hiệu memo",
    ).toHaveBeenCalledTimes(2);
  });

  it("C4 🔴 (D3) getCompanyRoleGrants KHÔNG memo — cache Valkey trống, gọi 2 lần ⇒ inner 2", async () => {
    const inner = scopedInner();
    const v = fakeValkey();
    // Valkey KHÔNG giữ gì (mô phỏng cache trống/tắt) ⇒ mọi lượt đọc rơi xuống inner nếu KHÔNG memo.
    (v as unknown as { set: () => Promise<boolean> }).set = async () => true;
    const repo = new CachedPermissionRepository(inner, v);
    await runWithGrantMemo(async () => {
      await repo.getCompanyRoleGrants(U, CO);
      await repo.getCompanyRoleGrants(U, CO);
    });
    expect(inner.getCompanyRoleGrants, "D3: can() path KHÔNG memo").toHaveBeenCalledTimes(2);
  });
});
