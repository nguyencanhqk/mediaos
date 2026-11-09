import type { FileAccessContext } from "./file-access-decision";
import { fileForbidden, linkFileMissing, unlinkableFileError } from "./file-link-guard";
import type { LinkerRecheckOutcome, LinkerViewOutcome } from "./file-linker-view";
import type { FileDecisionActor } from "./file-view-decision";
import type { FileService } from "./files.service";

/**
 * Bất biến: ghi con trỏ tệp lên một thực thể chỉ khi người ghi xem được tệp theo cùng quyết định với
 * `GET /foundation/files/:id` (`FileService.preflightLinkerView`). Từ chối mặc định: chỉ `allow` đi tiếp,
 * mọi nhánh khác ném. Cột con trỏ mới phải đi qua các hàm này (hoặc lõi gắn tệp).
 */
function assertNever(value: never): never {
  throw new Error(`Kết quả quyết định xem tệp không hợp lệ: ${JSON.stringify(value)}`);
}

/** `allow` ⇒ ảnh chụp để tx ghi so lại; mọi nhánh khác ném lỗi theo quy ước lõi. */
export function allowedLinkerCtx(outcome: LinkerViewOutcome): FileAccessContext {
  switch (outcome.kind) {
    case "allow":
      return outcome.ctx;
    case "missing":
      throw linkFileMissing();
    case "forbidden":
      throw fileForbidden(outcome.reason);
    case "unlinkable":
      throw unlinkableFileError(outcome.row);
    default:
      return assertNever(outcome);
  }
}

/** Kết quả so lại trong tx ghi: chỉ `ok` đi tiếp. */
export function assertRecheckOk(outcome: LinkerRecheckOutcome): void {
  switch (outcome.kind) {
    case "ok":
      return;
    case "missing":
      throw linkFileMissing();
    case "unlinkable":
      throw unlinkableFileError(outcome.row);
    default:
      assertNever(outcome);
  }
}

/** Pha ngoài tx ghi: quyết định xem tệp của người ghi (log từ chối `Link` do `preflightLinkerView` ghi). */
export async function decidePointerFile(
  files: Pick<FileService, "preflightLinkerView">,
  actor: FileDecisionActor,
  fileId: string,
  target: { moduleCode: string; entityType: string },
): Promise<FileAccessContext> {
  return allowedLinkerCtx(await files.preflightLinkerView(actor, fileId, target));
}
