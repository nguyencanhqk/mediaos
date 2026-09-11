/**
 * S17-CHAT-UX2-FE-5 — bề rộng khung nhìn quyết định BỐ CỤC nào của CHAT (SPEC-15 §9 CHAT-SCREEN-001 v2).
 *
 * Thay `use-dock-viewport.ts` của S7-CHAT-FE-3. Hook cũ trả lời đúng một câu — «màn hình có đủ chỗ cho
 * cửa sổ nổi 320×26rem không» — mà cửa sổ nổi đã bị DEC-026 xoá, nên câu hỏi cũng biến mất cùng nó.
 *
 * Ba mốc là ba BỐ CỤC KHÁC NHAU về cấu trúc, không phải ba cỡ chữ:
 *
 *   three (≥1280)  danh sách 320 · hội thoại co giãn · thông tin phòng 340 — ba CỘT
 *   two   (≥768)   danh sách · hội thoại — thông tin phòng chuyển thành SHEET trượt
 *   single (<768)  MỘT khung tại một thời điểm: danh sách → hội thoại (push, ‹) → thông tin toàn màn
 *
 * Vì thế nó phải sống ở JS chứ không chỉ ở CSS: `md:hidden` giấu được một cột, nhưng không biến một cột
 * thành một Sheet có focus-trap, và cũng không đổi được nút ⓘ từ "gập cột" thành "mở panel".
 */
import { useEffect, useState } from "react";

/** Khớp breakpoint `md` của Tailwind. */
export const CHAT_MD_QUERY = "(min-width: 768px)";
/** Khớp breakpoint `xl` của Tailwind. */
export const CHAT_XL_QUERY = "(min-width: 1280px)";

export type ChatLayoutMode = "single" | "two" | "three";

/**
 * Suy mốc từ HAI kết quả đọc CÙNG MỘT LÚC.
 *
 * ⚠️ Đây là lý do hook chỉ giữ MỘT `useState` thay vì hai. Hai state độc lập (một cho `md`, một cho
 * `xl`) được cập nhật bằng hai lời gọi `setState` từ hai listener khác nhau, nên giữa chúng tồn tại một
 * khung hình `xl = true, md = false` — một trạng thái BẤT KHẢ THI về mặt vật lý (không màn hình nào
 * rộng ≥1280 mà lại hẹp <768). Hôm nay `switch` đọc `xl` trước nên không ai thấy; ngày có người sắp lại
 * thứ tự nhánh, bố cục sẽ nhấp nháy sang `single` đúng một khung hình mỗi lần kéo cửa sổ.
 */
function resolveMode(isMd: boolean, isXl: boolean): ChatLayoutMode {
  if (isXl) return "three";
  if (isMd) return "two";
  return "single";
}

function readMode(): ChatLayoutMode {
  // Fail-soft giống `resolveSystemTheme` (web-core/lib/theme.ts) và giống hook tiền nhiệm: môi trường
  // không có `matchMedia` ⇒ coi như RỘNG NHẤT.
  //
  // ⚠️ Đây không chỉ là phòng thủ suông — `apps/app/src/test/setup.ts` KHÔNG polyfill `matchMedia` và
  // jsdom cũng không có sẵn, nên toàn bộ spec `/chat` viết trước FE-5 chạy qua đúng nhánh này và vẫn
  // thấy bố cục ba cột như cũ. Ngày ai đó thêm một polyfill `matchMedia` trả `matches: false` vào
  // `setup.ts`, mọi bài test đó lặng lẽ chuyển sang mốc `single` (danh sách và hội thoại loại trừ nhau)
  // mà không có gì đỏ để chỉ ra nguyên nhân. `use-chat-viewport.spec.ts` có ca RATCHET khoá nhánh này.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "three";
  return resolveMode(
    window.matchMedia(CHAT_MD_QUERY).matches,
    window.matchMedia(CHAT_XL_QUERY).matches,
  );
}

export function useChatLayoutMode(): ChatLayoutMode {
  const [mode, setMode] = useState(readMode);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mdQuery = window.matchMedia(CHAT_MD_QUERY);
    const xlQuery = window.matchMedia(CHAT_XL_QUERY);
    // Đọc LẠI cả hai trong cùng một lần chạy — không dùng `event.matches` của listener đang gọi, vì như
    // thế là cập nhật một nửa sự thật (xem docblock `resolveMode`).
    const sync = (): void => setMode(resolveMode(mdQuery.matches, xlQuery.matches));

    // Đồng bộ NGAY: giữa lần `useState(readMode)` và lần effect đầu, người dùng có thể đã xoay máy hoặc
    // kéo cửa sổ — giá trị khởi tạo lúc đó đã cũ.
    sync();
    mdQuery.addEventListener("change", sync);
    xlQuery.addEventListener("change", sync);
    return () => {
      mdQuery.removeEventListener("change", sync);
      xlQuery.removeEventListener("change", sync);
    };
  }, []);

  return mode;
}
