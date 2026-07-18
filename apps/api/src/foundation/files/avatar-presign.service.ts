import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../db/db.service";
import { STORAGE_ADAPTER, type StorageAdapter } from "../../storage/storage-adapter.port";
import { FileRepository } from "./file.repository";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `avatar_url` lưu fileId (UUID) cho ảnh self-service; legacy admin có thể set URL http trực tiếp. */
export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

/** 1 nhân viên cần resolve avatar: employeeId (chủ hàng) + giá trị avatar_url thô (fileId | http | null). */
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
 *   - SELF-DEFENDING (crown, security-review S5-ME-BE-5): KHÔNG tin cột `avatar_url` (đa-người-ghi — vd
 *     profile-change-request `avatar_file_id` ghi verbatim, có thể bị đầu độc trỏ file bất kỳ trong tenant).
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
   *   - avatar_url = http(s) URL  → passthrough (legacy admin-set, admin-trusted).
   *   - avatar_url = UUID fileId  → CHỈ ký nếu (employeeId, fileId) khớp 1 avatar ĐÃ XÁC MINH (link+image).
   *   - null / giá trị rác        → bỏ qua (không vào map).
   */
  async resolveEmployeeAvatars(
    companyId: string,
    subjects: AvatarSubject[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    // employeeId → fileId ứng viên (chỉ giữ bản ghi UUID; http đã passthrough thẳng vào `out`).
    const candidateFileId = new Map<string, string>();
    const fileIds: string[] = [];
    for (const s of subjects) {
      const raw = s.avatarUrl;
      if (!raw) continue;
      if (isUuid(raw)) {
        candidateFileId.set(s.employeeId, raw);
        fileIds.push(raw);
      } else if (raw.startsWith("http://") || raw.startsWith("https://")) {
        out.set(s.employeeId, raw);
      }
      // else: giá trị lạ (không UUID, không URL) → bỏ (initials).
    }
    if (fileIds.length === 0) return out;

    const verified = await this.db.withTenant(companyId, (tx) =>
      this.fileRepo.findVerifiedAvatarsTx(companyId, [...new Set(fileIds)], tx),
    );
    // Khớp ĐÚNG cặp (employeeId, fileId) — link.entity_id PHẢI là chính employee đó (chống đầu độc chéo).
    const storagePathByPair = new Map<string, string>();
    for (const v of verified) storagePathByPair.set(`${v.employeeId}:${v.fileId}`, v.storagePath);

    const toSign: Array<{ employeeId: string; storagePath: string }> = [];
    for (const [employeeId, fileId] of candidateFileId) {
      const storagePath = storagePathByPair.get(`${employeeId}:${fileId}`);
      if (storagePath) toSign.push({ employeeId, storagePath });
    }
    if (toSign.length === 0) return out;

    const results = await Promise.allSettled(
      toSign.map(async (t) => ({
        employeeId: t.employeeId,
        url: (await this.storage.get({ key: t.storagePath, companyId })).url,
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
