import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, ilike, isNull } from 'drizzle-orm';
import { DatabaseService, type TenantTx } from '../db/db.service';
import { channelMembers, channels, contentItems, platforms } from '../db/schema';

/** Input tạo kênh (đã validate ở DTO; platform = code khớp catalog). */
export interface CreateChannelData {
  name: string;
  platform: string;
  code?: string | null;
  url?: string | null;
  language?: string | null;
  targetCountry?: string | null;
  niche?: string | null;
  channelManagerId?: string | null;
  primaryTeamId?: string | null;
}

/** Patch kênh — chỉ field có mặt mới đổi (partial). */
export interface UpdateChannelData {
  name?: string;
  platform?: string;
  code?: string | null;
  url?: string | null;
  language?: string | null;
  targetCountry?: string | null;
  niche?: string | null;
  channelManagerId?: string | null;
  primaryTeamId?: string | null;
  status?: string;
}

export interface ListChannelsFilter {
  platform?: string;
  status?: string;
  managerId?: string;
  niche?: string;
  q?: string;
}

export interface AddChannelMemberData {
  userId: string;
  roleInChannel?: string | null;
  permissionLevel?: string | null;
}

export interface UpdateChannelMemberData {
  roleInChannel?: string | null;
  permissionLevel?: string | null;
  status?: string;
}

/** Normalize '' → NULL ở boundary (partial unique code dùng `code IS NOT NULL`). */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

@Injectable()
export class MediaRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Platforms (catalog global, read-only) ─────────────────────────────────

  /** companyId chỉ để mở withTenant; platforms KHÔNG RLS (app có GRANT SELECT). */
  listPlatforms(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx.select().from(platforms).orderBy(platforms.name),
    );
  }

  /** Resolve platform_id từ code trong cùng tx (catalog global). */
  private async resolvePlatformId(tx: TenantTx, code: string): Promise<string> {
    const [platform] = await tx
      .select({ id: platforms.id })
      .from(platforms)
      .where(eq(platforms.code, code))
      .limit(1);
    if (!platform) {
      throw new BadRequestException(`Unknown platform code: ${code}`);
    }
    return platform.id;
  }

  // ── Channels ───────────────────────────────────────────────────────────────

  listChannels(companyId: string, filters: ListChannelsFilter = {}) {
    return this.db.withTenant(companyId, (tx) => {
      const conds = [eq(channels.companyId, companyId), isNull(channels.deletedAt)];
      if (filters.platform) conds.push(eq(channels.platform, filters.platform));
      if (filters.status) conds.push(eq(channels.status, filters.status));
      if (filters.managerId) conds.push(eq(channels.channelManagerId, filters.managerId));
      if (filters.niche) conds.push(eq(channels.niche, filters.niche));
      if (filters.q) conds.push(ilike(channels.name, `%${filters.q}%`));
      return tx.select().from(channels).where(and(...conds)).orderBy(channels.name);
    });
  }

  findChannelById(companyId: string, id: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(channels)
        .where(and(eq(channels.companyId, companyId), eq(channels.id, id), isNull(channels.deletedAt)))
        .limit(1),
    );
  }

  /** Tạo kênh — resolve platform_id + mirror legacy `platform` text. Chạy trong tx của service (audit cùng commit). */
  async createChannel(companyId: string, data: CreateChannelData, tx: TenantTx) {
    const platformId = await this.resolvePlatformId(tx, data.platform);
    return tx
      .insert(channels)
      .values({
        companyId,
        name: data.name,
        platform: data.platform, // legacy text mirror platform_id (DROP ở 0029)
        platformId,
        code: normalizeOptional(data.code),
        url: normalizeOptional(data.url),
        language: normalizeOptional(data.language),
        targetCountry: normalizeOptional(data.targetCountry),
        niche: normalizeOptional(data.niche),
        channelManagerId: data.channelManagerId ?? null,
        primaryTeamId: data.primaryTeamId ?? null,
      })
      .returning();
  }

  async updateChannel(companyId: string, id: string, data: UpdateChannelData, tx: TenantTx) {
    const patch: Partial<typeof channels.$inferInsert> = { updatedAt: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.platform !== undefined) {
      patch.platform = data.platform;
      patch.platformId = await this.resolvePlatformId(tx, data.platform);
    }
    if (data.code !== undefined) patch.code = normalizeOptional(data.code);
    if (data.url !== undefined) patch.url = normalizeOptional(data.url);
    if (data.language !== undefined) patch.language = normalizeOptional(data.language);
    if (data.targetCountry !== undefined) patch.targetCountry = normalizeOptional(data.targetCountry);
    if (data.niche !== undefined) patch.niche = normalizeOptional(data.niche);
    if (data.channelManagerId !== undefined) patch.channelManagerId = data.channelManagerId;
    if (data.primaryTeamId !== undefined) patch.primaryTeamId = data.primaryTeamId;
    if (data.status !== undefined) patch.status = data.status;
    return tx
      .update(channels)
      .set(patch)
      .where(and(eq(channels.companyId, companyId), eq(channels.id, id), isNull(channels.deletedAt)))
      .returning();
  }

  softDeleteChannel(companyId: string, id: string, tx: TenantTx) {
    return tx
      .update(channels)
      .set({ deletedAt: new Date() })
      .where(and(eq(channels.companyId, companyId), eq(channels.id, id), isNull(channels.deletedAt)))
      .returning();
  }

  /** Health update (G6-5) — health_status/score/note. */
  updateChannelHealth(
    companyId: string,
    id: string,
    data: { healthStatus?: string | null; healthScore?: string | null; healthNote?: string | null },
    tx: TenantTx,
  ) {
    const patch: Partial<typeof channels.$inferInsert> = { updatedAt: new Date() };
    if (data.healthStatus !== undefined) patch.healthStatus = data.healthStatus;
    if (data.healthScore !== undefined) patch.healthScore = data.healthScore;
    if (data.healthNote !== undefined) patch.healthNote = data.healthNote;
    return tx
      .update(channels)
      .set(patch)
      .where(and(eq(channels.companyId, companyId), eq(channels.id, id), isNull(channels.deletedAt)))
      .returning();
  }

  // ── Channel members ──────────────────────────────────────────────────────

  listChannelMembers(companyId: string, channelId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.companyId, companyId),
            eq(channelMembers.channelId, channelId),
            isNull(channelMembers.deletedAt),
          ),
        )
        .orderBy(channelMembers.createdAt),
    );
  }

  addChannelMember(companyId: string, channelId: string, data: AddChannelMemberData, tx: TenantTx) {
    return tx
      .insert(channelMembers)
      .values({
        companyId,
        channelId,
        userId: data.userId,
        roleInChannel: data.roleInChannel ?? null,
        permissionLevel: data.permissionLevel ?? null,
        joinedAt: new Date(),
      })
      .returning();
  }

  updateChannelMember(
    companyId: string,
    channelId: string,
    memberId: string,
    data: UpdateChannelMemberData,
    tx: TenantTx,
  ) {
    const patch: Partial<typeof channelMembers.$inferInsert> = { updatedAt: new Date() };
    if (data.roleInChannel !== undefined) patch.roleInChannel = data.roleInChannel;
    if (data.permissionLevel !== undefined) patch.permissionLevel = data.permissionLevel;
    if (data.status !== undefined) patch.status = data.status;
    return tx
      .update(channelMembers)
      .set(patch)
      .where(
        and(
          eq(channelMembers.companyId, companyId),
          eq(channelMembers.channelId, channelId),
          eq(channelMembers.id, memberId),
          isNull(channelMembers.deletedAt),
        ),
      )
      .returning();
  }

  removeChannelMember(companyId: string, channelId: string, memberId: string, tx: TenantTx) {
    const now = new Date();
    return tx
      .update(channelMembers)
      .set({ deletedAt: now, leftAt: now })
      .where(
        and(
          eq(channelMembers.companyId, companyId),
          eq(channelMembers.channelId, channelId),
          eq(channelMembers.id, memberId),
          isNull(channelMembers.deletedAt),
        ),
      )
      .returning();
  }

  // ── Content ──────────────────────────────────────────────────────────────

  listContent(companyId: string, projectId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(contentItems)
        .where(
          and(
            eq(contentItems.companyId, companyId),
            eq(contentItems.projectId, projectId),
            isNull(contentItems.deletedAt),
          ),
        )
        .orderBy(contentItems.createdAt),
    );
  }

  createContent(
    companyId: string,
    projectId: string,
    data: { title: string; contentType: string },
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx.insert(contentItems).values({ companyId, projectId, ...data }).returning(),
    );
  }
}
