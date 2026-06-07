import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type {
  AddContentChannelRequest,
  CreateContentAssetRequest,
  CreateContentAssetVersionRequest,
  CreateContentItemRequest,
  CreateContentTypeRequest,
  SuggestWorkflowDto,
  UpdateContentChannelRequest,
  UpdateContentItemRequest,
  UpdateContentTypeRequest,
} from '@mediaos/contracts';
import { DatabaseService } from '../db/db.service';
import { AuditService } from '../events/audit.service';
import { ContentRepository, type ListContentFilter } from './content.repository';
import { ProjectsRepository } from './projects.repository';

const PG_UNIQUE_VIOLATION = '23505';

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as Record<string, unknown>)['code'];
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** ISO string → Date. undefined → bỏ qua patch; null → clear; string → Date. */
function toDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return new Date(v);
}

interface RequestUser {
  id: string;
  companyId: string;
}

@Injectable()
export class ContentService {
  constructor(
    private readonly repo: ContentRepository,
    private readonly projectsRepo: ProjectsRepository,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Content items ──────────────────────────────────────────────────────────

  listContent(companyId: string, filters: ListContentFilter) {
    return this.repo.listContent(companyId, filters);
  }

  async getContent(companyId: string, id: string) {
    const content = await this.repo.findContentById(companyId, id);
    if (!content) throw new NotFoundException(`Content not found: ${id}`);
    return content;
  }

  async createContent(user: RequestUser, dto: CreateContentItemRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        // Guard project + (optional) type/main-channel THUỘC tenant trong CÙNG tx (chặn chéo tenant + TOCTOU).
        if (!(await this.projectsRepo.projectExistsTx(tx, user.companyId, dto.projectId)))
          throw new NotFoundException(`Project not found: ${dto.projectId}`);
        if (dto.contentTypeId && !(await this.repo.contentTypeExistsTx(tx, user.companyId, dto.contentTypeId)))
          throw new NotFoundException(`Content type not found: ${dto.contentTypeId}`);
        if (
          dto.mainChannelId &&
          (await this.repo.channelPlatformTx(tx, user.companyId, dto.mainChannelId)) === undefined
        )
          throw new NotFoundException(`Channel not found: ${dto.mainChannelId}`);

        const rows = await this.repo.createContent(
          user.companyId,
          {
            projectId: dto.projectId,
            title: dto.title,
            contentTypeId: dto.contentTypeId ?? null,
            code: dto.code ?? null,
            description: dto.description ?? null,
            ownerUserId: dto.ownerUserId ?? null,
            mainChannelId: dto.mainChannelId ?? null,
            language: dto.language ?? null,
            priority: dto.priority ?? null,
            plannedPublishAt: toDate(dto.plannedPublishAt) ?? null,
          },
          tx,
        );
        if (!rows[0]) throw new InternalServerErrorException('Failed to create content item');
        await this.audit.record(tx, {
          action: 'ContentCreated',
          objectType: 'content',
          objectId: rows[0].id,
          actorUserId: user.id,
          after: { title: rows[0].title, projectId: rows[0].projectId, contentTypeId: rows[0].contentTypeId },
        });
        return rows[0];
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) throw new ConflictException('Content code already exists');
      throw err;
    }
  }

  async updateContent(user: RequestUser, id: string, dto: UpdateContentItemRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        if (dto.contentTypeId && !(await this.repo.contentTypeExistsTx(tx, user.companyId, dto.contentTypeId)))
          throw new NotFoundException(`Content type not found: ${dto.contentTypeId}`);
        if (
          dto.mainChannelId &&
          (await this.repo.channelPlatformTx(tx, user.companyId, dto.mainChannelId)) === undefined
        )
          throw new NotFoundException(`Channel not found: ${dto.mainChannelId}`);

        const rows = await this.repo.updateContent(
          user.companyId,
          id,
          {
            title: dto.title,
            contentTypeId: dto.contentTypeId,
            code: dto.code,
            description: dto.description,
            ownerUserId: dto.ownerUserId,
            mainChannelId: dto.mainChannelId,
            language: dto.language,
            status: dto.status,
            productionStatus: dto.productionStatus,
            priority: dto.priority,
            plannedPublishAt: toDate(dto.plannedPublishAt),
            publishedAt: toDate(dto.publishedAt),
            finalUrl: dto.finalUrl,
            thumbnailUrl: dto.thumbnailUrl,
            scriptUrl: dto.scriptUrl,
            videoFileUrl: dto.videoFileUrl,
          },
          tx,
        );
        if (!rows[0]) throw new NotFoundException(`Content not found: ${id}`);
        await this.audit.record(tx, {
          action: 'ContentUpdated',
          objectType: 'content',
          objectId: id,
          actorUserId: user.id,
          after: { changed: Object.keys(dto) },
        });
        return rows[0];
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) throw new ConflictException('Content code already exists');
      throw err;
    }
  }

  async deleteContent(user: RequestUser, id: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.softDeleteContent(user.companyId, id, tx);
      if (rows.length === 0) throw new NotFoundException(`Content not found: ${id}`);
      await this.audit.record(tx, {
        action: 'ContentDeleted',
        objectType: 'content',
        objectId: id,
        actorUserId: user.id,
      });
    });
  }

  /** Gợi ý workflow theo content type (CNT-001) — chỉ trả template ids (instance thật ở G7). */
  async suggestWorkflow(companyId: string, id: string): Promise<SuggestWorkflowDto> {
    const content = await this.getContent(companyId, id);
    if (!content.contentTypeId) {
      return { contentTypeId: null, defaultWorkflowTemplateId: null, defaultEvaluationTemplateId: null };
    }
    const type = await this.repo.findContentTypeById(companyId, content.contentTypeId);
    return {
      contentTypeId: content.contentTypeId,
      defaultWorkflowTemplateId: type?.defaultWorkflowTemplateId ?? null,
      defaultEvaluationTemplateId: type?.defaultEvaluationTemplateId ?? null,
    };
  }

  // ── Content channels (publish targets) ───────────────────────────────────────

  async listContentChannels(companyId: string, contentId: string) {
    await this.assertContentExists(companyId, contentId);
    return this.repo.listContentChannels(companyId, contentId);
  }

  async addContentChannel(user: RequestUser, contentId: string, dto: AddContentChannelRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        if (!(await this.repo.contentExistsTx(tx, user.companyId, contentId)))
          throw new NotFoundException(`Content not found: ${contentId}`);
        // Snapshot platform_id từ kênh (đồng thời guard kênh thuộc tenant + chưa xoá).
        const platformId = await this.repo.channelPlatformTx(tx, user.companyId, dto.channelId);
        if (platformId === undefined) throw new NotFoundException(`Channel not found: ${dto.channelId}`);

        const newId = await this.repo.addContentChannel(
          user.companyId,
          contentId,
          {
            channelId: dto.channelId,
            platformId,
            publishStatus: dto.publishStatus ?? null,
            publishUrl: dto.publishUrl ?? null,
            plannedPublishAt: toDate(dto.plannedPublishAt) ?? null,
          },
          tx,
        );
        await this.audit.record(tx, {
          action: 'ContentChannelLinked',
          objectType: 'content_channel',
          objectId: newId,
          actorUserId: user.id,
          after: { contentId, channelId: dto.channelId },
        });
        const row = await this.repo.findContentChannelByIdTx(tx, user.companyId, newId);
        if (!row) throw new InternalServerErrorException('Failed to add publish target');
        return row;
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION)
        throw new ConflictException('Channel already a publish target for this content');
      throw err;
    }
  }

  async updateContentChannel(
    user: RequestUser,
    contentId: string,
    contentChannelId: string,
    dto: UpdateContentChannelRequest,
  ) {
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.updateContentChannel(
        user.companyId,
        contentId,
        contentChannelId,
        {
          publishStatus: dto.publishStatus,
          publishUrl: dto.publishUrl,
          plannedPublishAt: toDate(dto.plannedPublishAt),
          publishedAt: toDate(dto.publishedAt),
        },
        tx,
      );
      if (!rows[0]) throw new NotFoundException('Publish target not found');
      await this.audit.record(tx, {
        action: 'ContentChannelUpdated',
        objectType: 'content_channel',
        objectId: contentChannelId,
        actorUserId: user.id,
        after: { contentId, changed: Object.keys(dto) },
      });
      const row = await this.repo.findContentChannelByIdTx(tx, user.companyId, contentChannelId);
      if (!row) throw new InternalServerErrorException('Failed to update publish target');
      return row;
    });
  }

  async removeContentChannel(user: RequestUser, contentId: string, contentChannelId: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.removeContentChannel(user.companyId, contentId, contentChannelId, tx);
      if (rows.length === 0) throw new NotFoundException('Publish target not found');
      await this.audit.record(tx, {
        action: 'ContentChannelUnlinked',
        objectType: 'content_channel',
        objectId: contentChannelId,
        actorUserId: user.id,
        after: { contentId },
      });
    });
  }

  // ── Content assets (version chain) ───────────────────────────────────────────

  async listContentAssets(companyId: string, contentId: string) {
    await this.assertContentExists(companyId, contentId);
    return this.repo.listContentAssets(companyId, contentId);
  }

  async createAsset(user: RequestUser, contentId: string, dto: CreateContentAssetRequest) {
    return this.db.withTenant(user.companyId, async (tx) => {
      if (!(await this.repo.contentExistsTx(tx, user.companyId, contentId)))
        throw new NotFoundException(`Content not found: ${contentId}`);
      const rows = await this.repo.createAssetV1(
        user.companyId,
        contentId,
        user.id,
        { assetType: dto.assetType ?? null, name: dto.name ?? null, fileUrl: dto.fileUrl ?? null, externalUrl: dto.externalUrl ?? null },
        tx,
      );
      if (!rows[0]) throw new InternalServerErrorException('Failed to create asset');
      await this.audit.record(tx, {
        action: 'ContentAssetCreated',
        objectType: 'content_asset',
        objectId: rows[0].id,
        actorUserId: user.id,
        after: { contentId, assetType: rows[0].assetType, version: rows[0].version },
      });
      return rows[0];
    });
  }

  /**
   * Tạo version mới cho group của `assetId` (CNT-003): flip bản current cũ (is_current=false +
   * superseded_by) TRƯỚC khi INSERT bản mới (né one-current uq) — CÙNG 1 tx.
   */
  async createAssetVersion(
    user: RequestUser,
    contentId: string,
    assetId: string,
    dto: CreateContentAssetVersionRequest,
  ) {
    return this.db.withTenant(user.companyId, async (tx) => {
      if (!(await this.repo.contentExistsTx(tx, user.companyId, contentId)))
        throw new NotFoundException(`Content not found: ${contentId}`);
      const target = await this.repo.findAssetByIdTx(tx, user.companyId, assetId);
      if (!target || target.contentItemId !== contentId)
        throw new NotFoundException(`Asset not found: ${assetId}`);

      const groupId = target.versionGroupId;
      const current = await this.repo.findCurrentInGroupTx(tx, user.companyId, groupId);
      const newId = randomUUID();

      // 1) Flip bản current cũ is_current=false TRƯỚC (giải phóng one-current slot; chưa set superseded_by
      //    vì FK content_assets.superseded_by → id của bản mới CHƯA tồn tại).
      if (current) {
        await this.repo.demoteAssetTx(user.companyId, current.id, tx);
      }
      // 2) INSERT bản mới is_current=true (slot đã trống → không vỡ one-current uq).
      const nextVersion = (await this.repo.maxVersionInGroupTx(tx, user.companyId, groupId)) + 1;
      const rows = await this.repo.insertAssetVersionTx(
        user.companyId,
        {
          id: newId,
          contentItemId: contentId,
          versionGroupId: groupId,
          version: nextVersion,
          parentAssetId: current?.id ?? assetId,
          uploadedBy: user.id,
          data: { assetType: dto.assetType ?? null, name: dto.name ?? null, fileUrl: dto.fileUrl ?? null, externalUrl: dto.externalUrl ?? null },
        },
        tx,
      );
      if (!rows[0]) throw new InternalServerErrorException('Failed to create asset version');
      // 3) Set superseded_by của bản cũ → bản mới (FK đã thoả vì bản mới đã tồn tại).
      if (current) {
        await this.repo.setSupersededByTx(user.companyId, current.id, newId, tx);
      }
      await this.audit.record(tx, {
        action: 'ContentAssetVersionCreated',
        objectType: 'content_asset',
        objectId: rows[0].id,
        actorUserId: user.id,
        after: { contentId, versionGroupId: groupId, version: nextVersion, supersededAssetId: current?.id ?? null },
      });
      return rows[0];
    });
  }

  async deleteAsset(user: RequestUser, contentId: string, assetId: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const target = await this.repo.findAssetByIdTx(tx, user.companyId, assetId);
      if (!target || target.contentItemId !== contentId)
        throw new NotFoundException(`Asset not found: ${assetId}`);
      // Bản current bị xoá PHẢI flip is_current=false (giải phóng one-current slot cho promote sau).
      await this.repo.softDeleteAssetTx(user.companyId, assetId, target.isCurrent, tx);
      await this.audit.record(tx, {
        action: 'ContentAssetDeleted',
        objectType: 'content_asset',
        objectId: assetId,
        actorUserId: user.id,
        after: { contentId, wasCurrent: target.isCurrent },
      });
    });
  }

  // ── Content types ────────────────────────────────────────────────────────────

  listContentTypes(companyId: string) {
    return this.repo.listContentTypes(companyId);
  }

  async createContentType(user: RequestUser, dto: CreateContentTypeRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const rows = await this.repo.createContentType(
          user.companyId,
          {
            name: dto.name,
            code: dto.code ?? null,
            description: dto.description ?? null,
            defaultWorkflowTemplateId: dto.defaultWorkflowTemplateId ?? null,
            defaultEvaluationTemplateId: dto.defaultEvaluationTemplateId ?? null,
            targetPlatform: dto.targetPlatform ?? null,
            standardDuration: dto.standardDuration ?? null,
          },
          tx,
        );
        if (!rows[0]) throw new InternalServerErrorException('Failed to create content type');
        await this.audit.record(tx, {
          action: 'ContentTypeCreated',
          objectType: 'content_type',
          objectId: rows[0].id,
          actorUserId: user.id,
          after: { name: rows[0].name, code: rows[0].code },
        });
        return rows[0];
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION)
        throw new ConflictException('Content type name or code already exists');
      throw err;
    }
  }

  async updateContentType(user: RequestUser, id: string, dto: UpdateContentTypeRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const rows = await this.repo.updateContentType(
          user.companyId,
          id,
          {
            name: dto.name,
            code: dto.code,
            description: dto.description,
            defaultWorkflowTemplateId: dto.defaultWorkflowTemplateId,
            defaultEvaluationTemplateId: dto.defaultEvaluationTemplateId,
            targetPlatform: dto.targetPlatform,
            standardDuration: dto.standardDuration,
            status: dto.status,
          },
          tx,
        );
        if (!rows[0]) throw new NotFoundException(`Content type not found: ${id}`);
        await this.audit.record(tx, {
          action: 'ContentTypeUpdated',
          objectType: 'content_type',
          objectId: id,
          actorUserId: user.id,
          after: { changed: Object.keys(dto) },
        });
        return rows[0];
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION)
        throw new ConflictException('Content type name or code already exists');
      throw err;
    }
  }

  async deleteContentType(user: RequestUser, id: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.softDeleteContentType(user.companyId, id, tx);
      if (rows.length === 0) throw new NotFoundException(`Content type not found: ${id}`);
      await this.audit.record(tx, {
        action: 'ContentTypeDeleted',
        objectType: 'content_type',
        objectId: id,
        actorUserId: user.id,
      });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async assertContentExists(companyId: string, contentId: string): Promise<void> {
    if (!(await this.repo.contentExists(companyId, contentId))) {
      throw new NotFoundException(`Content not found: ${contentId}`);
    }
  }
}
