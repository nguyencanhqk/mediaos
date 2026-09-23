/**
 * S16-SOCIAL-FE-1 (plan T7 · D7) — nối bảng tin vào kết nối `/ws` dùng chung của app shell.
 *
 * ┌─ 🔴 ĐẾM, KHÔNG CHÈN — và lý do thứ hai mới là lý do kỹ thuật ────────────────────────────────┐
 * │ (a) SPEC-16 §13.7 + SOC-DEC-010 **cấm** tự chèn bài mới vào dòng cuộn đang đọc.               │
 * │ (b) Kể cả muốn chèn cũng KHÔNG chèn nổi: `wsFeedPostCreatedEventSchema` **omit**              │
 * │     `myReaction`/`savedByMe`/`isMine`/`status` và strip `url` khỏi attachment (WS không ký    │
 * │     presign). Dựng thẻ bài từ payload đó cho ra một thẻ thiếu ảnh và không biết "tôi đã thích  │
 * │     chưa" — rồi lần refetch kế tiếp nó nhảy sang hình dạng khác.                               │
 * │ ⇒ Hook này chỉ TĂNG BỘ ĐẾM. Bấm badge mới `invalidateQueries` + cuộn lên đầu.                  │
 * │ Ca **C15** assert dương tính: 3 sự kiện ⇒ đếm = 3 **VÀ** độ dài danh sách KHÔNG đổi.          │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ FE **KHÔNG** join room: `realtime.gateway.ts` tự `client.join(feedRoomName(companyId))` lúc
 * connect, sau khi tự kiểm `view:feed`, và **fail-SOFT** (thiếu quyền ⇒ chỉ không join, phiên vẫn
 * sống). Hook chỉ `socket.on(...)`.
 *
 * ⚠️ Chỉ có room CÔNG TY (`co:{companyId}:feed`) — **không** có room nhóm / đơn vị (chưa hiện thực
 * phía BE). Nghĩa là badge chỉ đếm bài `audience='company'`. Đây là giới hạn của BE hôm nay, ghi ra
 * để không ai đi tìm lỗi ở FE (nợ N6).
 *
 * ⚠️ WS MỘT CHIỀU: hook chỉ ĐĂNG KÝ listener, không bao giờ `emit`. Muốn ghi thì gọi REST.
 */
import { useCallback, useEffect, useState } from "react";
import { getAppSocket, useCan } from "@mediaos/web-core";
import { WS_EVENTS, wsFeedPostCreatedEventSchema } from "@mediaos/contracts";

/**
 * Payload sai hình dạng: BỎ QUA (không ném trong listener socket) nhưng KHÔNG câm lặng.
 *
 * Một lần đổi shape ở `packages/contracts/src/realtime.ts` sẽ làm badge ngừng đếm HOÀN TOÀN; không
 * có dòng log này thì triệu chứng duy nhất là "không bao giờ thấy bài mới" — không lần ra được.
 */
function warnBadPayload(event: string, error: unknown): void {
  console.error(`[social] payload WS sai hợp đồng trên kênh ${event} — bỏ qua:`, error);
}

export interface FeedRealtime {
  /** Số bài mới đã nhận từ lúc reset gần nhất. */
  newPostCount: number;
  /** Gọi khi người dùng đã tải lại danh sách (bấm badge). */
  reset: () => void;
}

export function useFeedRealtime(): FeedRealtime {
  /**
   * ⚠️ MỌI hook gọi VÔ ĐIỀU KIỆN. Đặt `if (!canViewFeed) return …` phía trên chúng sẽ làm số hook đổi
   * giữa các lần render (`useCan` đọc capabilities nạp sau `/auth/me`, lần render ĐẦU gần như luôn
   * `false`) ⇒ React ném "Rendered fewer hooks than expected" và trắng nguyên app shell — không chỉ
   * hỏng bảng tin. Cổng quyền nằm BÊN TRONG effect.
   */
  const canViewFeed = useCan("view", "feed");
  const [newPostCount, setNewPostCount] = useState(0);

  const reset = useCallback(() => setNewPostCount(0), []);

  useEffect(() => {
    // Ca **C16** vế deny: không có `view:feed` ⇒ KHÔNG đăng ký listener nào. Không phải để tiết kiệm
    // — server đã fail-soft không join room cho người này, nên listener sẽ im lặng vĩnh viễn; đăng ký
    // nó chỉ tạo ảo giác "có nối" khi đọc code.
    if (!canViewFeed) return;

    const socket = getAppSocket();
    if (!socket) return; // chưa có phiên — shell sẽ điều hướng về app đăng nhập

    const onPostCreated = (raw: unknown): void => {
      const parsed = wsFeedPostCreatedEventSchema.safeParse(raw);
      if (!parsed.success) {
        warnBadPayload(WS_EVENTS.FEED_POST_CREATED, parsed.error);
        return;
      }
      setNewPostCount((n) => n + 1);
    };

    socket.on(WS_EVENTS.FEED_POST_CREATED, onPostCreated);

    /**
     * Gỡ ĐỐI XỨNG. `getAppSocket()` trả kết nối DÙNG CHUNG sống suốt phiên, nên một listener không
     * gỡ sẽ tích luỹ qua mỗi lần vào/ra bảng tin: badge tăng 2, rồi 3, rồi 4 cho MỖI bài mới.
     * Ca **C16** đếm `on` phải bằng `off`.
     */
    return () => {
      socket.off(WS_EVENTS.FEED_POST_CREATED, onPostCreated);
    };
  }, [canViewFeed]);

  return { newPostCount, reset };
}
