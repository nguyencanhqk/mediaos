import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { chatMessageSchema, type ChatMessageDto } from "@mediaos/contracts";
import { ChatRepository, type ChatMessageRow } from "./chat.repository";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly repo: ChatRepository,
    private readonly emitter: RealtimeEmitterService,
  ) {}

  /**
   * Masking layer DUY NHẤT cho message (CLAUDE.md §5): row DB (Date objects + cột nội bộ) → DTO chung
   * REST/WS qua `chatMessageSchema.parse()`. Zod strip key thừa ⇒ KHÔNG bao giờ rò cột không khai báo
   * ra client. Date → ISO string (schema yêu cầu `.datetime()`). REST trả + WS emit ĐỀU đi qua đây.
   */
  private toMessageDto(row: ChatMessageRow): ChatMessageDto {
    return chatMessageSchema.parse({
      ...row,
      pinnedAt: row.pinnedAt ? row.pinnedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    });
  }

  // ─── Rooms ───────────────────────────────────────────────────────────────────

  listRooms(companyId: string, userId: string) {
    return this.repo.findRoomsByUser(companyId, userId);
  }

  async getRoom(companyId: string, roomId: string, userId: string) {
    const rows = await this.repo.findRoomById(companyId, roomId);
    if (!rows[0]) throw new NotFoundException("Chat room not found");
    const isMember = await this.repo.isMember(companyId, roomId, userId);
    if (!isMember) throw new ForbiddenException("Not a member of this room");
    return rows[0];
  }

  async createRoom(
    companyId: string,
    userId: string,
    data: { name: string; roomType: string; refId?: string | null },
  ) {
    const rows = await this.repo.createRoom(companyId, data);
    if (!rows[0]) throw new InternalServerErrorException("Failed to create chat room");
    await this.repo.addMember(companyId, rows[0].id, userId);
    return rows[0];
  }

  /** Tự động tạo phòng chat cho project (idempotent — bỏ qua nếu đã tồn tại). */
  async ensureProjectRoom(
    companyId: string,
    projectId: string,
    projectName: string,
    creatorId: string,
  ) {
    try {
      const existing = await this.repo.findRoomByProject(companyId, projectId);
      if (existing[0]) return existing[0];

      const rows = await this.repo.createRoom(companyId, {
        name: projectName,
        roomType: "project",
        refId: projectId,
      });
      if (!rows[0]) return null;

      await this.repo.addMember(companyId, rows[0].id, creatorId);
      return rows[0];
    } catch (err) {
      this.logger.error("Failed to ensure project chat room", err);
      return null;
    }
  }

  /**
   * G10-2 — auto-tạo group chat cho 1 KÊNH (idempotent qua partial-unique chat_rooms_channel_uq).
   * Best-effort (parity ensureProjectRoom): lỗi room KHÔNG được rollback create channel ⇒ try/catch
   * log→return null (KHÔNG throw). memberIds = thành viên hiện tại của kênh (creator + channel_members).
   * Mọi truy vấn qua withTenant(companyId) ⇒ RLS chặn ghi/đọc chéo tenant.
   */
  async ensureChannelRoom(
    companyId: string,
    channelId: string,
    name: string,
    creatorId: string,
    memberIds: readonly string[] = [],
  ) {
    try {
      const existing = await this.repo.findRoomByChannel(companyId, channelId);
      if (existing[0]) return existing[0];

      const rows = await this.repo.createRoom(companyId, {
        name,
        roomType: "channel",
        channelId,
        createdBy: creatorId,
      });
      // onConflict (race 2 request cùng tạo) → re-select để lấy phòng đối thủ vừa tạo (chống TOCTOU).
      const room = rows[0] ?? (await this.repo.findRoomByChannel(companyId, channelId))[0];
      if (!room) return null;

      await this.repo.addMembers(companyId, room.id, [creatorId, ...memberIds]);
      return room;
    } catch (err) {
      this.logger.error("Failed to ensure channel chat room", err);
      return null;
    }
  }

  /**
   * G10-2 — auto-tạo group chat cho 1 PHÒNG BAN/org_unit (idempotent qua chat_rooms_org_unit_uq).
   * Best-effort như ensureChannelRoom. memberIds = thành viên hiện tại của phòng ban (head +
   * employee_profiles.org_unit_id). Lúc TẠO org_unit thường chưa có nhân sự ⇒ room chỉ có head (hợp lệ).
   */
  async ensureOrgUnitRoom(
    companyId: string,
    orgUnitId: string,
    name: string,
    memberIds: readonly string[] = [],
  ) {
    try {
      const existing = await this.repo.findRoomByOrgUnit(companyId, orgUnitId);
      if (existing[0]) return existing[0];

      const rows = await this.repo.createRoom(companyId, {
        name,
        roomType: "department",
        orgUnitId,
      });
      const room = rows[0] ?? (await this.repo.findRoomByOrgUnit(companyId, orgUnitId))[0];
      if (!room) return null;

      await this.repo.addMembers(companyId, room.id, memberIds);
      return room;
    } catch (err) {
      this.logger.error("Failed to ensure org unit chat room", err);
      return null;
    }
  }

  // ─── Messages ────────────────────────────────────────────────────────────────

  /**
   * Quyền vào room cho WS (gateway gọi TRƯỚC khi join/broadcast). Fail-closed: chỉ member mới true.
   * RLS đã ép tenant ở DB (`isMember` qua `withTenant`) ⇒ user tenant A KHÔNG bao giờ thấy room tenant B.
   */
  canAccessRoom(companyId: string, roomId: string, userId: string): Promise<boolean> {
    return this.repo.isMember(companyId, roomId, userId);
  }

  async getMessages(companyId: string, roomId: string, userId: string): Promise<ChatMessageDto[]> {
    const isMember = await this.repo.isMember(companyId, roomId, userId);
    if (!isMember) throw new ForbiddenException("Not a member of this room");
    const rows = await this.repo.findMessages(companyId, roomId);
    // Parity REST/WS: cùng masking layer (toMessageDto) — KHÔNG trả row DB thẳng.
    return rows.map((r) => this.toMessageDto(r));
  }

  /**
   * Gửi tin nhắn (dùng chung REST controller + WS gateway). Trả DTO ĐÃ mask (chatMessageSchema.parse).
   * Sau khi insert thành công → emit `chat:message` qua RealtimeEmitterService (best-effort, KHÔNG throw —
   * realtime hỏng không được làm hỏng giao dịch đã commit; FE còn poll REST). Payload emit = ĐÚNG DTO này.
   */
  async sendMessage(
    companyId: string,
    roomId: string,
    userId: string,
    input: { body: string; mentions?: string[] },
  ): Promise<ChatMessageDto> {
    const isMember = await this.repo.isMember(companyId, roomId, userId);
    if (!isMember) throw new ForbiddenException("Not a member of this room");

    const rows = await this.repo.createMessage(companyId, {
      roomId,
      senderId: userId,
      body: input.body,
      mentions: input.mentions ?? [],
    });
    if (!rows[0]) throw new InternalServerErrorException("Failed to send message");

    const dto = this.toMessageDto(rows[0]);
    this.emitter.emitChatMessage(companyId, roomId, dto);
    return dto;
  }
}
