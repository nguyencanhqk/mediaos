/**
 * HR-PERF-1 (beBatchPermHr) — pure 4-tier decision function, SHARED by can() and canBatch().
 *
 * Extracted verbatim from PermissionService.can() (§3b of G3-permission-engine.md) so there is
 * ONE source of truth for the decision semantics. can() and canBatch() differ ONLY in the FETCH
 * layer (single vs batched grant reads); the DECIDE layer is this function — they can never drift.
 *
 * Priority (lower number = higher authority):
 *   1. Object-level DENY  → deny-explicit (immediate)
 *   2. Object-level ALLOW → allow (beats company-level; object grants are always exact — no wildcards)
 *   3. Company-level DENY (any role DENY across all roles) → deny-explicit
 *   3b. F2 object-grant requirement (reveal-secret class) → deny-object-required
 *   4. Company-level ALLOW → allow (wildcards valid for non-sensitive only)
 *   5. Default            → deny-default
 *
 * Sensitive gate: wildcard grants (*:*) do NOT satisfy; requires exact non-wildcard ALLOW.
 * effectivelySensitive = input.isSensitive (gợi ý CALLER) OR any matching grant.isSensitive
 * (defense-in-depth) OR input.pairIsSensitive (cờ catalog của CẶP ĐÍCH — S14-SEC-DASHGATE-WILDCARD-1,
 * ADR `DECISIONS-12`; hai vế đầu MỘT MÌNH để `*:*` mở được cặp sensitive).
 * expires_at: re-checked here (cache-hit safety — the caller passes RAW grants, filter is applied here).
 * This function NEVER throws — the caller owns fail-closed error handling around the fetch.
 */
import { DATA_SCOPES, type DataScope } from "@mediaos/contracts";
import type {
  CanInput,
  CompanyRoleGrant,
  CompanyRoleGrantWithScope,
  ObjectGrant,
  PermissionDecision,
} from "./permission.types";

/**
 * Pure decision. `rawCompanyGrants` may include expired rows (cache scenario) — expiry is
 * re-checked here. `objectGrants` are the object_permissions for THIS (resourceType, resourceId);
 * pass [] for a type-level check (resourceId null/undefined) so the object-tier is skipped.
 */
export function decideCan(
  rawCompanyGrants: CompanyRoleGrant[],
  objectGrants: ObjectGrant[],
  input: CanInput,
  now: Date,
): PermissionDecision {
  const {
    action,
    resourceType,
    resourceId,
    isSensitive = false,
    pairIsSensitive = false,
    requiresReauth = false,
    objectGrantRequired,
    ctx,
  } = input;

  // Re-check expiresAt here — expires_at safety rule from §3b (repository may hand us stale/cached rows).
  const companyGrants = rawCompanyGrants.filter((g) => isGrantActive(g.expiresAt, now));

  // Company grants support wildcards: action='*' matches any action, resourceType='*' any type.
  // Object grants are always specific (no wildcards).
  const matchesCompanyGrant = (g: CompanyRoleGrant): boolean =>
    (g.action === action || g.action === "*") &&
    (g.resourceType === resourceType || g.resourceType === "*");

  // ── Object-tier (priority 1–2) ────────────────────────────────────────
  if (resourceId != null) {
    const forAction = objectGrants.filter(
      (g) => g.action === action && g.resourceType === resourceType,
    );

    // Priority 1: any object-level DENY → immediate deny
    if (forAction.some((g) => g.effect === "DENY")) {
      return { allow: false, reason: "deny-explicit", auditRequired: isSensitive };
    }

    // Priority 2: object-level ALLOW. Object grants are inherently exact (no wildcards), so they
    // satisfy the sensitive gate — they ARE the explicit grant the sensitive gate requires.
    if (forAction.some((g) => g.effect === "ALLOW")) {
      if (requiresReauth && !isReauthValid(ctx?.reauthValidUntil, now)) {
        return {
          allow: false,
          reason: "deny-reauth-required",
          requiresReauth: true,
          auditRequired: true,
        };
      }
      return { allow: true, reason: "allow", auditRequired: isSensitive };
    }
  }

  // ── Company-tier (priority 3) ─────────────────────────────────────────
  // Any company-level DENY from ANY role (deny-overrides-across-roles). Wildcard DENY also matches.
  if (companyGrants.some((g) => matchesCompanyGrant(g) && g.effect === "DENY")) {
    return { allow: false, reason: "deny-explicit", auditRequired: isSensitive };
  }

  // ── F2 object-grant requirement (crown-jewel, ADR-0010) ────────────────
  // reveal-secret class needs a per-object (Tier-3) ALLOW. Reaching here means NO object ALLOW matched.
  // Company-level ALLOW — even super-admin *:* — is NOT sufficient. Fail-closed DENY.
  const needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth);
  if (needsObjectGrant) {
    return { allow: false, reason: "deny-object-required", auditRequired: true };
  }

  const companyAllows = companyGrants.filter((g) => matchesCompanyGrant(g) && g.effect === "ALLOW");

  // Sensitive nếu MỘT TRONG BA: caller khai · một hàng grant khớp mang cờ · **cặp ĐÍCH là sensitive
  // trong catalog** (S14-SEC-DASHGATE-WILDCARD-1, ADR `DECISIONS-12`).
  //
  // Vế thứ ba là bản vá: hai vế đầu đều đọc cờ của thứ KHÁC cặp đích, nên actor chỉ cầm `('*','*')`
  // (hàng wildcard mang `is_sensitive=false`) trượt qua cổng — cổng tự khoá mình bằng chìa của kẻ đi qua.
  //
  // ⚠️ VỊ TRÍ DÒNG NÀY LÀ MỘT BẢO ĐẢM, KHÔNG PHẢI NGẪU NHIÊN — đừng chuyển nó lên trên:
  //   • object-tier ALLOW trả về ở :82 với `auditRequired: isSensitive` — `hr-read.service.ts` và
  //     `employees.service.ts` dùng `reveal = allow && auditRequired`, nên lật false→true ở đó biến
  //     MASK thành REVEAL (rò dữ liệu, đúng chiều ngược với WO này);
  //   • `needsObjectGrant` quyết ở :95-98 từ `isSensitive && requiresReauth` — bật nhầm sẽ deny CẢ
  //     actor có grant EXACT.
  // Cả hai nằm TRƯỚC dòng này ⇒ `pairIsSensitive` không với tới được chúng.
  //
  // ⚠️ KHÔNG có bất biến «`pairIsSensitive` chỉ đẻ ra deny». Bản đầu của WO này khẳng định vậy, dựa
  // trên lập luận: grant EXACT mang cờ catalog của chính cặp đích qua `innerJoin(permissions)`, nên
  // hễ `explicitAllows` khác rỗng thì vế thứ hai đã true từ trước. **Lập luận đó SAI** — nó giả định
  // cờ hàng-grant và cờ catalog KHÔNG BAO GIỜ lệch, mà chúng lệch ở ít nhất hai trạng thái THẬT:
  //   • catalog suy biến (`permission-catalog-snapshot.ts`: nạp hỏng + chưa có ảnh ⇒ MỌI cặp = true)
  //     trong khi grant vẫn phục vụ được từ cache Valkey (`permission.cache.ts` — không chạm DB);
  //   • `permissions.is_sensitive` vừa bị lật false→true, hàng grant trong cache còn mang cờ CŨ ≤300s.
  // Ở cả hai, một actor có grant EXACT trên cặp NON-sensitive vào được nhánh sensitive nhờ MỖI
  // `pairIsSensitive` mà `explicitAllows` KHÔNG rỗng ⇒ chạm return ALLOW ở cuối nhánh.
  // Vì thế `auditRequired` ở return đó phải được SUY RA, không hard-code — xem chú thích tại chỗ.
  const effectivelySensitive =
    isSensitive || companyAllows.some((g) => g.isSensitive) || pairIsSensitive;

  if (effectivelySensitive) {
    // Sensitive gate: wildcards (*) do NOT satisfy — require exact (non-wildcard) ALLOW.
    const explicitAllows = companyAllows.filter((g) => g.action !== "*" && g.resourceType !== "*");
    if (explicitAllows.length === 0) {
      return { allow: false, reason: "deny-sensitive", auditRequired: true };
    }
    if (requiresReauth && !isReauthValid(ctx?.reauthValidUntil, now)) {
      return {
        allow: false,
        reason: "deny-reauth-required",
        requiresReauth: true,
        auditRequired: true,
      };
    }
    // `auditRequired` SUY RA, KHÔNG hard-code `true` (S14-SEC-DASHGATE-WILDCARD-1, security-review):
    //   • mọi trạng thái tới được return này TRƯỚC bản vá đều có `isSensitive` hoặc một hàng grant
    //     mang cờ ⇒ biểu thức cho `true`, y hệt hằng cũ. Không đổi hành vi cũ.
    //   • trạng thái MỚI (vào nhánh nhờ MỖI `pairIsSensitive`, cờ hàng-grant lệch cờ catalog — xem
    //     chú thích ở `effectivelySensitive`) cho `false`, đúng bằng giá trị priority-4 mà cùng đầu
    //     vào ấy nhận trước bản vá.
    // Vì sao PHẢI thế: `hr-read.service.ts` và `employees.service.ts` tính `reveal = allow &&
    // auditRequired`. Hard-code `true` ở đây lật `reveal` false→true ⇒ biến MASK thành REVEAL, tức rò
    // dữ liệu — đúng chiều NGƯỢC với WO này, và chỉ nổ khi catalog đang suy biến.
    return {
      allow: true,
      reason: "allow",
      auditRequired: isSensitive || companyAllows.some((g) => g.isSensitive),
    };
  }

  // Priority 4: non-sensitive ALLOW (wildcards valid here)
  if (companyAllows.length > 0) {
    if (requiresReauth && !isReauthValid(ctx?.reauthValidUntil, now)) {
      return {
        allow: false,
        reason: "deny-reauth-required",
        requiresReauth: true,
        auditRequired: false,
      };
    }
    return { allow: true, reason: "allow", auditRequired: false };
  }

  // ── Default deny ──────────────────────────────────────────────────────
  return { allow: false, reason: "deny-default", auditRequired: isSensitive };
}

/** Scope strength order (BACKEND-03 §18.1): higher = wider visibility. */
const SCOPE_STRENGTH: Record<DataScope, number> = {
  Own: 1,
  Team: 2,
  Department: 3,
  Company: 4,
  System: 5,
};

/** Narrows an arbitrary string to a known DataScope, or null when it is not a recognised scope. */
function normalizeScope(value: string): DataScope | null {
  return (DATA_SCOPES as readonly string[]).includes(value) ? (value as DataScope) : null;
}

/** One (action, resourceType) question asked of a grant set. `isSensitive` is the CALLER hint. */
export interface ScopeRequest {
  action: string;
  resourceType: string;
  isSensitive?: boolean;
  /**
   * S14-SEC-DASHGATE-WILDCARD-1 — cờ catalog của CẶP ĐÍCH, bơm bởi `PermissionService`.
   * Mirror `CanInput.pairIsSensitive`; caller sản phẩm không cần đặt.
   */
  pairIsSensitive?: boolean;
}

/**
 * S14-PERF-DASHACTOR-1 — pure strongest-scope resolver, SHARED by resolveStrongestScope() and
 * resolveStrongestScopes(). Body moved VERBATIM out of PermissionService.resolveStrongestScope so
 * there is ONE source of truth for the scope semantics — exactly the split decideCan() made for
 * can()/canBatch(): the two entry points differ ONLY in the FETCH layer (1 pair vs N pairs over the
 * SAME grant set), never in the DECIDE layer.
 *
 * Algorithm (PIN chống nới scope ngầm — BACKEND-03 §18, plan-review):
 *   1. DENY-overrides (wildcard-aware) khớp → null (chặn, ưu tiên cao nhất).
 *   2. Mỗi grant đóng góp ĐÚNG dataScope của chính nó — KHÔNG nâng cấp (vd: *:* mang 'Company' KHÔNG thành System).
 *   3. Sensitive (caller-hint HOẶC grant.isSensitive) → chỉ EXACT non-wildcard ALLOW đủ điều kiện (mirror can()).
 *   4. EXACT > WILDCARD: có exact ALLOW đủ điều kiện → mạnh nhất trong exact; else (non-sensitive) → mạnh nhất wildcard.
 *   5. Không đủ điều kiện → null.
 *
 * ⚠️ INTERNAL — như `decideCan`, hàm này NEVER throws và KHÔNG tự fail-closed: **người gọi sở hữu
 * try/catch**. Gọi thẳng hàm này thay vì đi qua PermissionService là bỏ mất vỏ fail-closed
 * (lỗi hạ tầng sẽ nổ ra ngoài thay vì thành `null` = deny).
 *
 * `rawGrants` có thể chứa hàng đã hết hạn (kịch bản cache) — expiry được lọc LẠI ở đây, mirror decideCan.
 */
export function decideStrongestScope(
  rawGrants: CompanyRoleGrantWithScope[],
  req: ScopeRequest,
  now: Date,
): DataScope | null {
  const { action, resourceType, isSensitive, pairIsSensitive } = req;
  const grants = rawGrants.filter((grant) => isGrantActive(grant.expiresAt, now));

  const matches = (grant: CompanyRoleGrantWithScope): boolean =>
    (grant.action === action || grant.action === "*") &&
    (grant.resourceType === resourceType || grant.resourceType === "*");

  // Deny-overrides-across-roles (wildcard-aware) — any matching DENY blocks all scope.
  if (grants.some((grant) => grant.effect === "DENY" && matches(grant))) return null;

  const allowMatches = grants.filter((grant) => grant.effect === "ALLOW" && matches(grant));
  if (allowMatches.length === 0) return null;

  const isExact = (grant: CompanyRoleGrantWithScope): boolean =>
    grant.action === action && grant.resourceType === resourceType;

  // Sensitive gate (mirror can() §3b): wildcard ALLOW does NOT satisfy a sensitive pair.
  // Vế `pairIsSensitive` = cờ catalog của CẶP ĐÍCH (S14-SEC-DASHGATE-WILDCARD-1, ADR `DECISIONS-12`) —
  // hai vế đầu đọc cờ của caller / của HÀNG GRANT KHỚP, nên `*:*` (is_sensitive=false) trượt qua.
  // Ở đây không có `auditRequired` để lật, nên vị trí dòng không nhạy như bản `decideCan`; giữ cùng
  // hình dạng biểu thức để hai bản không trôi khỏi nhau.
  const effectivelySensitive =
    (isSensitive ?? false) ||
    allowMatches.some((grant) => grant.isSensitive) ||
    (pairIsSensitive ?? false);

  let eligible: CompanyRoleGrantWithScope[];
  if (effectivelySensitive) {
    // Mirror can(): only exact (non-wildcard) ALLOW satisfies a sensitive pair.
    eligible = allowMatches.filter(isExact);
  } else {
    const exact = allowMatches.filter(isExact);
    eligible = exact.length > 0 ? exact : allowMatches;
  }
  if (eligible.length === 0) return null;

  // Strongest scope among eligible; each grant contributes its own scope (no upgrade).
  let best: DataScope | null = null;
  let bestStrength = 0;
  for (const grant of eligible) {
    const scope = normalizeScope(grant.dataScope);
    if (scope == null) continue;
    const strength = SCOPE_STRENGTH[scope];
    if (strength > bestStrength) {
      bestStrength = strength;
      best = scope;
    }
  }
  return best;
}

/** Returns true when the grant is active (not expired). Treats malformed dates as expired. */
export function isGrantActive(expiresAt: Date | null, now: Date): boolean {
  if (expiresAt == null) return true;
  if (!(expiresAt instanceof Date) || isNaN(expiresAt.getTime())) return false;
  return expiresAt > now;
}

/** Returns true when the reauth window is still valid. */
export function isReauthValid(reauthValidUntil: Date | null | undefined, now: Date): boolean {
  if (reauthValidUntil == null) return false;
  if (!(reauthValidUntil instanceof Date) || isNaN(reauthValidUntil.getTime())) return false;
  return reauthValidUntil > now;
}
