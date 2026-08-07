import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";
import { employeeProfiles, users } from "../db/schema";
import { PermissionService } from "./permission.service";
import { DataScopeRepository } from "./data-scope.repository";

/**
 * The acting user's scope context. orgUnitId / managedUserIds / headedOrgUnitIds are the HR signals
 * resolved once per request (resolveContext) and are only consulted by Department/Team. They are
 * OPTIONAL so a manually-built context (e.g. an Own/Company check) need not carry them — an absent
 * set is treated as empty (fail-closed), never match-all.
 */
export interface ScopeContext {
  userId: string;
  companyId: string;
  /** Requester's own org_unit — for Department (same unit). */
  orgUnitId?: string | null;
  /** S2-INT-2: users.id the requester manages via employee_manager_relations — for Team (multi-manager). */
  managedUserIds?: string[];
  /** S2-INT-2: org_unit ids the requester heads (org_units.head_user_id) — for Department over a headed unit. */
  headedOrgUnitIds?: string[];
}

/** A candidate employee row whose in-scope membership we test (single-resource path). */
export interface EmployeeScopeTarget {
  // S2-HR-BE-2: nullable — an unlinked employee has no user. null never matches Own/Team (=== a real
  // user id is false), so it is correctly out of Own/Team scope; Company/System/Department unaffected.
  userId: string | null;
  companyId: string;
  orgUnitId?: string | null;
  /** employee_profiles.direct_manager_id (a users.id) — for Team membership. */
  directManagerUserId?: string | null;
}

/**
 * S2-AUTH-BE-2 — DataScopeService: the shared final-authorization layer that translates a granted
 * data_scope (Own/Team/Department/Company/System) into a query condition, reusable by every module
 * (HR-BE-1 first; ATT/LEAVE/TASK later) WITHOUT hard-coding roles. BACKEND-03 §18/§26.4.
 *
 * Surfaces:
 *   - buildEmployeeScopeCondition(): a Drizzle predicate ANDed into a list SELECT (filter at the DB),
 *     shaped on `employee_profiles` (HR records).
 *   - buildUserScopeCondition(): the same idea shaped on `users` (ACCOUNT directories) — S6-SEC-ORGSCOPE-1.
 *   - isEmployeeInScope(): an in-memory membership check for a single already-loaded resource.
 *
 * AUTHORIZATION CONTRACT (plan-review #3a): isEmployeeInScope is a SCOPE FILTER, NOT a permission gate.
 * A consumer MUST first pass PermissionService.can()/resolveAndAssert (object-tier DENY + sensitive gate
 * live in can()) and only then use these to bound the rows/resource by data_scope.
 */
@Injectable()
export class DataScopeService {
  private readonly logger = new Logger(DataScopeService.name);

  constructor(
    private readonly permission: PermissionService,
    private readonly repo: DataScopeRepository,
  ) {}

  /**
   * Gate: resolve the user's strongest granted scope for (action,resourceType); 403 when none.
   * Returns the scope so the consumer can build the list filter. Does NOT accept a requested scope —
   * "wider than grant" is enforced by NARROWING the rows (via buildEmployeeScopeCondition), not a 403.
   */
  async resolveAndAssert(
    userId: string,
    companyId: string,
    action: string,
    resourceType: string,
    opts?: { isSensitive?: boolean },
  ): Promise<DataScope> {
    const scope = await this.permission.resolveStrongestScope(
      userId,
      companyId,
      action,
      resourceType,
      opts,
    );
    if (scope == null) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope");
    }
    return scope;
  }

  /**
   * Như `resolveAndAssert` nhưng **KHÔNG ném** khi không có grant nào — trả `null`.
   *
   * VÌ SAO cần bản không-ném (S6-SEC-ORGTEAMSCOPE-1 / N-1c, KI-049): có route mà cặp quyền GATE khác
   * cặp quyền BOUND dữ liệu. `/org/teams/:id/members` gate `read:team` (truy cập tài nguyên team),
   * còn hai cột danh tính người bị buộc bởi cặp danh bạ `view:user`. Actor hoàn toàn có thể có cặp
   * thứ nhất mà KHÔNG có cặp thứ hai — role SEEDED `hr-manager` đúng hình dạng đó (đo PROD
   * 2026-07-29: `read:team@Company`, không có `view:user` nào).
   *
   * Dùng `resolveAndAssert` ở đó sẽ biến "không được xem danh bạ" thành **403 cả route** — siết quá
   * tay, vì `read:team` vốn cho phép xem vế quan hệ thành viên (owner chốt 2026-07-29, plan §3.2
   * đường A). Người gọi PHẢI tự xử lý `null`; đừng dùng hàm này cho route mà cặp gate = cặp bound
   * (ở đó `resolveAndAssert` mới đúng, vì `null` nghĩa là guard đã hỏng).
   */
  async resolveOrNull(
    userId: string,
    companyId: string,
    action: string,
    resourceType: string,
    opts?: { isSensitive?: boolean },
  ): Promise<DataScope | null> {
    return this.permission.resolveStrongestScope(userId, companyId, action, resourceType, opts);
  }

  /**
   * Resolve the acting user's full scope context: own org_unit (Department), the EMR-managed user set
   * (Team multi-manager) and headed org_units (Department over a headed unit). Read fresh from the DB
   * each call — never cached — so a manager/head reassignment takes effect on the next request (S2-INT-2).
   */
  async resolveContext(userId: string, companyId: string): Promise<ScopeContext> {
    const data = await this.repo.getRequesterScopeContext(userId, companyId);
    return {
      userId,
      companyId,
      orgUnitId: data.orgUnitId,
      managedUserIds: data.managedUserIds,
      headedOrgUnitIds: data.headedOrgUnitIds,
    };
  }

  /**
   * The org_unit ids that bound Department scope: the requester's own unit ∪ every unit they head.
   * Empty → Department fail-closes to 0 rows (never a match-all).
   *
   * ⟲ **S8-CHAT-UX-BE-2 — `private` → `public`** (chỉ đổi khả kiến, KHÔNG đổi thân hàm ⇒ 0 thay đổi
   * hành vi cho caller cũ). Lý do: SPEC-15 §11b đòi "có `('update','org_unit')` **với đơn vị neo của
   * phòng**", tức một câu hỏi Department-scope trên MỘT org_unit đã biết — không phải một vị từ danh
   * sách nhân viên, nên `buildEmployeeScopeCondition` không dùng được. Bản sao thứ hai của luật "own ∪
   * headed" sẽ trôi khỏi bản này ngay lần ai đó thêm nguồn tầm-với thứ ba.
   */
  departmentOrgUnitIds(ctx: ScopeContext): string[] {
    const ids = new Set<string>();
    if (ctx.orgUnitId) ids.add(ctx.orgUnitId);
    for (const id of ctx.headedOrgUnitIds ?? []) ids.add(id);
    return [...ids];
  }

  /**
   * Build the employee-list predicate for `scope`. ALWAYS carries company_id (belt-and-suspenders over RLS;
   * never a bare no-op that could match-all if RLS were bypassed — plan-review #9). Unknown/null scope and
   * Department with no own/headed unit fail closed to `false` (0 rows).
   */
  buildEmployeeScopeCondition(scope: DataScope | null, ctx: ScopeContext): SQL {
    const tenant = eq(employeeProfiles.companyId, ctx.companyId);
    const falsey = sql`false`;
    switch (scope) {
      // N=1 single-tenant MVP: System stays bounded to the current tenant (cross-system out of scope).
      case "System":
      case "Company":
        return tenant;
      case "Department": {
        // own unit ∪ headed units (S2-INT-2). Empty → 0 rows (fail-closed, never match-all).
        const orgUnitIds = this.departmentOrgUnitIds(ctx);
        if (orgUnitIds.length === 0) return falsey;
        return and(tenant, inArray(employeeProfiles.orgUnitId, orgUnitIds)) ?? falsey;
      }
      case "Team": {
        // reports ∪ self ∪ EMR-managed (S2-INT-2): a manager sees their direct reports, their own row,
        // and every employee they manage via employee_manager_relations (project/professional/temporary).
        const managed = ctx.managedUserIds ?? [];
        const teamOr: SQL[] = [
          eq(employeeProfiles.directManagerId, ctx.userId),
          eq(employeeProfiles.userId, ctx.userId),
        ];
        if (managed.length > 0) teamOr.push(inArray(employeeProfiles.userId, managed));
        return and(tenant, or(...teamOr)) ?? falsey;
      }
      case "Own":
        return and(tenant, eq(employeeProfiles.userId, ctx.userId)) ?? falsey;
      default:
        return falsey;
    }
  }

  /**
   * S6-SEC-ORGSCOPE-1 — build the ACCOUNT-directory predicate for `scope`, shaped on `users` (not
   * `employee_profiles`). For endpoints that list ACCOUNTS (`GET /auth/users`, `GET /org/employees`)
   * rather than HR records.
   *
   * WHY A SECOND SHAPE instead of reusing buildEmployeeScopeCondition: that one filters
   * `employee_profiles`, so ANDing it into a `users` SELECT would drop every account WITHOUT an HR
   * profile — including at Company scope. `apps/console` uses `/org/employees` as the subject list of
   * the RBAC screen, so a freshly-created account would become unassignable. Regression locked by
   * `test/integration/org-directory-scope.int-spec.ts`.
   *
   * Team/Department FAIL CLOSED to 0 rows: `users` carries no org mapping, and §13 only ever grants
   * Company on the account-read pair, so a narrower grant has no defined membership here. Same rule as
   * `AuthUsersService.buildUserScopeCondition` — deliberately, so the two account-listing endpoints do
   * not disagree on which rows a given scope yields.
   *
   * ⚠️ NOT a byte-for-byte mirror (FULL gate 2026-07-28): the `Own` branch here ALSO carries `company_id`
   * whereas `auth-users.service.ts` does not. This side is the stricter one — if the two are ever merged,
   * merge TOWARD this shape; copying the `auth-users` shape would drop the tenant belt.
   * ✅ SAME permission pair since `S6-SEC-PERMVERB-1` (2026-07-29): both `/org/employees` and
   * `/auth/users` now gate `view:user`, so `data_scope` — which is PER-(permission, role) — is a
   * SINGLE knob for both account-read paths instead of two that merely happened to agree. Tightening
   * the scope on that one pair now tightens both. ADR: `docs/DECISIONS/DECISIONS-06_Permission_Verb_Canonical.md`.
   * (The two PREDICATE implementations are still duplicated — see nợ N-1b below.)
   *
   * NOTE (deliberate, plan §2.1): Team/Department therefore return LESS than Own — non-monotonic in TWO
   * ways. (1) Per-scope: Team < Own. (2) Across the grant UNION: `resolveStrongestScope` takes the max,
   * so a user holding BOTH Own and Team resolves to Team and sees NOTHING — adding a role REMOVES rows.
   * Both err narrow (never toward a leak), and no role holds those scopes on this pair today (measured on
   * PROD 2026-07-28). The systemic fix — flooring Team/Department at the Own predicate so the lattice is
   * monotonic — must be applied to BOTH endpoints at once, not smuggled in here (nợ N-1b).
   */
  buildUserScopeCondition(
    scope: DataScope | null,
    // Pick, not the full ScopeContext, ON PURPOSE (FULL gate 2026-07-28): this predicate consults ONLY
    // these two fields, and `OrgService` builds the context by hand instead of calling resolveContext().
    // Declaring the full type would make that call-site look complete while silently fail-closing to 0
    // rows the day someone teaches this method about Team/Department. With Pick, that day breaks
    // TYPECHECK at every call-site instead — loud beats silent.
    ctx: Pick<ScopeContext, "userId" | "companyId">,
  ): SQL {
    // Tenant ALWAYS carried, exactly as buildEmployeeScopeCondition does: never a bare predicate that
    // could match-all if RLS were ever bypassed.
    const tenant = eq(users.companyId, ctx.companyId);
    switch (scope) {
      // N=1 single-tenant MVP: System stays bounded to the current tenant.
      case "System":
      case "Company":
        return tenant;
      case "Own":
        return and(tenant, eq(users.id, ctx.userId)) ?? sql`false`;
      default:
        // 0 rows over HTTP 200 is indistinguishable from "tenant has no users" at every layer above:
        // `getCapabilities` publishes {pair: true} WITHOUT data_scope, so `useCan()` is true and the
        // console renders its plain "no users" empty state to an admin whose tenant has dozens. Log it
        // so the deny path leaves a trace an operator can actually find (nợ N-5, S6-SEC-ORG-1 §7).
        this.logger.warn(
          "account-directory read resolved to a scope with no defined membership on `users` → 0 rows",
          { userId: ctx.userId, companyId: ctx.companyId, scope },
        );
        return sql`false`;
    }
  }

  /**
   * In-memory membership test for a single employee target. Defense-in-depth: a cross-tenant target is
   * out of scope for EVERY scope including Company/System (plan-review #4) — never trust an in-memory
   * object to be tenant-correct just because RLS guards the DB.
   */
  isEmployeeInScope(
    scope: DataScope | null,
    ctx: ScopeContext,
    target: EmployeeScopeTarget,
  ): boolean {
    if (target.companyId !== ctx.companyId) return false;
    switch (scope) {
      case "System":
      case "Company":
        return true;
      case "Department":
        // own unit ∪ headed units (mirrors buildEmployeeScopeCondition for list/detail parity).
        return (
          target.orgUnitId != null && this.departmentOrgUnitIds(ctx).includes(target.orgUnitId)
        );
      case "Team":
        // reports ∪ self ∪ EMR-managed (mirrors the list predicate so list and detail agree exactly).
        return (
          target.directManagerUserId === ctx.userId ||
          target.userId === ctx.userId ||
          (target.userId != null && (ctx.managedUserIds ?? []).includes(target.userId))
        );
      case "Own":
        return target.userId === ctx.userId;
      default:
        return false;
    }
  }
}
