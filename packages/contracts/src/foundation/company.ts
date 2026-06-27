import { z } from "zod";

/**
 * S1-FND-WIRE-1 — Foundation Company response DTO (nguồn sự thật contracts cho GET/PATCH
 * /api/v1/foundation/company/current). Khớp CompanyView (apps/api foundation/company). Field read-only
 * id/slug/status + hồ sơ; KHÔNG có secret. BACKEND-04 §9.2.
 */
export const companyViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  shortName: z.string().nullable(),
  companyCode: z.string().nullable(),
  logoUrl: z.string().nullable(),
  timezone: z.string(),
  currency: z.string(),
  language: z.string(),
  taxCode: z.string().nullable(),
  businessType: z.string().nullable(),
  regNumber: z.string().nullable(),
  regDate: z.string().nullable(),
  regPlace: z.string().nullable(),
  legalRepName: z.string().nullable(),
  legalRepTitle: z.string().nullable(),
  establishedDate: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  fax: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
});

export type CompanyView = z.infer<typeof companyViewSchema>;
