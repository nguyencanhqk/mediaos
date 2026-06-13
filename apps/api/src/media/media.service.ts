import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type {
  AddChannelMemberRequest,
  CreateChannelRequest,
  UpdateChannelHealthRequest,
  UpdateChannelMemberRequest,
  UpdateChannelRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { ChatService } from "../chat/chat.service";
import { MediaRepository, type ListChannelsFilter } from "./media.repository";

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as Record<string, unknown>)["code"] === PG_UNIQUE_VIOLATION
  );
}

/** numeric/decimal contract (number) → Drizzle numeric (string). undefined → bỏ qua patch; null → clear. */
function numToStr(v: number | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!Number.isFinite(v)) throw new BadRequestException(`Invalid numeric value: ${v}`);
  return String(v);
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
    let channel: Awaited<ReturnType<MediaRepository["createChannel"]>>[number];
    try {
      channel = await this.db.withTenant(user.companyId, async (tx) => {
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
        if (!rows[0]) throw new InternalServerErrorException("Failed to create channel");
        await this.audit.record(tx, {
          action: "ChannelCreated",
          objectType: "channel",
          objectId: rows[0].id,
          actorUserId: user.id,
          after: { name: rows[0].name, platform: rows[0].platform },
        });
        return rows[0];
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException("Channel name or code already exists");
      throw err;
    }

    // G10-2 — auto-tạo group chat cho kênh SAU khi tx commit (parity ProjectsService: non-critical,
    // lỗi room KHÔNG rollback channel). members = creator + channel_members hiện tại (thường rỗng lúc tạo).
    const memberRows = await this.repo.listChannelMembers(user.companyId, channel.id);
    await this.chat.ensureChannelRoom(
      user.companyId,
      channel.id,
      channel.name,
      user.id,
      memberRows.map((m) => m.userId),
    );

    return channel;
  }

  async updateChannel(user: RequestUser, id: string, dto: UpdateChannelRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const rows = await this.repo.updateChannel(user.companyId, id, dto, tx);
        if (!rows[0]) throw new NotFoundException(`Channel not found: ${id}`);
        await this.audit.record(tx, {
          action: "ChannelUpdated",
          objectType: "channel",
          objectId: id,
          actorUserId: user.id,
          after: { changed: Object.keys(dto) },
        });
        return rows[0];
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException("Channel name or code already exists");
      throw err;
    }
  }

  /** G6-5 — cập nhật sức khỏe kênh (health_status/score/note) + audit cùng tx. healthScore numeric(5,2) → string. */
  async updateChannelHealth(user: RequestUser, id: string, dto: UpdateChannelHealthRequest) {
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.updateChannelHealth(
        user.companyId,
        id,
        {
          healthStatus: dto.healthStatus,
          healthScore: numToStr(dto.healthScore),
          healthNote: dto.healthNote,
        },
        tx,
      );
      if (!rows[0]) throw new NotFoundException(`Channel not found: ${id}`);
      await this.audit.record(tx, {
        action: "ChannelHealthUpdated",
        objectType: "channel",
        objectId: id,
        actorUserId: user.id,
        after: { changed: Object.keys(dto) },
      });
      return rows[0];
    });
  }

  async deleteChannel(user: RequestUser, id: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.softDeleteChannel(user.companyId, id, tx);
      if (rows.length === 0) throw new NotFoundException(`Channel not found: ${id}`);
      await this.audit.record(tx, {
        action: "ChannelDeleted",
        objectType: "channel",
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
        if (!rows[0]) throw new InternalServerErrorException("Failed to add channel member");
        await this.audit.record(tx, {
          action: "ChannelMemberAdded",
          objectType: "channel_member",
          objectId: rows[0].id,
          actorUserId: user.id,
          after: { channelId, userId: dto.userId, roleInChannel: dto.roleInChannel ?? null },
        });
        return rows[0];
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException("User already a member of this channel");
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
      const rows = await this.repo.updateChannelMember(
        user.companyId,
        channelId,
        memberId,
        dto,
        tx,
      );
      if (!rows[0]) throw new NotFoundException(`Channel member not found: ${memberId}`);
      await this.audit.record(tx, {
        action: "ChannelMemberUpdated",
        objectType: "channel_member",
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
        action: "ChannelMemberRemoved",
        objectType: "channel_member",
        objectId: memberId,
        actorUserId: user.id,
      });
    });
  }
}
