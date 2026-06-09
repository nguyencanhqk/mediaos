import { Injectable, NotFoundException } from '@nestjs/common';
import type { UpdateCompanySettingsRequest } from '@mediaos/contracts';
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
