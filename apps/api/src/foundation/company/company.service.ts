import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../db/db.service";
import { AuditService } from "../../events/audit.service";
import { type Company } from "../../db/schema/companies";
import { assertCompanyActive } from "./company-status";
import { CompanyRepository, type CompanyUpdatePatch } from "./company.repository";
import type { CompanyView, PatchCompanyInput } from "./company.dto";

interface Actor {
  id: string;
  companyId: string;
}

/** Cột hồ sơ company được phép cập nhật — nguồn DUY NHẤT cho pickEditable + snapshot (đồng bộ DTO + repo). */
const EDITABLE_KEYS = [
  "name",
  "shortName",
  "logoUrl",
  "timezone",
  "currency",
  "language",
  "taxCode",
  "businessType",
  "regNumber",
  "regDate",
  "regPlace",
  "legalRepName",
  "legalRepTitle",
  "establishedDate",
  "address",
  "phone",
  "fax",
  "email",
  "website",
] as const satisfies readonly (keyof CompanyUpdatePatch)[];

/**
 * S1-FND-MODULE-1 — CompanyService (crown-jewel).
 *
 * (1) getCurrent: ĐỌC company của tenant TỪ AuthContext (db.withTenant(actor.companyId)) — KHÔNG bao giờ đọc
 *     company_id do client gửi. GET vẫn cho khi suspended (FE shell cần render trạng thái), gate suspended
 *     CHỈ áp cho GHI.
 * (2) updateCompany: trong db.withTenant(tx) — load existing → fail-closed nếu !existing (KHÔNG 500) →
 *     assertCompanyActive (suspended ⇒ 403 TRƯỚC mọi write/audit) → upsert allow-list → AuditService.record
 *     COMPANY_UPDATED object_type='company' CÙNG tx (BẤT BIẾN #2; masker + changedFields auto, BẤT BIẾN #3).
 *     KHÔNG audit khi không có thay đổi (patch rỗng) — tránh audit rác.
 */
@Injectable()
export class CompanyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CompanyRepository,
    private readonly audit: AuditService,
  ) {}

  /** GET /foundation/company/current — company của tenant (AuthContext). */
  async getCurrent(actor: Actor): Promise<CompanyView> {
    const existing = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.findCurrentTx(actor.companyId, tx),
    );
    if (!existing) throw new NotFoundException("Không tìm thấy công ty.");
    return toView(existing);
  }

  /** PATCH /foundation/company/current — cập nhật hồ sơ + audit-in-tx. */
  async updateCompany(actor: Actor, dto: PatchCompanyInput): Promise<CompanyView> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const existing = await this.repo.findCurrentTx(actor.companyId, tx);
      // Fail-closed: company không tồn tại cho tenant hợp lệ → 4xx sạch (KHÔNG NPE/500, KHÔNG write/audit).
      if (!existing) throw new NotFoundException("Không tìm thấy công ty.");
      // Suspended ⇒ 403 TRƯỚC mọi write/audit (BACKEND-04 §8.1 rule 1; allow-list status==='active').
      assertCompanyActive(existing.status);

      const patch = pickEditable(dto);
      // Không có field hợp lệ nào để đổi → no-op: trả current, KHÔNG audit (tránh audit rác).
      if (Object.keys(patch).length === 0) return toView(existing);

      const updated = await this.repo.updateTx(actor.companyId, patch, tx);
      // Fail-closed: 0 row (soft-delete chen ngang) → 4xx sạch, KHÔNG audit (BẤT BIẾN #2 không ghi nửa vời).
      if (!updated) throw new NotFoundException("Không tìm thấy công ty.");

      // Audit CÙNG tx (BẤT BIẾN #2 append-only). object_type='company' ∈ AUDIT_OBJECT_TYPES + CHECK (0003+).
      // old/new = snapshot field hồ sơ; AuditService MASK (BẤT BIẾN #3) + tự tính changed_fields (chỉ TÊN field).
      await this.audit.record(tx, {
        action: "COMPANY_UPDATED",
        objectType: "company",
        objectId: updated.id,
        actorUserId: actor.id,
        actorType: "User",
        moduleCode: "FOUNDATION",
        entityType: "company",
        entityId: updated.id,
        entityCode: updated.companyCode ?? updated.slug,
        oldValues: snapshot(existing),
        newValues: snapshot(updated),
        sensitivityLevel: "Normal",
        resultStatus: "Success",
        dataScope: "Company",
        permissionCode: "FOUNDATION.COMPANY.UPDATE",
      });

      return toView(updated);
    });
  }
}

/** Chỉ giữ key EDITABLE có mặt (đã Zod-strip). Immutable: dựng object MỚI. company_id/id/status KHÔNG bao giờ vào. */
function pickEditable(dto: PatchCompanyInput): CompanyUpdatePatch {
  const patch: CompanyUpdatePatch = {};
  for (const key of EDITABLE_KEYS) {
    const value = (dto as Record<string, unknown>)[key];
    if (value !== undefined) {
      (patch as Record<string, unknown>)[key] = value;
    }
  }
  return patch;
}

/** Snapshot cho audit old/new — field hồ sơ + status (ngữ cảnh). KHÔNG gồm created_at/updated_at (nhiễu diff). */
function snapshot(row: Company): Record<string, unknown> {
  const snap: Record<string, unknown> = { status: row.status };
  for (const key of EDITABLE_KEYS) {
    snap[key] = (row as Record<string, unknown>)[key] ?? null;
  }
  return snap;
}

function toView(row: Company): CompanyView {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    shortName: row.shortName,
    companyCode: row.companyCode,
    logoUrl: row.logoUrl,
    timezone: row.timezone,
    currency: row.currency,
    language: row.language,
    taxCode: row.taxCode,
    businessType: row.businessType,
    regNumber: row.regNumber,
    regDate: row.regDate,
    regPlace: row.regPlace,
    legalRepName: row.legalRepName,
    legalRepTitle: row.legalRepTitle,
    establishedDate: row.establishedDate,
    address: row.address,
    phone: row.phone,
    fax: row.fax,
    email: row.email,
    website: row.website,
  };
}
