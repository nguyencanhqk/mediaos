import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../../db/db.service";
import { isUniqueViolation } from "../../common/db-error";
import { sequenceCounters, type SequenceCounter } from "../../db/schema/sequences";
import type {
  EnsureSequenceCounterInput,
  SequenceCounterKey,
  UpdateSequenceInput,
} from "./sequence.types";

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
   * S2-FND-SEED-2 — Idempotent "insert-if-missing" (KHÔNG phải upsert): row ĐÃ tồn tại (Active HAY Inactive)
   * ⇒ trả về NGUYÊN VẸN, KHÔNG động tới (giữ nguyên current_value/status — ensure KHÔNG được phép reset số
   * đã cấp hay tự ý bật lại 1 counter admin đã tắt). CHỈ INSERT khi THỰC SỰ thiếu.
   *
   * VÌ SAO SELECT-then-INSERT (KHÔNG onConflictDoNothing): unique index `uq_sequence_counters_company_key_
   * scope_active` (mig 0434) là BIỂU THỨC partial — COALESCE(company_id,…), COALESCE(scope_reference_id,…) —
   * KHÔNG phải cột thuần. drizzle `onConflictDoNothing({ target })` chỉ nhận `Column | Column[]` (KHÔNG SQL
   * expression) ⇒ target cột-thuần SẼ nổ "no unique or exclusion constraint matching the specified columns".
   *
   * RACE (2 request đầu cùng miss counter, ví dụ 2 employee đầu tiên tạo song song): INSERT thứ 2 nhận
   * unique_violation (23505) — bắt lỗi, SELECT lại (không throw, không 500) — thấy row của request thắng.
   */
  async ensureCounterTx(
    companyId: string,
    key: SequenceCounterKey,
    defaults: EnsureSequenceCounterInput,
    tx: TenantTx,
  ): Promise<SequenceCounter> {
    const existing = await this.findCounterTx(companyId, key, tx);
    if (existing) return existing;

    try {
      const [row] = await tx
        .insert(sequenceCounters)
        .values({
          companyId,
          moduleCode: defaults.moduleCode,
          sequenceKey: key.sequenceKey,
          scopeType: key.scopeType ?? "Company",
          scopeReferenceId: key.scopeReferenceId ?? null,
          prefix: defaults.prefix ?? null,
          suffix: defaults.suffix ?? null,
          // paddingLength mặc định 0 khi KHÔNG truyền — CHỦ Ý (formatter): 0 = KHÔNG pad ⇒ 'EMP1' sai định
          // dạng thay vì 'EMP0001'. Caller PHẢI truyền đúng paddingLength (đọc từ config thật — CẤM hard-code).
          currentValue: BigInt(defaults.startValue ?? 0),
          incrementBy: defaults.incrementBy ?? 1,
          paddingLength: defaults.paddingLength ?? 0,
          resetPolicy: defaults.resetPolicy ?? "Never",
          formatPattern: defaults.datePattern ?? null,
          status: defaults.status ?? "Active",
          createdBy: defaults.actorUserId ?? null,
        })
        .returning();
      if (!row) throw new Error("ensureCounterTx: INSERT trả về 0 row (không rõ nguyên nhân)");
      return row;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await this.findCounterTx(companyId, key, tx);
      if (raced) return raced;
      // Vẫn không thấy sau unique_violation — lỗi thật (khác race dự kiến), ném nguyên err gốc.
      throw err;
    }
  }

  /**
   * S2-FND-BE-2 — Liệt kê MỌI counter của tenant (admin ops surface). READ-ONLY: SELECT eq(company_id) +
   * deleted_at IS NULL (KHÔNG global NULL — chỉ counter tenant, mirror listPolicies). Sắp module_code,
   * sequence_key ổn định. KHÔNG mutate.
   */
  async listCountersTx(companyId: string, tx: TenantTx): Promise<SequenceCounter[]> {
    return tx
      .select()
      .from(sequenceCounters)
      .where(and(eq(sequenceCounters.companyId, companyId), isNull(sequenceCounters.deletedAt)))
      .orderBy(sequenceCounters.moduleCode, sequenceCounters.sequenceKey);
  }

  /**
   * S2-FND-BE-2 — Đọc 1 counter theo id trong tenant (cho GET :id/preview + PATCH :id). READ-ONLY, KHÔNG
   * lock. eq(company_id) tường minh + deleted_at IS NULL (RLS+FORCE là lớp cuối). Cross-tenant / id lạ ⇒
   * undefined ⇒ service ném NotFound (404, KHÔNG lộ tồn tại hàng tenant khác).
   */
  async findCounterByIdTx(
    companyId: string,
    id: string,
    tx: TenantTx,
  ): Promise<SequenceCounter | undefined> {
    const [row] = await tx
      .select()
      .from(sequenceCounters)
      .where(
        and(
          eq(sequenceCounters.id, id),
          eq(sequenceCounters.companyId, companyId),
          isNull(sequenceCounters.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * S2-FND-BE-2 — Admin PATCH cấu hình counter THEO id (mirror updateConfigTx nhưng khoá theo id +
   * company_id). CHỈ field cấu hình — KHÔNG current_value (anti-tamper). `actorUserId` ghi updated_by.
   */
  async updateConfigByIdTx(
    companyId: string,
    id: string,
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
    await tx
      .update(sequenceCounters)
      .set(values)
      .where(
        and(
          eq(sequenceCounters.id, id),
          eq(sequenceCounters.companyId, companyId),
          isNull(sequenceCounters.deletedAt),
        ),
      );
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
