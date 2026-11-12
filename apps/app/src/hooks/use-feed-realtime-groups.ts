/**
 * S16-SOCIAL-FEGROUPBADGE-1 — đếm «bài mới» THEO NHÓM từ `feed:post.created` biến thể `audience:'group'`
 * (room `co:{c}:feedgroup:{g}` từ S16-SOCIAL-BE-2C: cổng membership + sàn `view:feed` @Company).
 *
 * Đây là PHẦN BÙ của `useFeedRealtime`: hook đó chỉ đếm `company` và bỏ im lặng payload nhóm; hook này chỉ
 * đếm payload nhóm. Khoá đếm = `groupId` của payload ĐÃ `safeParse` (không đọc khoá thô); payload sai
 * hợp đồng ⇒ log + không đếm. Như hook feed chính: ĐẾM, KHÔNG CHÈN bài (SOC-DEC-010); FE không join room
 * (server tự join khi connect); WS một chiều; mọi hook gọi vô điều kiện, cổng `view:feed` nằm trong effect
 * (server là bên quyết — client chỉ không đăng ký listener vô nghĩa).
 */
import { useCallback, useEffect, useState } from "react";
import { getAppSocket, useCan } from "@mediaos/web-core";
import { WS_EVENTS, wsFeedPostCreatedEventSchema } from "@mediaos/contracts";

export interface GroupFeedRealtime {
  /** Số bài mới theo `groupId` từ lúc reset gần nhất của nhóm đó. */
  counts: Readonly<Record<string, number>>;
  countFor: (groupId: string) => number;
  /** Gọi khi người dùng đã tải lại / mở nhóm đó. */
  reset: (groupId: string) => void;
}

/**
 * Mọi instance đang mount (rail «Nhóm của tôi» + tab bài của nhóm) cùng nghe một kênh reset: xoá đếm ở
 * MỘT nơi ⇒ xoá ở MỌI nơi, nên badge rail không còn kẹt ở nhóm mà người dùng đang xem.
 */
const resetListeners = new Set<(groupId: string) => void>();

export function useGroupFeedRealtime(): GroupFeedRealtime {
  const canViewFeed = useCan("view", "feed");
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});

  const resetLocal = useCallback((groupId: string) => {
    setCounts((prev) => {
      if (!(groupId in prev)) return prev;
      return Object.fromEntries(Object.entries(prev).filter(([id]) => id !== groupId));
    });
  }, []);

  useEffect(() => {
    resetListeners.add(resetLocal);
    return () => {
      resetListeners.delete(resetLocal);
    };
  }, [resetLocal]);

  const reset = useCallback((groupId: string) => {
    for (const fn of resetListeners) fn(groupId);
  }, []);

  const countFor = useCallback((groupId: string) => counts[groupId] ?? 0, [counts]);

  useEffect(() => {
    if (!canViewFeed) return;
    const socket = getAppSocket();
    if (!socket) return;

    const onPostCreated = (raw: unknown): void => {
      const parsed = wsFeedPostCreatedEventSchema.safeParse(raw);
      if (!parsed.success) {
        console.error(
          `[social] payload WS sai hợp đồng trên kênh ${WS_EVENTS.FEED_POST_CREATED} — bỏ qua:`,
          parsed.error,
        );
        return;
      }
      if (parsed.data.audience !== "group") return; // bài công ty thuộc badge feed chính
      const { groupId } = parsed.data;
      setCounts((prev) => ({ ...prev, [groupId]: (prev[groupId] ?? 0) + 1 }));
    };

    socket.on(WS_EVENTS.FEED_POST_CREATED, onPostCreated);
    return () => {
      socket.off(WS_EVENTS.FEED_POST_CREATED, onPostCreated);
    };
  }, [canViewFeed]);

  return { counts, countFor, reset };
}
