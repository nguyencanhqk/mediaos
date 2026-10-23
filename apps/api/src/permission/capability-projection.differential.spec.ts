/**
 * S14-SEC-CAPWILDCARD-1 — gate CW-G2: đối chiếu DIFFERENTIAL phép chiếu `capabilities` / `scopes` với CỔNG
 * thật (`decideCan` / `decideStrongestScope`) trên một lưới grant. Hai vế là hai cài đặt độc lập — vế phải
 * là cổng enforcement, không dẫn xuất từ mã đang kiểm (tránh khuôn same-builder-twice).
 *
 * Call-site mô phỏng = lớp call-site của hợp đồng (ADR `DECISIONS-13` §4): không khai `isSensitive` /
 * `requiresReauth` / `objectGrantRequired`; `pairIsSensitive` = cờ catalog của cặp đích (như `can()` đọc
 * từ ảnh chụp catalog). Kỳ vọng mỗi cặp catalog `k`:
 *
 *   caps[k] === (decideCan(...).allow ∧ ¬isCapabilityExcluded(action))
 *   scopes[k] (khi caps[k]): đã dedupe · TẬP = dataScope của grant đóng góp theo plan §6.1 (ALLOW exact khớp
 *   nếu có, ngược lại mọi ALLOW wildcard khớp) · scope MẠNH NHẤT trong đó === decideStrongestScope(...)
 *
 * Lưới: mọi tập con cỡ 1..3 của 51 mẫu grant:
 *   - wildcard 4 hình — ('*','*') · (action,'*') = ('view','*') · ('*',resourceType) = ('*','user') và
 *     ('*','break-glass') (rereview RR-1) — × ALLOW/DENY × cờ hàng × hết hạn, `dataScope` Company;
 *   - exact 4 cặp × ALLOW/DENY × hết hạn, cờ exact = cờ catalog như DB thật, `dataScope` Own;
 *   - 3 mẫu ALLOW KHÁC scope (rereview RR-2): exact view:user @Department, exact view:salary @Department,
 *     ('view','*') @Team ⇒ phủ nhánh danh sách dedupe NHIỀU scope (exact×exact và wildcard×wildcard).
 * Exact Own vs wildcard Company ⇒ vế scopes phân biệt được «exact thắng» với «wildcard».
 */
import { DATA_SCOPES, type DataScope } from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
import { isCapabilityExcluded } from "../auth/step-up/capability-exclusion";
import { projectCapabilities, projectCapabilityScopes } from "./capability-projection";
import { decideCan, decideStrongestScope } from "./permission.decide";
import { companyTierCatalog, grant } from "../../test/helpers/capability-stub-repo";
import type { CompanyRoleGrantWithScope } from "./permission.types";

const NOW = new Date("2026-10-23T08:00:00.000Z");
const EXPIRED = new Date("2026-10-22T08:00:00.000Z");
const ACTOR = "11111111-1111-4111-8111-111111111111";
const COMPANY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const CATALOG = companyTierCatalog();
const TARGETS = CATALOG.filter((p) => !p.action.includes("*") && !p.resourceType.includes("*"));
const EFFECTS = ["ALLOW", "DENY"] as const;
const EXPIRIES = [null, EXPIRED] as const;

function catalogFlag(action: string, resourceType: string): boolean {
  const hit = CATALOG.find((p) => p.action === action && p.resourceType === resourceType);
  if (hit === undefined)
    throw new Error(`fixture: ${action}:${resourceType} không có trong catalog`);
  return hit.isSensitive;
}

function grantTemplates(): CompanyRoleGrantWithScope[] {
  const out: CompanyRoleGrantWithScope[] = [];
  for (const [action, resourceType] of [
    ["*", "*"],
    ["view", "*"],
    ["*", "user"],
    ["*", "break-glass"],
  ] as const) {
    for (const effect of EFFECTS) {
      for (const isSensitive of [false, true]) {
        for (const expiresAt of EXPIRIES) {
          out.push(
            grant(action, resourceType, { effect, isSensitive, expiresAt, dataScope: "Company" }),
          );
        }
      }
    }
  }
  for (const [action, resourceType] of [
    ["view", "user"],
    ["view", "salary"],
    ["reveal-secret", "platform-account"],
    ["request-break-glass", "break-glass"],
  ] as const) {
    const isSensitive = catalogFlag(action, resourceType);
    for (const effect of EFFECTS) {
      for (const expiresAt of EXPIRIES) {
        out.push(grant(action, resourceType, { effect, isSensitive, expiresAt, dataScope: "Own" }));
      }
    }
  }
  // RR-2 — ALLOW cùng cặp/cùng hình nhưng KHÁC scope ⇒ danh sách scopes có > 1 phần tử.
  out.push(
    grant("view", "user", { isSensitive: catalogFlag("view", "user"), dataScope: "Department" }),
  );
  out.push(
    grant("view", "salary", {
      isSensitive: catalogFlag("view", "salary"),
      dataScope: "Department",
    }),
  );
  out.push(grant("view", "*", { dataScope: "Team" }));
  return out;
}

const strength = (scope: DataScope): number => DATA_SCOPES.indexOf(scope);

/** ALLOW còn hiệu lực khớp cặp — viết lại ĐỘC LẬP (không gọi `capability-projection` / `permission.decide`). */
function activeAllowsFor(
  grants: readonly CompanyRoleGrantWithScope[],
  action: string,
  resourceType: string,
): CompanyRoleGrantWithScope[] {
  return grants.filter(
    (g) =>
      g.effect === "ALLOW" &&
      (g.expiresAt === null || g.expiresAt > NOW) &&
      (g.action === action || g.action === "*") &&
      (g.resourceType === resourceType || g.resourceType === "*"),
  );
}

/** Plan §6.1: có ALLOW exact ⇒ chỉ exact đóng góp, không ⇒ mọi wildcard. Tập scope sắp theo độ mạnh. */
function contributorScopes(
  grants: readonly CompanyRoleGrantWithScope[],
  action: string,
  resourceType: string,
): DataScope[] {
  const allows = activeAllowsFor(grants, action, resourceType);
  const exact = allows.filter((g) => g.action === action && g.resourceType === resourceType);
  const eligible = exact.length > 0 ? exact : allows;
  return [...new Set(eligible.map((g) => g.dataScope as DataScope))].sort(
    (a, b) => strength(a) - strength(b),
  );
}

/** Mọi ALLOW còn hiệu lực khớp cặp đều có hình ('*', resourceType) — sàn chống xanh-rỗng cho RR-1. */
function onlyStarActionAllows(
  grants: readonly CompanyRoleGrantWithScope[],
  action: string,
  resourceType: string,
): boolean {
  const allows = activeAllowsFor(grants, action, resourceType);
  return allows.length > 0 && allows.every((g) => g.action === "*" && g.resourceType !== "*");
}

function combos<T>(items: readonly T[], maxSize: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, acc: T[]): void => {
    if (acc.length > 0) out.push([...acc]);
    if (acc.length === maxSize) return;
    for (let i = start; i < items.length; i += 1) walk(i + 1, [...acc, items[i]]);
  };
  walk(0, []);
  return out;
}

const label = (grants: readonly CompanyRoleGrantWithScope[]): string =>
  grants
    .map(
      (g) =>
        `${g.effect}(${g.action},${g.resourceType}${g.isSensitive ? ",S" : ""}${g.expiresAt ? ",exp" : ""}@${g.dataScope})`,
    )
    .join("+");

describe("S14-SEC-CAPWILDCARD-1 gate CW-G2 + RR-1/RR-2 — caps/scopes ≡ decideCan/decideStrongestScope trên lưới grant", () => {
  const templates = grantTemplates();
  const grids = combos(templates, 3);

  it("lưới đủ rộng (sàn chống xanh-rỗng)", () => {
    expect(templates.length).toBe(51);
    expect(grids.length).toBe(51 + 1275 + 20825);
  });

  it("mọi cặp catalog: caps[k] ⟺ decideCan ALLOW ∧ ¬EXCLUDED; scopes[k] = tập §6.1, mạnh nhất = decideStrongestScope", () => {
    const mismatches: string[] = [];
    let allowed = 0;
    let denied = 0;
    let multiScope = 0;
    let viaStarAction = 0;

    for (const grants of grids) {
      const caps = projectCapabilities({ grants, catalog: CATALOG, now: NOW });
      const scopes = projectCapabilityScopes({ grants, catalog: CATALOG, now: NOW });

      for (const p of TARGETS) {
        const k = `${p.action}:${p.resourceType}`;
        const req = {
          action: p.action,
          resourceType: p.resourceType,
          pairIsSensitive: p.isSensitive,
        };
        const canReq = { userId: ACTOR, companyId: COMPANY, ...req };
        const want =
          decideCan([...grants], [], canReq, NOW).allow && !isCapabilityExcluded(p.action);
        const got = caps[k] === true;
        if (want) allowed += 1;
        else denied += 1;
        if (got !== want) mismatches.push(`${label(grants)} :: caps[${k}]=${got}, can()=${want}`);

        const gotScopes = scopes[k];
        if (!want) {
          if (gotScopes !== undefined)
            mismatches.push(`${label(grants)} :: scopes[${k}] có mặt khi caps vắng`);
          continue;
        }
        if (onlyStarActionAllows(grants, p.action, p.resourceType)) viaStarAction += 1;
        const strongest = decideStrongestScope([...grants], req, NOW);
        const sorted = [...(gotScopes ?? [])].sort((a, b) => strength(a) - strength(b));
        const wantSet = contributorScopes(grants, p.action, p.resourceType);
        if (sorted.length > 1) multiScope += 1;
        if (
          gotScopes === undefined ||
          new Set(gotScopes).size !== gotScopes.length ||
          JSON.stringify(sorted) !== JSON.stringify(wantSet) ||
          sorted[sorted.length - 1] !== strongest
        ) {
          mismatches.push(
            `${label(grants)} :: scopes[${k}]=${JSON.stringify(gotScopes)}, §6.1=${JSON.stringify(wantSet)}, decide=${strongest}`,
          );
        }
      }

      const extra = Object.keys(caps).filter(
        (k) => !TARGETS.some((p) => `${p.action}:${p.resourceType}` === k),
      );
      if (extra.length > 0)
        mismatches.push(`${label(grants)} :: khoá ngoài catalog ${extra.join(",")}`);
    }

    expect(allowed, "sàn: có cặp ALLOW").toBeGreaterThan(1000);
    expect(denied, "sàn: có cặp DENY").toBeGreaterThan(1000);
    expect(multiScope, "sàn RR-2: có cặp mang > 1 scope").toBeGreaterThan(100);
    expect(viaStarAction, "sàn RR-1: có cặp mở CHỈ bởi ('*', resourceType)").toBeGreaterThan(100);
    expect({ count: mismatches.length, first: mismatches.slice(0, 8) }).toEqual({
      count: 0,
      first: [],
    });
  });
});
