import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { FOUNDATION_ERROR_CODES } from "@mediaos/contracts";
import { DatabaseService } from "../../db/db.service";
import { AuditService } from "../../events/audit.service";
import { PermissionService } from "../../permission/permission.service";
import { SettingRepository } from "./setting.repository";
import { getSettingDefault } from "./setting-defaults";
import {
  type RawSettingRow,
  type SafeSettingView,
  toAuditSnapshot,
  toPublicMap,
  toSafeView,
} from "./setting-mask";
import type {
  PatchCompanySettingInput,
  PatchSystemSettingInput,
  SettingValueType,
} from "./settings.dto";

interface Actor {
  id: string;
  companyId: string;
}

/** Hàng đã giải precedence (chưa mask) — dùng nội bộ để resolveSetting/resolveMany trả value tầng dưới. */
export interface ResolvedSetting {
  key: string;
  value: unknown;
  scope: "company" | "system" | "default";
  found: boolean;
}

function toRaw(row: {
  settingKey: string;
  settingValue: unknown;
  valueType: string;
  category: string;
  moduleCode: string | null;
  isPublic: boolean;
  isSensitive: boolean;
  isEncrypted: boolean;
  secretRef: string | null;
}): RawSettingRow {
  return {
    settingKey: row.settingKey,
    settingValue: row.settingValue,
    valueType: row.valueType,
    category: row.category,
    moduleCode: row.moduleCode,
    isPublic: row.isPublic,
    isSensitive: row.isSensitive,
    isEncrypted: row.isEncrypted,
    secretRef: row.secretRef,
  };
}

/**
 * S1-FND-SETTING-1 — SettingService (crown-jewel).
 *
 * (1) resolveSetting/resolveMany: precedence company_settings(Active,deleted_at NULL) → system_settings(Active)
 *     → default hard-coded. resolveMany BATCH ≤2 query (1/bảng) — KHÔNG N+1 (HỢP ĐỒNG NỘI BỘ cho ATT/LEAVE/DASH).
 * (2) getPublic: CHỈ is_public=true AND is_sensitive=false (drop secret-like) — KHÔNG secret_ref/raw secret.
 * (3) resolve (quyền-aware): user thường chỉ public; sensitive masked; secret_ref KHÔNG bao giờ trả; metadata
 *     đầy đủ cần quyền update (admin-level).
 * (4) updateCompanySetting: validate value_type + validation_schema → withTenant(tx): old → upsert → audit
 *     COMPANY_SETTING_UPDATED object_type='company_setting' CÙNG tx (mask + changedFields auto). BẤT BIẾN #1/#2/#3.
 */
@Injectable()
export class SettingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SettingRepository,
    private readonly audit: AuditService,
    private readonly permission: PermissionService,
  ) {}

  // ─── Internal contract cho ATT/LEAVE/DASH (precedence) ───────────────────────

  /** Giải 1 key theo precedence company > system > default. found=false khi cả 3 đều thiếu. */
  async resolveSetting(companyId: string, key: string): Promise<ResolvedSetting> {
    const many = await this.resolveMany(companyId, [key]);
    return many[0] ?? { key, value: undefined, scope: "default", found: false };
  }

  /**
   * Giải nhiều key — BATCH ≤2 query (1 company + 1 system). KHÔNG gọi từng key (KHÔNG N+1). default
   * hard-coded là tầng cuối (no query). Mọi đọc DB đi qua MỘT withTenant duy nhất.
   */
  async resolveMany(companyId: string, keys: string[]): Promise<ResolvedSetting[]> {
    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.length === 0) return [];

    const { companyRows, systemRows } = await this.db.withTenant(companyId, async (tx) => {
      const companyRows = await this.repo.findCompanyByKeysTx(uniqueKeys, tx); // query #1
      const systemRows = await this.repo.findSystemByKeysTx(uniqueKeys, tx); // query #2
      return { companyRows, systemRows };
    });

    const companyMap = new Map(companyRows.map((r) => [r.settingKey, r]));
    const systemMap = new Map(systemRows.map((r) => [r.settingKey, r]));

    return uniqueKeys.map((key): ResolvedSetting => {
      const c = companyMap.get(key);
      if (c) return { key, value: c.settingValue, scope: "company", found: true };
      const s = systemMap.get(key);
      if (s) return { key, value: s.settingValue, scope: "system", found: true };
      const d = getSettingDefault(key);
      if (d) return { key, value: d.value, scope: "default", found: true };
      return { key, value: undefined, scope: "default", found: false };
    });
  }

  // ─── (2) Public — chỉ is_public=true AND is_sensitive=false, KHÔNG secret ────

  /** GET /public — map key→value an toàn (company override > system; chỉ public-nonsensitive). */
  async getPublic(
    companyId: string,
    filter: { category?: string; moduleCode?: string },
  ): Promise<Record<string, unknown>> {
    const { companyRows, systemRows } = await this.db.withTenant(companyId, async (tx) => {
      const companyRows = await this.repo.findCompanyByFilterTx(filter, tx);
      const systemRows = await this.repo.findSystemByFilterTx(filter, tx);
      return { companyRows, systemRows };
    });

    // Precedence: company override đè system. Map system trước, company sau (đè key trùng).
    const merged = new Map<string, RawSettingRow>();
    for (const r of systemRows) merged.set(r.settingKey, toRaw(r));
    for (const r of companyRows) merged.set(r.settingKey, toRaw(r));
    return toPublicMap([...merged.values()]);
  }

  // ─── (3) Resolve — quyền-aware (mask), KHÔNG secret_ref ──────────────────────

  /**
   * POST /resolve — quyền-aware. Caller đã qua PermissionGuard (view:foundation-setting). Nếu có thêm quyền
   * update:foundation-setting (admin) → trả metadata + masked-value cho sensitive. Nếu KHÔNG → chỉ public.
   * secret_ref KHÔNG BAO GIỜ ra (toSafeView/toPublicMap drop). canSeeNonPublic do PermissionService quyết.
   */
  async resolve(
    actor: Actor,
    input: {
      keys?: string[];
      category?: string;
      moduleCode?: string;
      includeMetadata?: boolean;
    },
  ): Promise<{ settings: SafeSettingView[] } | { values: Record<string, unknown> }> {
    const canSeeNonPublic = await this.permission
      .can({
        userId: actor.id,
        companyId: actor.companyId,
        action: "update",
        resourceType: "foundation-setting",
      })
      .then((d) => d.allow)
      .catch(() => false); // fail-closed: lỗi infra → coi như user thường (chỉ public)

    const filter = { category: input.category, moduleCode: input.moduleCode };
    const { companyRows, systemRows } = await this.db.withTenant(actor.companyId, async (tx) => {
      const useKeys = input.keys && input.keys.length > 0;
      const companyRows = useKeys
        ? await this.repo.findCompanyByKeysTx(input.keys!, tx)
        : await this.repo.findCompanyByFilterTx(filter, tx);
      const systemRows = useKeys
        ? await this.repo.findSystemByKeysTx(input.keys!, tx)
        : await this.repo.findSystemByFilterTx(filter, tx);
      return { companyRows, systemRows };
    });

    const merged = new Map<string, { raw: RawSettingRow; scope: "company" | "system" }>();
    for (const r of systemRows) merged.set(r.settingKey, { raw: toRaw(r), scope: "system" });
    for (const r of companyRows) merged.set(r.settingKey, { raw: toRaw(r), scope: "company" });

    // User thường (KHÔNG quyền admin) → CHỈ public-nonsensitive (key→value an toàn), KHÔNG metadata.
    if (!canSeeNonPublic) {
      return { values: toPublicMap([...merged.values()].map((m) => m.raw)) };
    }

    // Admin → mọi key (kể cả sensitive) nhưng value sensitive bị MASK, secret_ref drop.
    const settings = [...merged.values()].map((m) => toSafeView(m.raw, m.scope));
    return { settings };
  }

  // ─── (4) PATCH company-setting — validate + upsert + audit-in-tx ──────────────

  /**
   * Upsert override công ty cho `key`. validate value_type + validation_schema TRƯỚC mọi side-effect (sai →
   * 400/422, KHÔNG upsert, KHÔNG audit). Trong db.withTenant(tx): đọc old → upsert → AuditService.record
   * COMPANY_SETTING_UPDATED object_type='company_setting' CÙNG tx (mask + changedFields auto). KHÔNG secret_ref vào audit.
   */
  async updateCompanySetting(
    actor: Actor,
    key: string,
    dto: PatchCompanySettingInput,
  ): Promise<SafeSettingView> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const [existing] = await this.repo.findOneCompanyTx(actor.companyId, key, tx);
      const [systemRef] = await this.repo.findOneSystemTx(key, tx);

      // Sticky secret guard (deny TRƯỚC validateValue/upsert): nếu setting hiện hữu đang là SecretRef
      // HOẶC isSensitive=true thì KHÔNG cho đổi value_type sang loại khác — chặn un-mask giá trị nhạy
      // cảm thành plaintext ở /resolve. KHÔNG upsert, KHÔNG audit (giống các deny khác).
      if (
        existing &&
        (existing.valueType === "SecretRef" || existing.isSensitive) &&
        dto.valueType !== undefined &&
        dto.valueType !== "SecretRef"
      ) {
        throw new BadRequestException({
          code: FOUNDATION_ERROR_CODES.SETTING_SECRET_STICKY,
          message: `Không thể đổi value_type của setting nhạy cảm '${key}' ra khỏi SecretRef.`,
        });
      }

      // value_type: dto > existing > system > default. valueType ép phải có để validate.
      const defaultMeta = getSettingDefault(key);
      const valueType = (dto.valueType ??
        existing?.valueType ??
        systemRef?.valueType ??
        defaultMeta?.valueType) as SettingValueType | undefined;
      if (!valueType) {
        throw new BadRequestException({
          code: FOUNDATION_ERROR_CODES.SETTING_VALUE_TYPE_UNKNOWN,
          message: `Không xác định được value_type cho '${key}' — cung cấp valueType trong body.`,
        });
      }

      // validation_schema: ưu tiên existing rồi system (nguồn cấu hình hợp lệ; dto KHÔNG đổi schema ở WO này).
      const validationSchema = existing?.validationSchema ?? systemRef?.validationSchema ?? null;
      this.validateValue(dto.settingValue, valueType, validationSchema);

      const category =
        dto.category ??
        existing?.category ??
        systemRef?.category ??
        defaultMeta?.category ??
        "General";
      const moduleCode =
        dto.moduleCode ??
        existing?.moduleCode ??
        systemRef?.moduleCode ??
        defaultMeta?.moduleCode ??
        null;

      const oldSnapshot = existing
        ? toAuditSnapshot({
            settingKey: existing.settingKey,
            settingValue: existing.settingValue,
            valueType: existing.valueType,
            category: existing.category,
            moduleCode: existing.moduleCode,
            isPublic: existing.isPublic,
            isSensitive: existing.isSensitive,
            isEncrypted: existing.isEncrypted,
            status: existing.status,
          })
        : null;

      let savedRow: typeof existing;
      if (existing) {
        const [updated] = await this.repo.updateCompanyTx(
          actor.companyId,
          existing.id,
          {
            settingValue: dto.settingValue as never,
            valueType,
            category,
            moduleCode,
            description: dto.description ?? existing.description,
            status: dto.status ?? existing.status,
            updatedBy: actor.id,
          },
          tx,
        );
        savedRow = updated;
      } else {
        const [inserted] = await this.repo.insertCompanyTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            settingKey: key,
            settingValue: dto.settingValue as never,
            valueType,
            category,
            moduleCode,
            description: dto.description ?? systemRef?.description ?? null,
            isPublic: systemRef?.isPublic ?? defaultMeta?.isPublic ?? false,
            isSensitive: systemRef?.isSensitive ?? false,
            isEncrypted: systemRef?.isEncrypted ?? false,
            status: dto.status ?? "Active",
            createdBy: actor.id,
            updatedBy: actor.id,
          },
          tx,
        );
        savedRow = inserted;
      }

      const newSnapshot = toAuditSnapshot({
        settingKey: savedRow.settingKey,
        settingValue: savedRow.settingValue,
        valueType: savedRow.valueType,
        category: savedRow.category,
        moduleCode: savedRow.moduleCode,
        isPublic: savedRow.isPublic,
        isSensitive: savedRow.isSensitive,
        isEncrypted: savedRow.isEncrypted,
        status: savedRow.status,
      });

      // Audit CÙNG tx (BẤT BIẾN #2 append-only). object_type='company_setting' ∈ CHECK (mig 0439).
      // action='COMPANY_SETTING_UPDATED' theo SPEC API-09 §1200/§2873 (nhãn audit chuẩn cho
      // FOUNDATION/CompanySetting). objectType GIỮ 'company_setting' = enum DB của CHECK (mig 0439).
      // old/new đã mask-at-source; AuditService cũng mask (phòng thủ chiều sâu) + auto changedFields.
      await this.audit.record(tx, {
        action: "COMPANY_SETTING_UPDATED",
        objectType: "company_setting",
        objectId: savedRow.id,
        actorUserId: actor.id,
        actorType: "User",
        moduleCode: savedRow.moduleCode ?? undefined,
        entityType: "company_setting",
        entityId: savedRow.id,
        entityCode: savedRow.settingKey,
        oldValues: oldSnapshot ?? {},
        newValues: newSnapshot,
        sensitivityLevel: savedRow.isSensitive ? "Sensitive" : "Normal",
        resultStatus: "Success",
        dataScope: "Company",
        permissionCode: "FOUNDATION.SETTING.UPDATE",
        metadata: dto.reason ? { reason: dto.reason } : undefined,
      });

      return toSafeView(toRaw(savedRow), "company");
    });
  }

  // ─── (5) System settings — GET (masked) + PATCH (validate + upsert + audit-in-tx) ───────────────
  //
  // Cổng = system-manage:foundation-setting (mig 0435, is_sensitive=TRUE, System-scope) — enforce ở
  // controller (PermissionGuard). system_settings là GLOBAL no-RLS (KHÔNG company_id) ⇒ mọi tenant thấy
  // CÙNG hàng; đọc/ghi vẫn đi qua db.withTenant(actor.companyId) để (a) nhất quán 1 chốt data-access và
  // (b) audit_logs.company_id = actor.companyId (audit ghi ở home-tenant của actor). RIÊNG company path:
  // KHÔNG chạm company_settings ở đây (validate + upsert đọc/ghi CHỈ system_settings).

  /**
   * GET /system-settings — LIST system_settings (masked y hệt company path). sensitive/encrypted/SecretRef →
   * value '***'; secret_ref KHÔNG BAO GIỜ ra (setting-mask.toSafeView drop). scope='system'.
   */
  async getSystemSettings(
    actor: Actor,
    filter: { category?: string; moduleCode?: string },
  ): Promise<SafeSettingView[]> {
    const rows = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.findSystemByFilterTx(filter, tx),
    );
    return rows.map((r) => toSafeView(toRaw(r), "system"));
  }

  /** GET /system-settings/:key — 1 system_setting (masked). Không tồn tại → 404 (KHÔNG lộ/không 500). */
  async getSystemSetting(actor: Actor, key: string): Promise<SafeSettingView> {
    const [row] = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.findOneSystemTx(key, tx),
    );
    if (!row) {
      throw new NotFoundException({
        code: FOUNDATION_ERROR_CODES.SETTING_NOT_FOUND,
        message: `system_setting '${key}' không tồn tại.`,
      });
    }
    return toSafeView(toRaw(row), "system");
  }

  /**
   * PATCH /system-settings/:key — upsert GLOBAL system_settings (KHÔNG company_settings). validate value_type +
   * validation_schema ĐỌC TỪ HÀNG system_settings (existing — KHÔNG company override) TRƯỚC mọi side-effect
   * (sai type → 400, sai schema → 422; KHÔNG upsert, KHÔNG audit). Trong db.withTenant(actor.companyId):
   * đọc old → upsert qua updateSystemTx/insertSystemTx → AuditService.record SYSTEM_SETTING_UPDATED
   * object_type='system_setting' CÙNG tx ⇒ audit_logs.company_id = actor.companyId. KHÔNG withTransaction
   * (audit_logs.company_id lấy từ GUC tenant). KHÔNG secret_ref vào audit/response (mask-at-source). BẤT BIẾN #1/#2/#3.
   */
  async updateSystemSetting(
    actor: Actor,
    key: string,
    dto: PatchSystemSettingInput,
  ): Promise<SafeSettingView> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const [existing] = await this.repo.findOneSystemTx(key, tx);

      // Sticky secret guard (y hệt company path): KHÔNG cho đổi value_type của setting nhạy cảm ra khỏi
      // SecretRef — chặn un-mask giá trị nhạy cảm thành plaintext. KHÔNG upsert, KHÔNG audit.
      if (
        existing &&
        (existing.valueType === "SecretRef" || existing.isSensitive) &&
        dto.valueType !== undefined &&
        dto.valueType !== "SecretRef"
      ) {
        throw new BadRequestException({
          code: FOUNDATION_ERROR_CODES.SETTING_SECRET_STICKY,
          message: `Không thể đổi value_type của system_setting nhạy cảm '${key}' ra khỏi SecretRef.`,
        });
      }

      // value_type: dto > existing(system) > default. ĐỌC TỪ HÀNG system_settings (existing), KHÔNG company.
      const defaultMeta = getSettingDefault(key);
      const valueType = (dto.valueType ?? existing?.valueType ?? defaultMeta?.valueType) as
        | SettingValueType
        | undefined;
      if (!valueType) {
        throw new BadRequestException({
          code: FOUNDATION_ERROR_CODES.SETTING_VALUE_TYPE_UNKNOWN,
          message: `Không xác định được value_type cho system_setting '${key}' — cung cấp valueType trong body.`,
        });
      }

      // validation_schema: CHỈ từ hàng system_settings (existing) — KHÔNG company override (đúng nguồn cấu hình).
      const validationSchema = existing?.validationSchema ?? null;
      this.validateValue(dto.settingValue, valueType, validationSchema);

      const category = dto.category ?? existing?.category ?? defaultMeta?.category ?? "General";
      const moduleCode = dto.moduleCode ?? existing?.moduleCode ?? defaultMeta?.moduleCode ?? null;

      const oldSnapshot = existing
        ? toAuditSnapshot({
            settingKey: existing.settingKey,
            settingValue: existing.settingValue,
            valueType: existing.valueType,
            category: existing.category,
            moduleCode: existing.moduleCode,
            isPublic: existing.isPublic,
            isSensitive: existing.isSensitive,
            isEncrypted: existing.isEncrypted,
            status: existing.status,
          })
        : null;

      let savedRow: typeof existing;
      if (existing) {
        const [updated] = await this.repo.updateSystemTx(
          existing.id,
          {
            settingValue: dto.settingValue as never,
            valueType,
            category,
            moduleCode,
            description: dto.description ?? existing.description,
            status: dto.status ?? existing.status,
            updatedBy: actor.id,
          },
          tx,
        );
        savedRow = updated;
      } else {
        const [inserted] = await this.repo.insertSystemTx(
          {
            settingKey: key,
            settingValue: dto.settingValue as never,
            valueType,
            category,
            moduleCode,
            description: dto.description ?? null,
            isPublic: defaultMeta?.isPublic ?? false,
            isSensitive: false,
            isEncrypted: false,
            status: dto.status ?? "Active",
            createdBy: actor.id,
            updatedBy: actor.id,
          },
          tx,
        );
        savedRow = inserted;
      }

      const newSnapshot = toAuditSnapshot({
        settingKey: savedRow.settingKey,
        settingValue: savedRow.settingValue,
        valueType: savedRow.valueType,
        category: savedRow.category,
        moduleCode: savedRow.moduleCode,
        isPublic: savedRow.isPublic,
        isSensitive: savedRow.isSensitive,
        isEncrypted: savedRow.isEncrypted,
        status: savedRow.status,
      });

      // Audit CÙNG tx (BẤT BIẾN #2 append-only). object_type='system_setting' ∈ CHECK (mig 0439). action=
      // 'SYSTEM_SETTING_UPDATED' (nhánh system-manage). dataScope='System' (cấp toàn hệ). old/new đã mask-at-
      // source; AuditService cũng mask (phòng thủ chiều sâu) + auto changedFields. company_id = actor.companyId
      // (từ GUC tenant của withTenant) — audit ghi ở home-tenant của actor thực hiện.
      await this.audit.record(tx, {
        action: "SYSTEM_SETTING_UPDATED",
        objectType: "system_setting",
        objectId: savedRow.id,
        actorUserId: actor.id,
        actorType: "User",
        moduleCode: savedRow.moduleCode ?? undefined,
        entityType: "system_setting",
        entityId: savedRow.id,
        entityCode: savedRow.settingKey,
        oldValues: oldSnapshot ?? {},
        newValues: newSnapshot,
        sensitivityLevel: savedRow.isSensitive ? "Sensitive" : "Normal",
        resultStatus: "Success",
        dataScope: "System",
        permissionCode: "FOUNDATION.SETTING.SYSTEM_MANAGE",
        metadata: dto.reason ? { reason: dto.reason } : undefined,
      });

      return toSafeView(toRaw(savedRow), "system");
    });
  }

  /** Validate value_type + validation_schema (PURE). Sai type → 400; sai schema → 422. KHÔNG side-effect. */
  private validateValue(
    value: unknown,
    valueType: SettingValueType,
    validationSchema: unknown,
  ): void {
    this.assertValueType(value, valueType);
    this.assertSchema(value, validationSchema);
  }

  private assertValueType(value: unknown, valueType: SettingValueType): void {
    const fail = (m: string): never => {
      // 400 sai value_type → mã FOUNDATION-ERR-* (giữ nguyên message chi tiết theo từng loại).
      throw new BadRequestException({
        code: FOUNDATION_ERROR_CODES.SETTING_VALUE_TYPE,
        message: m,
      });
    };
    switch (valueType) {
      case "String":
      case "SecretRef":
        if (typeof value !== "string") fail(`value phải là string cho value_type=${valueType}.`);
        return;
      case "Number":
        if (typeof value !== "number" || Number.isNaN(value))
          fail("value phải là number cho value_type=Number.");
        return;
      case "Boolean":
        if (typeof value !== "boolean") fail("value phải là boolean cho value_type=Boolean.");
        return;
      case "Array":
        if (!Array.isArray(value)) fail("value phải là array cho value_type=Array.");
        return;
      case "JSON":
        if (value === null || typeof value !== "object" || Array.isArray(value))
          fail("value phải là object cho value_type=JSON.");
        return;
      default: {
        const never: never = valueType;
        fail(`value_type không hỗ trợ: ${String(never)}`);
      }
    }
  }

  private assertSchema(value: unknown, raw: unknown): void {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
    const schema = raw as {
      min?: number;
      max?: number;
      minLength?: number;
      maxLength?: number;
      enum?: unknown[];
      pattern?: string;
    };
    const fail = (m: string): never => {
      throw new UnprocessableEntityException(m);
    };

    if (schema.enum !== undefined) {
      const ok = schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value));
      if (!ok) fail("value không nằm trong enum cho phép.");
    }
    if (typeof value === "number") {
      if (schema.min !== undefined && value < schema.min) fail(`value phải ≥ ${schema.min}.`);
      if (schema.max !== undefined && value > schema.max) fail(`value phải ≤ ${schema.max}.`);
    }
    if (typeof value === "string") {
      if (schema.minLength !== undefined && value.length < schema.minLength)
        fail(`độ dài value phải ≥ ${schema.minLength}.`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength)
        fail(`độ dài value phải ≤ ${schema.maxLength}.`);
      if (schema.pattern !== undefined) {
        let re: RegExp;
        try {
          re = new RegExp(schema.pattern);
        } catch {
          fail("validation_schema.pattern không hợp lệ.");
          return;
        }
        if (!re.test(value)) fail("value không khớp pattern.");
      }
    }
  }
}
