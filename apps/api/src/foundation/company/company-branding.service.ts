import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import {
  FOUNDATION_FILE_ERROR_CODES,
  type BrandingAsset,
  type BrandingKind,
  type BrandingUploadUrlInput,
  type BrandingUploadUrlResponse,
  type CompanyBranding,
  type ConfirmUploadResponse,
} from "@mediaos/contracts";
import { DatabaseService } from "../../db/db.service";
import { FileLinkRepository } from "../files/file-link.repository";
import { FileRepository } from "../files/file.repository";
import { FileService } from "../files/files.service";
import { SettingService } from "../settings/setting.service";
import {
  BRANDING_LINK_TYPE,
  BRANDING_MODULE_CODE,
  BRANDING_RULES,
  FAVICON_SETTING_KEY,
  looksLikeFileId,
} from "./branding.constants";
import { CompanyService } from "./company.service";

interface Actor {
  id: string;
  companyId: string;
}

/**
 * S5-BRAND-BE-1 — CompanyBrandingService: wrapper presign own-company cho logo + favicon.
 *
 * VÌ SAO WRAPPER (mirror MeAvatarService S5-ME-BE-4): gate `*:foundation-file` chỉ nằm ở FilesController,
 * `FileService` KHÔNG tự gate ⇒ bọc lại cho phép role có `update:foundation-company` (company-admin) chạy
 * trọn flow upload mà KHÔNG cần cấp thêm quyền file. WO này KHÔNG thêm cặp quyền nào.
 *
 * LƯU TRỮ (KHÔNG migration):
 *   logo    → `companies.logo_url` (chứa fileId UUID) qua CompanyService.updateCompany ⇒ audit
 *             COMPANY_UPDATED in-tx + assertCompanyActive + withTenant TÁI DÙNG NGUYÊN VẸN.
 *   favicon → `company_settings['branding.favicon_file_id']` qua SettingService.updateCompanySetting ⇒
 *             audit COMPANY_SETTING_UPDATED in-tx.
 * Cả hai đường ghi đều đã có audit + withTenant sẵn — service này KHÔNG tự ghi DB thẳng (KHÔNG nhân bản
 * đường audit thứ hai, tránh drift).
 *
 * BẤT BIẾN #1: mọi đọc/ghi qua `db.withTenant` hoặc service đã bọc withTenant. #3: chỉ trả fileId + URL
 * ephemeral, KHÔNG storage_path/bucket/checksum.
 */
@Injectable()
export class CompanyBrandingService {
  private readonly logger = new Logger(CompanyBrandingService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly fileRepo: FileRepository,
    private readonly linkRepo: FileLinkRepository,
    private readonly files: FileService,
    private readonly settings: SettingService,
    private readonly company: CompanyService,
  ) {}

  // ─── (1) READ — GET /foundation/company/branding ─────────────────────────────

  /**
   * Trả `{logo, favicon}`. FAIL-SOFT từng mục: chưa đặt / file bị gỡ / Infected / presign lỗi → `null`,
   * KHÔNG 500 (đây là read tải-trang — vỡ nó là vỡ cả vỏ app). Lỗi hạ tầng KHÁC vẫn propagate.
   */
  async getBranding(actor: Actor): Promise<CompanyBranding> {
    const [logoRef, faviconRef] = await Promise.all([
      this.readLogoRef(actor),
      this.readFaviconFileId(actor),
    ]);

    const [logo, favicon] = await Promise.all([
      this.resolveAsset(actor, logoRef, "logo"),
      this.resolveAsset(actor, faviconRef, "favicon"),
    ]);
    return { logo, favicon };
  }

  // ─── (2) UPLOAD — presign wrapper ────────────────────────────────────────────

  /**
   * POST /:kind/upload-url — validate MIME + size THEO KIND rồi delegate `FileService.upload` (register +
   * presigned-PUT). Chặn sớm ở tầng branding để KHÔNG register file rác; FileService vẫn re-validate
   * allowlist chung + đối chiếu extension↔MIME + re-check size/checksum ở confirm (KHÔNG tin mù client).
   */
  async createUploadUrl(
    actor: Actor,
    kind: BrandingKind,
    input: BrandingUploadUrlInput,
  ): Promise<BrandingUploadUrlResponse> {
    this.assertMimeAllowed(kind, input.declaredMimeType);
    this.assertSizeAllowed(kind, input.sizeBytes);

    const reg = await this.files.upload(
      { id: actor.id, companyId: actor.companyId },
      {
        originalName: input.originalName,
        declaredMimeType: input.declaredMimeType,
        sizeBytes: input.sizeBytes,
        visibility: "Private",
      },
    );
    return { fileId: reg.fileId, uploadUrl: reg.uploadUrl, expiresAt: reg.expiresAt };
  }

  /**
   * POST /:kind/confirm — flip Pending→Uploaded sau khi client PUT bytes. Owner-check TRƯỚC (IDOR: KHÔNG
   * confirm file do NGƯỜI KHÁC upload). `findByIdTx` chạy trong withTenant ⇒ fileId của công ty khác không
   * thấy được (RLS) → 404. Idempotent (đã Uploaded → 200).
   */
  async confirmUpload(
    actor: Actor,
    kind: BrandingKind,
    fileId: string,
  ): Promise<ConfirmUploadResponse> {
    await this.loadOwnedFileOrThrow(actor, fileId, { requireUploaded: false, kind });
    return this.files.confirmUpload({ id: actor.id, companyId: actor.companyId }, fileId, {});
  }

  // ─── (3) SET / REMOVE ────────────────────────────────────────────────────────

  /**
   * PUT /:kind — đặt tài sản thương hiệu từ 1 file ĐÃ upload+confirm. Kiểm đủ: tồn tại (RLS/tenant) →
   * owner (IDOR) → state Uploaded → không Infected → MIME thuộc whitelist của kind. Replace semantics:
   * gỡ (soft-delete) link CŨ cùng linkType TRƯỚC khi tạo link mới ⇒ không để file treo.
   */
  async setAsset(actor: Actor, kind: BrandingKind, fileId: string): Promise<BrandingAsset> {
    const requestUser = { id: actor.id, companyId: actor.companyId };
    await this.loadOwnedFileOrThrow(actor, fileId, { requireUploaded: true, kind });

    const companyId = await this.resolveCompanyIdOrThrow(actor);
    await this.unlinkStale(requestUser, companyId, kind);

    await this.files.link(requestUser, {
      fileId,
      moduleCode: BRANDING_MODULE_CODE,
      entityType: BRANDING_RULES[kind].entityType,
      entityId: companyId,
      linkType: BRANDING_LINK_TYPE,
      accessScope: "Company",
      isPrimary: true,
    });

    await this.persistRef(actor, kind, fileId);

    const asset = await this.resolveAsset(actor, fileId, kind);
    // setAsset vừa link + confirm-state xong ⇒ presign PHẢI ra được. null ở đây = lỗi hạ tầng thật
    // (storage down), KHÔNG phải "chưa đặt" ⇒ 409 tường minh thay vì trả null gây hiểu nhầm đã lưu hụt.
    if (!asset) {
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.NOT_DOWNLOADABLE,
        message: `${FOUNDATION_FILE_ERROR_CODES.NOT_DOWNLOADABLE}: đã lưu ${kind} nhưng không tạo được URL tải.`,
      });
    }
    return asset;
  }

  /** DELETE /:kind — gỡ link + xoá con trỏ. Idempotent (chưa đặt → no-op, vẫn 204). */
  async removeAsset(actor: Actor, kind: BrandingKind): Promise<void> {
    const requestUser = { id: actor.id, companyId: actor.companyId };
    const companyId = await this.resolveCompanyIdOrThrow(actor);
    await this.unlinkStale(requestUser, companyId, kind);
    await this.persistRef(actor, kind, null);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private assertMimeAllowed(kind: BrandingKind, mimeType: string): void {
    const rule = BRANDING_RULES[kind];
    if (!rule.allowedMimeTypes.includes(mimeType)) {
      throw new UnsupportedMediaTypeException({
        code: FOUNDATION_FILE_ERROR_CODES.MIME,
        message:
          `${FOUNDATION_FILE_ERROR_CODES.MIME}: ${kind} chỉ nhận ${rule.allowedMimeTypes.join(", ")} ` +
          `(mime: ${mimeType}).`,
      });
    }
  }

  private assertSizeAllowed(kind: BrandingKind, sizeBytes: number): void {
    const rule = BRANDING_RULES[kind];
    if (sizeBytes > rule.maxBytes) {
      throw new PayloadTooLargeException({
        code: FOUNDATION_FILE_ERROR_CODES.SIZE,
        message: `${FOUNDATION_FILE_ERROR_CODES.SIZE}: ${kind} tối đa ${Math.round(rule.maxBytes / 1024)}KB.`,
      });
    }
  }

  /**
   * Nạp file + ép mọi guard sở hữu/trạng thái. `findByIdTx` trong withTenant ⇒ RLS chặn cross-tenant
   * (fileId công ty khác → không thấy → 404, KHÔNG rò tồn tại).
   */
  private async loadOwnedFileOrThrow(
    actor: Actor,
    fileId: string,
    opts: { requireUploaded: boolean; kind: BrandingKind },
  ): Promise<void> {
    const file = await this.db.withTenant(actor.companyId, (tx) =>
      this.fileRepo.findByIdTx(actor.companyId, fileId, tx),
    );
    if (!file) throw new NotFoundException("RESOURCE-ERR-NOT-FOUND: file not found");
    // IDOR: chỉ dùng được file DO CHÍNH MÌNH upload (ownerUserId set ở FileService.upload).
    if (file.ownerUserId !== actor.id) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: file does not belong to the caller");
    }
    if (file.scanStatus === "Infected") {
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.INFECTED,
        message: `${FOUNDATION_FILE_ERROR_CODES.INFECTED}: file đang bị đánh dấu nhiễm.`,
      });
    }
    if (opts.requireUploaded && file.uploadStatus !== "Uploaded") {
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.NOT_PENDING,
        message: `${FOUNDATION_FILE_ERROR_CODES.NOT_PENDING}: file chưa upload xong (confirm trước khi đặt ${opts.kind}).`,
      });
    }
    // MIME THẬT (server ghi lúc register) — không phải giá trị client khai lại ở bước này.
    this.assertMimeAllowed(opts.kind, file.mimeType);
  }

  /** companies.id của tenant hiện tại (entityId của file_links). Không có company → 404 sạch. */
  private async resolveCompanyIdOrThrow(actor: Actor): Promise<string> {
    const view = await this.company.getCurrent(actor);
    return view.id;
  }

  /** Con trỏ logo hiện tại = `companies.logo_url` (fileId UUID HOẶC URL cũ). */
  private async readLogoRef(actor: Actor): Promise<string | null> {
    try {
      const view = await this.company.getCurrent(actor);
      return view.logoUrl;
    } catch (err) {
      if (err instanceof NotFoundException) return null; // fail-soft: company mất ⇒ không có branding
      throw err;
    }
  }

  /** Con trỏ favicon = company_settings['branding.favicon_file_id']. Vắng/rỗng → null. */
  private async readFaviconFileId(actor: Actor): Promise<string | null> {
    const resolved = await this.settings.resolveSetting(actor.companyId, FAVICON_SETTING_KEY);
    if (!resolved.found) return null;
    const value = resolved.value;
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  }

  /**
   * Con trỏ → BrandingAsset. UUID ⇒ ký presigned TTL-ngắn (`source='file'`); http(s) ⇒ trả nguyên văn
   * (`source='external'`, tương thích ngược giá trị nhập tay cũ). FAIL-SOFT: presign hỏng → null + WARN.
   */
  private async resolveAsset(
    actor: Actor,
    ref: string | null,
    kind: BrandingKind,
  ): Promise<BrandingAsset | null> {
    if (!ref) return null;
    if (!looksLikeFileId(ref)) {
      return { source: "external", fileId: null, url: ref, expiresAt: null };
    }
    try {
      const { url, expiresAt } = await this.files.getDownloadUrl(
        { id: actor.id, companyId: actor.companyId },
        ref,
      );
      return { source: "file", fileId: ref, url, expiresAt };
    } catch (err) {
      // Catch HẸP đúng 3 loại getDownloadUrl ném (files.service): NotFound (row mất/RLS 0-row) ·
      // Forbidden (resolver deny) · Conflict (NOT-DOWNLOADABLE/Infected). Loại KHÁC (storage chưa cấu
      // hình / QueryFailed) PHẢI propagate — KHÔNG nuốt (silent-failure).
      if (
        err instanceof ForbiddenException ||
        err instanceof NotFoundException ||
        err instanceof ConflictException
      ) {
        this.logger.warn(
          `getBranding degrade→null cho ${kind} (file ${ref}): ${err.constructor.name} — con trỏ treo?`,
        );
        return null;
      }
      throw err;
    }
  }

  /** Gỡ (soft-delete) mọi link branding của `kind` — replace semantics, không để file treo. */
  private async unlinkStale(
    requestUser: { id: string; companyId: string },
    companyId: string,
    kind: BrandingKind,
  ): Promise<void> {
    const links = await this.db.withTenant(requestUser.companyId, (tx) =>
      this.linkRepo.listActiveByEntityTx(
        requestUser.companyId,
        BRANDING_MODULE_CODE,
        BRANDING_RULES[kind].entityType,
        companyId,
        tx,
      ),
    );
    for (const link of links) {
      await this.files.unlink(requestUser, link.id);
    }
  }

  /**
   * Ghi con trỏ qua service ĐÃ CÓ audit in-tx (KHÔNG ghi DB thẳng — tránh đường audit thứ hai):
   *   logo    → CompanyService.updateCompany  ⇒ COMPANY_UPDATED (changed_fields tự tính = ['logoUrl']).
   *   favicon → SettingService.updateCompanySetting ⇒ COMPANY_SETTING_UPDATED.
   */
  private async persistRef(actor: Actor, kind: BrandingKind, fileId: string | null): Promise<void> {
    if (kind === "logo") {
      await this.company.updateCompany(actor, { logoUrl: fileId });
      return;
    }
    await this.settings.updateCompanySetting(actor, FAVICON_SETTING_KEY, {
      settingValue: fileId ?? "",
      valueType: "String",
      category: "Branding",
      moduleCode: "FOUNDATION",
      description: "fileId của favicon công ty (S5-BRAND-BE-1).",
    });
  }
}
