/**
 * S14-SEC-DASHGATE-WILDCARD-1 §5.2 — cờ sensitive đọc theo **CẶP ĐÍCH** (`pairIsSensitive`),
 * không theo HÀNG GRANT KHỚP. ADR `DECISIONS-12`.
 *
 * Lỗ đang vá: actor chỉ cầm `('*','*')` ⇒ hàng grant khớp là hàng wildcard (`is_sensitive=false`)
 * ⇒ `effectivelySensitive=false` ⇒ cổng sensitive KHÔNG bật ⇒ wildcard mở được cặp SENSITIVE.
 *
 * ⚠️ Hai họ ca ở đây KHÔNG được tách rời:
 *   • ca DENY (wildcard bị chặn) — cái mà WO này thêm;
 *   • ca ALLOW đối chứng (grant EXACT vẫn qua · cặp non-sensitive vẫn qua) — không có chúng thì ca
 *     DENY xanh-RỖNG với một bản vá "deny tất" (memory `deny-cases-vacuous-without-allow-case`).
 *   • ca GHIM `auditRequired` / `needsObjectGrant` — cờ mới CHỈ được siết cổng wildcard. Lật
 *     `auditRequired` false→true là biến MASK thành REVEAL ở `hr-read.service.ts` /
 *     `employees.service.ts` (`reveal = allow && auditRequired`).
 */
import { describe, expect, it, vi } from "vitest";
import { decideCan, decideStrongestScope } from "./permission.decide";
import { PermissionService } from "./permission.service";
import type {
  CanInput,
  CompanyRoleGrant,
  CompanyRoleGrantWithScope,
  IPermissionRepository,
  ObjectGrant,
  ObjectGrantBatch,
  PermissionCatalogEntry,
} from "./permission.types";

const CO = "co-1";
const U = "user-1";
const NOW = new Date("2026-09-04T00:00:00.000Z");
const REAUTH_OK = new Date("2026-09-04T00:10:00.000Z");

/** Cặp SENSITIVE thật trong catalog (widget PAYROLL_COST gác bằng cặp này). */
const SENS_ACTION = "view-line";
const SENS_TYPE = "payroll-period";
/** Cặp NON-sensitive thật trong catalog. */
const PLAIN_ACTION = "read";
const PLAIN_TYPE = "notification";

const grant = (
  action: string,
  resourceType: string,
  opts: { effect?: "ALLOW" | "DENY"; isSensitive?: boolean } = {},
): CompanyRoleGrant => ({
  action,
  resourceType,
  isSensitive: opts.isSensitive ?? false,
  effect: opts.effect ?? "ALLOW",
  expiresAt: null,
});

const scoped = (
  action: string,
  resourceType: string,
  dataScope = "Company",
  isSensitive = false,
): CompanyRoleGrantWithScope => ({ ...grant(action, resourceType, { isSensitive }), dataScope });

const can = (
  grants: CompanyRoleGrant[],
  input: Partial<CanInput> & Pick<CanInput, "action" | "resourceType">,
  objectGrants: ObjectGrant[] = [],
) => decideCan(grants, objectGrants, { userId: U, companyId: CO, ...input }, NOW);

/** Hàng grant DUY NHẤT của actor: `*:*`, mang `is_sensitive=false` — đúng hình dạng lỗ. */
const WILDCARD_ONLY = [grant("*", "*")];

/**
 * Matrix fixture HỢP LỆ cho ca #14/#14a/#14c — mỗi hàng grant mang ĐÚNG cờ catalog của CẶP CỦA CHÍNH
 * NÓ, đúng như `innerJoin(permissions)` sinh ra ngoài đời (`permission.repository.ts:31-35`,
 * và `:208-215` cho object-grant). Fixture lệch bất biến này đo ra kết luận không tồn tại
 * (memory `db-invariant-kills-adversarial-fixtures`).
 *
 * `decide(pairFlag)` chạy CÙNG một đầu vào với cờ tắt (= hành vi TRƯỚC bản vá) và cờ thật (= SAU),
 * để ca so được hai bên thay vì đóng đinh một con số.
 */
const REALISTIC_CASES: Array<{
  name: string;
  pairFlag: boolean;
  decide: (pairIsSensitive: boolean) => ReturnType<typeof decideCan>;
}> = [
  {
    name: "wildcard-only → cặp SENSITIVE",
    pairFlag: true,
    decide: (p) =>
      can(WILDCARD_ONLY, { action: SENS_ACTION, resourceType: SENS_TYPE, pairIsSensitive: p }),
  },
  {
    name: "wildcard-only → cặp NON-sensitive",
    pairFlag: false,
    decide: (p) =>
      can(WILDCARD_ONLY, { action: PLAIN_ACTION, resourceType: PLAIN_TYPE, pairIsSensitive: p }),
  },
  {
    name: "grant EXACT (cờ catalog true) → cặp SENSITIVE",
    pairFlag: true,
    decide: (p) =>
      can([grant(SENS_ACTION, SENS_TYPE, { isSensitive: true })], {
        action: SENS_ACTION,
        resourceType: SENS_TYPE,
        pairIsSensitive: p,
      }),
  },
  {
    name: "grant EXACT (cờ catalog false) → cặp NON-sensitive",
    pairFlag: false,
    decide: (p) =>
      can([grant(PLAIN_ACTION, PLAIN_TYPE)], {
        action: PLAIN_ACTION,
        resourceType: PLAIN_TYPE,
        pairIsSensitive: p,
      }),
  },
  {
    name: "wildcard + EXACT cùng lúc → cặp SENSITIVE",
    pairFlag: true,
    decide: (p) =>
      can([grant("*", "*"), grant(SENS_ACTION, SENS_TYPE, { isSensitive: true })], {
        action: SENS_ACTION,
        resourceType: SENS_TYPE,
        pairIsSensitive: p,
      }),
  },
  {
    name: "object ALLOW → cặp SENSITIVE (đường mask của hr-read/employees)",
    pairFlag: true,
    decide: (p) =>
      can(
        [],
        { action: SENS_ACTION, resourceType: SENS_TYPE, resourceId: "obj-1", pairIsSensitive: p },
        [{ action: SENS_ACTION, resourceType: SENS_TYPE, isSensitive: true, effect: "ALLOW" }],
      ),
  },
  {
    name: "object ALLOW → cặp NON-sensitive",
    pairFlag: false,
    decide: (p) =>
      can(
        [],
        { action: PLAIN_ACTION, resourceType: PLAIN_TYPE, resourceId: "obj-1", pairIsSensitive: p },
        [{ action: PLAIN_ACTION, resourceType: PLAIN_TYPE, isSensitive: false, effect: "ALLOW" }],
      ),
  },
  {
    name: "caller khai isSensitive:true + wildcard-only (site ĐÃ truyền cờ)",
    pairFlag: true,
    decide: (p) =>
      can(WILDCARD_ONLY, {
        action: SENS_ACTION,
        resourceType: SENS_TYPE,
        isSensitive: true,
        pairIsSensitive: p,
      }),
  },
  {
    // 🔴 security-review 04/09: hình dạng LỆCH — cờ hàng-grant (false) ≠ cờ catalog (true). Ma trận
    // bản đầu CỐ Ý chỉ chứa hàng "khớp bất biến DB", nên nó loại đúng trạng thái DUY NHẤT mà bất biến
    // có thể vỡ ⇒ #14/#14a xanh mà không chứng gì. Hai nguồn lệch THẬT: catalog suy biến (mọi cặp
    // true) + cache grant Valkey giữ cờ cũ ≤300s sau khi catalog lật false→true.
    name: "LỆCH — grant EXACT cờ false trên cặp catalog nói SENSITIVE",
    pairFlag: true,
    decide: (p) =>
      can([grant(SENS_ACTION, SENS_TYPE)], {
        action: SENS_ACTION,
        resourceType: SENS_TYPE,
        pairIsSensitive: p,
      }),
  },
  {
    name: "LỆCH — catalog suy biến: cặp NON-sensitive bị coi là sensitive, actor có grant EXACT",
    pairFlag: true,
    decide: (p) =>
      can([grant(PLAIN_ACTION, PLAIN_TYPE)], {
        action: PLAIN_ACTION,
        resourceType: PLAIN_TYPE,
        pairIsSensitive: p,
      }),
  },
  {
    name: "DENY wildcard đè mọi thứ",
    pairFlag: true,
    decide: (p) =>
      can([grant("*", "*", { effect: "DENY" })], {
        action: SENS_ACTION,
        resourceType: SENS_TYPE,
        pairIsSensitive: p,
      }),
  },
  {
    name: "không grant nào",
    pairFlag: true,
    decide: (p) => can([], { action: SENS_ACTION, resourceType: SENS_TYPE, pairIsSensitive: p }),
  },
];

// ─────────────────────────────────────────────────────────────────────────────

describe("decideCan — pairIsSensitive (cờ của CẶP ĐÍCH)", () => {
  it("#11 DENY — actor chỉ cầm `*:*`, cặp đích SENSITIVE ⇒ deny-sensitive", () => {
    const d = can(WILDCARD_ONLY, {
      action: SENS_ACTION,
      resourceType: SENS_TYPE,
      pairIsSensitive: true,
    });
    expect(d.allow).toBe(false);
    expect(d.reason).toBe("deny-sensitive");
  });

  it("#11b DENY — đủ BỐN hình dạng wildcard, không chỉ `*:*`", () => {
    // Matcher xử lý `action==='*'` HOẶC `resourceType==='*'` ĐỘC LẬP
    // (memory `permission-grant-census-must-cover-four-wildcard-shapes`).
    for (const g of [
      grant("*", "*"),
      grant("*", SENS_TYPE),
      grant(SENS_ACTION, "*"),
      grant("*", "khac"),
    ]) {
      const d = can([g], { action: SENS_ACTION, resourceType: SENS_TYPE, pairIsSensitive: true });
      expect(d.allow).toBe(false);
    }
  });

  it("#12 ALLOW đối chứng — CÙNG actor `*:*`, cặp đích NON-sensitive ⇒ vẫn allow", () => {
    // Không có ca này, một bản vá "deny mọi wildcard" cũng làm #11 xanh.
    const d = can(WILDCARD_ONLY, {
      action: PLAIN_ACTION,
      resourceType: PLAIN_TYPE,
      pairIsSensitive: false,
    });
    expect(d.allow).toBe(true);
    expect(d.reason).toBe("allow");
  });

  it("#13 ALLOW đối chứng — grant EXACT cho cặp SENSITIVE ⇒ vẫn allow", () => {
    const d = can([grant(SENS_ACTION, SENS_TYPE, { isSensitive: true })], {
      action: SENS_ACTION,
      resourceType: SENS_TYPE,
      pairIsSensitive: true,
    });
    expect(d.allow).toBe(true);
  });

  it("#14 GHIM — cờ cặp KHÔNG được lật `auditRequired` (company-tier ALLOW)", () => {
    // `reveal = allow && auditRequired` ở hr-read.service.ts:360,393 và employees.service.ts:223.
    // Lật `reveal` false→true là biến MASK thành REVEAL — rò dữ liệu, đúng chiều NGƯỢC với WO này.
    //
    // ⚠️ Kế hoạch §5.2 #14 mô tả ca này là «grant EXACT + `isSensitive:false` + `pairIsSensitive:true`
    // ⇒ auditRequired VẪN false». Fixture đó BẤT KHẢ ngoài đời: `grant.isSensitive` lấy từ
    // `innerJoin(permissions)` trên cặp của CHÍNH HÀNG GRANT (`permission.repository.ts:31-35`) ⇒ một
    // grant EXACT cho cặp sensitive LUÔN mang `isSensitive=true`, tức nhánh sensitive ĐÃ vào từ trước
    // bản vá và `auditRequired` ĐÃ là true. Đo trên fixture bất khả sẽ ép ra một thiết kế hai-cờ mà
    // §4.2 đã cân nhắc và loại. Nên ghim BẤT BIẾN THẬT trên fixture HỢP LỆ thay vì con số của một
    // trạng thái không tồn tại.
    for (const c of REALISTIC_CASES) {
      const before = c.decide(false);
      const after = c.decide(c.pairFlag);
      const revealBefore = before.allow && before.auditRequired;
      const revealAfter = after.allow && after.auditRequired;
      // reveal_sau ⇒ reveal_trước. Bản vá chỉ được LẤY BỚT quyền lộ, không bao giờ thêm.
      expect({ case: c.name, implied: !revealAfter || revealBefore }).toEqual({
        case: c.name,
        implied: true,
      });
    }
  });

  it("#14a GHIM — mọi ca còn ALLOW sau bản vá giữ NGUYÊN `auditRequired`", () => {
    // Hệ quả của bất biến «đường đi mới duy nhất là deny-sensitive»: không return ALLOW nào mới,
    // nên không giá trị `auditRequired` nào trên nhánh ALLOW đổi. Ca này ghim vế đó tách khỏi #14 —
    // #14 một mình vẫn xanh với một bản vá deny-tất (reveal_sau luôn false).
    for (const c of REALISTIC_CASES) {
      const before = c.decide(false);
      const after = c.decide(c.pairFlag);
      if (after.allow) {
        expect({ case: c.name, audit: after.auditRequired }).toEqual({
          case: c.name,
          audit: before.auditRequired,
        });
      }
    }
  });

  it("#14c ĐỐI CHỨNG — matrix ở trên có ca ALLOW THẬT (không xanh rỗng)", () => {
    // Không có ca này, #14/#14a xanh kể cả khi mọi ca của matrix đều deny — tức hai ca trên đo rỗng.
    const allowed = REALISTIC_CASES.filter((c) => c.decide(c.pairFlag).allow);
    expect(allowed.length).toBeGreaterThanOrEqual(4);
    // …và có ít nhất một ca ALLOW mang `auditRequired: true` (nhánh reveal thật sự sống).
    expect(allowed.some((c) => c.decide(c.pairFlag).auditRequired)).toBe(true);
  });

  it("#14b GHIM — cờ cặp KHÔNG được lật `auditRequired` (object-tier ALLOW)", () => {
    const d = can(
      [],
      {
        action: SENS_ACTION,
        resourceType: SENS_TYPE,
        resourceId: "obj-1",
        isSensitive: false,
        pairIsSensitive: true,
      },
      [{ action: SENS_ACTION, resourceType: SENS_TYPE, isSensitive: false, effect: "ALLOW" }],
    );
    expect(d.allow).toBe(true);
    expect(d.auditRequired).toBe(false);
  });

  it("#15 GHIM — cờ cặp KHÔNG được bật `needsObjectGrant` (deny cả actor có grant EXACT)", () => {
    // needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth). Nếu cờ mới OR vào
    // `isSensitive` thì cặp này thành reveal-secret class và DENY kể cả grant exact + reauth hợp lệ.
    const d = can([grant(SENS_ACTION, SENS_TYPE)], {
      action: SENS_ACTION,
      resourceType: SENS_TYPE,
      isSensitive: false,
      requiresReauth: true,
      pairIsSensitive: true,
      ctx: { reauthValidUntil: REAUTH_OK },
    });
    expect(d.reason).not.toBe("deny-object-required");
    expect(d.allow).toBe(true);
    // 🔴 security-review 04/09: dòng NÀY là ca chứng minh bất biến ban đầu của WO SAI. Đầu vào trên
    // vào nhánh sensitive nhờ MỖI `pairIsSensitive`, mà `explicitAllows` KHÔNG rỗng ⇒ chạm return
    // ALLOW cuối nhánh. Hard-code `auditRequired: true` ở đó lật `reveal` false→true = MASK thành
    // REVEAL. Giá trị đúng = giá trị mà CÙNG đầu vào này nhận ở priority 4 trước bản vá: false.
    expect(d.auditRequired).toBe(false);
  });

  it("#15c GHIM — cờ hàng-grant LỆCH cờ catalog (catalog suy biến / cache grant cũ) ⇒ auditRequired giữ nguyên", () => {
    // Trạng thái THẬT, không phải giả tưởng: `permission-catalog-snapshot` nạp hỏng + chưa có ảnh ⇒
    // MỌI cặp `pairIsSensitive=true`, trong khi grant vẫn phục vụ từ cache Valkey với cờ THẬT (false).
    // Actor có grant EXACT trên cặp NON-sensitive ⇒ vào nhánh sensitive nhưng KHÔNG được đổi reveal.
    const before = can([grant(PLAIN_ACTION, PLAIN_TYPE)], {
      action: PLAIN_ACTION,
      resourceType: PLAIN_TYPE,
      pairIsSensitive: false,
    });
    const after = can([grant(PLAIN_ACTION, PLAIN_TYPE)], {
      action: PLAIN_ACTION,
      resourceType: PLAIN_TYPE,
      pairIsSensitive: true,
    });
    expect(after.allow).toBe(true);
    expect(after.auditRequired).toBe(before.auditRequired);
    expect(after.auditRequired).toBe(false);
  });

  it("#15b GHIM — object-grant requirement TƯỜNG MINH vẫn deny như cũ", () => {
    const d = can(WILDCARD_ONLY, {
      action: SENS_ACTION,
      resourceType: SENS_TYPE,
      objectGrantRequired: true,
      pairIsSensitive: true,
    });
    expect(d.reason).toBe("deny-object-required");
  });
});

describe("decideStrongestScope — pairIsSensitive", () => {
  it("#17 `*:*` + cặp SENSITIVE ⇒ null (mất sàn scope)", () => {
    expect(
      decideStrongestScope(
        [scoped("*", "*", "Company")],
        { action: SENS_ACTION, resourceType: SENS_TYPE, pairIsSensitive: true },
        NOW,
      ),
    ).toBeNull();
  });

  it("#17b ALLOW đối chứng — `*:*` + cặp NON-sensitive ⇒ vẫn trả scope", () => {
    expect(
      decideStrongestScope(
        [scoped("*", "*", "Company")],
        { action: PLAIN_ACTION, resourceType: PLAIN_TYPE, pairIsSensitive: false },
        NOW,
      ),
    ).toBe("Company");
  });

  it("#17c ALLOW đối chứng — grant EXACT + cặp SENSITIVE ⇒ vẫn trả scope", () => {
    expect(
      decideStrongestScope(
        [scoped(SENS_ACTION, SENS_TYPE, "Department", true)],
        { action: SENS_ACTION, resourceType: SENS_TYPE, pairIsSensitive: true },
        NOW,
      ),
    ).toBe("Department");
  });
});

// ─── Tầng PermissionService: cờ phải được BƠM từ catalog, không phải caller ──────

const CATALOG: PermissionCatalogEntry[] = [
  { id: "p1", action: SENS_ACTION, resourceType: SENS_TYPE, isSensitive: true },
  { id: "p2", action: PLAIN_ACTION, resourceType: PLAIN_TYPE, isSensitive: false },
];

class StubRepo implements IPermissionRepository {
  catalogHits = 0;
  constructor(private readonly grants: CompanyRoleGrantWithScope[]) {}
  async getCompanyRoleGrants(): Promise<CompanyRoleGrant[]> {
    return this.grants;
  }
  async getCompanyRoleGrantsWithScope(): Promise<CompanyRoleGrantWithScope[]> {
    return this.grants;
  }
  async getObjectGrants(): Promise<ObjectGrant[]> {
    return [];
  }
  async getObjectGrantsBatch(
    _u: string,
    _c: string,
    _t: string,
    ids: string[],
  ): Promise<ObjectGrantBatch> {
    return new Map(ids.map((id) => [id, [] as ObjectGrant[]]));
  }
  async getPermissionsByIds(): Promise<PermissionCatalogEntry[]> {
    return CATALOG;
  }
  async getAllPermissions(): Promise<PermissionCatalogEntry[]> {
    this.catalogHits += 1;
    return CATALOG;
  }
}

describe("PermissionService — bơm pairIsSensitive từ catalog (call site KHÔNG đổi)", () => {
  it("#11-svc `can()` KHÔNG có opts: wildcard-only ⇒ 403 trên cặp sensitive", async () => {
    // Đây là hình dạng THẬT của 25 call-site thiếu cờ: không ai truyền `isSensitive`.
    const svc = new PermissionService(new StubRepo([scoped("*", "*")]));
    const d = await svc.can({
      userId: U,
      companyId: CO,
      action: SENS_ACTION,
      resourceType: SENS_TYPE,
    });
    expect(d.allow).toBe(false);
    expect(d.reason).toBe("deny-sensitive");
  });

  it("#12-svc ALLOW đối chứng — cùng actor, cặp non-sensitive ⇒ allow", async () => {
    const svc = new PermissionService(new StubRepo([scoped("*", "*")]));
    const d = await svc.can({
      userId: U,
      companyId: CO,
      action: PLAIN_ACTION,
      resourceType: PLAIN_TYPE,
    });
    expect(d.allow).toBe(true);
  });

  it("#13-svc ALLOW đối chứng — grant EXACT ⇒ allow", async () => {
    const svc = new PermissionService(
      new StubRepo([scoped(SENS_ACTION, SENS_TYPE, "Company", true)]),
    );
    const d = await svc.can({
      userId: U,
      companyId: CO,
      action: SENS_ACTION,
      resourceType: SENS_TYPE,
    });
    expect(d.allow).toBe(true);
  });

  it("#16 `canBatch()` BYTE-IDENTICAL với `can()` trên cùng ba ca", async () => {
    const repo = new StubRepo([scoped("*", "*")]);
    const svc = new PermissionService(repo);
    const batch = await svc.canBatch(
      U,
      CO,
      SENS_TYPE,
      ["r1"],
      [{ action: SENS_ACTION }, { action: PLAIN_ACTION }],
    );
    const single = await svc.can({
      userId: U,
      companyId: CO,
      action: SENS_ACTION,
      resourceType: SENS_TYPE,
      resourceId: "r1",
    });
    expect(batch.get("r1")?.get(SENS_ACTION)).toEqual(single);
    expect(batch.get("r1")?.get(SENS_ACTION)?.reason).toBe("deny-sensitive");
    // `read:notification` KHÔNG phải cặp của resourceType này ⇒ vắng catalog ⇒ D3 false ⇒ wildcard qua.
    expect(batch.get("r1")?.get(PLAIN_ACTION)?.allow).toBe(true);
  });

  it("#17-svc `resolveStrongestScope()` KHÔNG có opts: wildcard-only + sensitive ⇒ null", async () => {
    const svc = new PermissionService(new StubRepo([scoped("*", "*")]));
    expect(await svc.resolveStrongestScope(U, CO, SENS_ACTION, SENS_TYPE)).toBeNull();
    expect(await svc.resolveStrongestScope(U, CO, PLAIN_ACTION, PLAIN_TYPE)).toBe("Company");
  });

  it("#17-svc-batch `resolveStrongestScopes()` — sensitive null, non-sensitive giữ scope", async () => {
    const svc = new PermissionService(new StubRepo([scoped("*", "*")]));
    expect(
      await svc.resolveStrongestScopes(U, CO, [
        { action: SENS_ACTION, resourceType: SENS_TYPE },
        { action: PLAIN_ACTION, resourceType: PLAIN_TYPE },
      ]),
    ).toEqual([null, "Company"]);
  });

  it("F2 — `requests = []` KHÔNG chạm repository, kể cả để nạp catalog", async () => {
    // Ca ghim BLOCKING-7 của #469 đếm `getCompanyRoleGrantsWithScope`; ảnh chụp catalog là một
    // round-trip THỨ HAI mà bộ đếm cũ KHÔNG nhìn thấy ⇒ đếm riêng ở đây.
    const repo = new StubRepo([scoped("*", "*")]);
    const svc = new PermissionService(repo);
    expect(await svc.resolveStrongestScopes(U, CO, [])).toEqual([]);
    expect(repo.catalogHits).toBe(0);
  });

  it("D6 — N cặp trong MỘT lượt resolve ⇒ nạp catalog đúng 1 lần", async () => {
    const repo = new StubRepo([scoped("*", "*")]);
    const svc = new PermissionService(repo);
    await svc.resolveStrongestScopes(U, CO, [
      { action: SENS_ACTION, resourceType: SENS_TYPE },
      { action: PLAIN_ACTION, resourceType: PLAIN_TYPE },
      { action: SENS_ACTION, resourceType: SENS_TYPE },
    ]);
    expect(repo.catalogHits).toBe(1);
  });

  it("catalog nạp HỎNG ⇒ `logger.error` ĐƯỢC gọi với phase — dòng log là quan sát DUY NHẤT của nhánh suy biến", async () => {
    // Không có ca này, đổi `onError: (e, phase) => { this.logger.error(...) }` thành `onError: () => {}`
    // vẫn xanh toàn bộ suite VÀ vẫn qua cổng coverage ⇒ hệ chạy ở trạng thái siết vì lỗi hạ tầng mà
    // không ai biết (luật quan sát: nhánh suy biến PHẢI để vết).
    class FailingCatalogRepo extends StubRepo {
      override async getAllPermissions(): Promise<PermissionCatalogEntry[]> {
        throw new Error("catalog read failed (simulated)");
      }
    }
    const svc = new PermissionService(new FailingCatalogRepo([scoped("*", "*")]));
    const spy = vi.spyOn(svc["logger"], "error").mockImplementation(() => undefined);

    const d = await svc.can({
      userId: U,
      companyId: CO,
      action: SENS_ACTION,
      resourceType: SENS_TYPE,
    });

    // Suy biến về phía SIẾT: chưa có ảnh chụp ⇒ mọi cặp coi như sensitive ⇒ wildcard bị chặn.
    expect(d.allow).toBe(false);
    const call = spy.mock.calls.find((c) => String(c[0]).includes("catalog snapshot load failed"));
    expect(call, "thiếu dòng log của nhánh catalog suy biến").toBeDefined();
    expect((call?.[1] as { phase?: string } | undefined)?.phase).toBe("no-snapshot");
  });

  it("`onError` NÉM cũng không được biến lỗi đã xử lý thành reject (hợp đồng never-throw)", async () => {
    // Transport log hỏng là chuyện có thật. Nếu nó ném, promise single-flight reject ⇒ mọi caller
    // đang chờ chung lượt đó (vd Promise.all của dashboard) nhận reject thay vì sentinel.
    class FailingCatalogRepo extends StubRepo {
      override async getAllPermissions(): Promise<PermissionCatalogEntry[]> {
        throw new Error("catalog read failed (simulated)");
      }
    }
    const svc = new PermissionService(new FailingCatalogRepo([scoped("*", "*")]));
    vi.spyOn(svc["logger"], "error").mockImplementation(() => {
      throw new Error("log transport down");
    });

    await expect(
      svc.can({ userId: U, companyId: CO, action: SENS_ACTION, resourceType: SENS_TYPE }),
    ).resolves.toMatchObject({ allow: false });
  });

  it("D7 — `resetCatalogSnapshotForTest()` buộc nạp lại", async () => {
    const repo = new StubRepo([scoped("*", "*")]);
    const svc = new PermissionService(repo);
    await svc.can({ userId: U, companyId: CO, action: SENS_ACTION, resourceType: SENS_TYPE });
    expect(repo.catalogHits).toBe(1);
    svc.resetCatalogSnapshotForTest();
    await svc.can({ userId: U, companyId: CO, action: SENS_ACTION, resourceType: SENS_TYPE });
    expect(repo.catalogHits).toBe(2);
  });
});
