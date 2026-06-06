import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../db/db.service';
import { channels, contentItems, platforms, projectChannels, projects } from '../db/schema';

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

/** Normalize '' → NULL ở boundary (partial unique code dùng `code IS NOT NULL`). */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

@Injectable()
export class MediaRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Channels ────────────────────────────────────────────────────────────

  listChannels(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(channels)
        .where(and(eq(channels.companyId, companyId), isNull(channels.deletedAt)))
        .orderBy(channels.name),
    );
  }

  createChannel(companyId: string, data: CreateChannelData) {
    return this.db.withTenant(companyId, async (tx) => {
      // Resolve platform_id từ catalog global (platforms không RLS, app có GRANT SELECT).
      const [platform] = await tx
        .select({ id: platforms.id })
        .from(platforms)
        .where(eq(platforms.code, data.platform))
        .limit(1);
      if (!platform) {
        throw new BadRequestException(`Unknown platform code: ${data.platform}`);
      }
      return tx
        .insert(channels)
        .values({
          companyId,
          name: data.name,
          platform: data.platform, // legacy text mirror platform_id (DROP ở 0029)
          platformId: platform.id,
          code: normalizeOptional(data.code),
          url: normalizeOptional(data.url),
          language: normalizeOptional(data.language),
          targetCountry: normalizeOptional(data.targetCountry),
          niche: normalizeOptional(data.niche),
          channelManagerId: data.channelManagerId ?? null,
          primaryTeamId: data.primaryTeamId ?? null,
        })
        .returning();
    });
  }

  // ── Projects ─────────────────────────────────────────────────────────────

  async listProjects(companyId: string) {
    return this.db.withTenant(companyId, async (tx) => {
      const projectRows = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.companyId, companyId), isNull(projects.deletedAt)))
        .orderBy(projects.name);

      const channelRows = await tx
        .select({
          projectId: projectChannels.projectId,
          id: channels.id,
          name: channels.name,
          platform: channels.platform,
        })
        .from(projectChannels)
        .innerJoin(channels, and(eq(projectChannels.channelId, channels.id), isNull(channels.deletedAt)))
        .where(eq(projectChannels.companyId, companyId));

      const channelsByProject = new Map<string, { id: string; name: string; platform: string }[]>();
      for (const c of channelRows) {
        const list = channelsByProject.get(c.projectId) ?? [];
        list.push({ id: c.id, name: c.name, platform: c.platform });
        channelsByProject.set(c.projectId, list);
      }

      return projectRows.map((p) => ({ ...p, channels: channelsByProject.get(p.id) ?? [] }));
    });
  }

  async findProjectById(companyId: string, projectId: string) {
    return this.db.withTenant(companyId, async (tx) => {
      const [project] = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.companyId, companyId), eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1);

      if (!project) return null;

      const channelRows = await tx
        .select({ id: channels.id, name: channels.name, platform: channels.platform })
        .from(projectChannels)
        .innerJoin(channels, and(eq(projectChannels.channelId, channels.id), isNull(channels.deletedAt)))
        .where(and(eq(projectChannels.companyId, companyId), eq(projectChannels.projectId, projectId)));

      return { ...project, channels: channelRows };
    });
  }

  createProject(companyId: string, data: { name: string; orgUnitId?: string | null }) {
    return this.db.withTenant(companyId, (tx) =>
      tx.insert(projects).values({ companyId, ...data, orgUnitId: data.orgUnitId ?? null }).returning(),
    );
  }

  addProjectChannel(companyId: string, projectId: string, channelId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx.insert(projectChannels).values({ companyId, projectId, channelId }).returning(),
    );
  }

  removeProjectChannel(companyId: string, projectId: string, channelId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .delete(projectChannels)
        .where(
          and(
            eq(projectChannels.companyId, companyId),
            eq(projectChannels.projectId, projectId),
            eq(projectChannels.channelId, channelId),
          ),
        )
        .returning(),
    );
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
