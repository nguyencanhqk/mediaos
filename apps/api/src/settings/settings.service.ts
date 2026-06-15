import { Injectable, NotFoundException } from '@nestjs/common';
import type { UpdateCompanySettingsRequest } from '@mediaos/contracts';
import { assertValidTimezone } from '../common/tz.util';
import { SettingsRepository } from './settings.repository';

@Injectable()
export class SettingsService {
  constructor(private readonly repo: SettingsRepository) {}

  async getCompanySettings(companyId: string) {
    const rows = await this.repo.getCompanySettings(companyId);
    if (!rows[0]) throw new NotFoundException('Company not found');
    return rows[0];
  }

  async updateCompanySettings(companyId: string, dto: UpdateCompanySettingsRequest) {
    // GX-7 / ADR-0008: Zod only guards `min(1)` on timezone — fail-fast on a non-IANA value at the
    // boundary, BEFORE persisting. A garbage tz would otherwise silently corrupt every tz-derived
    // work_date / payroll-period attribution for this tenant.
    if (dto.timezone !== undefined) assertValidTimezone(dto.timezone);
    const rows = await this.repo.updateCompanySettings(companyId, {
      logoUrl: dto.logoUrl,
      timezone: dto.timezone,
      currency: dto.currency,
      language: dto.language,
      workingDaysJson: dto.workingDaysJson,
      payrollConfigJson: dto.payrollConfigJson,
    });
    if (!rows[0]) throw new NotFoundException('Company not found');
    return rows[0];
  }
}
