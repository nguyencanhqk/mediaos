import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { chatMessages, chatRoomMembers, chatRooms } from "../db/schema/communication";
import { users } from "../db/schema/users";

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
        .where(
          and(
            eq(chatRooms.companyId, companyId),
            eq(chatRoomMembers.userId, userId),
          ),
        )
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
        .where(
          and(eq(chatRooms.companyId, companyId), eq(chatRooms.refId, projectId)),
        )
        .limit(1),
    );
  }

  createRoom(
    companyId: string,
    data: { name: string; roomType: string; refId?: string | null },
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(chatRooms)
        .values({
          companyId,
          name: data.name,
          roomType: data.roomType,
          refId: data.refId ?? null,
        })
        .returning(),
    );
  }

  // ─── Members ─────────────────────────────────────────────────────────────────

  addMember(companyId: string, roomId: string, userId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(chatRoomMembers)
        .values({ companyId, roomId, userId })
        .onConflictDoNothing()
        .returning(),
    );
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

  // ─── Messages ────────────────────────────────────────────────────────────────

  findMessages(companyId: string, roomId: string, limit = 50) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          id: chatMessages.id,
          companyId: chatMessages.companyId,
          roomId: chatMessages.roomId,
          senderId: chatMessages.senderId,
          senderName: users.fullName,
          body: chatMessages.body,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .innerJoin(users, eq(chatMessages.senderId, users.id))
        .where(
          and(
            eq(chatMessages.companyId, companyId),
            eq(chatMessages.roomId, roomId),
          ),
        )
        .orderBy(asc(chatMessages.createdAt))
        .limit(limit),
    );
  }

  createMessage(
    companyId: string,
    data: { roomId: string; senderId: string; body: string },
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(chatMessages)
        .values({
          companyId,
          roomId: data.roomId,
          senderId: data.senderId,
          body: data.body,
        })
        .returning(),
    );
  }
}
