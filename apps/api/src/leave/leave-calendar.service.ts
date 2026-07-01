import { Injectable } from "@nestjs/common";
import type { LeaveCalendarQuery, LeaveCalendarResponse } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import { LeaveCalendarRepository } from "./leave-calendar.repository";
import { toCalendarEntryView } from "./leave-calendar.mappers";

interface Actor {
  id: string;
  companyId: string;
}

/** query.scope → (action, resource_type='leave-calendar', is_sensitive) — mig 0455 catalog, 3 distinct pairs. */
const SCOPE_PAIR = {
  own: { action: "view-own", isSensitive: false },
  team: { action: "view-team", isSensitive: true },
  company: { action: "view-company", isSensitive: true },
} as const;

const RESOURCE = "leave-calendar";

/**
 * S3-LEAVE-BE-5 (CO-S4-005) — GET /leave/calendar: đơn Approved/Pending trong [from,to], theo data-scope.
 *
 * GATE (2 tầng, mirror S3-LEAVE-BE-3 listPending): controller chỉ gate coarse view-own:leave-calendar
 * (mọi role có ở Own — chặn user hoàn toàn ngoài LEAVE). Ở ĐÂY, resolveAndAssert(action-theo-query.scope,
 * 'leave-calendar') là gate THẬT: employee xin scope=team/company → KHÔNG có view-team/view-company →
 * 403 ngay (KHÔNG âm thầm rơi về Own — client yêu cầu gì phải được cấp đúng cái đó, fail-closed).
 *
 * scope trả về từ resolveAndAssert LUÔN khớp scope suy ra từ action (Own/Team/Company — mig 0455 seed 1-1),
 * dùng thẳng để build predicate — KHÔNG hard-code lại.
 */
@Injectable()
export class LeaveCalendarService {
  constructor(
    private readonly db: DatabaseService,
    private readonly dataScope: DataScopeService,
    private readonly repo: LeaveCalendarRepository,
  ) {}

  async listCalendar(actor: Actor, query: LeaveCalendarQuery): Promise<LeaveCalendarResponse> {
    const pair = SCOPE_PAIR[query.scope];
    const scope = await this.dataScope.resolveAndAssert(
      actor.id,
      actor.companyId,
      pair.action,
      RESOURCE,
      { isSensitive: pair.isSensitive },
    );
    const ctx = await this.dataScope.resolveContext(actor.id, actor.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);

    const rows = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.listScopedTx(actor.companyId, scopeCond, { from: query.from, to: query.to }, tx),
    );

    return {
      scope: query.scope,
      items: rows.map((row) => toCalendarEntryView(row, actor.id)),
    };
  }
}
