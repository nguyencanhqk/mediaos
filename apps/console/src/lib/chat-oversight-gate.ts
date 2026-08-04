/**
 * S7-CHAT-FE-5 🔒 — cổng quyền DUY NHẤT của hai màn quản trị đọc-vượt (CHAT-SCREEN-007/008).
 *
 * ⚠️ Cặp `('view','chat-oversight')` là cặp NHẠY CẢM duy nhất của module CHAT (`is_sensitive = true`,
 * seed mig `0538`). Vì thế MỌI cổng ở đây dùng `useCanExact` — **KHÔNG** `useCan`, **KHÔNG**
 * `<PermissionGate>` mặc định.
 *
 * `useCan` (`packages/web-core/src/hooks/use-can.ts:14`) rơi xuống `*:resourceType` → `action:*` → `*:*`.
 * Dùng nó ở đây thì mọi tài khoản giữ một grant wildcard sẽ THẤY lối vào màn nguy hiểm nhất module —
 * trong khi backend (`@RequirePermission(..., { isSensitive: true })`) vẫn 403. Kết quả không phải "an
 * toàn nhưng xấu": người quản trị nhìn thấy một chức năng đọc trộm tin nhắn rồi ăn lỗi khó hiểu, và
 * việc "sửa cho hết lỗi" ở WO sau rất dễ đi theo hướng nới quyền. Ca test đóng đinh: caps `{"*:*":true}`
 * → không thấy lối vào (SPEC-15 §20 ca 12).
 */
import { useAuthStore, useCanExact } from "@mediaos/web-core";

export const CHAT_OVERSIGHT_ACTION = "view";
export const CHAT_OVERSIGHT_RESOURCE = "chat-oversight";

/** Key trong map `capabilities` của `/auth/me` — khớp CHÍNH XÁC, không wildcard. */
export const CHAT_OVERSIGHT_CAPABILITY = `${CHAT_OVERSIGHT_ACTION}:${CHAT_OVERSIGHT_RESOURCE}`;

/** Cổng trong React (component + nav). */
export function useCanChatOversight(): boolean {
  return useCanExact(CHAT_OVERSIGHT_ACTION, CHAT_OVERSIGHT_RESOURCE);
}

/**
 * Cổng NGOÀI React — `beforeLoad` của TanStack Router chạy ngoài cây component nên không gọi hook được.
 * Đọc thẳng store, vẫn khớp CHÍNH XÁC key (cùng vị từ với `useCanChatOversight`, không phải bản sao lỏng hơn).
 */
export function hasChatOversightCapability(): boolean {
  return useAuthStore.getState().capabilities[CHAT_OVERSIGHT_CAPABILITY] === true;
}
