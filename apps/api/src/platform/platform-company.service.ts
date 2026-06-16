import { randomUUID } from "node:crypto";
import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  CompanySubscriptionDto,
  CompanySummaryDto,
  CreateCompanyRequest,
  ListCompaniesQuery,
  ProvisionResultDto,
  SetSubscriptionRequest,
  UpdateCompanyRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { SubscriptionService } from "../saas/subscription.service";
import { TemplateCloneService } from "../templates/template-clone.service";
import { companies } from "../db/schema";
import { PlatformCompanyRepository } from "./platform-company.repository";

const DEFAULT_TEMPLATE = "starter";
const DEFAULT_PLAN = "free";
const PG_UNIQUE_VIOLATION = "23505";

type RequestUser = { id: string; companyId: string };

export interface CompanyListResult {
  items: CompanySummaryDto[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateCompanyResult {
  company: CompanySummaryDto;
  provision: ProvisionResultDto | null;
}

function toDto(row: typeof companies.$inferSelect): CompanySummaryDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    timezone: row.timezone,
    currency: row.currency,
    language: row.language,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

/**
 * PlatformCompanyService (G16-3, CROWN — quản vòng đời tenant chéo công ty). ADR-0017.
 *
 * - list: withPlatformContext (escape-hatch — thao tác DUY NHẤT cần nó).
 * - create: withTenant(newId tự sinh) — INSERT công ty + provision template + gán gói + audit ATOMIC.
 * - get/suspend/configure: withTenant(targetId) (policy id = current). Suspend = status (KHÔNG hard-delete).
 */
@Injectable()
export class PlatformCompanyService {
  private readonly logger = new Logger(PlatformCompanyService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PlatformCompanyRepository,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionService,
    private readonly clone: TemplateCloneService,
  ) {}

  async list(query: ListCompaniesQuery): Promise<CompanyListResult> {
    const offset = (query.page - 1) * query.limit;
    const filter = {
      status: query.status,
      search: query.search,
      limit: query.limit,
      offset,
    };
    return this.db.withPlatformContext(async (tx) => {
      const rows = await this.repo.listAll(tx, filter);
      const total = await this.repo.countAll(tx, filter);
      return { items: rows.map(toDto), total, page: query.page, limit: query.limit };
    });
  }

  async getOne(id: string): Promise<CompanySummaryDto> {
    const row = await this.db.withTenant(id, (tx) => this.repo.findById(tx, id));
    if (!row) throw new NotFoundException("Company not found");
    return toDto(row);
  }

  async create(actor: RequestUser, dto: CreateCompanyRequest): Promise<CreateCompanyResult> {
    const newId = randomUUID();
    // templateCode: undefined = default 'starter'; null = KHÔNG provision (công ty rỗng).
    const templateCode = dto.templateCode === undefined ? DEFAULT_TEMPLATE : dto.templateCode;
    const planCode = dto.planCode ?? DEFAULT_PLAN;
    try {
      return await this.db.withTenant(newId, async (tx) => {
        const company = await this.repo.insertCompany(tx, {
          id: newId,
          name: dto.name,
          slug: dto.slug,
          status: "active",
          timezone: dto.timezone,
          currency: dto.currency,
          language: dto.language,
        });
        await this.audit.record(tx, {
          action: "CompanyCreated",
          objectType: "company",
          objectId: newId,
          actorUserId: actor.id,
          after: { name: dto.name, slug: dto.slug },
        });
        await this.subscriptions.assignPlanInTx(tx, actor.id, newId, planCode);
        let provision: ProvisionResultDto | null = null;
        if (templateCode) {
          provision = await this.clone.provisionInTx(tx, newId, templateCode, actor.id);
        }
        return { company: toDto(company), provision };
      });
    } catch (err) {
      throw this.mapError(err, "Failed to create company");
    }
  }

  async suspend(actor: RequestUser, id: string): Promise<CompanySummaryDto> {
    return this.db.withTenant(id, async (tx) => {
      const existing = await this.repo.findById(tx, id);
      if (!existing) throw new NotFoundException("Company not found");
      await this.repo.updateStatus(tx, id, "suspended");
      await this.audit.record(tx, {
        action: "CompanySuspended",
        objectType: "company",
        objectId: id,
        actorUserId: actor.id,
        before: { status: existing.status },
        after: { status: "suspended" },
      });
      const fresh = await this.repo.findById(tx, id);
      if (!fresh) throw new InternalServerErrorException("Company row missing after suspend");
      return toDto(fresh);
    });
  }

  async configure(
    actor: RequestUser,
    id: string,
    dto: UpdateCompanyRequest,
  ): Promise<CompanySummaryDto> {
    const fields: {
      name?: string;
      timezone?: string;
      currency?: string;
      language?: string;
      logoUrl?: string | null;
    } = {};
    if (dto.name !== undefined) fields.name = dto.name;
    if (dto.timezone !== undefined) fields.timezone = dto.timezone;
    if (dto.currency !== undefined) fields.currency = dto.currency;
    if (dto.language !== undefined) fields.language = dto.language;
    if (dto.logoUrl !== undefined) fields.logoUrl = dto.logoUrl;

    return this.db.withTenant(id, async (tx) => {
      const existing = await this.repo.findById(tx, id);
      if (!existing) throw new NotFoundException("Company not found");
      await this.repo.updateFields(tx, id, fields);
      await this.audit.record(tx, {
        action: "CompanyConfigured",
        objectType: "company",
        objectId: id,
        actorUserId: actor.id,
        after: fields,
      });
      const fresh = await this.repo.findById(tx, id);
      if (!fresh) throw new InternalServerErrorException("Company row missing after configure");
      return toDto(fresh);
    });
  }

  /** Platform set gói CHÉO tenant: existence check rồi delegate SubscriptionService (withTenant target). */
  async setSubscription(
    actor: RequestUser,
    targetCompanyId: string,
    dto: SetSubscriptionRequest,
  ): Promise<CompanySubscriptionDto> {
    await this.getOne(targetCompanyId); // 404 nếu công ty không tồn tại
    return this.subscriptions.setSubscription(actor, targetCompanyId, dto);
  }

  private mapError(err: unknown, context: string): HttpException {
    if (err instanceof HttpException) return err;
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === PG_UNIQUE_VIOLATION) {
      return new ConflictException("A company with this slug already exists");
    }
    this.logger.error(context, { error: err instanceof Error ? err.stack : String(err) });
    return new InternalServerErrorException(context);
  }
}
