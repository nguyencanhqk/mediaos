import type { TenantTx } from "../../db/db.service";
import type { FileLink, FileRecord } from "../../db/schema/files";
import type { FileAccessContext } from "./file-access-decision";
import type { FileLinkRepository } from "./file-link.repository";
import type { FileRepository } from "./file.repository";

/**
 * S7-FND-LINKFALLBACK-1 · S19-SEC-FILELINKPATHS-1 — NGỮ CẢNH LIÊN KẾT cho một quyết định truy cập tệp: liên
 * kết SỐNG + cờ «đã từng có liên kết».
 *
 * Hai truy vấn phải nhìn CÙNG một ảnh chụp (cùng một tx): tách ra hai tx thì có cửa sổ mà liên kết cuối bị gỡ
 * ở giữa ⇒ `live` rỗng nhưng `everLinked` đọc trước khi gỡ trả `false` ⇒ rơi xuống fallback FOUNDATION.FILE.*
 * đúng lúc vừa bị thu hồi. Mọi đường (xem · tải · xoá · gắn, kể cả lần đọc lại trong tx ghi) đi qua đây.
 * Hàm thuần nhận repo + tx của người gọi — không mở tx.
 */

/** Ngữ cảnh liên kết với hàng liên kết đầy đủ (DTO metadata cần). */
export type FileLinkContext = FileAccessContext & { live: FileLink[] };

/** Tệp không có hàng liên kết nào trong lô: 0 sống, chưa từng gắn. */
export const UNLINKED_CONTEXT: FileAccessContext = Object.freeze({
  live: Object.freeze([]) as readonly FileLink[],
  everLinked: false,
});

export async function readLinkContextTx(
  linkRepo: Pick<FileLinkRepository, "listByFileTx" | "hasEverBeenLinkedTx">,
  companyId: string,
  fileId: string,
  tx: TenantTx,
): Promise<FileLinkContext> {
  return {
    live: await linkRepo.listByFileTx(companyId, fileId, tx),
    everLinked: await linkRepo.hasEverBeenLinkedTx(companyId, fileId, tx),
  };
}

/** Hàng tệp + ngữ cảnh liên kết trong cùng tx (một ảnh chụp) — GET /:id · tải · gắn. */
export async function readFileAccessContextTx(
  fileRepo: Pick<FileRepository, "findByIdTx">,
  linkRepo: Pick<FileLinkRepository, "listByFileTx" | "hasEverBeenLinkedTx">,
  companyId: string,
  fileId: string,
  tx: TenantTx,
): Promise<{ row: FileRecord | undefined; ctx: FileLinkContext }> {
  return {
    row: await fileRepo.findByIdTx(companyId, fileId, tx),
    ctx: await readLinkContextTx(linkRepo, companyId, fileId, tx),
  };
}

/**
 * Tách một lô liên kết (kể cả đã gỡ — `FileLinkRepository.listAllByFileIdsTx`) thành liên kết SỐNG + cờ
 * đã-từng-gắn cho từng tệp. Tệp vắng trong map ⇒ người gọi dùng `UNLINKED_CONTEXT`.
 */
export function groupLinksByFile(links: readonly FileLink[]): Map<string, FileLinkContext> {
  const byFile = new Map<string, FileLinkContext>();
  for (const link of links) {
    const ctx = byFile.get(link.fileId) ?? { live: [], everLinked: false };
    byFile.set(link.fileId, {
      live: link.deletedAt === null ? [...ctx.live, link] : ctx.live,
      everLinked: true,
    });
  }
  return byFile;
}
