/**
 * S14-SEC-CAPWILDCARD-1 — `getCapabilities` / `getCapabilityScopes` = phép chiếu quyết định `can()` ở
 * tầng CÔNG TY (ADR `DECISIONS-13` §4; plan §9.2 ca #1–#13, #18, #19, #23(a), #24 + §13.2).
 *
 * Hợp đồng (DECISIONS-13 §4):
 *   caps[k] === true ⟺ k ∉ EXCLUDED (action tiền tố `reveal-`) ∧ ¬denied(k) (DENY trên MỌI grant còn
 *   hiệu lực) ∧ (k non-sensitive theo CẶP ĐÍCH ∨ có ALLOW EXACT trên k); k KHÔNG BAO GIỜ chứa `*`.
 *
 * Mọi kỳ vọng viết TAY (không dẫn xuất từ mã đang kiểm). Catalog là tham số của từng ca — các ca đo đúng
 * cờ `is_sensitive` của cặp đích.
 */
import { describe, expect, it } from "vitest";
import { PermissionService } from "./permission.service";
import {
  CapabilityStubRepo,
  companyTierCatalog,
  grant,
  pair,
  SENSITIVE_KEYS_IN_FIXTURE,
} from "../../test/helpers/capability-stub-repo";
import type { CompanyRoleGrantWithScope, PermissionCatalogEntry } from "./permission.types";

const U = "11111111-1111-4111-8111-111111111111";
const CO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function service(
  grants: readonly CompanyRoleGrantWithScope[],
  catalog: readonly PermissionCatalogEntry[] = companyTierCatalog(),
) {
  const repo = new CapabilityStubRepo().withGrants(grants).withCatalog(catalog);
  return { svc: new PermissionService(repo), repo };
}

function starKeys(map: Record<string, unknown>): string[] {
  return Object.keys(map).filter((k) => k.includes("*"));
}

function sortedKeys(map: Record<string, unknown>): string[] {
  return Object.keys(map).sort();
}

describe("S14-SEC-CAPWILDCARD-1 — khai triển wildcard (§9.2 #1–#3)", () => {
  it("#1 actor CHỈ ('*','*') ⇒ 0 khoá chứa '*'; có cặp non-sensitive; KHÔNG cặp sensitive nào", async () => {
    const { svc } = service([grant("*", "*")]);
    const caps = await svc.getCapabilities(U, CO);

    expect(starKeys(caps)).toEqual([]);
    expect(caps).toMatchObject({
      "view:user": true,
      "update:user": true,
      "view:role": true,
      "read:employee": true,
    });
    for (const k of SENSITIVE_KEYS_IN_FIXTURE) {
      expect(k in caps, `wildcard KHÔNG được mở cặp sensitive ${k}`).toBe(false);
    }
  });

  it("#2 ('view','*') ⇒ có view:<non-sensitive>, KHÔNG view:<sensitive>, KHÔNG 'view:*'", async () => {
    const { svc } = service([grant("view", "*")]);
    const caps = await svc.getCapabilities(U, CO);

    expect(caps["view:user"]).toBe(true);
    expect(caps["view:role"]).toBe(true);
    expect("view:salary" in caps).toBe(false);
    expect("view:audit-log" in caps).toBe(false);
    expect("update:user" in caps, "trục action không được nới").toBe(false);
    expect(starKeys(caps)).toEqual([]);
  });

  it("#3 ('*','user') ⇒ mọi action non-sensitive trên user; KHÔNG resource khác; KHÔNG '*:user'", async () => {
    const { svc } = service([grant("*", "user")]);
    const caps = await svc.getCapabilities(U, CO);

    expect(caps["view:user"]).toBe(true);
    expect(caps["update:user"]).toBe(true);
    expect("view:role" in caps, "trục resource không được nới").toBe(false);
    expect(starKeys(caps)).toEqual([]);
  });
});

describe("S14-SEC-CAPWILDCARD-1 — đối chứng + ratchet hình dạng (§9.2 #4, #5)", () => {
  it("#4 ĐỐI CHỨNG: grant exact non-sensitive thuần ⇒ caps/scopes bằng hằng viết tay", async () => {
    const { svc } = service([
      grant("view", "user", { dataScope: "Company" }),
      grant("update", "user", { dataScope: "Own" }),
    ]);

    expect(await svc.getCapabilities(U, CO)).toEqual({ "view:user": true, "update:user": true });
    expect(await svc.getCapabilityScopes(U, CO)).toEqual({
      "view:user": ["Company"],
      "update:user": ["Own"],
    });
  });

  // Đột biến «gỡ vế loại hàng catalog chứa '*'» CHỈ chết khi: catalog CÓ hàng '*' (companyTierCatalog có
  // ('*','*') và ('view','*')) VÀ actor giữ grant action='*' (tổ hợp 1, 3, 5 bên dưới).
  it("#5 RATCHET: với mọi tổ hợp grant, 0 khoá caps/scopes chứa '*'", async () => {
    const combos: ReadonlyArray<readonly CompanyRoleGrantWithScope[]> = [
      [grant("*", "*")],
      [grant("view", "*")],
      [grant("*", "user")],
      [grant("view", "user"), grant("view", "*")],
      [grant("*", "*"), grant("view-own", "adjustment", { isSensitive: true })],
      [grant("*", "*"), grant("view", "user", { effect: "DENY" })],
    ];
    for (const combo of combos) {
      const { svc } = service(combo);
      const label = combo.map((g) => `${g.effect}:${g.action}:${g.resourceType}`).join(",");
      expect(starKeys(await svc.getCapabilities(U, CO)), `caps [${label}]`).toEqual([]);
      expect(starKeys(await svc.getCapabilityScopes(U, CO)), `scopes [${label}]`).toEqual([]);
    }
  });
});

describe("S14-SEC-CAPWILDCARD-1 — cổng sensitive theo CẶP ĐÍCH (§9.2 #6, #7, #19)", () => {
  it("#6 grant EXACT sensitive NGOÀI allowlist ⇒ khoá CÓ MẶT", async () => {
    const { svc } = service([
      grant("view-own", "adjustment", { isSensitive: true, dataScope: "Own" }),
    ]);

    expect(await svc.getCapabilities(U, CO)).toEqual({ "view-own:adjustment": true });
  });

  it("#7 ĐỐI CHỨNG: CHỈ wildcard + cặp sensitive trong catalog ⇒ khoá sensitive VẮNG", async () => {
    const { svc } = service([grant("*", "*")]);
    const caps = await svc.getCapabilities(U, CO);

    expect("view-own:adjustment" in caps).toBe(false);
    expect("view:salary" in caps).toBe(false);
  });

  it("#19 CẢ exact sensitive X CẢ wildcard khớp X ⇒ X CÓ (vòng khai triển không hạ hasExactAllow)", async () => {
    const { svc } = service([
      grant("view-own", "adjustment", { isSensitive: true }),
      grant("*", "*"),
    ]);
    const caps = await svc.getCapabilities(U, CO);

    expect(caps["view-own:adjustment"]).toBe(true);
    expect("view:salary" in caps, "wildcard vẫn không mở sensitive KHÁC").toBe(false);
  });
});

describe("S14-SEC-CAPWILDCARD-1 — DENY sau khai triển (§9.2 #8, #9, #18)", () => {
  it("#8 ('*','*') ALLOW + ('view','user') DENY ⇒ view:user VẮNG, cặp khác còn", async () => {
    const { svc } = service([grant("*", "*"), grant("view", "user", { effect: "DENY" })]);
    const caps = await svc.getCapabilities(U, CO);

    expect("view:user" in caps).toBe(false);
    expect(caps["view:role"]).toBe(true);
    expect(caps["update:user"]).toBe(true);
  });

  it("#9 DENY ('*','user') suppress MỌI action trên user", async () => {
    const { svc } = service([grant("*", "*"), grant("*", "user", { effect: "DENY" })]);
    const caps = await svc.getCapabilities(U, CO);

    expect("view:user" in caps).toBe(false);
    expect("update:user" in caps).toBe(false);
    expect(caps["view:role"]).toBe(true);
  });

  // Vế SIẾT duy nhất của WO: DENY tính trên MỌI grant còn hiệu lực, kể cả hàng sensitive. X vắng trên mã cũ
  // vì vế lọc `!g.isSensitive` — giá trị của X là giết đột biến «gom DENY chỉ trên grant non-sensitive».
  // Y (cùng ca, không DENY) là bằng chứng ca phân biệt được: Y phải CÓ.
  it("#18 ALLOW exact sensitive X + DENY exact trên chính X ⇒ X VẮNG; Y sensitive không DENY ⇒ CÓ", async () => {
    const { svc } = service([
      grant("view", "salary", { isSensitive: true }),
      grant("view", "salary", { isSensitive: true, effect: "DENY" }),
      grant("view-own", "adjustment", { isSensitive: true }),
    ]);
    const caps = await svc.getCapabilities(U, CO);
    const scopes = await svc.getCapabilityScopes(U, CO);

    expect("view:salary" in caps).toBe(false);
    expect("view:salary" in scopes).toBe(false);
    expect(caps["view-own:adjustment"]).toBe(true);
  });
});

describe("S14-SEC-CAPWILDCARD-1 — scopes: keyset + chọn grant đóng góp (§9.2 #10–#12)", () => {
  it("#10 keyset scopes === keyset caps cho 3 nhóm actor §8 + actor giữ exact reveal-*", async () => {
    const groups: ReadonlyArray<{
      label: string;
      grants: CompanyRoleGrantWithScope[];
      keys: string[];
    }> = [
      {
        label: "exact sensitive ngoài allowlist + non-sensitive",
        grants: [grant("view-own", "adjustment", { isSensitive: true }), grant("view", "role")],
        keys: ["view-own:adjustment", "view:role"],
      },
      {
        label: "chỉ wildcard",
        grants: [grant("*", "*")],
        keys: ["read:employee", "update:user", "view:role", "view:user"],
      },
      {
        label: "chỉ exact non-sensitive",
        grants: [grant("view", "user")],
        keys: ["view:user"],
      },
      {
        label: "exact reveal-* + exact non-sensitive",
        grants: [
          grant("reveal-break-glass", "break-glass", { isSensitive: true }),
          grant("reveal-secret", "platform-account", { isSensitive: true }),
          grant("view", "user"),
        ],
        keys: ["view:user"],
      },
    ];
    for (const g of groups) {
      const { svc } = service(g.grants);
      const caps = await svc.getCapabilities(U, CO);
      const scopes = await svc.getCapabilityScopes(U, CO);
      expect(sortedKeys(caps), `caps — ${g.label}`).toEqual([...g.keys].sort());
      expect(sortedKeys(scopes), `scopes — ${g.label}`).toEqual(sortedKeys(caps));
    }
  });

  it("#11 exact THẮNG wildcard: view:user@Own + *:*@Company ⇒ scopes['view:user']=['Own'], cặp khác ['Company']", async () => {
    const { svc } = service([
      grant("view", "user", { dataScope: "Own" }),
      grant("*", "*", { dataScope: "Company" }),
    ]);
    const scopes = await svc.getCapabilityScopes(U, CO);

    expect(scopes["view:user"]).toEqual(["Own"]);
    expect(scopes["view:role"]).toEqual(["Company"]);
  });

  it("#11 biến thể read:employee (cặp có consumer FE thật): exact@Department + *:*@Company ⇒ ['Department']", async () => {
    const { svc } = service([
      grant("read", "employee", { dataScope: "Department" }),
      grant("*", "*", { dataScope: "Company" }),
    ]);
    const scopes = await svc.getCapabilityScopes(U, CO);

    expect(scopes["read:employee"]).toEqual(["Department"]);
    expect(scopes["update:user"]).toEqual(["Company"]);
  });

  it("#12 exact HẾT HẠN + wildcard còn hiệu lực ⇒ rơi về scope wildcard (không [], không mất khoá)", async () => {
    const past = new Date(Date.now() - 60_000);
    const { svc } = service([
      grant("view", "user", { dataScope: "Own", expiresAt: past }),
      grant("*", "*", { dataScope: "Company" }),
    ]);

    expect((await svc.getCapabilities(U, CO))["view:user"]).toBe(true);
    expect((await svc.getCapabilityScopes(U, CO))["view:user"]).toEqual(["Company"]);
  });
});

describe("S14-SEC-CAPWILDCARD-1 — EXCLUDED = action tiền tố 'reveal-' (§9.2 #13, #24)", () => {
  // Xanh sẵn trên mã cũ (vế `!g.isSensitive`) — KHÔNG phải RED; giá trị = giết đột biến «gỡ EXCLUDED».
  it("#13 grant exact reveal-secret:platform-account ⇒ khoá VẮNG ở caps + scopes", async () => {
    const { svc } = service([
      grant("reveal-secret", "platform-account", { isSensitive: true }),
      grant("view", "user"),
    ]);

    expect("reveal-secret:platform-account" in (await svc.getCapabilities(U, CO))).toBe(false);
    expect("reveal-secret:platform-account" in (await svc.getCapabilityScopes(U, CO))).toBe(false);
  });

  it("#24 loại mọi action tiền tố reveal-: reveal-break-glass VẮNG; request-break-glass (sensitive, ngoài allowlist) CÓ", async () => {
    const { svc } = service([
      grant("reveal-break-glass", "break-glass", { isSensitive: true }),
      grant("request-break-glass", "break-glass", { isSensitive: true }),
    ]);
    const caps = await svc.getCapabilities(U, CO);
    const scopes = await svc.getCapabilityScopes(U, CO);

    expect("reveal-break-glass:break-glass" in caps).toBe(false);
    expect("reveal-break-glass:break-glass" in scopes).toBe(false);
    expect(caps["request-break-glass:break-glass"]).toBe(true);
    expect(scopes["request-break-glass:break-glass"]).toEqual(["Company"]);
  });
});

describe("S14-SEC-CAPWILDCARD-1 — mệnh đề đơn điệu CÓ ĐIỀU KIỆN (§9.2 #23a, §8 T1)", () => {
  // Khẳng định PHẢN VÍ DỤ T1 TỒN TẠI (không phải khẳng định nó không xảy ra): catalog có hàng wildcard
  // ('view','*') mang is_sensitive=true + DENY trên chính hàng đó ⇒ vế DENY-siết nhìn thấy nó ⇒ khoá
  // non-sensitive actor giữ bằng grant exact BỊ MẤT.
  it("#23a hàng ('view','*') is_sensitive=true + DENY trên nó ⇒ view:user (exact) BỊ MẤT; update:user còn", async () => {
    const catalog = [
      pair("view", "user", false),
      pair("update", "user", false),
      pair("view", "*", true),
    ];
    const { svc } = service(
      [
        grant("view", "user"),
        grant("update", "user"),
        grant("view", "*", { effect: "DENY", isSensitive: true }),
      ],
      catalog,
    );

    expect(await svc.getCapabilities(U, CO)).toEqual({ "update:user": true });
  });
});

describe("S14-SEC-CAPWILDCARD-1 — cờ HÀNG grant wildcard ALLOW (gate CW-SEC-1/CW-G1, vế ALLOW của §8 T1)", () => {
  // `decideCan` (permission.decide.ts — `effectivelySensitive`) coi cặp là sensitive khi MỘT hàng ALLOW khớp
  // mang cờ, kể cả hàng wildcard ⇒ actor chỉ có wildcard nhận deny-sensitive. Phép chiếu phải soi gương.
  const catalog = [
    pair("view", "user", false),
    pair("update", "user", false),
    pair("*", "*", false),
    pair("view", "*", true),
  ];

  it("ALLOW ('view','*') is_sensitive=true + ALLOW ('*','*') ⇒ view:user VẮNG ở caps + scopes; update:user CÒN", async () => {
    const { svc } = service([grant("*", "*"), grant("view", "*", { isSensitive: true })], catalog);

    expect(await svc.getCapabilities(U, CO)).toEqual({ "update:user": true });
    expect(await svc.getCapabilityScopes(U, CO)).toEqual({ "update:user": ["Company"] });
  });

  it("ĐỐI CHỨNG: cùng hàng wildcard sensitive + ALLOW EXACT view:user ⇒ view:user CÒN (exact thoả cổng)", async () => {
    const { svc } = service(
      [grant("view", "*", { isSensitive: true }), grant("view", "user", { dataScope: "Own" })],
      catalog,
    );

    expect(await svc.getCapabilities(U, CO)).toEqual({ "view:user": true });
    expect(await svc.getCapabilityScopes(U, CO)).toEqual({ "view:user": ["Own"] });
  });
});

describe("S14-SEC-CAPWILDCARD-1 — reset ảnh chụp catalog (§13.2)", () => {
  it("resetCatalogSnapshotForTest() reset CẢ ảnh chụp cặp ⇒ cặp mới seed thấy ngay qua wildcard", async () => {
    const catalog = [pair("view", "user", false)];
    const repo = new CapabilityStubRepo().withGrants([grant("*", "*")]).withCatalog(catalog);
    const svc = new PermissionService(repo);
    expect(await svc.getCapabilities(U, CO)).toEqual({ "view:user": true });

    repo.withCatalog([...catalog, pair("view", "permission", false)]);
    svc.resetCatalogSnapshotForTest();

    expect(await svc.getCapabilities(U, CO)).toEqual({
      "view:user": true,
      "view:permission": true,
    });
  });
});
