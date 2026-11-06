/**
 * Ranh giới phiên (S20-FE-TOAST-2) — MỘT tín hiệu dùng chung cho «người đang dùng app vừa đổi».
 *
 * Bắn khi danh tính trong auth store đổi: đăng xuất (A → không ai) · hết phiên (api-client gọi `logout()`
 * trước khi `redirectToAuth()`) · đổi phiên tại chỗ (A → B qua `setUser`) · đăng nhập sau trang trống
 * (không ai → B). KHÔNG bắn khi `/me` làm mới cùng người (cùng `companyId:id`) hay chỉ đổi access token.
 *
 * Ai cần dọn trạng thái của người trước thì đăng ký ở đây thay vì tự rình store ở từng app:
 * - `configureToast` (error-mapper) tự đăng ký `toast.clear()` khi đích có `clear` ⇒ mọi app gắn toast là
 *   có dọn thông báo, không phải nhớ thêm dòng nào.
 * - S19-SEC-FECACHELOGOUT-1 (WO riêng) cắm `queryClient.clear()` bằng đúng `onSessionBoundary`.
 *
 * Một handler ném lỗi KHÔNG chặn handler sau (dọn dở dang = rò dữ liệu người trước) — lỗi được log rõ.
 */
import { useAuthStore } from "../stores/auth";

export type SessionBoundaryHandler = () => void;

const handlers = new Set<SessionBoundaryHandler>();
let detachStore: (() => void) | null = null;

type AuthSnapshot = ReturnType<typeof useAuthStore.getState>;

function identityOf(state: AuthSnapshot): string | null {
  return state.user ? `${state.user.companyId}:${state.user.id}` : null;
}

function runHandlers(): void {
  // Chụp bản sao: handler tự huỷ đăng ký giữa chừng không làm lệch vòng lặp.
  for (const handler of [...handlers]) {
    try {
      handler();
    } catch (err: unknown) {
      console.error(
        "[session-boundary] handler dọn phiên lỗi — vẫn chạy các handler còn lại:",
        err,
      );
    }
  }
}

function attachStore(): void {
  if (detachStore) return;
  let previous = identityOf(useAuthStore.getState());
  detachStore = useAuthStore.subscribe((state) => {
    const next = identityOf(state);
    if (next === previous) return;
    previous = next;
    runHandlers();
  });
}

/** Đăng ký việc dọn khi đổi người dùng. Trả hàm huỷ đăng ký (gỡ luôn lượt rình store khi hết handler). */
export function onSessionBoundary(handler: SessionBoundaryHandler): () => void {
  handlers.add(handler);
  attachStore();
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0 && detachStore) {
      detachStore();
      detachStore = null;
    }
  };
}
