import { Injectable } from "@nestjs/common";
import { and, asc, eq, desc } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { chatMessages, chatRoomMembers, chatRooms } from "../db/schema/communication";
import { users } from "../db/schema/users";

/** Hàng message kèm senderName (join users) — nguồn để map ChatMessageDto (REST + WS dùng chung). */
export interface ChatMessageRow {
  id: string;
  companyId: string;
  roomId: string;
  senderId: string;
  senderName: string | null;
  body: string;
  messageType: string;
  fileUrl: string | null;
  fileName: string | null;
  mentions: string[];
  pinnedAt: Date | null;
  pinnedBy: string | null;
  seq: number;
  createdAt: Date;
}

const messageColumns = {
  id: chatMessages.id,
  companyId: chatMessages.companyId,
  roomId: chatMessages.roomId,
  senderId: chatMessages.senderId,
  senderName: users.fullName,
  body: chatMessages.body,
  messageType: chatMessages.messageType,
  fileUrl: chatMessages.fileUrl,
  fileName: chatMessages.fileName,
  mentions: chatMessages.mentions,
  pinnedAt: chatMessages.pinnedAt,
  pinnedBy: chatMessages.pinnedBy,
  seq: chatMessages.seq,
  createdAt: chatMessages.createdAt,
} as const;

@Injectable()
export class ChatRepository {
  constructor(private readonly db: DatabaseService) {}

  // ─── Rooms ───────────────────────────────────────────────────────────────────

  findRoomsByUser(companyId: string, userId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          id: chatRooms.id,
          companyId: chatRooms.companyId,
          refId: chatRooms.refId,
          roomType: chatRooms.roomType,
          name: chatRooms.name,
          createdAt: chatRooms.createdAt,
        })
        .from(chatRooms)
        .innerJoin(chatRoomMembers, eq(chatRooms.id, chatRoomMembers.roomId))
        .where(and(eq(chatRooms.companyId, companyId), eq(chatRoomMembers.userId, userId)))
        .orderBy(desc(chatRooms.createdAt)),
    );
  }

  findRoomById(companyId: string, roomId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(chatRooms)
        .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.id, roomId)))
        .limit(1),
    );
  }

  findRoomByProject(companyId: string, projectId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(chatRooms)
        .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.refId, projectId)))
        .limit(1),
    );
  }

  /** G10-2 auto-room: tìm phòng theo channel (idempotent — partial-unique chat_rooms_channel_uq). */
  findRoomByChannel(companyId: string, channelId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(chatRooms)
        .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.channelId, channelId)))
        .limit(1),
    );
  }

  /** G10-2 auto-room: tìm phòng theo org_unit (idempotent — partial-unique chat_rooms_org_unit_uq). */
  findRoomByOrgUnit(companyId: string, orgUnitId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(chatRooms)
        .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.orgUnitId, orgUnitId)))
        .limit(1),
    );
  }

  createRoom(
    companyId: string,
    data: {
      name: string;
      roomType: string;
      refId?: string | null;
      channelId?: string | null;
      orgUnitId?: string | null;
      directKey?: string | null;
      createdBy?: string | null;
    },
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(chatRooms)
        .values({
          companyId,
          name: data.name,
          roomType: data.roomType,
          refId: data.refId ?? null,
          channelId: data.channelId ?? null,
          orgUnitId: data.orgUnitId ?? null,
          directKey: data.directKey ?? null,
          createdBy: data.createdBy ?? null,
        })
        .onConflictDoNothing()
        .returning(),
    );
  }

  /** DM 1-1 idempotent qua direct_key (unique partial idx). Trả về phòng (tạo mới hoặc đã có). */
  async ensureDirectRoom(
    companyId: string,
    directKey: string,
    name: string,
    createdBy: string,
    memberIds: readonly string[],
  ) {
    return this.db.withTenant(companyId, async (tx) => {
      const existing = await tx
        .select()
        .from(chatRooms)
        .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.directKey, directKey)))
        .limit(1);
      if (existing[0]) return existing[0];

      const inserted = await tx
        .insert(chatRooms)
        .values({ companyId, name, roomType: "direct", directKey, createdBy })
        .onConflictDoNothing()
        .returning();

      // onConflict (race) → re-select để lấy phòng đối thủ vừa tạo.
      const room =
        inserted[0] ??
        (
          await tx
            .select()
            .from(chatRooms)
            .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.directKey, directKey)))
            .limit(1)
        )[0];
      if (!room) return null;

      for (const userId of memberIds) {
        await tx
          .insert(chatRoomMembers)
          .values({ companyId, roomId: room.id, userId })
          .onConflictDoNothing();
      }
      return room;
    });
  }

  // ─── Members ─────────────────────────────────────────────────────────────────

  addMember(companyId: string, roomId: string, userId: string, role = "member") {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(chatRoomMembers)
        .values({ companyId, roomId, userId, role })
        .onConflictDoNothing()
        .returning(),
    );
  }

  /**
   * G10-2 auto-room: thêm nhiều member 1 lần (bulk) — bỏ qua trùng (onConflictDoNothing) ⇒ idempotent
   * khi gọi lại. Mọi insert qua withTenant(companyId) ⇒ RLS+FORCE company_id chặn ghi chéo tenant.
   * userIds rỗng → no-op (không query). Dedupe trước insert để tránh va unique trong cùng 1 batch.
   */
  addMembers(companyId: string, roomId: string, userIds: readonly string[]) {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return Promise.resolve([] as { id: string }[]);
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(chatRoomMembers)
        .values(unique.map((userId) => ({ companyId, roomId, userId })))
        .onConflictDoNothing()
        .returning({ id: chatRoomMembers.id }),
    );
  }

  /** Thêm member trong tx có sẵn (đồng commit với audit). */
  addMemberTx(tx: TenantTx, companyId: string, roomId: string, userId: string, role: string) {
    return tx
      .insert(chatRoomMembers)
      .values({ companyId, roomId, userId, role })
      .onConflictDoNothing()
      .returning();
  }

  removeMemberTx(tx: TenantTx, companyId: string, roomId: string, userId: string) {
    return tx
      .delete(chatRoomMembers)
      .where(
        and(
          eq(chatRoomMembers.companyId, companyId),
          eq(chatRoomMembers.roomId, roomId),
          eq(chatRoomMembers.userId, userId),
        ),
      )
      .returning({ id: chatRoomMembers.id });
  }

  isMember(companyId: string, roomId: string, userId: string) {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx
        .select({ id: chatRoomMembers.id })
        .from(chatRoomMembers)
        .where(
          and(
            eq(chatRoomMembers.companyId, companyId),
            eq(chatRoomMembers.roomId, roomId),
            eq(chatRoomMembers.userId, userId),
          ),
        )
        .limit(1);
      return rows.length > 0;
    });
  }

  /** Vai trò của user trong phòng (member/admin) hoặc null nếu không phải member. */
  getMembership(companyId: string, roomId: string, userId: string) {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx
        .select({ role: chatRoomMembers.role })
        .from(chatRoomMembers)
        .where(
          and(
            eq(chatRoomMembers.companyId, companyId),
            eq(chatRoomMembers.roomId, roomId),
            eq(chatRoomMembers.userId, userId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    });
  }

  listMembers(companyId: string, roomId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          id: chatRoomMembers.id,
          roomId: chatRoomMembers.roomId,
          userId: chatRoomMembers.userId,
          role: chatRoomMembers.role,
          joinedAt: chatRoomMembers.joinedAt,
        })
        .from(chatRoomMembers)
        .where(and(eq(chatRoomMembers.companyId, companyId), eq(chatRoomMembers.roomId, roomId)))
        .orderBy(asc(chatRoomMembers.joinedAt)),
    );
  }

  // ─── Messages ────────────────────────────────────────────────────────────────

  findMessages(companyId: string, roomId: string, limit = 50): Promise<ChatMessageRow[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select(messageColumns)
        .from(chatMessages)
        .innerJoin(users, eq(chatMessages.senderId, users.id))
        .where(and(eq(chatMessages.companyId, companyId), eq(chatMessages.roomId, roomId)))
        .orderBy(asc(chatMessages.seq))
        .limit(limit),
    );
  }

  /** Insert tin nhắn + trả lại hàng kèm senderName (DTO parity). */
  createMessage(
    companyId: string,
    data: {
      roomId: string;
      senderId: string;
      body: string;
      messageType?: string;
      fileUrl?: string | null;
      fileName?: string | null;
      mentions?: string[];
    },
  ): Promise<ChatMessageRow[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const inserted = await tx
        .insert(chatMessages)
        .values({
          companyId,
          roomId: data.roomId,
          senderId: data.senderId,
          body: data.body,
          messageType: data.messageType ?? "text",
          fileUrl: data.fileUrl ?? null,
          fileName: data.fileName ?? null,
          mentions: data.mentions ?? [],
        })
        .returning({ id: chatMessages.id });
      const id = inserted[0]?.id;
      if (!id) return [];
      return this.selectMessageById(tx, companyId, id);
    });
  }

  /** Ghim/bỏ ghim (chỉ UPDATE pinned_at, pinned_by — append-only body/sender). tx-aware để đồng audit. */
  async pinMessageTx(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    messageId: string,
    userId: string | null,
    pin: boolean,
  ): Promise<ChatMessageRow[]> {
    const updated = await tx
      .update(chatMessages)
      .set({ pinnedAt: pin ? new Date() : null, pinnedBy: pin ? userId : null })
      .where(
        and(
          eq(chatMessages.companyId, companyId),
          eq(chatMessages.roomId, roomId),
          eq(chatMessages.id, messageId),
        ),
      )
      .returning({ id: chatMessages.id });
    if (!updated[0]) return [];
    return this.selectMessageById(tx, companyId, messageId);
  }

  private selectMessageById(
    tx: TenantTx,
    companyId: string,
    messageId: string,
  ): Promise<ChatMessageRow[]> {
    return tx
      .select(messageColumns)
      .from(chatMessages)
      .innerJoin(users, eq(chatMessages.senderId, users.id))
      .where(and(eq(chatMessages.companyId, companyId), eq(chatMessages.id, messageId)))
      .limit(1);
  }
}
