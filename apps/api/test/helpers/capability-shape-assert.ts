/**
 * S14-SEC-CAPWILDCARD-1 (plan §9.1a, D-v4-6) — khuôn 3 khẳng định thay cho 9 dòng từng GHIM
 * `caps["*:*"] === true` ở `auth-me-capabilities.int.spec.ts`.
 *
 * Hợp đồng mới (ADR `DECISIONS-13` §4): `capabilities` là phép chiếu quyết định của `can()` ở tầng công
 * ty — khoá KHÔNG BAO GIỜ chứa `*`. Mỗi dòng cũ đổi 1 ↔ 1 thành một lời gọi helper này; tham số là LOẠI
 * actor của chính ca đó (đọc từng ca, không áp máy móc):
 *
 *   (a) không khoá nào chứa `*` (gồm `"*:*"`);
 *   (b) một cặp non-sensitive CHÍNH TẮC vẫn `true` — `view:user` (mig 0444, `is_sensitive=false`), không
 *       lấy cặp bất kỳ vì catalog lane bị nhiều spec đóng dấu;
 *   (c) khẳng định sensitive theo grant của actor: chỉ-wildcard ⇒ cặp sensitive chính tắc VẮNG; có grant
 *       exact sensitive ⇒ cặp đó CÓ.
 */
import { expect } from "vitest";

/** Cặp non-sensitive chính tắc — `migrations/0444…sql` (`('view','user',false)`). */
export const CANONICAL_NON_SENSITIVE_CAP = "view:user";

/**
 * Cặp sensitive chính tắc NGOÀI `SENSITIVE_CAPABILITY_ALLOWLIST` — `migrations/0454…sql:45`
 * (`is_sensitive=true`), grant exact `Own` cho role employee (0008).
 */
export const CANONICAL_SENSITIVE_OUTSIDE_ALLOWLIST_CAP = "view-own:adjustment";

export type WildcardActorShape =
  /** Actor CHỈ giữ grant `*:*` — không grant exact sensitive nào. */
  | { readonly kind: "wildcard-only" }
  /** Actor giữ `*:*` KÈM grant exact trên các cặp sensitive liệt kê. */
  | { readonly kind: "wildcard-with-exact-sensitive"; readonly exactSensitive: readonly string[] };

export function expectCompanyTierCapsShape(
  caps: Record<string, boolean>,
  shape: WildcardActorShape,
): void {
  const starKeys = Object.keys(caps).filter((k) => k.includes("*"));
  expect(starKeys, "capabilities không được chứa khoá có '*' (DECISIONS-13 §4)").toEqual([]);
  expect(
    caps[CANONICAL_NON_SENSITIVE_CAP],
    `grant wildcard phải khai triển ra cặp non-sensitive ${CANONICAL_NON_SENSITIVE_CAP}`,
  ).toBe(true);

  if (shape.kind === "wildcard-only") {
    expect(
      CANONICAL_SENSITIVE_OUTSIDE_ALLOWLIST_CAP in caps,
      `wildcard KHÔNG được mở cặp sensitive ${CANONICAL_SENSITIVE_OUTSIDE_ALLOWLIST_CAP}`,
    ).toBe(false);
    return;
  }
  for (const key of shape.exactSensitive) {
    expect(caps[key], `grant exact sensitive ${key} phải hiện trong capabilities`).toBe(true);
  }
}

/** Actor chỉ giữ `*:*`. */
export const WILDCARD_ONLY: WildcardActorShape = { kind: "wildcard-only" };

/** Actor giữ `*:*` + role employee (0008) — role đó cấp exact `view-own:adjustment` (sensitive). */
export const WILDCARD_WITH_EMPLOYEE_ROLE: WildcardActorShape = {
  kind: "wildcard-with-exact-sensitive",
  exactSensitive: [CANONICAL_SENSITIVE_OUTSIDE_ALLOWLIST_CAP],
};
