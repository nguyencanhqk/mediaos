/**
 * api-idempotency.ts — Tạo Idempotency-Key cho action quan trọng (FRONTEND-04 §11.2, §11.3).
 *
 * Các action cần idempotency key (IMPLEMENTATION-08 §13.2):
 * - Check-in / check-out
 * - Tạo đơn nghỉ / duyệt / từ chối
 * - Tạo nhân viên
 * - Tạo task / dự án
 *
 * Không cần: GET list/detail, login, mark notification read.
 */

/**
 * Tạo idempotency key NGẪU NHIÊN: `<prefix>_<uuid>` hoặc `<uuid>` nếu không có prefix.
 *
 * CẢNH BÁO CÁCH DÙNG: khoá ngẫu nhiên chỉ chống trùng khi caller GIỮ LẠI và gửi ĐÚNG khoá đó ở mọi
 * lần thử lại. Sinh mới trong thân hàm API mỗi lần gọi ⇒ mỗi lần thử lại là một khoá khác ⇒ server coi
 * là ý định mới ⇒ KHÔNG chống được trùng (idempotency chỉ có trên giấy). Khi không giữ được khoá theo
 * vòng đời thao tác, dùng `idempotencyKeyFor()` bên dưới.
 */
export function createIdempotencyKey(prefix?: string): string {
  let id: string;

  try {
    id = crypto.randomUUID();
  } catch {
    // Fallback cho môi trường test không có crypto shim đầy đủ
    id = `${Math.random().toString(36).slice(2)}_${Date.now()}`;
  }

  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Băm chuỗi 64-bit (2 vòng FNV-1a với offset khác nhau) → hex 16 ký tự.
 * Không dùng cho mục đích an ninh — chỉ để hai request GIỐNG HỆT nhau sinh cùng một khoá.
 * Chọn hàm đồng bộ (WebCrypto digest là async) để chữ ký hàm API không phải đổi sang async.
 */
function hash64(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Khoá idempotency SUY TỪ NỘI DUNG: `<scope>_<hash(payload)>`.
 *
 * TẠI SAO suy từ nội dung thay vì ngẫu nhiên: khoá phải GIỐNG NHAU giữa các lần thử lại của CÙNG một
 * thao tác, và KHÁC NHAU giữa hai thao tác khác nhau — mà lớp API không giữ trạng thái theo vòng đời
 * thao tác của UI. Băm payload cho đúng cả hai:
 *   - thử lại (TanStack Query retry / replay sau refresh-401) gửi lại ĐÚNG payload cũ → cùng khoá
 *     → server phát lại phản hồi cũ, KHÔNG tạo bản ghi thứ hai;
 *   - thao tác mới (payload khác) → khoá khác → chạy thật.
 *
 * HỆ QUẢ CÓ CHỦ Ý: cùng khoá ⇔ cùng payload, nên guard "khoá dùng lại cho nội dung khác" (409
 * KEY_REUSED) phía server KHÔNG BAO GIỜ bắn oan cho client này — nó chỉ còn bảo vệ trước client lỗi.
 *
 * GIỚI HẠN ĐÃ BIẾT: payload chứa trường biến thiên theo từng lần bấm (vd `clientTime` của check-in)
 * ⇒ hai lần bấm liên tiếp cho ra hai khoá khác nhau, lớp này KHÔNG chặn được bấm-đúp cho các endpoint
 * đó. Ở đó việc chống trùng vẫn do rule nghiệp vụ phía server (đã check-in → 409) + nút bị vô hiệu hoá
 * khi đang gửi đảm nhiệm. Ghi rõ để không ai tưởng lớp này phủ mọi trường hợp.
 */
export function idempotencyKeyFor(scope: string, payload: unknown): string {
  let serialized: string;
  try {
    serialized = payload === undefined ? "" : (JSON.stringify(payload) ?? "");
  } catch {
    // Payload không serialize được → không suy được khoá ổn định; rơi về khoá ngẫu nhiên
    // (không tệ hơn hiện trạng, và không làm hỏng lời gọi).
    return createIdempotencyKey(scope);
  }
  return `${scope}_${hash64(serialized)}`;
}
