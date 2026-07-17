import { Injectable } from "@nestjs/common";
import type { OrgChartEmployeeNode, OrgChartEmployeeTree } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import { HrOrgChartRepository } from "./hr-org-chart.repository";

type RequestUser = { id: string; companyId: string };

/**
 * A flat directory-class row for one active employee — the ONLY fields the org-chart may surface
 * (BẤT BIẾN #3: no PII/salary/identity/contact). `directManagerId` is a users.id (shortcut column) used
 * to link the tree; it is NEVER emitted in the node.
 */
export interface OrgChartRow {
  employeeId: string;
  userId: string | null;
  directManagerId: string | null;
  displayName: string | null;
  positionName: string | null;
  orgUnitName: string | null;
  jobLevelName: string | null;
  avatarUrl: string | null;
  employeeCode: string | null;
}

/**
 * S5-HR-ORGCHART-BE-1 — org-chart cây nhân sự (SPEC-03 §14, Option A: scoped subtree only).
 *
 * Pipeline = ĐÚNG pipeline của GET /hr/employees: gate read:employee (403 nếu thiếu) → resolve scope +
 * ctx (fresh) → build predicate → fetch tập ACTIVE scoped (directory-only SELECT) → dựng cây in-memory.
 * Node = tập con active của cùng predicate ⇒ org-chart KHÔNG BAO GIỜ lộ node mà list không lộ. Không có
 * đường quản lý lên trên: manager ngoài tập / null / chưa-link / đã nghỉ → node gốc (orphan).
 */
@Injectable()
export class HrOrgChartService {
  constructor(
    private readonly repo: HrOrgChartRepository,
    private readonly db: DatabaseService,
    private readonly dataScope: DataScopeService,
  ) {}

  async getEmployeeOrgChart(user: RequestUser): Promise<OrgChartEmployeeTree> {
    // GATE first (403 if no read:employee grant) — BEFORE any repo/DB read (fail-closed).
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "read",
      "employee",
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    // SCOPE = filter: reuse the SAME predicate as the list (Own/Team/Department/Company/System).
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);

    const rows = await this.db.withTenant(user.companyId, (tx) =>
      this.repo.listScopedActiveTx(tx, user.companyId, scopeCond),
    );
    return buildOrgChartTree(rows);
  }
}

/** Compare nodes by displayName (nulls last), tiebreak by employeeId — deterministic output order. */
function compareNodes(a: OrgChartEmployeeNode, b: OrgChartEmployeeNode): number {
  const an = a.displayName;
  const bn = b.displayName;
  if (an == null && bn == null) return a.employeeId.localeCompare(b.employeeId);
  if (an == null) return 1;
  if (bn == null) return -1;
  const c = an.localeCompare(bn);
  return c !== 0 ? c : a.employeeId.localeCompare(b.employeeId);
}

/**
 * Pure tree builder — no DB, no I/O. Guarantees (crown-jewel, "no hang/500" for ANY input, incl. adversarial):
 *   - node set = exactly the DISTINCT-by-employeeId `rows` (already scope-filtered by the caller) — no row
 *     is added or fetched here; a duplicate employeeId is dropped first-wins (never collapsed to a double ref);
 *   - each employee appears EXACTLY once;
 *   - a manager outside the set / null / unlinked → the node is a root (orphan);
 *   - cyclic data (self-manage or A→B→A) never loops forever: the object graph is cut acyclic and
 *     `warnings.cyclesDetected` is set. The returned graph is always JSON-serialisable (a strict forest).
 *   - walks are ITERATIVE (explicit heap stacks) — a pathologically DEEP manager chain (thousands of rows in
 *     a linear line) can never blow the call stack / 500 (silent-failure-hunter MEDIUM).
 *
 * Runtime field-allowlist enforcement lives HERE (the explicit projection below only ever sets the 8
 * directory-class fields + children) + the repo SELECT — NOT in a Zod parse (the DTO `.strict()` is the
 * compile-time contract; a recursive runtime parse would re-introduce the deep-recursion 500 this avoids).
 *
 * Exported standalone so it is unit-testable without the Nest DI container.
 */
export function buildOrgChartTree(rows: OrgChartRow[]): OrgChartEmployeeTree {
  // ONE node object per DISTINCT employeeId (roots + children + edge-cut all reference the SAME object).
  const nodeById = new Map<string, OrgChartEmployeeNode>();
  // userId → employeeId: only a linked row (userId != null) can be a manager/parent (direct_manager_id → users.id).
  const employeeIdByUser = new Map<string, string>();
  // First-wins de-dup: honor the "exactly once" contract for ANY caller. The repo guarantees a unique
  // employeeId (PK) so this never fires there, but a duplicate row must be dropped, not double-referenced.
  const uniqueRows: OrgChartRow[] = [];
  for (const r of rows) {
    if (nodeById.has(r.employeeId)) continue; // duplicate employeeId → skip (first-wins)
    uniqueRows.push(r);
    nodeById.set(r.employeeId, {
      employeeId: r.employeeId,
      userId: r.userId,
      displayName: r.displayName,
      positionName: r.positionName,
      orgUnitName: r.orgUnitName,
      jobLevelName: r.jobLevelName,
      avatarUrl: r.avatarUrl,
      employeeCode: r.employeeCode,
      children: [],
    });
    if (r.userId != null && !employeeIdByUser.has(r.userId)) {
      employeeIdByUser.set(r.userId, r.employeeId); // first-wins (unique index makes dup unreachable here)
    }
  }

  let cyclesDetected = false;
  const roots: OrgChartEmployeeNode[] = [];
  // childEmployeeId → parentEmployeeId, so a cut edge can be removed from the exact parent later.
  const parentOf = new Map<string, string>();

  for (const r of uniqueRows) {
    const node = nodeById.get(r.employeeId)!;
    const dm = r.directManagerId;
    // Self-manage (direct_manager_id === own user id) = degenerate cycle → root + flag.
    const isSelfManage = dm != null && dm === r.userId;
    if (isSelfManage) cyclesDetected = true;
    const parentEmpId = dm != null && !isSelfManage ? employeeIdByUser.get(dm) : undefined;
    if (parentEmpId != null && parentEmpId !== r.employeeId) {
      nodeById.get(parentEmpId)!.children.push(node);
      parentOf.set(r.employeeId, parentEmpId);
    } else {
      roots.push(node); // manager null / outside set / unlinked / self → orphan root
    }
  }

  // Cut multi-level cycles: iterative DFS from roots; any node still unvisited sits in a pure cycle with no
  // acyclic entry → cut its incoming edge (functional graph: one parent → breaks the loop), promote to root.
  const visited = new Set<string>();
  const visit = (start: OrgChartEmployeeNode): void => {
    const stack: OrgChartEmployeeNode[] = [start];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (visited.has(node.employeeId)) continue;
      visited.add(node.employeeId);
      for (const c of node.children) stack.push(c);
    }
  };
  for (const r of roots) visit(r);
  for (const r of uniqueRows) {
    if (visited.has(r.employeeId)) continue;
    cyclesDetected = true;
    const node = nodeById.get(r.employeeId)!;
    const parentEmpId = parentOf.get(r.employeeId);
    if (parentEmpId != null) {
      const parent = nodeById.get(parentEmpId)!;
      const idx = parent.children.indexOf(node);
      if (idx >= 0) parent.children.splice(idx, 1);
    }
    roots.push(node);
    visit(node);
  }

  // Deterministic ordering (iterative) + a final defensive acyclic guarantee (a strict forest by now; the
  // sortSeen guard cuts any residual back-edge so the returned object can NEVER be circular).
  const sortSeen = new Set<string>();
  roots.sort(compareNodes);
  const sortStack: OrgChartEmployeeNode[] = [...roots];
  while (sortStack.length > 0) {
    const node = sortStack.pop()!;
    if (sortSeen.has(node.employeeId)) {
      cyclesDetected = true;
      node.children = [];
      continue;
    }
    sortSeen.add(node.employeeId);
    node.children.sort(compareNodes);
    for (const c of node.children) sortStack.push(c);
  }

  return { roots, warnings: { cyclesDetected } };
}
