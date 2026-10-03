/**
 * Tác giả trên kênh WS (`feed:post.created` — CẢ HAI biến thể · `feed:comment.created`) — owner D3-b
 * (S16-SOCIAL-AVATARPRESIGN-1): GIỮ khoá, `avatarUrl` LUÔN `null` (URL ký là capability TTL, không lên
 * room). Chép TƯỜNG MINH từng khoá (không `...author`): khoá mới của DTO REST không tự chảy ra room.
 * Schema WS (`wsFeedAuthorSchema`) là tầng thứ hai.
 *
 * Module THUẦN, 0 import: `social-ws-payload.ts` (hàm thuần — plan BE-2C §4.7) dùng nó, nên nó KHÔNG được
 * sống trong `social-avatar-signer.ts` (kéo Nest DI · drizzle · presign/S3 vào hàm thuần). Signer
 * re-export để `social-comments.service.ts` giữ nguyên đường import.
 */
export function wsAuthorOf(author: { employeeId: string | null; fullName: string | null }): {
  employeeId: string | null;
  fullName: string | null;
  avatarUrl: null;
} {
  return { employeeId: author.employeeId, fullName: author.fullName, avatarUrl: null };
}
