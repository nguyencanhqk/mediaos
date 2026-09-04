import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ConfirmUploadResponse,
  DownloadUrlDto,
  RecruitCandidateFileDto,
  RecruitCandidateFileUploadUrlInput,
  RegisterFileResponse,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { FileRepository } from "../foundation/files/file.repository";
import { FileService } from "../foundation/files/files.service";
import { CandidatesRepository } from "./candidates.repository";
import { RecruitAccessService } from "./recruit-access.service";
import { CANDIDATE_ENTITY, RECRUIT_MODULE } from "./recruit-candidate-file.resolver";
import {
  RecruitCandidateFileRepository,
  type RecruitCandidateFileRow,
} from "./recruit-candidate-file.repository";
import type { RecruitRequestUser } from "./recruit.types";

/** `file_links.purpose` của mọi tệp gắn qua wrapper này — nhãn phân loại, KHÔNG phải cổng quyền. */
const CV_PURPOSE = "CV";

/**
 * S14-RECRUIT-FILEGRANT-1 — wrapper RECRUIT quanh Foundation Files cho tệp CV
 * (RECRUIT-API-033..037, SPEC-12 §15).
 *
 * ┌─ VÌ SAO FILE NÀY TỒN TẠI ────────────────────────────────────────────────────────────────────┐
 * │ Luồng CV đi qua `/foundation/files*`, gate `*:foundation-file` ở `FilesController`. Census 4  │
 * │ hình dạng trên DB thật (plan §1): chỉ company-admin + 2 role tuỳ biến tenant giữ 6 cặp đó;    │
 * │ `recruiter`/`hr` giữ 0 ⇒ không đính/tải được CV. CẤP cặp `foundation-file` cho họ thì mở luôn │
 * │ màn quản trị System > Files (sidebar-registry:692) và `GET /foundation/files` KHÔNG gác       │
 * │ per-file (file.repository:308) ⇒ trình duyệt tệp TOÀN TENANT. Nên: wrapper module-owned.      │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Wrapper hợp lệ vì gate `*:foundation-file` nằm ở CONTROLLER, `FileService` KHÔNG gate — cùng khuôn
 * `MeAvatarService` (S5-ME-BE-4) · `ChatFilesService` (S7-CHAT-BE-8) · `CompanyBrandingService`, cả ba
 * đã qua FULL gate. KHÔNG cấp cặp `foundation-file` nào cho ai.
 *
 * ⚠️ Câu "wrapper chỉ thu hẹp, không nới" ĐÚNG cho `upload`/`confirm`, **SAI cho `link`**: `canLinkFile`
 * của resolver được NỚI thêm vế `upload:candidate-file`, và đồng thời SIẾT bằng 4 vế trạng thái/sở hữu
 * (kể cả với company-admin đang giữ `link:foundation-file`). Xem jsdoc `RecruitCandidateFileResolver`.
 *
 * Ba tầng gác trên mọi method: (1) decorator `@RequirePermission` ở controller · (2) tầng 2
 * `RecruitAccessService.resolveActor` với cặp + cờ sensitive LẤY TỪ BẢNG `RECRUIT_ROUTE_PAIRS` (sàn
 * scope Company ép ở đây) · (3) `FilePolicyService` → resolver, do `FileService` gọi.
 */
@Injectable()
export class RecruitCandidateFileService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: RecruitAccessService,
    private readonly candidates: CandidatesRepository,
    private readonly repo: RecruitCandidateFileRepository,
    private readonly fileRepo: FileRepository,
    private readonly files: FileService,
  ) {}

  /**
   * 033 — `GET /candidates/:id/files`. Mảng TRẦN (không phong bì phân trang): client dùng `apiFetch`
   * + array schema, còn `apiFetchPaginated` sẽ nuốt mất dữ liệu ở đây
   * (`apifetch-drops-pagination-bare-array`).
   */
  async list(user: RecruitRequestUser, candidateId: string): Promise<RecruitCandidateFileDto[]> {
    await this.access.resolveActor(user, "candidateFileList");
    await this.assertCandidateLive(user, candidateId);
    const rows = await this.db.withTenant(user.companyId, (tx) =>
      this.repo.listByCandidateTx(tx, user.companyId, candidateId),
    );
    return rows.map(toDto);
  }

  /**
   * 034 — `GET /candidates/:id/files/:fileId/download-url`.
   *
   * CHỐNG IDOR: `findLinkedFileTx` chứng minh `fileId` đang link SỐNG vào ĐÚNG `candidateId` trước khi
   * gọi `FileService`. Lệch ⇒ **404**, không 403 — 403 ở đây là oracle "tệp này tồn tại nhưng thuộc
   * ứng viên khác". `FileService.getDownloadUrl` vẫn hỏi lại resolver và ghi `file_access_logs`.
   */
  async getDownloadUrl(
    user: RecruitRequestUser,
    candidateId: string,
    fileId: string,
  ): Promise<DownloadUrlDto> {
    await this.access.resolveActor(user, "candidateFileDownload");
    await this.assertCandidateLive(user, candidateId);
    await this.loadLinkedFileOr404(user, candidateId, fileId);
    return this.files.getDownloadUrl({ id: user.id, companyId: user.companyId }, fileId);
  }

  /**
   * 035 — `POST /candidates/:id/files/upload-url`. Đăng ký metadata (`Pending`) + presigned-PUT.
   *
   * Truyền `moduleCode/entityType/entityId` NGAY từ bước register (khác `ChatFilesService`, nơi tin
   * nhắn chưa tồn tại): `files.service.ts:167-169` dùng cả ba cho `audit_logs` + `file_access_logs`,
   * nên dấu vết gắn đúng ứng viên ngay từ đầu. Hằng `RECRUIT_MODULE`/`CANDIDATE_ENTITY` import từ
   * resolver, KHÔNG gõ literal — lệch chính tả ⇒ `canonicalOwnerKey` 400, hoặc tệ hơn là link ma.
   *
   * `visibility` SERVER-SET `'Private'` — schema `.strict()` không nhận field đó từ client.
   */
  async createUploadUrl(
    user: RecruitRequestUser,
    candidateId: string,
    input: RecruitCandidateFileUploadUrlInput,
  ): Promise<RegisterFileResponse> {
    await this.access.resolveActor(user, "candidateFileUploadUrl");
    await this.assertCandidateLive(user, candidateId);
    return this.files.upload(
      { id: user.id, companyId: user.companyId },
      {
        originalName: input.originalName,
        declaredMimeType: input.declaredMimeType,
        sizeBytes: input.sizeBytes,
        visibility: "Private",
        moduleCode: RECRUIT_MODULE,
        entityType: CANDIDATE_ENTITY,
        entityId: candidateId,
      },
    );
  }

  /**
   * 036 — `POST /candidates/:id/files/:fileId/confirm`. Lật `Pending → Uploaded` sau khi client PUT.
   *
   * ⚠️ OWNER-CHECK CHẠY TRƯỚC `FileService.confirmUpload` (nguyên văn `ChatFilesService.confirmOwnUpload`
   * / `MeAvatarService`). Thiếu vế này thì bất kỳ ai giữ `upload:candidate-file` cũng confirm hộ tệp
   * người khác — đẩy tệp người khác qua bước verify size/checksum và đưa nó vào trạng thái GẮN ĐƯỢC,
   * ngay trước mũi vế `owner_user_id` mà resolver đang gác.
   *
   * `!file` ⇒ 404 TRƯỚC owner-check (fileId là UUID không đoán được; đồng nhất với hai wrapper kia).
   *
   * ⚠️ GIỚI HẠN ĐÃ BIẾT, KHÔNG phải escalation: route này KHÔNG kiểm "tệp được đăng ký cho ĐÚNG
   * `:id` này". Không kiểm được cho rẻ — `files` không có cột entity; `entityId` của bước 035 chỉ nằm
   * trong `audit_logs`/`file_access_logs`. Hệ quả tối đa: caller (đã sở hữu tệp và đã có quyền
   * @Company trên MỌI ứng viên) confirm tệp qua URL của ứng viên khác ⇒ hàng audit bước register ghi
   * ứng viên A còn link cuối gắn vào B. Không ai đọc/ghi thêm được thứ trước đó không thể — cùng
   * người đó chỉ cần đăng ký một tệp mới cho B là xong. Nếu sau này cần khớp cả bước register thì
   * phải thêm cột entity vào `files`, tức đổi hợp đồng dùng chung của 5 module ⇒ WO riêng.
   */
  async confirmOwnUpload(
    user: RecruitRequestUser,
    candidateId: string,
    fileId: string,
  ): Promise<ConfirmUploadResponse> {
    await this.access.resolveActor(user, "candidateFileConfirm");
    await this.assertCandidateLive(user, candidateId);
    const file = await this.db.withTenant(user.companyId, (tx) =>
      this.fileRepo.findByIdTx(user.companyId, fileId, tx),
    );
    if (!file) throw new NotFoundException("RESOURCE-ERR-NOT-FOUND: file not found");
    if (file.ownerUserId !== user.id) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: file does not belong to the caller");
    }
    return this.files.confirmUpload({ id: user.id, companyId: user.companyId }, fileId, {});
  }

  /**
   * 037 — `POST /candidates/:id/files/:fileId/link`. Gắn tệp đã confirm vào ứng viên.
   *
   * ⚠️ KHÔNG bọc `files.link(...)` trong `withTenant`: `FileService.link` gọi `policy.canLink` NGOÀI
   * mọi tx và resolver TỰ mở tenant tx ⇒ bọc lại là tx lồng tx (vấn đề thật dưới PgBouncer
   * transaction-mode). Khuôn `EmployeeFileService.link:107-130` — gọi thẳng.
   *
   * `isPrimary: false` bắt buộc — `true` ăn 409 `uq_file_links_primary_per_entity_type` ở tệp thứ hai.
   * `accessScope: 'Company'` vì candidate CHỈ Company (§13.6).
   */
  async link(
    user: RecruitRequestUser,
    candidateId: string,
    fileId: string,
  ): Promise<RecruitCandidateFileDto> {
    await this.access.resolveActor(user, "candidateFileLink");
    await this.assertCandidateLive(user, candidateId);
    await this.files.link(
      { id: user.id, companyId: user.companyId },
      {
        fileId,
        moduleCode: RECRUIT_MODULE,
        entityType: CANDIDATE_ENTITY,
        entityId: candidateId,
        linkType: "Document",
        accessScope: "Company",
        isPrimary: false,
        purpose: CV_PURPOSE,
      },
    );
    const row = await this.loadLinkedFileOr404(user, candidateId, fileId);
    return toDto(row);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Ứng viên phải TỒN TẠI-SỐNG trong tenant, nếu không ⇒ **404** — trên CẢ NĂM route.
   *
   * Vì sao cả năm: thiếu vế này thì `list` trả `[]` 200 cho ứng viên không tồn tại trong khi
   * `download-url` trả 404, hai route lệch nhau, và `upload-url` cấp presigned URL gắn `entityId` trỏ
   * vào hư vô (dấu vết `audit_logs`/`file_access_logs` không truy ngược được). Cross-tenant cũng rơi
   * vào đây: RLS trả 0 hàng ⇒ 404, không rò tồn tại.
   */
  private async assertCandidateLive(user: RecruitRequestUser, candidateId: string): Promise<void> {
    const row = await this.db.withTenant(user.companyId, (tx) =>
      this.candidates.findTx(tx, user.companyId, candidateId),
    );
    if (row === null) throw new NotFoundException("RESOURCE-ERR-NOT-FOUND: candidate not found");
  }

  private async loadLinkedFileOr404(
    user: RecruitRequestUser,
    candidateId: string,
    fileId: string,
  ): Promise<RecruitCandidateFileRow> {
    const row = await this.db.withTenant(user.companyId, (tx) =>
      this.repo.findLinkedFileTx(tx, user.companyId, candidateId, fileId),
    );
    if (!row) throw new NotFoundException("RESOURCE-ERR-NOT-FOUND: file not found");
    return row;
  }
}

function toDto(row: RecruitCandidateFileRow): RecruitCandidateFileDto {
  return {
    linkId: row.linkId,
    fileId: row.fileId,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    scanStatus: row.scanStatus,
    uploadStatus: row.uploadStatus,
    uploadedAt: row.uploadedAt.toISOString(),
    purpose: row.purpose,
  };
}
