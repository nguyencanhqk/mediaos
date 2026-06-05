import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../db/db.service';
import { channels, contentItems, projectChannels, projects } from '../db/schema';

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

  createChannel(companyId: string, data: { name: string; platform: string }) {
    return this.db.withTenant(companyId, (tx) =>
      tx.insert(channels).values({ companyId, ...data }).returning(),
    );
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
