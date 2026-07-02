import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { attendanceRules, shiftAssignments, shifts } from "../db/schema/attendance";

/**
 * S3-ATT-BE-3 — full CRUD persistence for shift/rule/assignment config (DB-04 §7.1/7.2/7.3).
 *
 * Distinct from AttendanceRepository's SHIFT_FIELDS/RULE_FIELDS (a rows-for-resolve-effective subset
 * used by check-in/out/today) — here every method returns the FULL row for HR/Admin management screens.
 * Every method is tenant-scoped (RLS via withTenant + explicit company_id — BẤT BIẾN #1).
 */
@Injectable()
export class AttendanceShiftRepository {
  constructor(private readonly db: DatabaseService) {}

  // ─── shifts ──────────────────────────────────────────────────────────────────

  findShifts(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.companyId, companyId), isNull(shifts.deletedAt)))
        .orderBy(desc(shifts.isDefault), shifts.name),
    );
  }

  findShiftByIdTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.companyId, companyId), eq(shifts.id, id), isNull(shifts.deletedAt)))
      .limit(1);
  }

  insertShiftTx(companyId: string, data: typeof shifts.$inferInsert, tx: TenantTx) {
    return tx
      .insert(shifts)
      .values({ ...data, companyId })
      .returning();
  }

  updateShiftTx(
    companyId: string,
    id: string,
    data: Partial<typeof shifts.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(shifts)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(shifts.companyId, companyId), eq(shifts.id, id), isNull(shifts.deletedAt)))
      .returning();
  }

  // ─── attendance_rules ────────────────────────────────────────────────────────

  findRules(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(attendanceRules)
        .where(and(eq(attendanceRules.companyId, companyId), isNull(attendanceRules.deletedAt)))
        .orderBy(desc(attendanceRules.priority), attendanceRules.name),
    );
  }

  findRuleByIdTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(attendanceRules)
      .where(
        and(
          eq(attendanceRules.companyId, companyId),
          eq(attendanceRules.id, id),
          isNull(attendanceRules.deletedAt),
        ),
      )
      .limit(1);
  }

  insertRuleTx(companyId: string, data: typeof attendanceRules.$inferInsert, tx: TenantTx) {
    return tx
      .insert(attendanceRules)
      .values({ ...data, companyId })
      .returning();
  }

  updateRuleTx(
    companyId: string,
    id: string,
    data: Partial<typeof attendanceRules.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(attendanceRules)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(attendanceRules.companyId, companyId),
          eq(attendanceRules.id, id),
          isNull(attendanceRules.deletedAt),
        ),
      )
      .returning();
  }

  // ─── shift_assignments ───────────────────────────────────────────────────────

  findShiftAssignments(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(shiftAssignments)
        .where(and(eq(shiftAssignments.companyId, companyId), isNull(shiftAssignments.deletedAt)))
        .orderBy(desc(shiftAssignments.priority), desc(shiftAssignments.effectiveFrom)),
    );
  }

  insertShiftAssignmentTx(
    companyId: string,
    data: typeof shiftAssignments.$inferInsert,
    tx: TenantTx,
  ) {
    return tx
      .insert(shiftAssignments)
      .values({ ...data, companyId })
      .returning();
  }
}
