import { Injectable, NotFoundException } from '@nestjs/common';
import type { UpdateCompanySettingsRequest } from '@mediaos/contracts';
import { assertValidTimezone } from '../common/tz.util';
import { AuditService } from '../events/audit.service';
import { resolveProfileLogoWrite } from '../foundation/company/company-logo-ref';
import { SettingsRepository } from './settings.repository';

@Injectable()
export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly audit: AuditService,
  ) {}

  async getCompanySettings(companyId: string) {
    const rows = await this.repo.getCompanySettings(companyId);
    if (!rows[0]) throw new NotFoundException('Company not found');
    return rows[0];
  }

  async updateCompanySettings(
    companyId: string,
    dto: UpdateCompanySettingsRequest,
    actorUserId: string,
  ) {
    // GX-7 / ADR-0008: Zod only guards `min(1)` on timezone — fail-fast on a non-IANA value at the
    // boundary, BEFORE persisting. A garbage tz would otherwise silently corrupt every tz-derived
    // work_date / payroll-period attribution for this tenant.
    if (dto.timezone !== undefined) assertValidTimezone(dto.timezone);

    const rows = await this.repo.updateCompanySettings(
      companyId,
      {
        timezone: dto.timezone,
        currency: dto.currency,
        language: dto.language,
        workingDaysJson: dto.workingDaysJson,
        payrollConfigJson: dto.payrollConfigJson,
        // CS-5 profile fields
        shortName: dto.shortName,
        taxCode: dto.taxCode,
        businessType: dto.businessType,
        regNumber: dto.regNumber,
        regDate: dto.regDate,
        regPlace: dto.regPlace,
        legalRepName: dto.legalRepName,
        legalRepTitle: dto.legalRepTitle,
        establishedDate: dto.establishedDate,
        address: dto.address,
        phone: dto.phone,
        fax: dto.fax,
        email: dto.email,
        website: dto.website,
      },
      { audit: this.audit, actorUserId },
      // Logo: chỉ rỗng / http(s) / giữ giá trị hiện có; fileId chỉ qua endpoint branding.
      (before) => {
        const decision = resolveProfileLogoWrite(before.logoUrl, dto.logoUrl);
        return decision.write ? { logoUrl: decision.value } : {};
      },
    );

    if (!rows[0]) throw new NotFoundException('Company not found');
    return rows[0];
  }
}
