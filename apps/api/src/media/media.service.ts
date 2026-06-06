import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type {
  AddChannelMemberRequest,
  AddProjectChannelRequest,
  CreateChannelRequest,
  CreateContentItemRequest,
  CreateProjectRequest,
  UpdateChannelMemberRequest,
  UpdateChannelRequest,
} from '@mediaos/contracts';
import { DatabaseService } from '../db/db.service';
import { AuditService } from '../events/audit.service';
import { MediaRepository, type ListChannelsFilter } from './media.repository';
import { ChatService } from '../chat/chat.service';

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as Record<string, unknown>)['code'] === PG_UNIQUE_VIOLATION
  );
}

interface RequestUser {
  id: string;
  companyId: string;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly repo: MediaRepository,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly chat: ChatService,
  ) {}

  // ── Platforms ──────────────────────────────────────────────────────────────

  listPlatforms(companyId: string) {
    return this.repo.listPlatforms(companyId);
  }

  // ── Channels ────────────────────────────────────────────────────────────────

  listChannels(companyId: string, filters: ListChannelsFilter) {
    return this.repo.listChannels(companyId, filters);
  }

  async getChannel(companyId: string, id: string) {
    const [channel] = await this.repo.findChannelById(companyId, id);
    if (!channel) throw new NotFoundException(`Channel not found: ${id}`);
    return channel;
  }

  async createChannel(user: RequestUser, dto: CreateChannelRequest) {
    try {
      const channel = await this.db.withTenant(user.companyId, async (tx) => {
        const rows = await this.repo.createChannel(
          user.companyId,
          {
            name: dto.name,
            platform: dto.platform,
            code: dto.code ?? null,
            url: dto.url ?? null,
            language: dto.language ?? null,
            targetCountry: dto.targetCountry ?? null,
            niche: dto.niche ?? null,
            channelManagerId: dto.channelManagerId ?? null,
            primaryTeamId: dto.primaryTeamId ?? null,
          },
          tx,
        );
        if (!rows[0]) throw new InternalServerErrorException('Failed to create channel');
        await this.audit.record(tx, {
          action: 'ChannelCreated',
          objectType: 'channel',
          objectId: rows[0].id,
          actorUserId: user.id,
          after: { name: rows[0].name, platform: rows[0].platform },
        });
        return rows[0];
      });
      return channel;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Channel name or code already exists');
      throw err;
    }
  }

  async updateChannel(user: RequestUser, id: string, dto: UpdateChannelRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const rows = await this.repo.updateChannel(user.companyId, id, dto, tx);
        if (!rows[0]) throw new NotFoundException(`Channel not found: ${id}`);
        await this.audit.record(tx, {
          action: 'ChannelUpdated',
          objectType: 'channel',
          objectId: id,
          actorUserId: user.id,
          after: { changed: Object.keys(dto) },
        });
        return rows[0];
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Channel name or code already exists');
      throw err;
    }
  }

  async deleteChannel(user: RequestUser, id: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.softDeleteChannel(user.companyId, id, tx);
      if (rows.length === 0) throw new NotFoundException(`Channel not found: ${id}`);
      await this.audit.record(tx, {
        action: 'ChannelDeleted',
        objectType: 'channel',
        objectId: id,
        actorUserId: user.id,
      });
    });
  }

  // ── Channel members ──────────────────────────────────────────────────────

  async listChannelMembers(companyId: string, channelId: string) {
    const [channel] = await this.repo.findChannelById(companyId, channelId);
    if (!channel) throw new NotFoundException(`Channel not found: ${channelId}`);
    return this.repo.listChannelMembers(companyId, channelId);
  }

  async addChannelMember(user: RequestUser, channelId: string, dto: AddChannelMemberRequest) {
    const [channel] = await this.repo.findChannelById(user.companyId, channelId);
    if (!channel) throw new NotFoundException(`Channel not found: ${channelId}`);
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const rows = await this.repo.addChannelMember(
          user.companyId,
          channelId,
          {
            userId: dto.userId,
            roleInChannel: dto.roleInChannel ?? null,
            permissionLevel: dto.permissionLevel ?? null,
          },
          tx,
        );
        if (!rows[0]) throw new InternalServerErrorException('Failed to add channel member');
        await this.audit.record(tx, {
          action: 'ChannelMemberAdded',
          objectType: 'channel_member',
          objectId: rows[0].id,
          actorUserId: user.id,
          after: { channelId, userId: dto.userId, roleInChannel: dto.roleInChannel ?? null },
        });
        return rows[0];
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('User already a member of this channel');
      throw err;
    }
  }

  async updateChannelMember(
    user: RequestUser,
    channelId: string,
    memberId: string,
    dto: UpdateChannelMemberRequest,
  ) {
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.updateChannelMember(user.companyId, channelId, memberId, dto, tx);
      if (!rows[0]) throw new NotFoundException(`Channel member not found: ${memberId}`);
      await this.audit.record(tx, {
        action: 'ChannelMemberUpdated',
        objectType: 'channel_member',
        objectId: memberId,
        actorUserId: user.id,
        after: { changed: Object.keys(dto) },
      });
      return rows[0];
    });
  }

  async removeChannelMember(user: RequestUser, channelId: string, memberId: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.removeChannelMember(user.companyId, channelId, memberId, tx);
      if (rows.length === 0) throw new NotFoundException(`Channel member not found: ${memberId}`);
      await this.audit.record(tx, {
        action: 'ChannelMemberRemoved',
        objectType: 'channel_member',
        objectId: memberId,
        actorUserId: user.id,
      });
    });
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  listProjects(companyId: string) {
    return this.repo.listProjects(companyId);
  }

  async getProject(companyId: string, projectId: string) {
    const project = await this.repo.findProjectById(companyId, projectId);
    if (!project) throw new NotFoundException(`Project not found: ${projectId}`);
    return project;
  }

  async createProject(companyId: string, dto: CreateProjectRequest, creatorId: string) {
    let project: Awaited<ReturnType<MediaRepository['createProject']>>[0];
    try {
      const rows = await this.repo.createProject(companyId, {
        name: dto.name,
        orgUnitId: dto.orgUnitId ?? null,
      });
      if (!rows[0]) throw new InternalServerErrorException('Failed to create project');
      project = rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Project name already exists');
      throw err;
    }

    // Auto-tạo phòng chat project (non-critical — lỗi không rollback project)
    await this.chat.ensureProjectRoom(companyId, project.id, project.name, creatorId);

    return project;
  }

  async addProjectChannel(companyId: string, projectId: string, dto: AddProjectChannelRequest) {
    try {
      const rows = await this.repo.addProjectChannel(companyId, projectId, dto.channelId);
      if (!rows[0]) throw new InternalServerErrorException('Failed to link channel to project');
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Channel already linked to this project');
      throw err;
    }
  }

  async removeProjectChannel(companyId: string, projectId: string, channelId: string) {
    const rows = await this.repo.removeProjectChannel(companyId, projectId, channelId);
    if (rows.length === 0) throw new NotFoundException('Channel not linked to this project');
  }

  listContent(companyId: string, projectId: string) {
    return this.repo.listContent(companyId, projectId);
  }

  async createContent(companyId: string, projectId: string, dto: CreateContentItemRequest) {
    const rows = await this.repo.createContent(companyId, projectId, {
      title: dto.title,
      contentType: dto.contentType,
    });
    if (!rows[0]) throw new InternalServerErrorException('Failed to create content item');
    return rows[0];
  }
}
