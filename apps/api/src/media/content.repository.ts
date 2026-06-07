import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, eq, ilike, isNull, sql } from 'drizzle-orm';
import { DatabaseService, type TenantTx } from '../db/db.service';
import { channels, contentAssets, contentChannels, contentItems, contentTypes } from '../db/schema';

/** Input tạo content (đã validate ở DTO; timestamp đã chuẩn hoá sang Date|null ở service). */
export interface CreateContentData {
  projectId: string;
  title: string;
  contentTypeId?: string | null;
  code?: string | null;
  description?: string | null;
  ownerUserId?: string | null;
  mainChannelId?: string | null;
  language?: string | null;
  priority?: string | null;
  plannedPublishAt?: Date | null;
}

/** Patch content — chỉ field có mặt mới đổi (partial). */
export interface UpdateContentData {
  title?: string;
  contentTypeId?: string | null;
  code?: string | null;
  description?: string | null;
  ownerUserId?: string | null;
  mainChannelId?: string | null;
  language?: string | null;
  status?: string;
  productionStatus?: string | null;
  priority?: string | null;
  plannedPublishAt?: Date | null;
  publishedAt?: Date | null;
  finalUrl?: string | null;
  thumbnailUrl?: string | null;
  scriptUrl?: string | null;
  videoFileUrl?: string | null;
}

export interface ListContentFilter {
  projectId?: string;
  status?: string;
  productionStatus?: string;
  contentTypeId?: string;
  mainChannelId?: string;
  q?: string;
}

export interface AddContentChannelData {
  channelId: string;
  platformId: string | null;
  publishStatus?: string | null;
  publishUrl?: string | null;
  plannedPublishAt?: Date | null;
}

export interface UpdateContentChannelData {
  publishStatus?: string;
  publishUrl?: string | null;
  plannedPublishAt?: Date | null;
  publishedAt?: Date | null;
}

export interface CreateContentTypeData {
  name: string;
  code?: string | null;
  description?: string | null;
  defaultWorkflowTemplateId?: string | null;
  defaultEvaluationTemplateId?: string | null;
  targetPlatform?: string | null;
  standardDuration?: number | null;
}

export interface UpdateContentTypeData {
  name?: string;
  code?: string | null;
  description?: string | null;
  defaultWorkflowTemplateId?: string | null;
  defaultEvaluationTemplateId?: string | null;
  targetPlatform?: string | null;
  standardDuration?: number | null;
  status?: string;
}

export interface CreateAssetData {
  assetType?: string | null;
  name?: string | null;
  fileUrl?: string | null;
  externalUrl?: string | null;
}

/** Normalize '' → NULL ở boundary (partial unique code dùng `code IS NOT NULL`). */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Escape ký tự pattern ILIKE (\ % _) để `q` là so khớp literal substring (không thành wildcard). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Shape join trả về cho FE (content_channel + channel name/platform). Khớp contentChannelSchema. */
const contentChannelSelection = {
  id: contentChannels.id,
  contentItemId: contentChannels.contentItemId,
  channelId: contentChannels.channelId,
  channelName: channels.name,
  platform: channels.platform,
  platformId: contentChannels.platformId,
  publishStatus: contentChannels.publishStatus,
  publishUrl: contentChannels.publishUrl,
  plannedPublishAt: contentChannels.plannedPublishAt,
  publishedAt: contentChannels.publishedAt,
  createdAt: contentChannels.createdAt,
  updatedAt: contentChannels.updatedAt,
};

@Injectable()
export class ContentRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Content items ──────────────────────────────────────────────────────────

  listContent(companyId: string, filters: ListContentFilter = {}) {
    return this.db.withTenant(companyId, (tx) => {
      const conds = [eq(contentItems.companyId, companyId), isNull(contentItems.deletedAt)];
      if (filters.projectId) conds.push(eq(contentItems.projectId, filters.projectId));
      if (filters.status) conds.push(eq(contentItems.status, filters.status));
      if (filters.productionStatus) conds.push(eq(contentItems.productionStatus, filters.productionStatus));
      if (filters.contentTypeId) conds.push(eq(contentItems.contentTypeId, filters.contentTypeId));
      if (filters.mainChannelId) conds.push(eq(contentItems.mainChannelId, filters.mainChannelId));
      if (filters.q) conds.push(ilike(contentItems.title, `%${escapeLike(filters.q)}%`));
      return tx
        .select()
        .from(contentItems)
        .where(and(...conds))
        .orderBy(contentItems.createdAt);
    });
  }

  /** Content + type + channels (joined) + assets (non-deleted) cho trang chi tiết. null nếu không tồn tại. */
  async findContentById(companyId: string, id: string) {
    return this.db.withTenant(companyId, async (tx) => {
      const [content] = await tx
        .select()
        .from(contentItems)
        .where(
          and(eq(contentItems.companyId, companyId), eq(contentItems.id, id), isNull(contentItems.deletedAt)),
        )
        .limit(1);
      if (!content) return null;

      const [contentType] = content.contentTypeId
        ? await tx
            .select()
            .from(contentTypes)
            .where(and(eq(contentTypes.companyId, companyId), eq(contentTypes.id, content.contentTypeId)))
            .limit(1)
        : [];

      const channelLinks = await tx
        .select(contentChannelSelection)
        .from(contentChannels)
        .innerJoin(channels, and(eq(contentChannels.channelId, channels.id), isNull(channels.deletedAt)))
        .where(and(eq(contentChannels.companyId, companyId), eq(contentChannels.contentItemId, id)))
        .orderBy(contentChannels.createdAt);

      const assetRows = await tx
        .select()
        .from(contentAssets)
        .where(
          and(
            eq(contentAssets.companyId, companyId),
            eq(contentAssets.contentItemId, id),
            isNull(contentAssets.deletedAt),
          ),
        )
        .orderBy(contentAssets.versionGroupId, contentAssets.version);

      return { ...content, contentType: contentType ?? null, channels: channelLinks, assets: assetRows };
    });
  }

  createContent(companyId: string, data: CreateContentData, tx: TenantTx) {
    return tx
      .insert(contentItems)
      .values({
        companyId,
        projectId: data.projectId,
        title: data.title,
        contentTypeId: data.contentTypeId ?? null,
        code: normalizeOptional(data.code),
        description: normalizeOptional(data.description),
        ownerUserId: data.ownerUserId ?? null,
        mainChannelId: data.mainChannelId ?? null,
        language: normalizeOptional(data.language),
        // Entry-state pipeline 10-trạng thái (nhất quán backfill draft→idea ở 0025). status workflow-lite giữ default 'draft'.
        productionStatus: 'idea',
        priority: data.priority ?? null,
        plannedPublishAt: data.plannedPublishAt ?? null,
      })
      .returning();
  }

  updateContent(companyId: string, id: string, data: UpdateContentData, tx: TenantTx) {
    const patch: Partial<typeof contentItems.$inferInsert> = { updatedAt: new Date() };
    if (data.title !== undefined) patch.title = data.title;
    if (data.contentTypeId !== undefined) patch.contentTypeId = data.contentTypeId;
    if (data.code !== undefined) patch.code = normalizeOptional(data.code);
    if (data.description !== undefined) patch.description = data.description;
    if (data.ownerUserId !== undefined) patch.ownerUserId = data.ownerUserId;
    if (data.mainChannelId !== undefined) patch.mainChannelId = data.mainChannelId;
    if (data.language !== undefined) patch.language = normalizeOptional(data.language);
    if (data.status !== undefined) patch.status = data.status;
    if (data.productionStatus !== undefined) patch.productionStatus = data.productionStatus;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.plannedPublishAt !== undefined) patch.plannedPublishAt = data.plannedPublishAt;
    if (data.publishedAt !== undefined) patch.publishedAt = data.publishedAt;
    if (data.finalUrl !== undefined) patch.finalUrl = data.finalUrl;
    if (data.thumbnailUrl !== undefined) patch.thumbnailUrl = data.thumbnailUrl;
    if (data.scriptUrl !== undefined) patch.scriptUrl = data.scriptUrl;
    if (data.videoFileUrl !== undefined) patch.videoFileUrl = data.videoFileUrl;
    return tx
      .update(contentItems)
      .set(patch)
      .where(and(eq(contentItems.companyId, companyId), eq(contentItems.id, id), isNull(contentItems.deletedAt)))
      .returning();
  }

  softDeleteContent(companyId: string, id: string, tx: TenantTx) {
    return tx
      .update(contentItems)
      .set({ deletedAt: new Date() })
      .where(and(eq(contentItems.companyId, companyId), eq(contentItems.id, id), isNull(contentItems.deletedAt)))
      .returning();
  }

  // ── In-tx tenant-scoped existence (guard cross-tenant link + TOCTOU) ──────────

  async contentExistsTx(tx: TenantTx, companyId: string, id: string): Promise<boolean> {
    const rows = await tx
      .select({ id: contentItems.id })
      .from(contentItems)
      .where(and(eq(contentItems.companyId, companyId), eq(contentItems.id, id), isNull(contentItems.deletedAt)))
      .limit(1);
    return rows.length > 0;
  }

  async contentExists(companyId: string, id: string): Promise<boolean> {
    return this.db.withTenant(companyId, (tx) => this.contentExistsTx(tx, companyId, id));
  }

  /** Kênh thuộc tenant + chưa xoá? Trả platformId để snapshot vào content_channels. undefined nếu không có. */
  async channelPlatformTx(tx: TenantTx, companyId: string, channelId: string): Promise<string | undefined> {
    const rows = await tx
      .select({ platformId: channels.platformId })
      .from(channels)
      .where(and(eq(channels.companyId, companyId), eq(channels.id, channelId), isNull(channels.deletedAt)))
      .limit(1);
    return rows[0]?.platformId;
  }

  /** Content type thuộc tenant + chưa xoá? (chặn gán type chéo tenant). */
  async contentTypeExistsTx(tx: TenantTx, companyId: string, typeId: string): Promise<boolean> {
    const rows = await tx
      .select({ id: contentTypes.id })
      .from(contentTypes)
      .where(and(eq(contentTypes.companyId, companyId), eq(contentTypes.id, typeId), isNull(contentTypes.deletedAt)))
      .limit(1);
    return rows.length > 0;
  }

  // ── Content channels (publish targets) ───────────────────────────────────────

  listContentChannels(companyId: string, contentItemId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select(contentChannelSelection)
        .from(contentChannels)
        .innerJoin(channels, and(eq(contentChannels.channelId, channels.id), isNull(channels.deletedAt)))
        .where(and(eq(contentChannels.companyId, companyId), eq(contentChannels.contentItemId, contentItemId)))
        .orderBy(contentChannels.createdAt),
    );
  }

  /** Đọc 1 publish-target joined (sau insert/update). null nếu không thấy. */
  async findContentChannelByIdTx(tx: TenantTx, companyId: string, id: string) {
    const [row] = await tx
      .select(contentChannelSelection)
      .from(contentChannels)
      .innerJoin(channels, and(eq(contentChannels.channelId, channels.id), isNull(channels.deletedAt)))
      .where(and(eq(contentChannels.companyId, companyId), eq(contentChannels.id, id)))
      .limit(1);
    return row ?? null;
  }

  addContentChannel(companyId: string, contentItemId: string, data: AddContentChannelData, tx: TenantTx) {
    return tx
      .insert(contentChannels)
      .values({
        companyId,
        contentItemId,
        channelId: data.channelId,
        platformId: data.platformId,
        publishStatus: data.publishStatus ?? 'not_scheduled',
        publishUrl: normalizeOptional(data.publishUrl),
        plannedPublishAt: data.plannedPublishAt ?? null,
      })
      .returning({ id: contentChannels.id });
  }

  updateContentChannel(
    companyId: string,
    contentItemId: string,
    contentChannelId: string,
    data: UpdateContentChannelData,
    tx: TenantTx,
  ) {
    const patch: Partial<typeof contentChannels.$inferInsert> = { updatedAt: new Date() };
    if (data.publishStatus !== undefined) patch.publishStatus = data.publishStatus;
    if (data.publishUrl !== undefined) patch.publishUrl = normalizeOptional(data.publishUrl);
    if (data.plannedPublishAt !== undefined) patch.plannedPublishAt = data.plannedPublishAt;
    if (data.publishedAt !== undefined) patch.publishedAt = data.publishedAt;
    return tx
      .update(contentChannels)
      .set(patch)
      .where(
        and(
          eq(contentChannels.companyId, companyId),
          eq(contentChannels.contentItemId, contentItemId),
          eq(contentChannels.id, contentChannelId),
        ),
      )
      .returning({ id: contentChannels.id });
  }

  removeContentChannel(companyId: string, contentItemId: string, contentChannelId: string, tx: TenantTx) {
    return tx
      .delete(contentChannels)
      .where(
        and(
          eq(contentChannels.companyId, companyId),
          eq(contentChannels.contentItemId, contentItemId),
          eq(contentChannels.id, contentChannelId),
        ),
      )
      .returning({ id: contentChannels.id });
  }

  // ── Content assets (version chain) ───────────────────────────────────────────

  listContentAssets(companyId: string, contentItemId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(contentAssets)
        .where(
          and(
            eq(contentAssets.companyId, companyId),
            eq(contentAssets.contentItemId, contentItemId),
            isNull(contentAssets.deletedAt),
          ),
        )
        .orderBy(contentAssets.versionGroupId, contentAssets.version),
    );
  }

  /**
   * Tạo asset v1 (anchor group mới): version_group_id = id (app-gen UUID), parent_asset_id NULL,
   * version 1, is_current true (ERD v2 §11 — v1 anchor).
   */
  createAssetV1(companyId: string, contentItemId: string, uploadedBy: string, data: CreateAssetData, tx: TenantTx) {
    const newId = randomUUID();
    return tx
      .insert(contentAssets)
      .values({
        id: newId,
        companyId,
        contentItemId,
        assetType: data.assetType ?? null,
        name: normalizeOptional(data.name),
        fileUrl: normalizeOptional(data.fileUrl),
        externalUrl: normalizeOptional(data.externalUrl),
        version: 1,
        versionGroupId: newId,
        parentAssetId: null,
        isCurrent: true,
        uploadedBy,
      })
      .returning();
  }

  /** Asset theo id, thuộc tenant + chưa xoá. null nếu không thấy. */
  async findAssetByIdTx(tx: TenantTx, companyId: string, assetId: string) {
    const [row] = await tx
      .select()
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.companyId, companyId),
          eq(contentAssets.id, assetId),
          isNull(contentAssets.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Bản current (is_current, chưa xoá) của 1 version_group. null nếu group không còn bản current. */
  async findCurrentInGroupTx(tx: TenantTx, companyId: string, versionGroupId: string) {
    const [row] = await tx
      .select()
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.companyId, companyId),
          eq(contentAssets.versionGroupId, versionGroupId),
          eq(contentAssets.isCurrent, true),
          isNull(contentAssets.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** version lớn nhất trong group (kể cả soft-deleted) để cấp version kế tiếp. */
  async maxVersionInGroupTx(tx: TenantTx, companyId: string, versionGroupId: string): Promise<number> {
    const [row] = await tx
      .select({ maxVersion: sql<number>`COALESCE(MAX(${contentAssets.version}), 0)` })
      .from(contentAssets)
      .where(and(eq(contentAssets.companyId, companyId), eq(contentAssets.versionGroupId, versionGroupId)));
    return Number(row?.maxVersion ?? 0);
  }

  /** Flip bản current cũ: is_current=false (gọi TRƯỚC insert bản mới để giải phóng one-current slot). */
  demoteAssetTx(companyId: string, assetId: string, tx: TenantTx) {
    return tx
      .update(contentAssets)
      .set({ isCurrent: false, updatedAt: new Date() })
      .where(and(eq(contentAssets.companyId, companyId), eq(contentAssets.id, assetId)))
      .returning({ id: contentAssets.id });
  }

  /** Set superseded_by SAU khi bản mới đã INSERT (FK content_assets.superseded_by → id phải tồn tại). */
  setSupersededByTx(companyId: string, assetId: string, supersededBy: string, tx: TenantTx) {
    return tx
      .update(contentAssets)
      .set({ supersededBy, updatedAt: new Date() })
      .where(and(eq(contentAssets.companyId, companyId), eq(contentAssets.id, assetId)))
      .returning({ id: contentAssets.id });
  }

  /** Insert bản version mới (cùng version_group_id, is_current=true). id app-gen để link superseded_by trước. */
  insertAssetVersionTx(
    companyId: string,
    params: {
      id: string;
      contentItemId: string;
      versionGroupId: string;
      version: number;
      parentAssetId: string;
      uploadedBy: string;
      data: CreateAssetData;
    },
    tx: TenantTx,
  ) {
    return tx
      .insert(contentAssets)
      .values({
        id: params.id,
        companyId,
        contentItemId: params.contentItemId,
        assetType: params.data.assetType ?? null,
        name: normalizeOptional(params.data.name),
        fileUrl: normalizeOptional(params.data.fileUrl),
        externalUrl: normalizeOptional(params.data.externalUrl),
        version: params.version,
        versionGroupId: params.versionGroupId,
        parentAssetId: params.parentAssetId,
        isCurrent: true,
        uploadedBy: params.uploadedBy,
      })
      .returning();
  }

  /**
   * Soft-delete 1 asset + LUÔN flip is_current=false (giải phóng one-current slot). Set false vô điều
   * kiện là an toàn: bản đã xoá không bao giờ được là "hiện hành"; tránh ternary mong manh khi isCurrent null.
   */
  softDeleteAssetTx(companyId: string, assetId: string, tx: TenantTx) {
    return tx
      .update(contentAssets)
      .set({ deletedAt: new Date(), isCurrent: false, updatedAt: new Date() })
      .where(
        and(
          eq(contentAssets.companyId, companyId),
          eq(contentAssets.id, assetId),
          isNull(contentAssets.deletedAt),
        ),
      )
      .returning({ id: contentAssets.id });
  }

  // ── Content types ────────────────────────────────────────────────────────────

  listContentTypes(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(contentTypes)
        .where(and(eq(contentTypes.companyId, companyId), isNull(contentTypes.deletedAt)))
        .orderBy(contentTypes.name),
    );
  }

  /** content_type cho suggest-workflow (template ids). null nếu không tồn tại. */
  async findContentTypeById(companyId: string, typeId: string) {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .select()
        .from(contentTypes)
        .where(and(eq(contentTypes.companyId, companyId), eq(contentTypes.id, typeId), isNull(contentTypes.deletedAt)))
        .limit(1);
      return row ?? null;
    });
  }

  createContentType(companyId: string, data: CreateContentTypeData, tx: TenantTx) {
    return tx
      .insert(contentTypes)
      .values({
        companyId,
        name: data.name,
        code: normalizeOptional(data.code),
        description: normalizeOptional(data.description),
        defaultWorkflowTemplateId: data.defaultWorkflowTemplateId ?? null,
        defaultEvaluationTemplateId: data.defaultEvaluationTemplateId ?? null,
        targetPlatform: normalizeOptional(data.targetPlatform),
        standardDuration: data.standardDuration ?? null,
      })
      .returning();
  }

  updateContentType(companyId: string, id: string, data: UpdateContentTypeData, tx: TenantTx) {
    const patch: Partial<typeof contentTypes.$inferInsert> = { updatedAt: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.code !== undefined) patch.code = normalizeOptional(data.code);
    if (data.description !== undefined) patch.description = data.description;
    if (data.defaultWorkflowTemplateId !== undefined)
      patch.defaultWorkflowTemplateId = data.defaultWorkflowTemplateId;
    if (data.defaultEvaluationTemplateId !== undefined)
      patch.defaultEvaluationTemplateId = data.defaultEvaluationTemplateId;
    if (data.targetPlatform !== undefined) patch.targetPlatform = normalizeOptional(data.targetPlatform);
    if (data.standardDuration !== undefined) patch.standardDuration = data.standardDuration;
    if (data.status !== undefined) patch.status = data.status;
    return tx
      .update(contentTypes)
      .set(patch)
      .where(and(eq(contentTypes.companyId, companyId), eq(contentTypes.id, id), isNull(contentTypes.deletedAt)))
      .returning();
  }

  softDeleteContentType(companyId: string, id: string, tx: TenantTx) {
    return tx
      .update(contentTypes)
      .set({ deletedAt: new Date() })
      .where(and(eq(contentTypes.companyId, companyId), eq(contentTypes.id, id), isNull(contentTypes.deletedAt)))
      .returning({ id: contentTypes.id });
  }
}
