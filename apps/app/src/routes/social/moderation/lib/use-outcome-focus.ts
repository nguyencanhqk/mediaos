/**
 * S16-SOCIAL-FE-3 (L2) — đưa focus tới dải kết cục sau một lượt GHI của màn Kiểm duyệt (029 · 006).
 *
 * Vì sao cần: thứ đang giữ focus lúc lượt ghi xong chính là thứ SẮP BIẾN MẤT — nút «Xử lý» của báo cáo
 * vừa kết thúc (hộp thoại đóng thì `Dialog` trả focus về đó, rồi refetch gỡ hàng), nút «Hiện lại» của bài
 * vừa hiện. Phần tử đang focus bị gỡ khỏi DOM thì focus rơi về `body`: người dùng bàn phím phải Tab lại
 * từ đầu vỏ ứng dụng, trình đọc màn hình mất chỗ — sau MỖI báo cáo / bài.
 *
 * Cách dùng: gắn `noticeRef` vào vỏ của dải kết cục (`tabIndex={-1}`), `fallbackRef` vào một phần tử LUÔN
 * có mặt (dải có thể không được vẽ — luật «lượt đọc đang lỗi thì không vẽ dải kết cục»); gọi
 * `requestFocus()` CÙNG chỗ với `setState` vẽ dải. Focus được đặt trong effect của lượt commit đó: effect
 * dọn dẹp của hộp thoại vừa unmount (trả focus về nút kích hoạt) chạy TRƯỚC effect này nên không đè lại.
 *
 * KHÔNG dùng cho lượt người dùng TỰ đóng hộp thoại — ở đó focus về nút kích hoạt là đúng.
 */
import * as React from "react";

/** Lớp của vỏ nhận focus: vòng focus như mọi phần tử tương tác khác, không viền mặc định của trình duyệt. */
export const OUTCOME_FOCUS_CLASS =
  "rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export interface OutcomeFocus<N extends HTMLElement, F extends HTMLElement> {
  /** Vỏ của dải kết cục; chỉ mount khi dải được vẽ. */
  noticeRef: React.RefObject<N | null>;
  /** Phần tử luôn có mặt — nhận focus khi dải không được vẽ. */
  fallbackRef: React.RefObject<F | null>;
  /** Gọi cùng nhịp với việc đặt dải kết cục. */
  requestFocus: () => void;
}

export function useOutcomeFocus<
  N extends HTMLElement = HTMLDivElement,
  F extends HTMLElement = HTMLElement,
>(): OutcomeFocus<N, F> {
  const noticeRef = React.useRef<N>(null);
  const fallbackRef = React.useRef<F>(null);
  // Bộ đếm, không phải cờ: hai kết cục liên tiếp đều phải kéo focus.
  const [requestCount, setRequestCount] = React.useState(0);

  React.useEffect(() => {
    if (requestCount === 0) return;
    (noticeRef.current ?? fallbackRef.current)?.focus();
  }, [requestCount]);

  const requestFocus = React.useCallback((): void => {
    setRequestCount((count) => count + 1);
  }, []);

  return { noticeRef, fallbackRef, requestFocus };
}
