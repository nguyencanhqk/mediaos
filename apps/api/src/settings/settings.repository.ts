import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../db/db.service';
import { companies } from '../db/schema';
import { AuditService } from '../events/audit.service';

/** Subset of company columns writable via PATCH /settings/company. */
export type CompanyProfilePatch = Partial<{
  logoUrl: string | null;
  timezone: string;
  currency: string;
  language: string;
  workingDaysJson: unknown;
  payrollConfigJson: unknown;
  // CS-5 profile fields
  shortName: string | null;
  taxCode: string | null;
  businessType: string | null;
  regNumber: string | null;
  regDate: string | null;
  regPlace: string | null;
  legalRepName: string | null;
  legalRepTitle: string | null;
  establishedDate: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
  website: string | null;
}>;

export interface SettingsAuditMeta {
  audit: AuditService;
  actorUserId: string;
}

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
    data: CompanyProfilePatch,
    auditMeta: SettingsAuditMeta,
  ) {
    return this.db.withTenant(companyId, async (tx) => {
      // Read before-state for audit (only the fields we're about to mutate).
      const existing = await tx
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);

      const beforeRow = existing[0];

      const rows = await tx
        .update(companies)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(companies.id, companyId))
        .returning();

      const afterRow = rows[0];

      if (afterRow) {
        await auditMeta.audit.record(tx, {
          action: 'CompanySettingsUpdated',
          objectType: 'company',
          objectId: companyId,
          actorUserId: auditMeta.actorUserId,
          before: beforeRow
            ? {
                logoUrl: beforeRow.logoUrl,
                timezone: beforeRow.timezone,
                currency: beforeRow.currency,
                language: beforeRow.language,
                workingDaysJson: beforeRow.workingDaysJson,
                payrollConfigJson: beforeRow.payrollConfigJson,
                shortName: beforeRow.shortName,
                taxCode: beforeRow.taxCode,
                businessType: beforeRow.businessType,
                regNumber: beforeRow.regNumber,
                regDate: beforeRow.regDate,
                regPlace: beforeRow.regPlace,
                legalRepName: beforeRow.legalRepName,
                legalRepTitle: beforeRow.legalRepTitle,
                establishedDate: beforeRow.establishedDate,
                address: beforeRow.address,
                phone: beforeRow.phone,
                fax: beforeRow.fax,
                email: beforeRow.email,
                website: beforeRow.website,
              }
            : null,
          after: {
            logoUrl: afterRow.logoUrl,
            timezone: afterRow.timezone,
            currency: afterRow.currency,
            language: afterRow.language,
            workingDaysJson: afterRow.workingDaysJson,
            payrollConfigJson: afterRow.payrollConfigJson,
            shortName: afterRow.shortName,
            taxCode: afterRow.taxCode,
            businessType: afterRow.businessType,
            regNumber: afterRow.regNumber,
            regDate: afterRow.regDate,
            regPlace: afterRow.regPlace,
            legalRepName: afterRow.legalRepName,
            legalRepTitle: afterRow.legalRepTitle,
            establishedDate: afterRow.establishedDate,
            address: afterRow.address,
            phone: afterRow.phone,
            fax: afterRow.fax,
            email: afterRow.email,
            website: afterRow.website,
          },
        });
      }

      return rows;
    });
  }
}
