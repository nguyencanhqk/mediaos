import { Injectable } from "@nestjs/common";
import type { TemplateSummaryDto } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { TemplateRepository } from "./template.repository";

/**
 * TemplateService (G16-3) — đọc catalog template (list). workspace_templates là catalog toàn cục (no RLS)
 * nên đọc trong bất kỳ tx được; dùng withTenant(actor.companyId) cho gọn (KHÔNG cần escape-hatch để đọc).
 */
@Injectable()
export class TemplateService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TemplateRepository,
  ) {}

  async listTemplates(actorCompanyId: string): Promise<TemplateSummaryDto[]> {
    const rows = await this.db.withTenant(actorCompanyId, (tx) => this.repo.listTemplates(tx));
    return rows.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      description: t.description,
      isSystem: t.isSystem,
    }));
  }
}
