/**
 * S8-CHAT-UX-FE-3 — báo "đang gõ" (CHAT-API-023 · CHAT-DEC-017), **TIẾT LƯU leading-edge**.
 *
 * Mốc ping cuối ở `ref` chứ không ở state: nó không được kích hoạt render (một `setState` mỗi phím là
 * đúng thứ làm ô soạn giật khi gõ nhanh), và nó phải sống qua mọi lần re-render.
 *
 * Leading-edge (bắn NGAY phím đầu rồi im 3 s) chứ không trailing: người nhận cần thấy chỉ báo ở đầu
 * lượt gõ, không phải 3 giây sau khi người kia đã gõ xong nửa câu.
 *
 * ⚠️ Lỗi bị NUỐT CÓ CHỦ ĐÍCH — không toast, không banner. Đây là tín hiệu mỹ thuật: không ghi DB, không
 * audit, mất một ping thì chỉ báo tắt sớm 5 s và tự lành. Chen một thông báo lỗi vào giữa lúc người
 * dùng đang gõ là đổi một khiếm khuyết vô hình lấy một phiền toái nhìn thấy được.
 *
 * ⚠️ Test của khối này (`MessageComposer.typing.spec.tsx`) KHÔNG được dịch đồng hồ bằng fake timers —
 * xem memory `fake-timers-break-socketio-client-emit`.
 */
import { useCallback, useEffect, useRef } from "react";
import { chatApi } from "@mediaos/web-core";
import { TYPING_PING_THROTTLE_MS } from "@/routes/chat/constants";

export function useTypingPing(roomId: string, disabled: boolean): () => void {
  const lastPingRef = useRef(0);

  // Đổi phòng ⇒ quên mốc tiết lưu: mốc là của MỘT phòng, giữ lại thì phím đầu tiên ở phòng mới bị nuốt.
  useEffect(() => {
    lastPingRef.current = 0;
  }, [roomId]);

  return useCallback(() => {
    if (disabled) return;
    const now = Date.now();
    if (now - lastPingRef.current < TYPING_PING_THROTTLE_MS) return;
    lastPingRef.current = now;
    void chatApi.pingTyping(roomId).catch(() => {
      // Cố ý im lặng — xem docblock trên. Nhả mốc để lần gõ kế tiếp thử lại thay vì im 3 s vô ích.
      lastPingRef.current = 0;
    });
  }, [disabled, roomId]);
}
