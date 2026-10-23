import { Injectable, Logger } from "@nestjs/common";
import type { FileListItemDto, ListFilesQuery } from "@mediaos/contracts";
import { DatabaseService } from "../../db/db.service";
import type { FileLink, FileRecord } from "../../db/schema/files";
import { FileLinkRepository } from "./file-link.repository";
import { toFileListItemDto } from "./file-metadata.mapper";
import { FilePolicyService } from "./file-policy.service";
import { FilePolicyAction } from "./file-policy.types";
import { decideFileAccess } from "./file-access-decision";
import { groupLinksByFile, type FileLinkContext } from "./file-link-context";
import type { FileDecisionActor } from "./file-view-decision";
import { FileRepository } from "./file.repository";

/** Số fileId tối đa trong một dòng log chẩn đoán (đủ để tra, không xả cả trang vào log). */
const LOG_SAMPLE_FILE_IDS = 5;
/**
 * Mã module/entity vào log theo quy tắc DƯƠNG: khớp tập ký tự của mã ⇒ giữ nguyên, khác ⇒ «?». Hai cột chỉ bị
 * ràng buộc độ dài (`linkFileInputSchema`, DB không CHECK) ⇒ không ghép thô chuỗi do người dùng cấp vào log.
 */
const LOG_CODE = /^[A-Za-z0-9_.-]{1,100}$/;
const logCode = (value: string): string => (LOG_CODE.test(value) ? value : "?");

/** Lý do che được tóm tắt trong log — deny thường của resolver KHÔNG tính (đó là kết quả đúng, không phải sự cố). */
type LoggedReason = "deny-no-resolver" | "deny-error";
const LOGGED_REASONS: readonly LoggedReason[] = ["deny-no-resolver", "deny-error"];

interface MaskedEntry {
  fileId: string;
  reason: LoggedReason;
  links: readonly FileLink[];
}

/**
 * S19-SEC-FILEMETAGATE-1 — `GET /foundation/files`: tên · đuôi · cỡ · chủ tệp của một hàng đi theo quyết
 * định XEM của chính người gọi cho đúng tệp đó — cùng vị từ với `GET /foundation/files/:id`
 * (`decideFileAccess` ở `file-access-decision.ts`, S19-SEC-FILELINKGATE-1).
 *
 * - GIỮ mọi hàng (không lọc): lọc sau LIMIT/OFFSET làm trang hụt ⇒ client dừng phân trang sớm và `total`
 *   lệch; quyết định đi qua resolver nên không lọc được trong SQL. Hàng không xem được bị che (mapper).
 * - Hàng + total + MỌI link của trang đọc trong CÙNG một `withTenant` (một ảnh chụp, một truy vấn link cho
 *   cả trang). Quyết định chạy TUẦN TỰ SAU khi tx đóng — resolver tự mở `withTenant`, lồng tx treo trên
 *   PgBouncer (khuôn `chat-attachments.service.ts`).
 * - Không ghi `file_access_logs` (danh sách chưa từng ghi). Một `logger.error` mỗi request khi có hàng che do
 *   `deny-no-resolver`/`deny-error` (đếm theo lý do, không tên tệp); policy vẫn tự log từng `deny-error`.
 */
@Injectable()
export class FileListService {
  private readonly logger = new Logger(FileListService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly fileRepo: FileRepository,
    private readonly linkRepo: FileLinkRepository,
    private readonly policy: FilePolicyService,
  ) {}

  async list(
    user: FileDecisionActor,
    query: ListFilesQuery,
  ): Promise<{ data: FileListItemDto[]; meta: { total: number; page: number; limit: number } }> {
    const offset = (query.page - 1) * query.limit;
    const { rows, total, links } = await this.db.withTenant(user.companyId, async (tx) => {
      const [pageRows, count] = await Promise.all([
        this.fileRepo.listTx(
          user.companyId,
          { limit: query.limit, offset, visibility: query.visibility },
          tx,
        ),
        this.fileRepo.countTx(user.companyId, { visibility: query.visibility }, tx),
      ]);
      const pageLinks = await this.linkRepo.listAllByFileIdsTx(
        user.companyId,
        pageRows.map((r) => r.id),
        tx,
      );
      return { rows: pageRows, total: count, links: pageLinks };
    });

    const data = await this.decideRows(user, rows, groupLinksByFile(links));
    return { data, meta: { total, page: query.page, limit: query.limit } };
  }

  /** Quyết định XEM từng hàng (tuần tự, ngoài tx) rồi map — che hàng DENY, giữ thứ tự. */
  private async decideRows(
    user: FileDecisionActor,
    rows: readonly FileRecord[],
    byFile: ReadonlyMap<string, FileLinkContext>,
  ): Promise<FileListItemDto[]> {
    const data: FileListItemDto[] = [];
    const masked: MaskedEntry[] = [];
    for (const row of rows) {
      const ctx = byFile.get(row.id) ?? { live: [], everLinked: false };
      const decision = await decideFileAccess(this.policy, user, row, ctx, FilePolicyAction.View);
      const reason = LOGGED_REASONS.find((r) => r === decision.reason);
      if (reason) masked.push({ fileId: row.id, reason, links: ctx.live });
      data.push(toFileListItemDto(row, decision.allow));
    }
    if (masked.length > 0) this.logMasked(masked, rows.length);
    return data;
  }

  /**
   * MỘT dòng mỗi request khi có hàng che do lỗi quyết định: số hàng che / số hàng của trang, đếm theo lý do,
   * tập (module, entity) qua `logCode`, mẫu fileId. KHÔNG tên tệp. Một trang che hàng loạt vì `deny-error` hiện
   * thành MỘT dòng tóm tắt — phân biệt sự cố với từ chối hợp lệ (stack từng hàng vẫn ở log của policy).
   */
  private logMasked(entries: readonly MaskedEntry[], pageSize: number): void {
    const counts = LOGGED_REASONS.map(
      (r) => `${r}=${entries.filter((e) => e.reason === r).length}`,
    ).join(", ");
    const pairs = new Set(
      entries.flatMap((e) =>
        e.links.map((l) => `${logCode(l.moduleCode)}/${logCode(l.entityType)}`),
      ),
    );
    const sample = entries.slice(0, LOG_SAMPLE_FILE_IDS).map((e) => e.fileId);
    this.logger.error(
      `file list: ${entries.length} of ${pageSize} row(s) masked by a decision failure (${counts}); ` +
        `links=[${[...pairs].join(", ")}]; sampleFileIds=[${sample.join(", ")}]`,
    );
  }
}
