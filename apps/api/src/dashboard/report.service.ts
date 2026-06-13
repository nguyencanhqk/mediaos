import { Injectable } from "@nestjs/common";
import { and, count, eq, gte, isNull, lt, sql, sum } from "drizzle-orm";
import type { ReportSummaryDto } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { revenueRecords, costRecords } from "../db/schema/finance";
import { channels } from "../db/schema/media";
import { employeeProfiles } from "../db/schema/employees";
import { attendanceRecords } from "../db/schema/hr";

interface RequestUser {
  id: string;
  companyId: string;
}

interface ReportPermissionSet {
  canReadFinanceReport: boolean;
  canReadEmployeeReport: boolean;
  canReadAttendanceReport: boolean;
}

/**
 * ReportService — G14-2 role-filtered aggregate report.
 * Server returns ONLY what the caller's permission set allows.
 * null fields = caller lacks the required permission; FE renders what it receives.
 */
@Injectable()
export class ReportService {
  constructor(private readonly db: DatabaseService) {}

  async getReport(actor: RequestUser, perms: ReportPermissionSet): Promise<ReportSummaryDto> {
    const [finance, employee, attendance] = await Promise.all([
      this.getFinanceSummary(actor, perms.canReadFinanceReport),
      this.getEmployeeSummary(actor, perms.canReadEmployeeReport),
      this.getAttendanceReport(actor, perms.canReadAttendanceReport),
    ]);

    return {
      revenueThisMonth: finance.revenueThisMonth,
      costThisMonth: finance.costThisMonth,
      profitThisMonth: finance.profitThisMonth,
      revenueByChannel: finance.revenueByChannel,
      totalEmployees: employee.totalEmployees,
      todayAttendanceRate: attendance.todayAttendanceRate,
    };
  }

  // ─── Finance aggregate ────────────────────────────────────────────────────

  private async getFinanceSummary(
    actor: RequestUser,
    canRead: boolean,
  ): Promise<
    Pick<ReportSummaryDto, "revenueThisMonth" | "costThisMonth" | "profitThisMonth" | "revenueByChannel">
  > {
    if (!canRead) {
      return {
        revenueThisMonth: null,
        costThisMonth: null,
        profitThisMonth: null,
        revenueByChannel: null,
      };
    }

    const { companyId } = actor;
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + "-01";

    const [revenueRows, costRows, channelRows] = await Promise.all([
      this.db.withTenant(companyId, (tx) =>
        tx
          .select({ total: sum(revenueRecords.amount) })
          .from(revenueRecords)
          .where(
            and(
              eq(revenueRecords.companyId, companyId),
              gte(revenueRecords.revenueDate, monthStart),
              // Only original entries; adjustments/voids are accounted separately
              sql`${revenueRecords.entryKind} = 'original'`,
            ),
          ),
      ),
      this.db.withTenant(companyId, (tx) =>
        tx
          .select({ total: sum(costRecords.amount) })
          .from(costRecords)
          .where(
            and(
              eq(costRecords.companyId, companyId),
              gte(costRecords.costDate, monthStart),
              sql`${costRecords.entryKind} = 'original'`,
            ),
          ),
      ),
      this.db.withTenant(companyId, (tx) =>
        tx
          .select({
            channelId: revenueRecords.channelId,
            channelName: channels.name,
            total: sum(revenueRecords.amount),
          })
          .from(revenueRecords)
          .leftJoin(channels, eq(revenueRecords.channelId, channels.id))
          .where(
            and(
              eq(revenueRecords.companyId, companyId),
              gte(revenueRecords.revenueDate, monthStart),
              sql`${revenueRecords.entryKind} = 'original'`,
            ),
          )
          .groupBy(revenueRecords.channelId, channels.name),
      ),
    ]);

    const revenue = Number(revenueRows[0]?.total ?? 0);
    const cost = Number(costRows[0]?.total ?? 0);

    const revenueByChannel = channelRows
      .filter((r) => r.channelId !== null)
      .map((r) => ({
        channelId: r.channelId as string,
        channelName: r.channelName ?? "Không rõ kênh",
        amount: Number(r.total ?? 0),
      }));

    return {
      revenueThisMonth: revenue,
      costThisMonth: cost,
      profitThisMonth: revenue - cost,
      revenueByChannel,
    };
  }

  // ─── Employee aggregate ───────────────────────────────────────────────────

  private async getEmployeeSummary(
    actor: RequestUser,
    canRead: boolean,
  ): Promise<Pick<ReportSummaryDto, "totalEmployees">> {
    if (!canRead) return { totalEmployees: null };

    const { companyId } = actor;

    const rows = await this.db.withTenant(companyId, (tx) =>
      tx
        .select({ cnt: count() })
        .from(employeeProfiles)
        .where(
          and(eq(employeeProfiles.companyId, companyId), isNull(employeeProfiles.deletedAt)),
        ),
    );

    return { totalEmployees: Number(rows[0]?.cnt ?? 0) };
  }

  // ─── Attendance report ───────────────────────────────────────────────────

  private async getAttendanceReport(
    actor: RequestUser,
    canRead: boolean,
  ): Promise<Pick<ReportSummaryDto, "todayAttendanceRate">> {
    if (!canRead) return { todayAttendanceRate: null };

    const { companyId } = actor;
    const today = new Date().toISOString().slice(0, 10);

    const [presentRows, totalRows] = await Promise.all([
      this.db.withTenant(companyId, (tx) =>
        tx
          .select({ cnt: count() })
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.companyId, companyId),
              eq(attendanceRecords.workDate, today),
              sql`${attendanceRecords.status} IN ('present','late','early_leave','approved_adjustment')`,
              isNull(attendanceRecords.deletedAt),
            ),
          ),
      ),
      this.db.withTenant(companyId, (tx) =>
        tx
          .select({ cnt: count() })
          .from(employeeProfiles)
          .where(
            and(eq(employeeProfiles.companyId, companyId), isNull(employeeProfiles.deletedAt)),
          ),
      ),
    ]);

    const present = Number(presentRows[0]?.cnt ?? 0);
    const total = Number(totalRows[0]?.cnt ?? 0);

    return {
      todayAttendanceRate: total > 0 ? Math.round((present / total) * 100 * 10) / 10 : 0,
    };
  }
}
