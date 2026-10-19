import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService, type TenantTx } from "../../db/db.service";
import { STORAGE_ADAPTER, type StorageAdapter } from "../../storage/storage-adapter.port";
import { FileRepository, type VerifiedAvatarMeta } from "./file.repository";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `avatar_url` chỉ lưu fileId (UUID) — do `/me/avatar` hoặc endpoint ảnh của HR ghi, đều đã kiểm tệp
 * (S19-HR-AVATARWRITE-1). Giá trị không phải UUID không bao giờ được trả làm URL ảnh.
 */
export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

/** 1 nhân viên cần resolve avatar: employeeId (chủ hàng) + giá trị avatar_url thô (fileId | null | rác). */
export interface AvatarSubject {
  employeeId: string;
  avatarUrl: string | null;
}

/**
 * S5-ME-BE-5 — ký URL tải TTL-ngắn cho avatar nhân viên (directory-class) để HR read/org-chart hiển thị ảnh.
 * CỐ Ý:
 *   - KHÔNG qua FilePolicy owner-check: avatar là DIRECTORY-CLASS — ai đọc được nhân viên (đã qua gate
 *     read:employee + data-scope ở caller) thì thấy avatar. Owner-only resolver (ME/avatar) chỉ cho luồng
 *     download đầy đủ của CHÍNH chủ, KHÔNG cho thumbnail directory.
 *   - SELF-DEFENDING (crown, security-review S5-ME-BE-5): KHÔNG tin cột `avatar_url` (dữ liệu cũ hoặc một
 *     đường ghi tương lai có thể trỏ file bất kỳ trong tenant) — chỉ ký fileId đã xác minh, không passthrough.
 *     `findVerifiedAvatarsTx` CHỈ trả file có link ME/avatar SỐNG (nguồn DUY NHẤT = MeAvatarService.setAvatar,
 *     đã validate owner+image) + image/*+Uploaded, VÀ caller khớp ĐÚNG cặp (employeeId, fileId) ⇒ đầu độc
 *     (trỏ contract/payslip/ID scan hoặc avatar người khác) KHÔNG bao giờ được ký (→ initials).
 *   - KHÔNG ghi file_access_log / bump download_count (thumbnail → tránh nhiễu số liệu tải).
 *   - FAIL-SOFT: storage lỗi → BỎ QUA (không có trong map) ⇒ initials, KHÔNG 500 cả danh sách/cây.
 *
 * Ký cục bộ (HMAC, không round-trip mạng) ⇒ N URL/trang (≤ pageSize) chấp nhận được về hiệu năng.
 */
@Injectable()
export class AvatarPresignService {
  private readonly logger = new Logger(AvatarPresignService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly fileRepo: FileRepository,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /**
   * subjects (employeeId + avatar_url thô) → Map<employeeId, displayUrl>. Employee KHÔNG có trong map ⇒ caller
   * hiển thị initials (chưa có avatar / đầu độc / ký lỗi). Gọi NGOÀI transaction đọc chính của caller (tự mở
   * withTenant riêng) để tránh nested-tx trên PgBouncer.
   *
   *   - avatar_url = UUID fileId     → CHỈ ký nếu (employeeId, fileId) khớp 1 avatar ĐÃ XÁC MINH (link+image).
   *   - http(s) / null / giá trị rác → bỏ qua (không vào map) — KHÔNG passthrough (S19-HR-AVATARWRITE-1).
   */
  async resolveEmployeeAvatars(
    companyId: string,
    subjects: AvatarSubject[],
    /**
     * S5-TASK-AVATAR-1 — tx CỦA CALLER, dùng khi lời gọi nằm SẴN trong một transaction đọc.
     *
     * Không có tham số này thì caller trong tx buộc phải tách đôi luồng (đọc trong tx → ký ngoài tx),
     * vì mở `withTenant` lồng nhau sẽ treo trên PgBouncer transaction-mode. Truyền tx vào là tái dùng
     * đúng kết nối đang mở — vẫn cùng tenant, vẫn qua RLS+FORCE. Phần ký là HMAC cục bộ (không I/O
     * mạng) nên không giữ tx lâu.
     */
    callerTx?: TenantTx,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    // employeeId → fileId ứng viên. CHỈ UUID là ứng viên; mọi giá trị khác (http(s), rác) → bỏ (initials).
    const candidateFileId = new Map<string, string>();
    const fileIds: string[] = [];
    let nonFileIdValues = 0;
    for (const s of subjects) {
      const raw = s.avatarUrl;
      if (!raw) continue;
      if (!isUuid(raw)) {
        nonFileIdValues++;
        continue;
      }
      candidateFileId.set(s.employeeId, raw);
      fileIds.push(raw);
    }
    if (nonFileIdValues > 0) {
      // Bỏ-CÓ-LOG (không im lặng): giá trị ghi trước S19-HR-AVATARWRITE-1 (link, chuỗi rác) về initials.
      // Chỉ in SỐ ĐẾM + companyId — KHÔNG in giá trị (chuỗi do người dùng nhập).
      this.logger.warn(
        `resolveEmployeeAvatars[company=${companyId}]: ${nonFileIdValues}/${subjects.length} giá trị avatar_url không phải fileId bị bỏ (degrade→initials)`,
      );
    }
    if (fileIds.length === 0) return out;

    const uniqueFileIds = [...new Set(fileIds)];
    const verified = callerTx
      ? await this.fileRepo.findVerifiedAvatarsTx(companyId, uniqueFileIds, callerTx)
      : await this.db.withTenant(companyId, (tx) =>
          this.fileRepo.findVerifiedAvatarsTx(companyId, uniqueFileIds, tx),
        );
    // Khớp ĐÚNG cặp (employeeId, fileId) — link.entity_id PHẢI là chính employee đó (chống đầu độc chéo).
    const verifiedByPair = new Map<string, VerifiedAvatarMeta>();
    for (const v of verified) verifiedByPair.set(`${v.employeeId}:${v.fileId}`, v);

    // Mang CẢ MIME đã đăng ký + tên gốc của hàng tới bước ký (S16-SOCIAL-FILEDISPOSITION-1) — không đoán.
    const toSign: VerifiedAvatarMeta[] = [];
    for (const [employeeId, fileId] of candidateFileId) {
      const meta = verifiedByPair.get(`${employeeId}:${fileId}`);
      if (meta?.storagePath) toSign.push(meta);
    }
    if (toSign.length === 0) return out;

    const results = await Promise.allSettled(
      toSign.map(async (t) => ({
        employeeId: t.employeeId,
        url: (
          await this.storage.get({
            key: t.storagePath,
            companyId,
            registeredMimeType: t.mimeType,
            fileName: t.originalName,
          })
        ).url,
      })),
    );
    let failures = 0;
    let sampleReason: unknown;
    for (const res of results) {
      if (res.status === "fulfilled") out.set(res.value.employeeId, res.value.url);
      else {
        failures++;
        sampleReason ??= res.reason;
      }
    }
    if (failures > 0) {
      // Degrade-CÓ-LOG (không nuốt im lặng): storage lỗi/cấu hình thiếu → avatar về initials, list vẫn trả.
      // Kèm 1 reason mẫu + companyId để 1 BUG THẬT (vd assertKeyInTenant ném) KHÔNG lẩn sau fail-soft.
      const reason = sampleReason instanceof Error ? sampleReason.message : String(sampleReason);
      this.logger.warn(
        `resolveEmployeeAvatars[company=${companyId}]: ${failures}/${toSign.length} avatar ký lỗi (degrade→initials). Reason mẫu: ${reason}`,
      );
    }
    return out;
  }
}
