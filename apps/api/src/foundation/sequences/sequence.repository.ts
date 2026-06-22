import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../../db/db.service";
import { sequenceCounters, type SequenceCounter } from "../../db/schema/sequences";
import type { SequenceCounterKey, UpdateSequenceInput } from "./sequence.types";

/**
 * FOUNDATION-BE-2 — persistence cho sequence_counters (DB-08 §8.9). MỌI method nhận `companyId` + `tx`:
 * chạy BÊN TRONG transaction `withTenant` của service (1 chốt tenant duy nhất). Lọc `eq(company_id)`
 * tường minh (defense-in-depth) DÙ RLS+FORCE (mig 0434) đã ép ở DB. KHÔNG DELETE (BẤT BIẾN #2 — soft-delete).
 *
 * Anti-race (DB-08 §8.9 rule 1/2): `lockCounterForUpdateTx` SELECT ... FOR UPDATE đúng row counter
 * (company_id + sequence_key + scope_type + COALESCE(scope_reference_id)) ⇒ N request đồng thời serialize,
 * 0 mã trùng. KHÔNG dùng MAX(code)+1.
 */
@Injectable()
export class SequenceRepository {
  /**
   * WHERE khoá đúng 1 row counter trong tenant: company_id + sequence_key + scope_type +
   * COALESCE(scope_reference_id) (NULL → sentinel để khớp partial-unique của mig 0434), deleted_at IS NULL.
   */
  private counterWhere(companyId: string, key: SequenceCounterKey) {
    const scopeType = key.scopeType ?? "Company";
    const scopeRef = key.scopeReferenceId ?? null;
    return and(
      eq(sequenceCounters.companyId, companyId),
      eq(sequenceCounters.sequenceKey, key.sequenceKey),
      eq(sequenceCounters.scopeType, scopeType),
      // COALESCE để NULL scope_reference_id khớp đúng row global-scope (mirror partial-unique của mig 0434).
      sql`coalesce(${sequenceCounters.scopeReferenceId}, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(${scopeRef}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
      isNull(sequenceCounters.deletedAt),
    );
  }

  /**
   * SELECT ... FOR UPDATE row counter trong tx (DB-08 §8.9 rule 1). Khoá row ⇒ request đồng thời chờ tới
   * khi tx này commit ⇒ KHÔNG cấp trùng value. Trả undefined nếu không tồn tại (service → SequenceNotFoundError).
   */
  async lockCounterForUpdateTx(
    companyId: string,
    key: SequenceCounterKey,
    tx: TenantTx,
  ): Promise<SequenceCounter | undefined> {
    const [row] = await tx
      .select()
      .from(sequenceCounters)
      .where(this.counterWhere(companyId, key))
      .limit(1)
      .for("update");
    return row;
  }

  /** Đọc counter KHÔNG lock — CHỈ cho preview (KHÔNG mutate, KHÔNG chặn request khác). */
  async findCounterTx(
    companyId: string,
    key: SequenceCounterKey,
    tx: TenantTx,
  ): Promise<SequenceCounter | undefined> {
    const [row] = await tx
      .select()
      .from(sequenceCounters)
      .where(this.counterWhere(companyId, key))
      .limit(1);
    return row;
  }

  /**
   * Ghi giá trị mới + mã vừa sinh + mốc reset (nextCode). CHỈ cột giá trị runtime — KHÔNG đụng cấu hình.
   * `lastResetAt` truyền khi kỳ reset đổi (kỳ mới); undefined = giữ nguyên.
   */
  async updateCounterValueTx(
    companyId: string,
    key: SequenceCounterKey,
    patch: { currentValue: bigint; lastGeneratedCode: string; lastResetAt?: Date },
    tx: TenantTx,
  ): Promise<void> {
    const values: Record<string, unknown> = {
      currentValue: patch.currentValue,
      lastGeneratedCode: patch.lastGeneratedCode,
      updatedAt: new Date(),
    };
    if (patch.lastResetAt !== undefined) {
      values["lastResetAt"] = patch.lastResetAt;
    }
    await tx.update(sequenceCounters).set(values).where(this.counterWhere(companyId, key));
  }

  /**
   * Admin PATCH cấu hình counter (updateSequence). CHỈ field cấu hình (prefix/suffix/datePattern/
   * paddingLength/incrementBy/resetPolicy/status) — KHÔNG current_value (anti-tamper: không cho sửa số
   * chạy qua đường admin). `actorUserId` ghi updated_by để truy vết.
   */
  async updateConfigTx(
    companyId: string,
    key: SequenceCounterKey,
    input: UpdateSequenceInput,
    tx: TenantTx,
  ): Promise<void> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (input.prefix !== undefined) values["prefix"] = input.prefix;
    if (input.suffix !== undefined) values["suffix"] = input.suffix;
    if (input.datePattern !== undefined) values["formatPattern"] = input.datePattern;
    if (input.paddingLength !== undefined) values["paddingLength"] = input.paddingLength;
    if (input.incrementBy !== undefined) values["incrementBy"] = input.incrementBy;
    if (input.resetPolicy !== undefined) values["resetPolicy"] = input.resetPolicy;
    if (input.status !== undefined) values["status"] = input.status;
    if (input.actorUserId !== undefined) values["updatedBy"] = input.actorUserId;
    await tx.update(sequenceCounters).set(values).where(this.counterWhere(companyId, key));
  }
}
