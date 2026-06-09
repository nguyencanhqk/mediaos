import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../db/db.service';
import { companies } from '../db/schema';

@Injectable()
export class SettingsRepository {
  constructor(private readonly db: DatabaseService) {}

  getCompanySettings(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx.select().from(companies).where(eq(companies.id, companyId)).limit(1),
    );
  }

  updateCompanySettings(
    companyId: string,
    data: Partial<{
      logoUrl: string | null;
      timezone: string;
      currency: string;
      language: string;
      workingDaysJson: unknown;
      payrollConfigJson: unknown;
    }>,
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(companies)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(companies.id, companyId))
        .returning(),
    );
  }
}
