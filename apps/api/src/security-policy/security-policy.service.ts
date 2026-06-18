import { Injectable, Logger } from "@nestjs/common";
import type { SecurityPolicyDto, UpdateSecurityPolicyRequest } from "@mediaos/contracts";
import { loadEnv } from "../config/env.schema";
import { DatabaseService, type TenantTx } from "../db/db.service";
import type { CompanySecurityPolicy } from "../db/schema/security-policy";
import { AuditService } from "../events/audit.service";
import { SecurityPolicyRepository } from "./security-policy.repository";
import {
  SecurityPolicyEvaluator,
  type AccessContext,
  type PolicyDecision,
  type PolicyEvaluationConfig,
} from "./security-policy-evaluator";

/** DTO default khi công ty CHƯA cấu hình — mọi cờ false/null ⇒ KHÔNG enforce (an toàn). */
const DEFAULT_POLICY_DTO: SecurityPolicyDto = {
  autoLogoutMinutes: null,
  ipRestrictionEnabled: false,
  allowlistCidrs: [],
  timeRestrictionEnabled: false,
  timeWindows: [],
  applyScope: "all",
  applyAppKeys: [],
  exemptUserIds: [],
  emailDomainRestrictionEnabled: false,
  allowedEmailDomains: [],
  twoFactorEnforced: null,
  updatedAt: null,
};

/**
 * CS-9 SecurityPolicyService — CRUD per-company policy + nguồn quyết định enforce cho auth.
 *
 * KILL-SWITCH CỨNG (BẤT BIẾN #5): SECURITY_POLICY_ENFORCEMENT_ENABLED='false' ⇒ MỌI enforce IP/giờ/
 * email-domain BỎ QUA mà KHÔNG đọc DB (chống tự-khoá khi policy lỗi). Đọc 1 lần lúc init (mirror 2FA guard).
 */
@Injectable()
export class SecurityPolicyService {
  private readonly logger = new Logger(SecurityPolicyService.name);
  private readonly enforcementEnabled =
    loadEnv().SECURITY_POLICY_ENFORCEMENT_ENABLED === "true";

  constructor(
    private readonly dbsvc: DatabaseService,
    private readonly repo: SecurityPolicyRepository,
    private readonly evaluator: SecurityPolicyEvaluator,
    private readonly audit: AuditService,
  ) {}

  /** GET — trả policy hiện tại; chưa cấu hình → DEFAULT (KHÔNG 404). */
  async getPolicy(companyId: string): Promise<SecurityPolicyDto> {
    const row = await this.repo.findByCompany(companyId);
    return row ? this.toDto(row) : { ...DEFAULT_POLICY_DTO };
  }

  /**
   * PATCH (upsert) — cập nhật cấu hình + audit before/after CÙNG tx. CHỐNG TỰ-KHOÁ (BẤT BIẾN #4): người
   * gọi LUÔN được thêm vào exemptUserIds (kết quả lưu) — admin sửa policy KHÔNG bao giờ tự khoá khỏi IP/giờ.
   */
  async updatePolicy(
    companyId: string,
    dto: UpdateSecurityPolicyRequest,
    actorUserId: string,
  ): Promise<SecurityPolicyDto> {
    const result = await this.dbsvc.withTenant(companyId, async (tx) => {
      const before = await this.repo.findByCompanyTx(tx, companyId);

      // Chống tự-khoá: hợp nhất exempt-list cuối (giá trị mới nếu có, ngược lại giá trị cũ) + ÉP thêm actor.
      const baseExempt = dto.exemptUserIds ?? before?.exemptUserIds ?? [];
      const exemptWithActor = Array.from(new Set([...baseExempt, actorUserId]));

      const after = await this.repo.upsertTx(tx, companyId, {
        ...dto,
        exemptUserIds: exemptWithActor,
      });

      await this.audit.record(tx, {
        action: "security_policy.updated",
        objectType: "security_policy",
        objectId: after.id,
        actorUserId,
        before: before ? this.toAuditShape(before) : null,
        after: this.toAuditShape(after),
      });
      return after;
    });
    return this.toDto(result);
  }

  // ── enforcement (auth-path) ──────────────────────────────────────────────────────────────────

  /**
   * Quyết định 1 lần cấp token (login/refresh) có được phép theo IP/giờ. Kill-switch tắt ⇒ allow KHÔNG
   * đọc DB. Lỗi đọc DB ⇒ FAIL-OPEN + log cảnh báo (không tự-khoá toàn bộ tenant vì 1 lỗi tạm thời ở
   * bảng policy; sàn bảo mật thật vẫn là mật khẩu + 2FA + token TTL). Chạy SAU verify mật khẩu.
   */
  async evaluateAccess(companyId: string, ctx: AccessContext): Promise<PolicyDecision> {
    if (!this.enforcementEnabled) return { allowed: true };
    try {
      const config = await this.loadEvaluationConfig(companyId);
      if (!config) return { allowed: true }; // chưa cấu hình → không enforce.
      return this.evaluator.evaluate(config, ctx);
    } catch (err) {
      this.logger.warn(
        `evaluateAccess: đọc policy thất bại (fail-open, login dựa mật khẩu/2FA): ${err instanceof Error ? err.message : String(err)}`,
      );
      return { allowed: true };
    }
  }

  /** Đọc config tối thiểu cho evaluator. null = chưa có hàng policy. */
  private async loadEvaluationConfig(
    companyId: string,
  ): Promise<PolicyEvaluationConfig | null> {
    const row = await this.repo.findByCompany(companyId);
    if (!row) return null;
    return {
      ipRestrictionEnabled: row.ipRestrictionEnabled,
      allowlistCidrs: row.allowlistCidrs ?? [],
      timeRestrictionEnabled: row.timeRestrictionEnabled,
      timeWindows: row.timeWindows ?? [],
      exemptUserIds: row.exemptUserIds ?? [],
    };
  }

  /**
   * 2FA fail-STRICTER (BẤT BIẾN #1). `global` = TWO_FACTOR_ENFORCEMENT_ENABLED. Tenant CHỈ tăng chuẩn:
   * effective = global || (policy.two_factor_enforced ?? false). Kill-switch CS-9 tắt ⇒ KHÔNG đọc policy
   * (chỉ còn sàn global). Lỗi đọc ⇒ trả `global` (fail tới sàn — không hạ, không tự-bật sai). Dùng trong tx
   * guard (truyền tx để +0 round-trip khi đã trong withTenant).
   */
  async getEffectiveTwoFactorRequired(
    tx: TenantTx,
    companyId: string,
    globalEnabled: boolean,
  ): Promise<boolean> {
    if (globalEnabled) return true; // sàn global đã bật ⇒ luôn ép, KHÔNG cần đọc DB.
    if (!this.enforcementEnabled) return globalEnabled;
    try {
      const row = await this.repo.findByCompanyTx(tx, companyId);
      return globalEnabled || (row?.twoFactorEnforced ?? false);
    } catch (err) {
      this.logger.warn(
        `getEffectiveTwoFactorRequired: đọc policy thất bại (fail tới sàn global=${globalEnabled}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return globalEnabled;
    }
  }

  /**
   * email-domain check ở TẠO TÀI KHOẢN (BẤT BIẾN #6). Kill-switch tắt ⇒ allow KHÔNG đọc DB. Chạy trong tx
   * tạo user (truyền tx). Lỗi đọc ⇒ FAIL-OPEN (không chặn tạo tài khoản vì lỗi tạm thời). Empty/disabled ⇒ allow.
   */
  async assertEmailDomainAllowedTx(
    tx: TenantTx,
    companyId: string,
    email: string,
  ): Promise<boolean> {
    if (!this.enforcementEnabled) return true;
    try {
      const row = await this.repo.findByCompanyTx(tx, companyId);
      if (!row) return true;
      return this.evaluator.isEmailDomainAllowed(email, {
        emailDomainRestrictionEnabled: row.emailDomainRestrictionEnabled,
        allowedEmailDomains: row.allowedEmailDomains ?? [],
      });
    } catch (err) {
      this.logger.warn(
        `assertEmailDomainAllowedTx: đọc policy thất bại (fail-open): ${err instanceof Error ? err.message : String(err)}`,
      );
      return true;
    }
  }

  // ── mappers ──────────────────────────────────────────────────────────────────────────────────

  private toDto(row: CompanySecurityPolicy): SecurityPolicyDto {
    return {
      autoLogoutMinutes: row.autoLogoutMinutes ?? null,
      ipRestrictionEnabled: row.ipRestrictionEnabled,
      allowlistCidrs: row.allowlistCidrs ?? [],
      timeRestrictionEnabled: row.timeRestrictionEnabled,
      timeWindows: row.timeWindows ?? [],
      applyScope: (row.applyScope as "all" | "selected") ?? "all",
      applyAppKeys: row.applyAppKeys ?? [],
      exemptUserIds: row.exemptUserIds ?? [],
      emailDomainRestrictionEnabled: row.emailDomainRestrictionEnabled,
      allowedEmailDomains: row.allowedEmailDomains ?? [],
      twoFactorEnforced: row.twoFactorEnforced ?? null,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }

  /** Shape audit — chỉ cấu hình (KHÔNG secret/PII). exempt/cidr/domain là cấu hình công khai trong tenant. */
  private toAuditShape(row: CompanySecurityPolicy): Record<string, unknown> {
    return {
      autoLogoutMinutes: row.autoLogoutMinutes,
      ipRestrictionEnabled: row.ipRestrictionEnabled,
      allowlistCidrs: row.allowlistCidrs,
      timeRestrictionEnabled: row.timeRestrictionEnabled,
      timeWindows: row.timeWindows,
      applyScope: row.applyScope,
      applyAppKeys: row.applyAppKeys,
      exemptUserIds: row.exemptUserIds,
      emailDomainRestrictionEnabled: row.emailDomainRestrictionEnabled,
      allowedEmailDomains: row.allowedEmailDomains,
      twoFactorEnforced: row.twoFactorEnforced,
    };
  }
}
