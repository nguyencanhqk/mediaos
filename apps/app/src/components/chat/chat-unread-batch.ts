/**
 * S20-CHAT-UNREADNAV-1 (US-CHAT-NV-05) — «Đánh dấu đã đọc» một phòng và «Đọc hết» các phòng đang hiển thị.
 *
 * Không đổi BE: mỗi phòng là MỘT `POST /chat/rooms/:id/read` (CHAT-API-014) với `seq = lastMessageSeq` của
 * chính phòng đó. KHÔNG gửi số «sentinel» lớn để «đọc tới cuối»: server kẹp được, nhưng FE gửi số bịa là
 * dựa vào một chi tiết kẹp ở tầng SQL thay vì nói thật điều mình biết. Luật con trỏ chỉ-tiến (SPEC-15
 * §13.2) giữ nguyên: số nhỏ hơn con trỏ hiện có thì server bỏ qua và vẫn trả 200.
 *
 * Lạc quan có hoàn nguyên: badge (và badge tổng ở header — cộng dồn từ store) về 0 NGAY khi bấm; phòng nào
 * lỗi (mạng/5xx/404) thì khôi phục RIÊNG phòng đó và báo «Không đánh dấu được N phòng» kèm «Thử lại».
 * Phòng thành công vẫn đã đọc — một lời gọi hỏng không được kéo cả lô quay về.
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { chatApi } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";
import { isRoomUnreadLooking } from "./chat-room-prefs";

/** Trần lời gọi `POST /read` cùng bay khi «Đọc hết» — đủ nhanh cho vài chục phòng, không dội server. */
export const READ_ALL_CONCURRENCY = 4;

/** Khoá gộp thông báo lỗi: bấm «Thử lại» rồi lại hỏng thì thay thông báo cũ, không chồng thêm. */
export const READ_FAILED_TOAST_KEY = "chat-mark-read-failed";

/**
 * `seq` gửi cho `POST /read` — `lastMessageSeq` THẬT của phòng, hoặc `null` khi không có gì để làm.
 *
 * `null` khi phòng đã đọc hết (không badge, không cờ đánh dấu tay) hoặc khi không có số thật (server cũ
 * không trả `lastMessageSeq`, số âm/không nguyên). `0` hợp lệ: phòng rỗng đánh dấu tay chỉ cần gỡ cờ.
 */
export function markReadTargetOf(room: ChatRoomDto): number | null {
  if (!isRoomUnreadLooking(room)) return null;
  const seq = room.lastMessageSeq;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) return null;
  return seq;
}

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Chạy `worker` trên từng phần tử, tối đa `limit` cùng lúc. Kết quả GIỮ thứ tự đầu vào, không ném. */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<Settled<R>[]> {
  const results: Settled<R>[] = new Array(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { ok: true, value: await worker(items[index]) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}

/** Ảnh lạc quan: badge + số @ về 0, cờ đánh dấu tay về `null` (server gỡ cờ ở chính lời gọi này). */
export function optimisticReadRoom(room: ChatRoomDto): ChatRoomDto {
  return {
    ...room,
    unreadCount: 0,
    // Server cũ không trả số @ ⇒ không bịa khoá (vắng khoá = «không nói gì», xem `keepMention`).
    ...(typeof room.mentionUnreadCount === "number" ? { mentionUnreadCount: 0 } : {}),
    markedUnreadAt: null,
  };
}

/**
 * Hoàn nguyên MỘT phòng lỗi, giữ cả tin tới trong lúc lời gọi bay.
 *
 * Con trỏ server không tiến ⇒ chưa đọc = `before.unread + (current.lastSeq − before.lastSeq)`. Chép lại ảnh
 * chụp `before` là xoá mất tin WS vừa cộng; số @ cũng vậy (ảnh lạc quan về 0, WS cộng từ 0), kẹp ≤ badge.
 */
export function restoreUnreadRoom(before: ChatRoomDto, current: ChatRoomDto): ChatRoomDto {
  const arrived = Math.max(0, (current.lastMessageSeq ?? 0) - (before.lastMessageSeq ?? 0));
  const unreadCount = (before.unreadCount ?? 0) + arrived;
  const mentionBefore = before.mentionUnreadCount;
  return {
    ...current,
    unreadCount,
    ...(typeof mentionBefore === "number"
      ? {
          mentionUnreadCount: Math.min(
            unreadCount,
            mentionBefore + (current.mentionUnreadCount ?? 0),
          ),
        }
      : {}),
    markedUnreadAt: before.markedUnreadAt ?? null,
  };
}

export interface MarkRoomsRead {
  /** Đánh dấu đã đọc các phòng (đã lọc sẵn theo danh sách đang hiển thị). Phòng không có đích bị bỏ qua. */
  markRoomsRead: (rooms: readonly ChatRoomDto[]) => void;
  isMarking: boolean;
}

export function useMarkRoomsRead(): MarkRoomsRead {
  const { t } = useTranslation("chat");
  const [inFlight, setInFlight] = useState(0);

  const markRoomsRead = useCallback(
    (rooms: readonly ChatRoomDto[]): void => {
      // Đọc lại phòng TỪ STORE tại điểm bấm: WS có thể đã cộng tin sau lần render dựng `rooms`, và ảnh
      // lạc quan dựng trên bản cũ hơn sẽ bị `hydrateRooms` coi là ảnh chụp cũ (giữ nguyên badge).
      const latest = useChatStore.getState().roomsById;
      const jobs = rooms.flatMap((room) => {
        const before = latest[room.id] ?? room;
        const seq = markReadTargetOf(before);
        return seq === null ? [] : [{ before, seq }];
      });
      if (jobs.length === 0) return;

      useChatStore.getState().hydrateRooms(jobs.map((job) => optimisticReadRoom(job.before)));
      setInFlight((n) => n + 1);

      void runWithConcurrency(jobs, READ_ALL_CONCURRENCY, (job) =>
        chatApi.markRead(job.before.id, { seq: job.seq }),
      ).then((results) => {
        setInFlight((n) => n - 1);
        const { myUserId, applyReadEvent, hydrateRooms, roomsById } = useChatStore.getState();
        const failedIds: string[] = [];
        results.forEach((result, i) => {
          const { before } = jobs[i];
          if (result.ok) {
            // Badge theo CHÍNH phản hồi (không đợi tiếng vọng `chat:read`), tính lại trên `lastMessageSeq`
            // đang giữ: tin tới trong lúc lời gọi bay vẫn là chưa đọc.
            if (myUserId !== null) {
              applyReadEvent({
                roomId: before.id,
                userId: myUserId,
                lastReadSeq: result.value.lastReadSeq,
              });
            }
            return;
          }
          console.error(`[chat] không đánh dấu đã đọc được phòng ${before.id}:`, result.error);
          failedIds.push(before.id);
          // Phòng đã biến khỏi store (404 vì vừa bị bớt/xoá) ⇒ không còn gì để khôi phục, nhưng VẪN báo.
          const current = roomsById[before.id];
          if (current !== undefined) hydrateRooms([restoreUnreadRoom(before, current)]);
        });
        if (failedIds.length === 0) return;
        toast.error(t("rooms.readAll.failed", { count: failedIds.length }), {
          key: READ_FAILED_TOAST_KEY,
          action: {
            label: t("rooms.readAll.retry"),
            // Thử lại trên trạng thái HIỆN TẠI của store (badge vừa khôi phục, có thể đã thêm tin mới).
            onClick: () => {
              const now = useChatStore.getState().roomsById;
              markRoomsRead(
                failedIds.map((id) => now[id]).filter((r): r is ChatRoomDto => r !== undefined),
              );
            },
          },
        });
      });
    },
    [t],
  );

  return { markRoomsRead, isMarking: inFlight > 0 };
}
