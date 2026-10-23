/**
 * S14-SEC-CAPWILDCARD-1 — phép chiếu THUẦN `capabilities` / `scopes` của `/auth/me` (ADR `DECISIONS-13` §4,
 * plan §4.2–§4.3 + §6.1). Không I/O: grants + catalog cặp + now ⇒ caps/scopes. `PermissionService` chỉ
 * đọc dữ liệu rồi uỷ quyền vào đây — MỘT nguồn quyết định cho cả hai map, không biểu thức thứ hai.
 *
 * Hợp đồng (`k = "action:resourceType"`):
 *
 *   caps[k] === true ⟺ (a,t) ∈ P ∧ ¬excluded(a) ∧ ¬denied(a,t) ∧ (¬sensitive(a,t) ∨ hasExactAllow(a,t))
 *   và `k` KHÔNG BAO GIỜ chứa `*`.
 *
 *   P            = { cặp của grant ALLOW EXACT } ∪ { cặp catalog khớp bởi grant ALLOW WILDCARD }
 *   excluded(a)  = `isCapabilityExcluded(a)` — action tiền tố `reveal-` (owner chốt CW-1 23/10/2026)
 *   denied(a,t)  = ∃ grant DENY còn hiệu lực khớp (a,t) — trên MỌI grant, kể cả hàng sensitive (mirror
 *                  `decideCan`). Đây là vế SIẾT duy nhất so với bản cũ (bản cũ chỉ gom DENY non-sensitive).
 *   sensitive    = cờ của CẶP ĐÍCH ∨ cờ của một HÀNG ALLOW khớp (mirror `effectivelySensitive` của
 *                  `decideCan`). Grant EXACT mang đúng cờ cặp đích (UNIQUE (action, resource_type), cờ lấy
 *                  từ chính hàng được grant) ⇒ grant exact KHÔNG cần catalog; cặp khai triển từ wildcard đọc
 *                  cờ catalog VÀ cờ các hàng wildcard khớp — hàng wildcard mang `is_sensitive=true` khiến
 *                  `can()` deny-sensitive mọi cặp nó khớp khi không có ALLOW exact.
 *
 * Bất biến hình dạng được ép ở ĐIỂM PHÁT KHOÁ (không ở tập đích): mọi cặp chứa `*` bị loại, nên nhánh
 * nào cũng kín — kể cả catalog có hàng `('*','*')` hay `('view','*')`.
 *
 * ⚠️ KHÔNG phải cổng enforcement — `can()`/`PermissionGuard` vẫn là cổng thật. Đây là GỢI Ý UI phản chiếu
 * quyết định tầng công ty của `can()` cho call-site không khai `requiresReauth`/`objectGrantRequired` và
 * không khai `isSensitive` trên cặp mà catalog ghi non-sensitive (call-site khai `isSensitive: true` làm
 * `can()` đòi ALLOW exact ⇒ actor chỉ có wildcard thấy khoá mà nhận 403 — lệch hẹp, không rò; gate CW-SEC-2).
 *
 * ⚠️ Mệnh đề «không actor nào mất khoá» CHỈ đúng khi catalog không có hàng wildcard mang
 * `is_sensitive=true` và ảnh chụp catalog đã nạp ≥ 1 lần (plan §8 T1/T2). Hàng wildcard sensitive siết ở CẢ
 * HAI vế: DENY trên nó ⇒ mất khoá exact khớp (#23a); ALLOW trên nó ⇒ mọi cặp nó khớp cần ALLOW exact (vế
 * ALLOW, gate CW-SEC-1). Đừng đọc nó như định lý vô điều kiện.
 */
import type { DataScope } from "@mediaos/contracts";
import { isCapabilityExcluded } from "../auth/step-up/capability-exclusion";
import { grantMatchesPair, isGrantActive } from "./permission.decide";
import type { CompanyRoleGrant, CompanyRoleGrantWithScope } from "./permission.types";

/** Một cặp của catalog `permissions` — nguồn khai triển grant wildcard. */
export interface CapabilityCatalogPair {
  readonly action: string;
  readonly resourceType: string;
  readonly isSensitive: boolean;
}

export interface CapabilityProjectionInput<G extends CompanyRoleGrant> {
  /** Grant tầng công ty THÔ — có thể chứa hàng hết hạn (kịch bản cache); lọc lại ở đây. */
  readonly grants: readonly G[];
  /** Catalog cặp — CHỈ dùng để khai triển grant ALLOW wildcard; bỏ qua khi actor không giữ wildcard. */
  readonly catalog: readonly CapabilityCatalogPair[];
  readonly now: Date;
}

interface ProjectedPair<G> {
  readonly action: string;
  readonly resourceType: string;
  /** §6.1 — grant đóng góp scope: exact THẮNG, wildcard chỉ khi cặp không có ALLOW exact nào. */
  readonly contributors: readonly G[];
}

interface Candidate<G> extends ProjectedPair<G> {
  readonly isSensitive: boolean;
  readonly hasExactAllow: boolean;
}

const isWildcardGrant = (grant: Pick<CompanyRoleGrant, "action" | "resourceType">): boolean =>
  grant.action === "*" || grant.resourceType === "*";

const containsStar = (action: string, resourceType: string): boolean =>
  action.includes("*") || resourceType.includes("*");

const capabilityKey = (pair: { action: string; resourceType: string }): string =>
  `${pair.action}:${pair.resourceType}`;

/**
 * Plan §4.3 — catalog CHỈ cần khi actor giữ grant ALLOW wildcard CÒN HIỆU LỰC. Grant DENY wildcard không
 * cần catalog (nó chỉ trừ khỏi tập đã có). `false` ⇒ người gọi KHÔNG được đọc catalog (0 truy vấn thêm).
 */
export function needsCatalogForCapabilities(
  grants: readonly CompanyRoleGrant[],
  now: Date,
): boolean {
  return grants.some(
    (g) => g.effect === "ALLOW" && isWildcardGrant(g) && isGrantActive(g.expiresAt, now),
  );
}

/** Nhóm grant ALLOW EXACT theo cặp — mọi cặp ở đây có `hasExactAllow = true`. */
function exactCandidates<G extends CompanyRoleGrant>(
  exactAllows: readonly G[],
): Map<string, Candidate<G>> {
  const grouped = new Map<string, Candidate<G>>();
  for (const g of exactAllows) {
    const key = capabilityKey(g);
    const prior = grouped.get(key);
    grouped.set(key, {
      action: g.action,
      resourceType: g.resourceType,
      isSensitive: g.isSensitive || (prior?.isSensitive ?? false),
      hasExactAllow: true,
      contributors: [...(prior?.contributors ?? []), g],
    });
  }
  return grouped;
}

/** Tập cặp được phát (đã qua mọi vế của hợp đồng) — nguồn chung của caps và scopes. */
function projectPairs<G extends CompanyRoleGrant>(
  input: CapabilityProjectionInput<G>,
): ProjectedPair<G>[] {
  const active = input.grants.filter((g) => isGrantActive(g.expiresAt, input.now));
  const allows = active.filter((g) => g.effect === "ALLOW");
  const denies = active.filter((g) => g.effect === "DENY");
  const wildcardAllows = allows.filter(isWildcardGrant);

  const candidates = exactCandidates(allows.filter((g) => !isWildcardGrant(g)));
  if (wildcardAllows.length > 0) {
    for (const p of input.catalog) {
      const key = capabilityKey(p);
      // ⚠️ Cặp ĐÃ có ALLOW exact giữ nguyên `hasExactAllow = true` — ghi đè ở đây là lật cổng sensitive.
      if (candidates.has(key) || containsStar(p.action, p.resourceType)) continue;
      const matching = wildcardAllows.filter((g) => grantMatchesPair(g, p.action, p.resourceType));
      if (matching.length === 0) continue;
      // Soi gương `decideCan`/`decideStrongestScope` (`effectivelySensitive`): cặp là sensitive khi cờ
      // CẶP ĐÍCH bật HOẶC một hàng ALLOW khớp mang cờ — kể cả hàng wildcard (gate CW-SEC-1/CW-G1).
      const rowFlagged = matching.some((g) => g.isSensitive);
      candidates.set(key, {
        action: p.action,
        resourceType: p.resourceType,
        isSensitive: p.isSensitive || rowFlagged,
        hasExactAllow: false,
        contributors: matching,
      });
    }
  }

  return [...candidates.values()].filter(
    (c) =>
      !containsStar(c.action, c.resourceType) &&
      !isCapabilityExcluded(c.action) &&
      !denies.some((d) => grantMatchesPair(d, c.action, c.resourceType)) &&
      (!c.isSensitive || c.hasExactAllow),
  );
}

/** `/auth/me.capabilities` — xem hợp đồng ở đầu tệp. */
export function projectCapabilities(
  input: CapabilityProjectionInput<CompanyRoleGrant>,
): Record<string, boolean> {
  return Object.fromEntries(projectPairs(input).map((p) => [capabilityKey(p), true]));
}

/**
 * `/auth/me.scopes` — KEYSET === keyset `projectCapabilities` trên cùng đầu vào (cùng `projectPairs`).
 * Giá trị = data_scope DEDUPE của grant đóng góp (§6.1, soi gương `decideStrongestScope`: exact THẮNG,
 * wildcard bị LOẠI khi cặp có exact). Exact HẾT HẠN đã bị lọc trước ⇒ rơi về scope wildcard.
 */
export function projectCapabilityScopes(
  input: CapabilityProjectionInput<CompanyRoleGrantWithScope>,
): Record<string, DataScope[]> {
  return Object.fromEntries(
    projectPairs(input).map((p) => [
      capabilityKey(p),
      [...new Set(p.contributors.map((g) => g.dataScope as DataScope))],
    ]),
  );
}
