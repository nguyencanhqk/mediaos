import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ChatRepository } from "./chat.repository";

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly repo: ChatRepository) {}

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

  // ─── Messages ────────────────────────────────────────────────────────────────

  async getMessages(companyId: string, roomId: string, userId: string) {
    const isMember = await this.repo.isMember(companyId, roomId, userId);
    if (!isMember) throw new ForbiddenException("Not a member of this room");
    return this.repo.findMessages(companyId, roomId);
  }

  async sendMessage(
    companyId: string,
    roomId: string,
    userId: string,
    body: string,
  ) {
    const isMember = await this.repo.isMember(companyId, roomId, userId);
    if (!isMember) throw new ForbiddenException("Not a member of this room");

    const rows = await this.repo.createMessage(companyId, {
      roomId,
      senderId: userId,
      body,
    });
    if (!rows[0]) throw new InternalServerErrorException("Failed to send message");
    return rows[0];
  }
}
