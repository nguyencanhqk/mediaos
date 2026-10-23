import type { TenantTx } from "../../db/db.service";
import type { FileRecord } from "../../db/schema/files";
import {
  decideLinkAccess,
  type FileAccessAction,
  type FileAccessContext,
} from "./file-access-decision";
import { readLinkContextTx } from "./file-link-context";
import { assertSameLinkSnapshot, isLinkableFile } from "./file-link-guard";
import type { FileLinkRepository } from "./file-link.repository";
import type { FilePolicyService } from "./file-policy.service";
import type { FileDecisionActor } from "./file-view-decision";
import type { FileRepository } from "./file.repository";

/**
 * S19-SEC-FILELINKPATHS-1 — quyết định «người gắn xem được tệp» dùng chung cho MỌI đường tạo liên kết tệp:
 * biên gắn lõi `FileService.link()` và các đường gắn của module (đính kèm tin CHAT · ảnh phòng CHAT · ảnh đại
 * diện NV do HR đặt). Cùng vị từ với `GET /foundation/files/:id` (`decideLinkAccess` → `decideFileAccess`).
 *
 * Trả GIÁ TRỊ, không ném: mỗi route giữ mã lỗi của mình. Thứ tự: hàng vắng → quyết định xem → trạng thái gắn
 * được (người không xem được tệp không học được trạng thái của nó).
 *
 * Hai pha (D-2): quyết định chạy NGOÀI tx ghi (resolver module tự mở `withTenant`; lồng vào tx đang mở sẽ treo
 * trên PgBouncer transaction-mode); tx ghi gọi `recheckLinkerSnapshotTx` — khoá hàng tệp rồi so lại ảnh chụp.
 */

export type LinkerViewOutcome =
  /** Người gắn xem được tệp và tệp gắn được; `ctx` = ảnh chụp đã dùng để tx ghi so lại. */
  | { kind: "allow"; row: FileRecord; ctx: FileAccessContext }
  /** Tệp không có trong tenant (RLS 0 hàng) hoặc không tồn tại. */
  | { kind: "missing" }
  /** Người gắn không xem được tệp; `action` = hành động của quyết định từ chối (mã quyền của dòng log). */
  | { kind: "forbidden"; reason: string; action: FileAccessAction }
  /** Xem được nhưng tệp không gắn được (Infected · tệp tạm). */
  | { kind: "unlinkable"; row: FileRecord };

export type LinkerRecheckOutcome =
  | { kind: "ok"; row: FileRecord }
  | { kind: "missing" }
  | { kind: "unlinkable"; row: FileRecord };

/** Đích ghi lên dòng log từ chối Link (tin chưa có id ⇒ bỏ `entityId`). */
export interface LinkerLogTarget {
  moduleCode: string;
  entityType: string;
  entityId?: string;
}

/** Quyết định trên MỘT ảnh chụp đã nạp (`row` + `ctx` đọc cùng tx). Thuần trừ resolver của policy. */
export async function decideLinkerViewFromSnapshot(
  policy: Pick<FilePolicyService, "decideForLinkedFile">,
  actor: FileDecisionActor,
  row: FileRecord | undefined,
  ctx: FileAccessContext,
): Promise<LinkerViewOutcome> {
  if (!row) return { kind: "missing" };
  const view = await decideLinkAccess(policy, actor, row, ctx);
  if (!view.allow) return { kind: "forbidden", reason: view.reason, action: view.action };
  if (!isLinkableFile(row)) return { kind: "unlinkable", row };
  return { kind: "allow", row, ctx };
}

/**
 * Trong tx ghi, đúng thứ tự của `link()`: (1) khoá hàng tệp (`SELECT … FOR UPDATE` — các lời gắn đồng thời
 * trên cùng tệp chạy tuần tự) → (2) trạng thái gắn được → (3) đọc lại ảnh chụp liên kết; lệch so với `decided`
 * ⇒ ném 409 `FOUNDATION-FILE-ERR-LINK` (quyết định không còn đứng, client thử lại).
 */
export async function recheckLinkerSnapshotTx(
  fileRepo: Pick<FileRepository, "findByIdForUpdateTx">,
  linkRepo: Pick<FileLinkRepository, "listByFileTx" | "hasEverBeenLinkedTx">,
  companyId: string,
  fileId: string,
  decided: FileAccessContext,
  tx: TenantTx,
): Promise<LinkerRecheckOutcome> {
  const row = await fileRepo.findByIdForUpdateTx(companyId, fileId, tx);
  if (!row) return { kind: "missing" };
  if (!isLinkableFile(row)) return { kind: "unlinkable", row };
  assertSameLinkSnapshot(decided, await readLinkContextTx(linkRepo, companyId, fileId, tx));
  return { kind: "ok", row };
}
