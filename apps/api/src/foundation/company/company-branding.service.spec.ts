import "reflect-metadata";
import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BRANDING_RULES, FAVICON_SETTING_KEY } from "./branding.constants";
import { CompanyBrandingService } from "./company-branding.service";

/**
 * S5-BRAND-BE-1 — CompanyBrandingService UNIT (không DB). Soi các nhánh mà security-reviewer /
 * silent-failure-hunter quan tâm:
 *   - createUploadUrl: MIME ngoài whitelist + size vượt trần bị chặn TRƯỚC FileService.upload (không register rác).
 *   - confirm/set: owner-check (IDOR) + state Uploaded + MIME THẬT chạy TRƯỚC mọi side-effect.
 *   - getBranding: FAIL-SOFT narrow-by-type (Forbidden/NotFound/Conflict → null); lỗi hạ tầng KHÁC propagate.
 *   - logo dạng URL cũ (không phải UUID) → source='external', KHÔNG gọi presign (tương thích ngược).
 *   - đường ghi: logo qua CompanyService.updateCompany · favicon qua SettingService.updateCompanySetting
 *     (audit in-tx tái dùng — service KHÔNG tự mở đường audit thứ hai).
 * Deny-path HTTP thật (403 thiếu update:foundation-company, cross-tenant) ở int-spec (DB cô lập).
 */

const ACTOR = { id: "u1", companyId: "c1" };
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";

type Mock = ReturnType<typeof vi.fn>;

interface Deps {
  findByIdTx: Mock;
  upload: Mock;
  confirmUpload: Mock;
  getDownloadUrl: Mock;
  link: Mock;
  unlink: Mock;
  listActiveByEntityTx: Mock;
  resolveSetting: Mock;
  updateCompanySetting: Mock;
  getCurrent: Mock;
  updateCompany: Mock;
}

/** File hợp lệ mặc định: do ACTOR upload, đã Uploaded, sạch, image/png. */
function okFile(over: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    ownerUserId: ACTOR.id,
    uploadStatus: "Uploaded",
    scanStatus: "Clean",
    mimeType: "image/png",
    ...over,
  };
}

function makeService(over: Partial<Deps> = {}): { svc: CompanyBrandingService; deps: Deps } {
  const deps: Deps = {
    findByIdTx: vi.fn(async () => okFile()),
    upload: vi.fn(async () => ({
      fileId: FILE_ID,
      uploadUrl: "https://storage.local/put",
      expiresAt: "2026-07-22T02:00:00.000Z",
    })),
    confirmUpload: vi.fn(async () => ({ fileId: FILE_ID, uploadStatus: "Uploaded" })),
    getDownloadUrl: vi.fn(async () => ({
      url: "https://storage.local/get",
      expiresAt: "2026-07-22T02:00:00.000Z",
    })),
    link: vi.fn(),
    unlink: vi.fn(),
    listActiveByEntityTx: vi.fn(async () => []),
    resolveSetting: vi.fn(async () => ({
      key: FAVICON_SETTING_KEY,
      value: undefined,
      scope: "default",
      found: false,
    })),
    updateCompanySetting: vi.fn(),
    getCurrent: vi.fn(async () => ({ id: COMPANY_ID, logoUrl: null })),
    updateCompany: vi.fn(),
    ...over,
  };

  const db = { withTenant: vi.fn((_c: string, fn: (tx: unknown) => unknown) => fn({})) };
  const fileRepo = { findByIdTx: deps.findByIdTx };
  const linkRepo = { listActiveByEntityTx: deps.listActiveByEntityTx };
  const files = {
    upload: deps.upload,
    confirmUpload: deps.confirmUpload,
    getDownloadUrl: deps.getDownloadUrl,
    link: deps.link,
    unlink: deps.unlink,
  };
  const settings = {
    resolveSetting: deps.resolveSetting,
    updateCompanySetting: deps.updateCompanySetting,
  };
  const company = { getCurrent: deps.getCurrent, updateCompany: deps.updateCompany };

  const svc = new CompanyBrandingService(
    db as never,
    fileRepo as never,
    linkRepo as never,
    files as never,
    settings as never,
    company as never,
  );
  return { svc, deps };
}

const UPLOAD_INPUT = {
  originalName: "logo.png",
  declaredMimeType: "image/png",
  sizeBytes: 1024,
};

describe("CompanyBrandingService — createUploadUrl (chặn TRƯỚC register)", () => {
  it("MIME ngoài whitelist của kind → 415 và KHÔNG gọi FileService.upload", async () => {
    const { svc, deps } = makeService();
    await expect(
      svc.createUploadUrl(ACTOR, "logo", { ...UPLOAD_INPUT, declaredMimeType: "application/pdf" }),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(deps.upload).not.toHaveBeenCalled();
  });

  it("SVG bị từ chối cho logo (quyết định chống stored-XSS — không nằm trong whitelist)", async () => {
    const { svc, deps } = makeService();
    await expect(
      svc.createUploadUrl(ACTOR, "logo", { ...UPLOAD_INPUT, declaredMimeType: "image/svg+xml" }),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(deps.upload).not.toHaveBeenCalled();
    expect(BRANDING_RULES.logo.allowedMimeTypes).not.toContain("image/svg+xml");
  });

  it("size vượt trần của kind → 413 và KHÔNG gọi FileService.upload", async () => {
    const { svc, deps } = makeService();
    await expect(
      svc.createUploadUrl(ACTOR, "favicon", {
        originalName: "fav.png",
        declaredMimeType: "image/png",
        sizeBytes: BRANDING_RULES.favicon.maxBytes + 1,
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(deps.upload).not.toHaveBeenCalled();
  });

  it("favicon nhận .ico nhưng logo thì KHÔNG (whitelist theo kind, không dùng chung)", async () => {
    const { svc, deps } = makeService();
    await expect(
      svc.createUploadUrl(ACTOR, "favicon", {
        originalName: "fav.ico",
        declaredMimeType: "image/x-icon",
        sizeBytes: 2048,
      }),
    ).resolves.toMatchObject({ fileId: FILE_ID });

    await expect(
      svc.createUploadUrl(ACTOR, "logo", {
        originalName: "logo.ico",
        declaredMimeType: "image/x-icon",
        sizeBytes: 2048,
      }),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(deps.upload).toHaveBeenCalledTimes(1);
  });

  it("hợp lệ → delegate FileService.upload với visibility Private", async () => {
    const { svc, deps } = makeService();
    await svc.createUploadUrl(ACTOR, "logo", UPLOAD_INPUT);
    expect(deps.upload).toHaveBeenCalledWith(
      { id: ACTOR.id, companyId: ACTOR.companyId },
      expect.objectContaining({ visibility: "Private" }),
    );
  });
});

describe("CompanyBrandingService — guard sở hữu/trạng thái (IDOR)", () => {
  it("file của người khác → 403 và KHÔNG confirm", async () => {
    const { svc, deps } = makeService({
      findByIdTx: vi.fn(async () => okFile({ ownerUserId: "kẻ-khác" })),
    });
    await expect(svc.confirmUpload(ACTOR, "logo", FILE_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(deps.confirmUpload).not.toHaveBeenCalled();
  });

  it("fileId không thấy (RLS chặn cross-tenant / không tồn tại) → 404, KHÔNG rò tồn tại", async () => {
    const { svc } = makeService({ findByIdTx: vi.fn(async () => null) });
    await expect(svc.setAsset(ACTOR, "logo", FILE_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("file chưa confirm (Pending) → 409 và KHÔNG link, KHÔNG ghi con trỏ", async () => {
    const { svc, deps } = makeService({
      findByIdTx: vi.fn(async () => okFile({ uploadStatus: "Pending" })),
    });
    await expect(svc.setAsset(ACTOR, "logo", FILE_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(deps.link).not.toHaveBeenCalled();
    expect(deps.updateCompany).not.toHaveBeenCalled();
  });

  it("file Infected → 409 kể cả ở bước confirm", async () => {
    const { svc, deps } = makeService({
      findByIdTx: vi.fn(async () => okFile({ scanStatus: "Infected" })),
    });
    await expect(svc.confirmUpload(ACTOR, "logo", FILE_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(deps.confirmUpload).not.toHaveBeenCalled();
  });

  it("MIME THẬT trên row file (không phải giá trị client khai) bị đối chiếu lại ở setAsset", async () => {
    const { svc, deps } = makeService({
      findByIdTx: vi.fn(async () => okFile({ mimeType: "application/pdf" })),
    });
    await expect(svc.setAsset(ACTOR, "logo", FILE_ID)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    expect(deps.link).not.toHaveBeenCalled();
  });
});

describe("CompanyBrandingService — setAsset ghi qua service có audit sẵn", () => {
  it("logo → CompanyService.updateCompany({logoUrl:fileId}) (audit COMPANY_UPDATED tái dùng)", async () => {
    const { svc, deps } = makeService();
    const asset = await svc.setAsset(ACTOR, "logo", FILE_ID);
    expect(deps.updateCompany).toHaveBeenCalledWith(ACTOR, { logoUrl: FILE_ID });
    expect(deps.updateCompanySetting).not.toHaveBeenCalled();
    expect(asset).toMatchObject({ source: "file", fileId: FILE_ID });
  });

  it("favicon → SettingService.updateCompanySetting(branding.favicon_file_id)", async () => {
    const { svc, deps } = makeService();
    await svc.setAsset(ACTOR, "favicon", FILE_ID);
    expect(deps.updateCompanySetting).toHaveBeenCalledWith(
      ACTOR,
      FAVICON_SETTING_KEY,
      expect.objectContaining({ settingValue: FILE_ID, valueType: "String" }),
    );
    expect(deps.updateCompany).not.toHaveBeenCalled();
  });

  it("replace: gỡ link CŨ trước khi tạo link mới (không để file treo)", async () => {
    const order: string[] = [];
    const { svc } = makeService({
      listActiveByEntityTx: vi.fn(async () => [{ id: "link-cũ", linkType: "Other" }]),
      unlink: vi.fn(async () => {
        order.push("unlink");
      }),
      link: vi.fn(async () => {
        order.push("link");
      }),
    });
    await svc.setAsset(ACTOR, "logo", FILE_ID);
    expect(order).toEqual(["unlink", "link"]);
  });

  it("logo và favicon dùng entityType KHÁC NHAU ⇒ đặt logo không gỡ link favicon", async () => {
    const { svc, deps } = makeService();
    await svc.setAsset(ACTOR, "logo", FILE_ID);
    expect(deps.listActiveByEntityTx).toHaveBeenCalledWith(
      ACTOR.companyId,
      "FOUNDATION",
      BRANDING_RULES.logo.entityType,
      COMPANY_ID,
      expect.anything(),
    );
    expect(BRANDING_RULES.logo.entityType).not.toBe(BRANDING_RULES.favicon.entityType);
  });

  it("removeAsset idempotent: chưa đặt gì vẫn xoá con trỏ, không ném", async () => {
    const { svc, deps } = makeService();
    await expect(svc.removeAsset(ACTOR, "logo")).resolves.toBeUndefined();
    expect(deps.updateCompany).toHaveBeenCalledWith(ACTOR, { logoUrl: null });
  });
});

describe("CompanyBrandingService — getBranding FAIL-SOFT", () => {
  it("chưa đặt gì → {logo:null, favicon:null}, KHÔNG ném", async () => {
    const { svc } = makeService();
    await expect(svc.getBranding(ACTOR)).resolves.toEqual({ logo: null, favicon: null });
  });

  it("logo là fileId UUID → ký presigned, source='file'", async () => {
    const { svc, deps } = makeService({
      getCurrent: vi.fn(async () => ({ id: COMPANY_ID, logoUrl: FILE_ID })),
    });
    const out = await svc.getBranding(ACTOR);
    expect(out.logo).toEqual({
      source: "file",
      fileId: FILE_ID,
      url: "https://storage.local/get",
      expiresAt: "2026-07-22T02:00:00.000Z",
    });
    expect(deps.getDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it("logo là URL cũ nhập tay → source='external', KHÔNG gọi presign (tương thích ngược)", async () => {
    const { svc, deps } = makeService({
      getCurrent: vi.fn(async () => ({ id: COMPANY_ID, logoUrl: "https://cdn.cũ/logo.png" })),
    });
    const out = await svc.getBranding(ACTOR);
    expect(out.logo).toEqual({
      source: "external",
      fileId: null,
      url: "https://cdn.cũ/logo.png",
      expiresAt: null,
    });
    expect(deps.getDownloadUrl).not.toHaveBeenCalled();
  });

  it.each([
    ["NotFound (con trỏ treo)", new NotFoundException("mất")],
    ["Forbidden (resolver deny)", new ForbiddenException("cấm")],
    ["Conflict (Infected/not-downloadable)", new ConflictException("hỏng")],
  ])("presign ném %s → null, KHÔNG 500 (read tải-trang không vỡ)", async (_label, err) => {
    const { svc } = makeService({
      getCurrent: vi.fn(async () => ({ id: COMPANY_ID, logoUrl: FILE_ID })),
      getDownloadUrl: vi.fn(async () => {
        throw err;
      }),
    });
    const out = await svc.getBranding(ACTOR);
    expect(out.logo).toBeNull();
  });

  it("lỗi hạ tầng KHÁC (storage chưa cấu hình) PROPAGATE — không nuốt (silent-failure)", async () => {
    const { svc } = makeService({
      getCurrent: vi.fn(async () => ({ id: COMPANY_ID, logoUrl: FILE_ID })),
      getDownloadUrl: vi.fn(async () => {
        throw new InternalServerErrorException("storage down");
      }),
    });
    await expect(svc.getBranding(ACTOR)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("favicon đọc từ company_settings; chuỗi rỗng (đã gỡ) coi như chưa đặt", async () => {
    const { svc } = makeService({
      resolveSetting: vi.fn(async () => ({
        key: FAVICON_SETTING_KEY,
        value: "",
        scope: "company",
        found: true,
      })),
    });
    const out = await svc.getBranding(ACTOR);
    expect(out.favicon).toBeNull();
  });
});

describe("CompanyBrandingService — setAsset không im lặng khi presign hỏng", () => {
  let deps: Deps;
  let svc: CompanyBrandingService;

  beforeEach(() => {
    ({ svc, deps } = makeService({
      getDownloadUrl: vi.fn(async () => {
        throw new NotFoundException("mất");
      }),
    }));
  });

  it("đã lưu nhưng không ký được URL → 409 tường minh (KHÔNG trả null gây hiểu nhầm lưu hụt)", async () => {
    await expect(svc.setAsset(ACTOR, "logo", FILE_ID)).rejects.toBeInstanceOf(ConflictException);
    // con trỏ ĐÃ ghi trước đó — lỗi ở bước ký URL trả về, không phải bước lưu.
    expect(deps.updateCompany).toHaveBeenCalled();
  });
});
