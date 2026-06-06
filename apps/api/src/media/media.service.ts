import { ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import type {
  AddProjectChannelRequest,
  CreateChannelRequest,
  CreateContentItemRequest,
  CreateProjectRequest,
} from '@mediaos/contracts';
import { MediaRepository } from './media.repository';
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

@Injectable()
export class MediaService {
  constructor(
    private readonly repo: MediaRepository,
    private readonly chat: ChatService,
  ) {}

  listChannels(companyId: string) {
    return this.repo.listChannels(companyId);
  }

  async createChannel(companyId: string, dto: CreateChannelRequest) {
    try {
      const rows = await this.repo.createChannel(companyId, {
        name: dto.name,
        platform: dto.platform,
        code: dto.code ?? null,
        url: dto.url ?? null,
        language: dto.language ?? null,
        targetCountry: dto.targetCountry ?? null,
        niche: dto.niche ?? null,
        channelManagerId: dto.channelManagerId ?? null,
        primaryTeamId: dto.primaryTeamId ?? null,
      });
      if (!rows[0]) throw new InternalServerErrorException('Failed to create channel');
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Channel name already exists');
      throw err;
    }
  }

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
