import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService, type TenantTx } from "../../db/db.service";
import { AuditService } from "../../events/audit.service";
import type { SequenceCounter } from "../../db/schema/sequences";
import { buildCode, DEFAULT_TIME_ZONE, resetPeriodKey } from "./sequence-formatter";
import { SequenceRepository } from "./sequence.repository";
import {
  type EnsureSequenceCounterInput,
  type NextCodeInput,
  type NextCodeResult,
  type PreviewNextCodeInput,
  type ResetPolicy,
  type SequenceCounterKey,
  type SequenceStatus,
  SequenceInactiveError,
  SequenceNotFoundError,
  type UpdateSequenceInput,
} from "./sequence.types";

/** Cấu hình admin được audit (KHÔNG secret/PII — chỉ field hình thức mã). */
interface SequenceConfigSnapshot {
  prefix: string | null;
  suffix: string | null;
  datePattern: string | null;
  paddingLength: number;
  incrementBy: number;
  resetPolicy: string;
  status: string;
}

/**
 * S2-FND-BE-2 — view an toàn cho admin ops surface (GET /foundation/sequences). WHITELIST: cấu hình +
 * trạng thái + mã đã sinh gần nhất (đã emit — KHÔNG secret). TUYỆT ĐỐI KHÔNG `currentValue` (QA-06) —
 * giá trị runtime không lộ. `updatedAt`/`lastResetAt` = ISO-8601 string trên wire (khớp contract).
 */
export interface SequenceCounterView {
  id: string;
  moduleCode: string;
  sequenceKey: string;
  scopeType: string;
  scopeReferenceId: string | null;
  prefix: string | null;
  suffix: string | null;
  datePattern: string | null;
  paddingLength: number;
  incrementBy: number;
  resetPolicy: string;
  status: string;
  lastGeneratedCode: string | null;
  lastResetAt: string | null;
  updatedAt: string;
}

/**
 * FOUNDATION-BE-2 SequenceService — sinh mã nghiệp vụ AN TOÀN-ĐỒNG-THỜI (BACKEND-04 §8.6, DB-08 §8.9).
 *
 * MỌI đường đi qua `db.withTenant(companyId, tx => ...)` (BẤT BIẾN #1 — RLS+FORCE ép ở DB là lớp cuối).
 * `nextCode`: SELECT ... FOR UPDATE row counter trong tx → tính value kế (xét reset theo tz công ty) →
 * UPDATE current_value. KHÔNG MAX(code)+1 ⇒ N request đồng thời = 0 mã trùng. `previewNextCode` đọc KHÔNG
 * lock, KHÔNG mutate. `updateSequence` (admin PATCH) ghi audit append-only CÙNG tx (before/after = cấu hình,
 * KHÔNG secret).
 */
@Injectable()
export class SequenceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SequenceRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * TZ công ty để render datePattern + tính biên chu kỳ reset (wall-clock, UTC-at-rest — ADR-0008).
   * TODO(FOUNDATION-BE-6/settings): đọc tz từ company settings. N=1 single-company ⇒ default tập trung
   * tại 1 chỗ (KHÔNG rải hard-code) để khi có nguồn settings chỉ thay 1 điểm.
   */
  private resolveTimeZone(_companyId: string): string {
    return DEFAULT_TIME_ZONE;
  }

  /**
   * Tính value kế tiếp + có cần reset không, dựa trên kỳ (theo tz công ty) so với last_reset_at của row.
   * resetPolicy='Never' ⇒ luôn cộng dồn. Khác ⇒ nếu kỳ hiện tại khác kỳ của last_reset_at (hoặc chưa từng
   * reset) ⇒ bắt đầu lại từ increment_by và đánh dấu reset. Pure (KHÔNG chạm DB) — gọi BÊN TRONG lock.
   */
  private computeNextValue(
    row: SequenceCounter,
    now: Date,
    timeZone: string,
  ): { nextValue: bigint; reset: boolean } {
    const incrementBy = BigInt(row.incrementBy);
    const resetPolicy = row.resetPolicy as ResetPolicy;

    if (resetPolicy === "Never") {
      return { nextValue: row.currentValue + incrementBy, reset: false };
    }

    const currentPeriod = resetPeriodKey(now, timeZone, resetPolicy);
    const lastPeriod = row.lastResetAt
      ? resetPeriodKey(row.lastResetAt, timeZone, resetPolicy)
      : null;

    if (lastPeriod !== currentPeriod) {
      // Sang kỳ mới (hoặc chưa từng reset) ⇒ bắt đầu lại từ increment_by, KHÔNG cộng dồn kỳ cũ.
      return { nextValue: incrementBy, reset: true };
    }
    return { nextValue: row.currentValue + incrementBy, reset: false };
  }

  /** Render mã từ row + value đã tính (formatPattern column = datePattern config). */
  private renderCode(row: SequenceCounter, value: bigint, now: Date, timeZone: string): string {
    return buildCode({
      prefix: row.prefix,
      suffix: row.suffix,
      datePattern: row.formatPattern,
      paddingLength: row.paddingLength,
      value,
      now,
      timeZone,
    });
  }

  /**
   * Cấp mã KẾ TIẾP an-toàn-đồng-thời. Trong 1 tx withTenant:
   *   lock row FOR UPDATE → validate Active → tính value (xét reset) → buildCode → UPDATE current_value.
   * @throws SequenceNotFoundError nếu counter không tồn tại trong tenant (RLS lọc 0 row ⇒ cũng ném đây).
   * @throws SequenceInactiveError nếu status != 'Active' (KHÔNG mutate).
   */
  async nextCode(companyId: string, input: NextCodeInput): Promise<NextCodeResult> {
    const now = input.now ?? new Date();
    const timeZone = this.resolveTimeZone(companyId);
    const key = {
      sequenceKey: input.sequenceKey,
      scopeType: input.scopeType,
      scopeReferenceId: input.scopeReferenceId,
    };

    return this.db.withTenant(companyId, async (tx) => {
      const row = await this.repo.lockCounterForUpdateTx(companyId, key, tx);
      if (!row) {
        throw new SequenceNotFoundError(input.sequenceKey);
      }
      if (row.status !== "Active") {
        throw new SequenceInactiveError(input.sequenceKey);
      }

      const { nextValue, reset } = this.computeNextValue(row, now, timeZone);
      const code = this.renderCode(row, nextValue, now, timeZone);

      await this.repo.updateCounterValueTx(
        companyId,
        key,
        {
          currentValue: nextValue,
          lastGeneratedCode: code,
          ...(reset ? { lastResetAt: now } : {}),
        },
        tx,
      );

      return { sequenceKey: input.sequenceKey, value: Number(nextValue), code };
    });
  }

  /**
   * Xem trước mã kế tiếp KHÔNG mutate counter. Đọc KHÔNG lock (findCounterTx) → tính value/reset y hệt
   * nextCode nhưng TUYỆT ĐỐI KHÔNG gọi updateCounterValueTx. Vẫn trong withTenant (KHÔNG đọc thẳng db/pool).
   * @throws SequenceNotFoundError / SequenceInactiveError như nextCode.
   */
  async previewNextCode(companyId: string, input: PreviewNextCodeInput): Promise<NextCodeResult> {
    const now = input.now ?? new Date();
    const timeZone = this.resolveTimeZone(companyId);
    const key = {
      sequenceKey: input.sequenceKey,
      scopeType: input.scopeType,
      scopeReferenceId: input.scopeReferenceId,
    };

    return this.db.withTenant(companyId, async (tx) => {
      const row = await this.repo.findCounterTx(companyId, key, tx);
      if (!row) {
        throw new SequenceNotFoundError(input.sequenceKey);
      }
      if (row.status !== "Active") {
        throw new SequenceInactiveError(input.sequenceKey);
      }

      const { nextValue } = this.computeNextValue(row, now, timeZone);
      const code = this.renderCode(row, nextValue, now, timeZone);
      return { sequenceKey: input.sequenceKey, value: Number(nextValue), code };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // S2-FND-SEED-2 — ensure-on-miss (allocateEmployeeCode) + PATCH-sync (EmployeeCodeConfigService).
  // Cả hai chạy TRONG tx của caller (mirror HrTasksService.cancelTaskTx) — KHÔNG tự mở withTenant riêng,
  // để atomic với write/audit của caller khi cần (BẤT BIẾN #1 — vẫn qua RLS+FORCE của tx đã set GUC).
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Idempotent "insert-if-missing" trong tx do CALLER cấp. Row đã tồn tại (Active HAY Inactive) ⇒ trả về
   * NGUYÊN VẸN — KHÔNG re-enable, KHÔNG reset current_value. Dùng cho ensure-on-miss (allocateEmployeeCode
   * đọc employee_code_config thật rồi truyền vào `defaults` — CẤM hard-code prefix/padding).
   */
  async ensureCounterTx(
    tx: TenantTx,
    companyId: string,
    key: SequenceCounterKey,
    defaults: EnsureSequenceCounterInput,
  ): Promise<SequenceCounter> {
    return this.repo.ensureCounterTx(companyId, key, defaults, tx);
  }

  /**
   * OWNER CHỐT 2026-07-03 — PATCH-sync: đồng bộ prefix/paddingLength/status từ 1 config module (vd
   * employee_code_configs) → sequence_counters TRONG CÙNG tx của caller. GIỮ NGUYÊN current_value (số đã
   * cấp KHÔNG reset) — counter vẫn là NGUỒN RENDER DUY NHẤT (nextCode/previewNextCode chỉ đọc counter,
   * KHÔNG đọc config module). Counter CHƯA tồn tại (company mới / seeder chưa reconcile) ⇒ tạo mới GIỮ
   * current_value=0 với đúng prefix/padding/status vừa PATCH — mã đầu tiên vẫn đúng format ngay từ counter
   * đầu tiên (KHÔNG cần 1 lượt ensure-on-miss riêng sau đó).
   */
  async syncCounterConfigTx(
    tx: TenantTx,
    companyId: string,
    key: SequenceCounterKey,
    sync: {
      moduleCode: string;
      prefix: string | null;
      paddingLength: number;
      status: SequenceStatus;
    },
  ): Promise<void> {
    const existing = await this.repo.findCounterTx(companyId, key, tx);
    if (!existing) {
      await this.repo.ensureCounterTx(
        companyId,
        key,
        {
          ...key,
          moduleCode: sync.moduleCode,
          prefix: sync.prefix,
          paddingLength: sync.paddingLength,
          resetPolicy: "Never",
          status: sync.status,
        },
        tx,
      );
      return;
    }

    await this.repo.updateConfigTx(
      companyId,
      key,
      { prefix: sync.prefix, paddingLength: sync.paddingLength, status: sync.status },
      tx,
    );
  }

  /** Snapshot cấu hình (audit-safe — KHÔNG current_value/secret/PII). */
  private configSnapshot(row: SequenceCounter): SequenceConfigSnapshot {
    return {
      prefix: row.prefix,
      suffix: row.suffix,
      datePattern: row.formatPattern,
      paddingLength: row.paddingLength,
      incrementBy: row.incrementBy,
      resetPolicy: row.resetPolicy,
      status: row.status,
    };
  }

  /**
   * Admin PATCH cấu hình counter (prefix/suffix/datePattern/padding/increment/resetPolicy/status). Trong
   * 1 tx withTenant: đọc before → UPDATE config → ghi audit 'sequence_counter'/SequenceUpdated CÙNG tx
   * (append-only, before/after = cấu hình — KHÔNG current_value/secret/PII). `actor` đã được controller
   * xác thực + check quyền (BE-9 wire) — service KHÔNG tự guard.
   * @throws SequenceNotFoundError nếu counter không tồn tại trong tenant.
   */
  async updateSequence(
    actor: { id: string; companyId: string },
    key: SequenceCounterKey,
    input: UpdateSequenceInput,
  ): Promise<SequenceConfigSnapshot> {
    const counterKey: SequenceCounterKey = {
      sequenceKey: key.sequenceKey,
      scopeType: key.scopeType,
      scopeReferenceId: key.scopeReferenceId,
    };

    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findCounterTx(actor.companyId, counterKey, tx);
      if (!before) {
        throw new SequenceNotFoundError(key.sequenceKey);
      }

      await this.repo.updateConfigTx(
        actor.companyId,
        counterKey,
        { ...input, actorUserId: actor.id },
        tx,
      );

      const after = await this.repo.findCounterTx(actor.companyId, counterKey, tx);
      const beforeSnap = this.configSnapshot(before);
      const afterSnap = after ? this.configSnapshot(after) : beforeSnap;

      await this.audit.record(tx, {
        objectType: "sequence_counter",
        action: "SequenceUpdated",
        objectId: before.id,
        actorUserId: actor.id,
        before: beforeSnap,
        after: afterSnap,
      });

      return afterSnap;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // S2-FND-BE-2 — HTTP ops surface (admin) THEO id. READ list/preview KHÔNG mutate; PATCH id ghi audit
  // CÙNG tx (mirror updateSequence). MỌI method qua withTenant (BẤT BIẾN #1). NotFoundException (404) khi
  // 0 row (cross-tenant / id lạ / soft-deleted) — RLS che, KHÔNG lộ tồn tại hàng tenant khác.
  // ───────────────────────────────────────────────────────────────────────────

  /** Map row → view WHITELIST an toàn (KHÔNG current_value/secret — QA-06). */
  private toCounterView(row: SequenceCounter): SequenceCounterView {
    return {
      id: row.id,
      moduleCode: row.moduleCode,
      sequenceKey: row.sequenceKey,
      scopeType: row.scopeType,
      scopeReferenceId: row.scopeReferenceId,
      prefix: row.prefix,
      suffix: row.suffix,
      datePattern: row.formatPattern,
      paddingLength: row.paddingLength,
      incrementBy: row.incrementBy,
      resetPolicy: row.resetPolicy,
      status: row.status,
      lastGeneratedCode: row.lastGeneratedCode,
      lastResetAt: row.lastResetAt ? row.lastResetAt.toISOString() : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Liệt kê counter của tenant (admin ops). READ-ONLY (withTenant + RLS). Trả view WHITELIST — KHÔNG
   * current_value/secret. company_id ép ở repo (eq) + RLS (defense-in-depth).
   */
  async listSequences(companyId: string): Promise<SequenceCounterView[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await this.repo.listCountersTx(companyId, tx);
      return rows.map((r) => this.toCounterView(r));
    });
  }

  /**
   * Xem trước mã kế tiếp THEO id counter (GET /:id/preview). Đọc KHÔNG lock → tính value/reset (reuse
   * computeNextValue/renderCode) → KHÔNG updateCounterValueTx (TUYỆT ĐỐI KHÔNG mutate). id lạ/cross-tenant
   * ⇒ NotFoundException (404). Preview cho phép cả counter Inactive (read-only, admin xem mã kế tiếp).
   */
  async previewNextCodeById(companyId: string, id: string): Promise<NextCodeResult> {
    const now = new Date();
    const timeZone = this.resolveTimeZone(companyId);

    return this.db.withTenant(companyId, async (tx) => {
      const row = await this.repo.findCounterByIdTx(companyId, id, tx);
      if (!row) {
        throw new NotFoundException(`Không tìm thấy sequence counter id=${id}.`);
      }
      const { nextValue } = this.computeNextValue(row, now, timeZone);
      const code = this.renderCode(row, nextValue, now, timeZone);
      return { sequenceKey: row.sequenceKey, value: Number(nextValue), code };
    });
  }

  /**
   * Admin PATCH cấu hình counter THEO id (PATCH /:id). CÙNG tx withTenant: đọc before → UPDATE config →
   * ghi audit 'sequence_counter'/SequenceUpdated (append-only, before/after = cấu hình — KHÔNG
   * current_value/secret/PII). id lạ/cross-tenant ⇒ NotFoundException (404, RLS che). `actor` đã được
   * controller xác thực + PermissionGuard gate (update:foundation-sequence) — service KHÔNG tự guard.
   */
  async updateSequenceById(
    actor: { id: string; companyId: string },
    id: string,
    input: UpdateSequenceInput,
  ): Promise<SequenceConfigSnapshot> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findCounterByIdTx(actor.companyId, id, tx);
      if (!before) {
        throw new NotFoundException(`Không tìm thấy sequence counter id=${id}.`);
      }

      await this.repo.updateConfigByIdTx(
        actor.companyId,
        id,
        { ...input, actorUserId: actor.id },
        tx,
      );

      const after = await this.repo.findCounterByIdTx(actor.companyId, id, tx);
      const beforeSnap = this.configSnapshot(before);
      const afterSnap = after ? this.configSnapshot(after) : beforeSnap;

      await this.audit.record(tx, {
        objectType: "sequence_counter",
        action: "SequenceUpdated",
        objectId: before.id,
        actorUserId: actor.id,
        before: beforeSnap,
        after: afterSnap,
      });

      return afterSnap;
    });
  }
}
