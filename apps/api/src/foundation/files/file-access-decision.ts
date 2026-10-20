import type { FileLink } from "../../db/schema/files";
import type { FilePolicyService } from "./file-policy.service";
import type { FilePolicyAction, FilePolicyDecision } from "./file-policy.types";
import { fileSelfPolicyInput, toFileLinkRef, type FileDecisionActor } from "./file-view-decision";

/**
 * S19-SEC-FILELINKGATE-1 — MỘT vị từ XEM/TẢI từng tệp FOUNDATION, dùng chung cho `GET /foundation/files/:id`,
 * đường tải FOUNDATION, hàng danh sách `GET /foundation/files` và biên gắn tệp `FileService.link()`:
 *
 *   ≥ 1 liên kết sống          ⇒ AND mọi liên kết (resolver của từng liên kết — `decideForLinkedFile`);
 *   0 sống + chưa từng gắn     ⇒ chủ tệp (`ownerUserId` = người gọi) ⇒ ALLOW; còn lại ⇒ fallback FOUNDATION.FILE.*;
 *   0 sống + đã từng gắn       ⇒ từ chối mọi người, kể cả chủ (gỡ liên kết là THU HỒI).
 *
 * Hàm thuần, không truy cập DB: ngữ cảnh liên kết do người gọi nạp trong một ảnh chụp. Vế chủ đặt ở đây chứ
 * không trong `FilePolicyService.decideForLinkedFile` vì hàm đó còn người gọi ngoài FOUNDATION luôn trên tệp
 * đã có liên kết, và policy không giữ hàng `files`. `Delete` không thuộc kiểu `action` — vế chủ không áp cho xoá.
 */

/** Hành động có vế chủ tệp. */
export type FileAccessAction = FilePolicyAction.View | FilePolicyAction.Download;

/** Ngữ cảnh liên kết của một tệp đọc trong cùng một ảnh chụp. */
export interface FileAccessContext {
  live: readonly FileLink[];
  everLinked: boolean;
}

/** Phần của hàng `files` mà quyết định cần. */
export interface FileAccessSubject {
  id: string;
  ownerUserId: string | null;
}

/** Vế chủ: chỉ cho tệp CHƯA TỪNG gắn, có chủ ghi nhận, đúng người gọi, đủ phạm vi tenant. */
function isOwnerOfUnlinkedFile(
  actor: FileDecisionActor,
  file: FileAccessSubject,
  ctx: FileAccessContext,
): boolean {
  if (!actor.companyId || !actor.id) return false;
  if (ctx.live.length > 0 || ctx.everLinked) return false;
  return file.ownerUserId !== null && file.ownerUserId === actor.id;
}

export async function decideFileAccess(
  policy: Pick<FilePolicyService, "decideForLinkedFile">,
  actor: FileDecisionActor,
  file: FileAccessSubject,
  ctx: FileAccessContext,
  action: FileAccessAction,
): Promise<FilePolicyDecision> {
  if (isOwnerOfUnlinkedFile(actor, file, ctx)) return { allow: true, reason: "allow-owner" };
  return policy.decideForLinkedFile(
    fileSelfPolicyInput(actor, file.id, action),
    ctx.live.map((l) => toFileLinkRef(l)),
    action,
    ctx.everLinked,
  );
}
