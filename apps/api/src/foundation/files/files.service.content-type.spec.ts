/**
 * S16-SOCIAL-FILEDISPOSITION-1 — FileService: kiểu nội dung trên đường đăng ký / xác nhận / tải
 * (unit cạnh nguồn, không DB, không storage thật).
 *
 * File RIÊNG — `files.service.spec.ts` đã quá dài nên ca mới của WO này không thêm vào đó. Khung giả lập
 * dựng theo đúng khung của file ấy: `withTenant` chạy callback với một tx giả; repo / policy / settings /
 * storage là `vi.fn`. Khác một điểm: `stat` mặc định trả CẢ `contentType` (hình dạng `StorageStatResult`).
 *
 * Ca (mỗi ca TỪ CHỐI đứng cạnh ca CHO PHÉP cùng khung):
 *   F1 — confirm: kiểu đã LƯU ở storage khác kiểu đã đăng ký ⇒ 409, hàng `Failed`, không đọc bytes.
 *   F2 — confirm: storage không trả kiểu ⇒ thất bại như F1 nhưng với lý do RIÊNG (`content-type-unknown`);
 *        cả hai để lại đúng một dòng `warn` đủ trường, không mang khoá object.
 *   F3 — confirm thất bại vì lệch kiểu: audit + nhật ký truy cập mang đúng mã / lý do.
 *   F4 — register: kiểu bị từ chối cứng ⇒ 415 dù allowlist công ty đã mở; bảng 14 kiểu vẫn qua.
 *   F5 — register: đuôi bị từ chối cứng ⇒ 415 dù `blocked_extensions` của công ty rỗng.
 *   F6 — register: tầng ký từ chối (kiểu / cỡ ngoài trần) ⇒ 415 / 413, không để lại hàng đã ghi.
 *   F7 — `getDownloadUrl` chuyển MIME đã đăng ký + tên gốc của hàng xuống `storage.get`.
 */
import {
  ConflictException,
  HttpException,
  Logger,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { ATTACHMENT_ALLOWED_CONTENT_TYPES } from "@mediaos/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnsupportedAttachmentError } from "../../storage/object-storage.service";
import { StoragePresignInvariantError } from "../../storage/presign-invariants";
import type { StorageStatResult } from "../../storage/storage-adapter.port";
import { FileAccessLogService } from "./file-access-log.service";
import { CONFIRM_FAILURE_ERROR_CODE, registerContentRejection } from "./file-content-guard";
import type { FilePolicyDecision } from "./file-policy.types";
import { FileService } from "./files.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const FILE = "33333333-3333-3333-3333-333333333333";
const STORAGE_PATH = `${COMPANY}/files/${FILE}`;

const user = { id: USER, companyId: COMPANY };

/** Dòng `warn` của Logger trong từng ca — bắt lại để assert dấu vết và để không in ra console. */
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
});

const ALLOW: FilePolicyDecision = { allow: true, reason: "allow-foundation" };

const CODE_MIME = "FOUNDATION-FILE-ERR-MIME";
const CODE_SIZE = "FOUNDATION-FILE-ERR-SIZE";
const CODE_BLOCKED = "FOUNDATION-FILE-ERR-BLOCKED";
const CODE_CONFIRM_MISMATCH = "FOUNDATION-FILE-ERR-CONFIRM-MISMATCH";

const BASE_UPLOAD = {
  originalName: "tep-khong-duoi",
  declaredMimeType: "application/pdf",
  sizeBytes: 1024,
  visibility: "Private" as const,
};

function makeFileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE,
    companyId: COMPANY,
    originalName: "doc.pdf",
    storedName: FILE,
    fileExtension: "pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 1024,
    storageProvider: "MinIO",
    storageBucket: null,
    storagePath: STORAGE_PATH,
    checksumSha256: null,
    contentHash: null,
    visibility: "Private",
    uploadStatus: "Pending",
    scanStatus: "NotRequired",
    scanResult: null,
    ownerUserId: USER,
    uploadedBy: USER,
    uploadedAt: new Date("2026-10-08T00:00:00Z"),
    lastAccessedAt: null,
    downloadCount: 0,
    isTemporary: false,
    expiresAt: null,
    retentionUntil: null,
    metadata: null,
    createdAt: new Date("2026-10-08T00:00:00Z"),
    updatedAt: new Date("2026-10-08T00:00:00Z"),
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function makeHarness(policyDecision: FilePolicyDecision = ALLOW) {
  const fakeTx = {
    insert: (_table: unknown) => ({
      values: (row: Record<string, unknown>) => ({ returning: async () => [row] }),
    }),
  };
  const db = {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn(fakeTx),
    ),
  };
  const fileRepo = {
    findByIdTx: vi.fn(),
    insertTx: vi.fn(),
    listTx: vi.fn(async () => []),
    countTx: vi.fn(async () => 0),
    softDeleteTx: vi.fn(async () => 1),
    markUploadedTx: vi.fn(async () => 1),
    markFailedTx: vi.fn(async () => 1),
    incrementDownloadCountTx: vi.fn(async () => 1),
  };
  const linkRepo = {
    insertTx: vi.fn(),
    findByIdTx: vi.fn(),
    listByFileTx: vi.fn(async () => []),
    hasEverBeenLinkedTx: vi.fn(async () => false),
    softDeleteTx: vi.fn(async () => 1),
  };
  const accessLog = new FileAccessLogService();
  const accessLogSpy = vi.fn(accessLog.record.bind(accessLog));
  accessLog.record = accessLogSpy as typeof accessLog.record;
  const audit = {
    record: vi.fn(async (_tx: unknown, _entry: Record<string, unknown>) => undefined),
  };
  const policy = {
    canView: vi.fn(async () => policyDecision),
    canDownload: vi.fn(async () => policyDecision),
    canLink: vi.fn(async () => policyDecision),
    canUnlink: vi.fn(async () => policyDecision),
    canDelete: vi.fn(async () => policyDecision),
    decideForLinkedFile: vi.fn(async () => policyDecision),
    canonicalOwnerKey: vi.fn(() => null),
  };
  const storage = {
    get: vi.fn(async () => ({
      url: "https://signed.example/get",
      expiresAt: new Date("2026-10-08T00:05:00Z"),
    })),
    put: vi.fn(),
    delete: vi.fn(),
    signedUrl: vi.fn(async (_input: unknown) => ({
      url: "https://signed.example/put",
      expiresAt: new Date("2026-10-08T00:05:00Z"),
    })),
    stat: vi.fn(
      async (): Promise<StorageStatResult> => ({
        exists: true,
        sizeBytes: 1024,
        contentType: "application/pdf",
      }),
    ),
    getBytes: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
  };
  const settings = {
    resolveMany: vi.fn(async () => companySettings(["application/pdf", "image/png"], ["exe"])),
  };

  const service = new FileService(
    db as never,
    fileRepo as never,
    linkRepo as never,
    accessLog,
    audit as never,
    policy as never,
    settings as never,
    storage as never,
  );

  return { service, db, fileRepo, linkRepo, accessLogSpy, audit, policy, storage, settings };
}

/** Ba dòng setting mà `upload()` đọc — allowlist MIME + blocklist đuôi do ca test tự chọn. */
function companySettings(allowedMime: string[], blockedExtensions: string[]) {
  return [
    { key: "file.allowed_mime_types", value: allowedMime, scope: "company", found: true },
    { key: "file.max_upload_size_mb", value: 25, scope: "default", found: true },
    { key: "file.blocked_extensions", value: blockedExtensions, scope: "company", found: true },
  ];
}

/** Mã `FOUNDATION-FILE-ERR-*` trong thân một HttpException; không phải HttpException ⇒ undefined. */
function responseCode(err: unknown): string | undefined {
  if (!(err instanceof HttpException)) return undefined;
  const body = err.getResponse();
  return typeof body === "object" && body !== null && "code" in body
    ? String(body.code)
    : undefined;
}

// ─── confirm ─────────────────────────────────────────────────────────────────────────────────────

describe("FileService.confirmUpload — kiểu đã lưu phải khớp kiểu đã đăng ký", () => {
  it("F1 — TỪ CHỐI: storage lưu text/html, hàng đăng ký application/pdf ⇒ 409 CONFIRM-MISMATCH, hàng Failed, không đọc bytes", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());
    h.storage.stat.mockResolvedValue({ exists: true, sizeBytes: 1024, contentType: "text/html" });

    const attempt = h.service.confirmUpload(user, FILE, {});
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);

    expect(responseCode(await attempt.catch((e: unknown) => e))).toBe(CODE_CONFIRM_MISMATCH);
    expect(h.fileRepo.markFailedTx).toHaveBeenCalledTimes(1);
    expect(h.fileRepo.markFailedTx).toHaveBeenCalledWith(
      COMPANY,
      FILE,
      "content-type-mismatch",
      expect.anything(),
    );
    expect(h.storage.getBytes).not.toHaveBeenCalled();
    expect(h.fileRepo.markUploadedTx).not.toHaveBeenCalled();
  });

  it("F1 — CHO PHÉP: storage lưu 'Application/PDF; x=1' cho hàng application/pdf ⇒ Uploaded", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());
    h.storage.stat.mockResolvedValue({
      exists: true,
      sizeBytes: 1024,
      contentType: "Application/PDF; x=1",
    });

    const res = await h.service.confirmUpload(user, FILE, {});

    expect(res).toEqual({ fileId: FILE, uploadStatus: "Uploaded", sizeBytes: 1024 });
    expect(h.storage.getBytes).toHaveBeenCalledTimes(1);
    expect(h.fileRepo.markUploadedTx).toHaveBeenCalledTimes(1);
    expect(h.fileRepo.markFailedTx).not.toHaveBeenCalled();
  });

  it.each([
    [null, "content-type-unknown"],
    ["", "content-type-unknown"],
    ["   ", "content-type-unknown"],
    ["binary/octet-stream", "content-type-mismatch"],
    ["rác", "content-type-mismatch"],
  ])(
    "F2 — TỪ CHỐI: storage trả kiểu %j ⇒ 409 CONFIRM-MISMATCH, hàng Failed, lý do %s",
    async (storedContentType, reason) => {
      const h = makeHarness();
      h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());
      h.storage.stat.mockResolvedValue({
        exists: true,
        sizeBytes: 1024,
        contentType: storedContentType,
      });

      const attempt = h.service.confirmUpload(user, FILE, {});
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);

      expect(responseCode(await attempt.catch((e: unknown) => e))).toBe(CODE_CONFIRM_MISMATCH);
      expect(h.fileRepo.markFailedTx).toHaveBeenCalledWith(
        COMPANY,
        FILE,
        reason,
        expect.anything(),
      );
      expect(h.storage.getBytes).not.toHaveBeenCalled();
      expect(h.fileRepo.markUploadedTx).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["text/html", "content-type-mismatch", 'storedType="text/html"'],
    [null, "content-type-unknown", "storedType=null"],
  ])(
    "F2 — dấu vết: storage trả kiểu %j ⇒ ĐÚNG MỘT dòng warn (%s) đủ fileId · companyId · kiểu đăng ký · kiểu storage trả, không khoá object",
    async (storedContentType, reason, storedField) => {
      const h = makeHarness();
      h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());
      h.storage.stat.mockResolvedValue({
        exists: true,
        sizeBytes: 1024,
        contentType: storedContentType,
      });

      await expect(h.service.confirmUpload(user, FILE, {})).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = String(warnSpy.mock.calls[0][0]);
      expect(logged).toContain(reason);
      expect(logged).toContain(`fileId=${FILE}`);
      expect(logged).toContain(`companyId=${COMPANY}`);
      expect(logged).toContain('registeredType="application/pdf"');
      expect(logged).toContain(storedField);
      expect(logged).not.toContain(STORAGE_PATH);
      expect(logged).not.toContain("http");
      // Thân 409 không chép kiểu nào ra cho client.
      const body = JSON.stringify(
        (
          (await h.service.confirmUpload(user, FILE, {}).catch((e: unknown) => e)) as HttpException
        ).getResponse(),
      );
      expect(body).not.toContain("text/html");
      expect(body).not.toContain("application/pdf");
    },
  );

  it("F2 — dấu vết: kiểu storage trả chứa ký tự ngắt dòng ⇒ dòng warn vẫn là MỘT dòng ASCII", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());
    const lineBreak = String.fromCodePoint(10);
    h.storage.stat.mockResolvedValue({
      exists: true,
      sizeBytes: 1024,
      contentType: `text/html${lineBreak}dong-gia${"x".repeat(400)}`,
    });

    await expect(h.service.confirmUpload(user, FILE, {})).rejects.toBeInstanceOf(ConflictException);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = String(warnSpy.mock.calls[0][0]);
    expect(logged).toMatch(/^[ -~]+$/);
    expect(logged.length).toBeLessThan(400);
  });

  it("F2 — CHO PHÉP: kiểu khớp ⇒ không có dòng warn nào", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());

    await h.service.confirmUpload(user, FILE, {});

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("F2 — TỪ CHỐI: kiểu đăng ký của hàng sai dạng ⇒ không khớp dù storage trả đúng chuỗi đó", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow({ mimeType: "rác" }));
    h.storage.stat.mockResolvedValue({ exists: true, sizeBytes: 1024, contentType: "rác" });

    await expect(h.service.confirmUpload(user, FILE, {})).rejects.toBeInstanceOf(ConflictException);

    expect(h.fileRepo.markUploadedTx).not.toHaveBeenCalled();
  });

  it("F2 — thứ tự kiểm: lệch CẢ cỡ lẫn kiểu ⇒ lý do ghi là size-mismatch (kiểu xét SAU cỡ)", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());
    h.storage.stat.mockResolvedValue({ exists: true, sizeBytes: 9999, contentType: "text/html" });

    await expect(h.service.confirmUpload(user, FILE, {})).rejects.toBeInstanceOf(ConflictException);

    expect(h.fileRepo.markFailedTx).toHaveBeenCalledTimes(1);
    expect(h.fileRepo.markFailedTx).toHaveBeenCalledWith(
      COMPANY,
      FILE,
      "size-mismatch",
      expect.anything(),
    );
  });

  it("F3 — lệch kiểu: audit FileUploadFailed mang mã CONFIRM-MISMATCH, nhật ký truy cập ghi deniedReason = content-type-mismatch", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());
    h.storage.stat.mockResolvedValue({ exists: true, sizeBytes: 1024, contentType: "text/html" });

    await expect(h.service.confirmUpload(user, FILE, {})).rejects.toBeInstanceOf(ConflictException);

    expect(h.audit.record).toHaveBeenCalledTimes(1);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "FileUploadFailed",
        objectType: "file",
        objectId: FILE,
        resultStatus: "Failure",
        errorCode: CODE_CONFIRM_MISMATCH,
        after: { uploadStatus: "Failed" },
      }),
    );
    const denied = h.accessLogSpy.mock.calls.filter((call) => call[1].accessGranted === false);
    expect(denied).toHaveLength(1);
    expect(denied[0]?.[1].deniedReason).toBe("content-type-mismatch");
    expect(h.accessLogSpy.mock.calls.some((call) => call[1].accessGranted === true)).toBe(false);
  });

  it("F3 — bảng lý do → mã có đủ 4 khoá; lệch kiểu và không rõ kiểu dùng chung mã với lệch cỡ", () => {
    expect(Object.keys(CONFIRM_FAILURE_ERROR_CODE).sort()).toEqual([
      "content-type-mismatch",
      "content-type-unknown",
      "object-absent",
      "size-mismatch",
    ]);
    expect(CONFIRM_FAILURE_ERROR_CODE["content-type-mismatch"]).toBe(CODE_CONFIRM_MISMATCH);
    expect(CONFIRM_FAILURE_ERROR_CODE["content-type-unknown"]).toBe(CODE_CONFIRM_MISMATCH);
    expect(CONFIRM_FAILURE_ERROR_CODE["size-mismatch"]).toBe(CODE_CONFIRM_MISMATCH);
    expect(CONFIRM_FAILURE_ERROR_CODE["object-absent"]).toBe("FOUNDATION-FILE-ERR-CONFIRM-ABSENT");
  });
});

// ─── register ────────────────────────────────────────────────────────────────────────────────────

/** Các chuỗi khai bị từ chối cứng. Allowlist của ca F4 mở cho ĐÚNG từng chuỗi này. */
const REJECTED_DECLARED = [
  "text/html",
  " TEXT/HTML ",
  "text/html; charset=utf-8",
  "image/svg+xml",
  "application/xml",
  "application/xhtml+xml",
  "text/xml",
  "application/atom+xml",
];

/** Một đuôi hợp lệ cho từng kiểu trong 14 kiểu của tầng storage (thiếu kiểu nào ⇒ không biên dịch). */
const EXTENSION_OF: Record<(typeof ATTACHMENT_ALLOWED_CONTENT_TYPES)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

describe("FileService.upload — kiểu bị từ chối cứng lúc đăng ký", () => {
  it.each(REJECTED_DECLARED)(
    "F4 — TỪ CHỐI: khai %j dù allowlist công ty ĐÃ mở cho đúng chuỗi đó ⇒ 415 MIME, không ghi hàng, không ký",
    async (declaredMimeType) => {
      const h = makeHarness();
      h.settings.resolveMany.mockResolvedValue(
        companySettings([...REJECTED_DECLARED, "application/pdf"], []),
      );
      h.fileRepo.insertTx.mockImplementation(async (row) => makeFileRow(row));

      const attempt = h.service.upload(user, { ...BASE_UPLOAD, declaredMimeType });
      await expect(attempt).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

      expect(responseCode(await attempt.catch((e: unknown) => e))).toBe(CODE_MIME);
      expect(h.fileRepo.insertTx).not.toHaveBeenCalled();
      expect(h.storage.signedUrl).not.toHaveBeenCalled();
      expect(h.db.withTenant).not.toHaveBeenCalled();
      // Lưới này đứng TRƯỚC cấu hình công ty: quyết định xong mà chưa đọc setting nào.
      expect(h.settings.resolveMany).not.toHaveBeenCalled();
    },
  );

  it("F4 — CHO PHÉP: cùng allowlist đó, khai application/pdf ⇒ có uploadUrl", async () => {
    const h = makeHarness();
    h.settings.resolveMany.mockResolvedValue(
      companySettings([...REJECTED_DECLARED, "application/pdf"], []),
    );
    h.fileRepo.insertTx.mockImplementation(async (row) => makeFileRow(row));

    const res = await h.service.upload(user, BASE_UPLOAD);

    expect(res.uploadUrl).toBe("https://signed.example/put");
    expect(h.fileRepo.insertTx).toHaveBeenCalledTimes(1);
    expect(h.storage.signedUrl).toHaveBeenCalledTimes(1);
  });

  it.each([...ATTACHMENT_ALLOWED_CONTENT_TYPES])(
    "F4 — CHO PHÉP (bảng 14 kiểu): %s không bị từ chối cứng, upload() trả uploadUrl và ký đúng chuỗi đã khai",
    async (declaredMimeType) => {
      const h = makeHarness();
      h.settings.resolveMany.mockResolvedValue(
        companySettings([...ATTACHMENT_ALLOWED_CONTENT_TYPES], []),
      );
      h.fileRepo.insertTx.mockImplementation(async (row) => makeFileRow(row));
      const extension = EXTENSION_OF[declaredMimeType];

      expect(registerContentRejection(declaredMimeType, extension)).toBeNull();
      const res = await h.service.upload(user, {
        ...BASE_UPLOAD,
        originalName: `tep.${extension}`,
        declaredMimeType,
      });

      expect(res.uploadUrl).toBe("https://signed.example/put");
      expect(h.storage.signedUrl).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: declaredMimeType, sizeBytes: 1024 }),
      );
    },
  );
});

describe("FileService.upload — đuôi bị từ chối cứng (HỢP với blocked_extensions của công ty)", () => {
  it.each([
    "a.svgz",
    "a.xml",
    "a.xht",
    "a.html",
    "a.htm",
    "a.xhtml",
    "a.shtml",
    "a.svg",
    "a.xsl",
    "a.xslt",
    "A.SVGZ",
  ])(
    "F5 — TỪ CHỐI: blocked_extensions của công ty RỖNG, tên %j ⇒ 415 BLOCKED, không ghi hàng, không ký",
    async (originalName) => {
      const h = makeHarness();
      h.settings.resolveMany.mockResolvedValue(
        companySettings(["application/zip", "application/pdf"], []),
      );
      h.fileRepo.insertTx.mockImplementation(async (row) => makeFileRow(row));

      const attempt = h.service.upload(user, {
        ...BASE_UPLOAD,
        originalName,
        declaredMimeType: "application/zip",
      });
      await expect(attempt).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

      expect(responseCode(await attempt.catch((e: unknown) => e))).toBe(CODE_BLOCKED);
      expect(h.fileRepo.insertTx).not.toHaveBeenCalled();
      expect(h.storage.signedUrl).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a.pdf", "application/pdf"],
    ["a.zip", "application/zip"],
  ])("F5 — CHO PHÉP: cùng cấu hình đó, tên %j (%s) ⇒ có uploadUrl", async (originalName, mime) => {
    const h = makeHarness();
    h.settings.resolveMany.mockResolvedValue(
      companySettings(["application/zip", "application/pdf"], []),
    );
    h.fileRepo.insertTx.mockImplementation(async (row) => makeFileRow(row));

    const res = await h.service.upload(user, {
      ...BASE_UPLOAD,
      originalName,
      declaredMimeType: mime,
    });

    expect(res.uploadUrl).toBe("https://signed.example/put");
  });

  it("F5 — HỢP, không thay: đuôi công ty tự chặn (zip) VẪN bị chặn, đuôi chặn cứng (xml) cũng bị chặn, pdf qua", async () => {
    const codeFor = async (originalName: string, declaredMimeType: string) => {
      const h = makeHarness();
      h.settings.resolveMany.mockResolvedValue(
        companySettings(["application/zip", "application/pdf"], ["zip"]),
      );
      h.fileRepo.insertTx.mockImplementation(async (row) => makeFileRow(row));
      const outcome = await h.service
        .upload(user, { ...BASE_UPLOAD, originalName, declaredMimeType })
        .then(
          () => "accepted",
          (e: unknown) => responseCode(e) ?? "unexpected-error",
        );
      return outcome;
    };

    expect(await codeFor("a.zip", "application/zip")).toBe(CODE_BLOCKED);
    expect(await codeFor("a.xml", "application/zip")).toBe(CODE_BLOCKED);
    expect(await codeFor("a.pdf", "application/pdf")).toBe("accepted");
  });
});

describe("FileService.upload — tầng ký từ chối (trần cứng của storage)", () => {
  /** Kiểu có trong allowlist công ty, không thuộc nhóm bị từ chối cứng — chỉ tầng ký mới chặn. */
  const BEYOND_CEILING = "application/x-thu-nghiem";

  function harnessWhereSigningThrows(error: Error) {
    const h = makeHarness();
    const order: string[] = [];
    h.settings.resolveMany.mockResolvedValue(companySettings([BEYOND_CEILING], []));
    h.fileRepo.insertTx.mockImplementation(async (row) => {
      order.push("insert");
      return makeFileRow(row);
    });
    h.storage.signedUrl.mockImplementation(async () => {
      order.push("sign");
      throw error;
    });
    return { h, order };
  }

  it("F6 — TỪ CHỐI: tầng ký báo KIỂU ngoài trần ⇒ 415 MIME; ném TRONG tx đã ghi hàng (⇒ rollback), không mở tx nào khác", async () => {
    const { h, order } = harnessWhereSigningThrows(
      new UnsupportedAttachmentError("kiểu ngoài trần", "content-type"),
    );

    const caught = await h.service
      .upload(user, { ...BASE_UPLOAD, declaredMimeType: BEYOND_CEILING })
      .catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(UnsupportedMediaTypeException);
    expect(responseCode(caught)).toBe(CODE_MIME);
    // Hàng `files` ĐÃ được ghi trước khi ký, trong cùng một tx tenant. Lỗi phải thoát ra khỏi callback
    // của CHÍNH tx đó (DatabaseService.withTenant ⇒ db.transaction rollback) — không được nuốt rồi commit.
    expect(order).toEqual(["insert", "sign"]);
    expect(h.db.withTenant).toHaveBeenCalledTimes(1);
    await expect(h.db.withTenant.mock.results[0]?.value).rejects.toBe(caught);
  });

  it("F6 — TỪ CHỐI: tầng ký báo CỠ ngoài trần ⇒ 413 SIZE, cũng ném trong tx đã ghi hàng", async () => {
    const { h, order } = harnessWhereSigningThrows(
      new UnsupportedAttachmentError("cỡ ngoài trần", "size"),
    );

    const caught = await h.service
      .upload(user, { ...BASE_UPLOAD, declaredMimeType: BEYOND_CEILING })
      .catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(PayloadTooLargeException);
    expect(responseCode(caught)).toBe(CODE_SIZE);
    expect(order).toEqual(["insert", "sign"]);
    expect(h.db.withTenant).toHaveBeenCalledTimes(1);
    await expect(h.db.withTenant.mock.results[0]?.value).rejects.toBe(caught);
  });

  it.each([
    ["content-type", "kieu ngoai tran"],
    ["size", "co ngoai tran"],
  ] as const)(
    "F6 — dấu vết: tầng ký từ chối (%s) ⇒ ĐÚNG MỘT dòng warn nêu kind · companyId · kiểu khai · thông điệp gốc",
    async (kind, detail) => {
      const { h } = harnessWhereSigningThrows(new UnsupportedAttachmentError(detail, kind));

      await h.service
        .upload(user, { ...BASE_UPLOAD, declaredMimeType: BEYOND_CEILING })
        .catch((e: unknown) => e);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = String(warnSpy.mock.calls[0][0]);
      expect(logged).toContain(`kind=${kind}`);
      expect(logged).toContain(`companyId=${COMPANY}`);
      expect(logged).toContain(`declaredType="${BEYOND_CEILING}"`);
      expect(logged).toContain(`detail="${detail}"`);
      expect(logged).not.toContain(STORAGE_PATH);
    },
  );

  it.each([
    ["lỗi hạ tầng bất kỳ", new Error("storage không phản hồi")],
    ["lỗi tự kiểm sau ký", new StoragePresignInvariantError("PUT", "thiếu ràng buộc")],
  ])(
    "F6 — CHO PHÉP đi qua nguyên vẹn: %s ⇒ ném lại ĐÚNG đối tượng đó, không đổi thành 4xx",
    async (_label, error) => {
      const { h } = harnessWhereSigningThrows(error);

      const caught = await h.service
        .upload(user, { ...BASE_UPLOAD, declaredMimeType: BEYOND_CEILING })
        .catch((e: unknown) => e);

      expect(caught).toBe(error);
      expect(caught).not.toBeInstanceOf(HttpException);
      // Lỗi không phải «tầng ký từ chối» thì đường này không tự ghi dòng nào (bên bắt lỗi chung lo).
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  it("F6 — CHO PHÉP: tầng ký nhận ⇒ trả uploadUrl", async () => {
    const h = makeHarness();
    h.settings.resolveMany.mockResolvedValue(companySettings([BEYOND_CEILING], []));
    h.fileRepo.insertTx.mockImplementation(async (row) => makeFileRow(row));

    const res = await h.service.upload(user, { ...BASE_UPLOAD, declaredMimeType: BEYOND_CEILING });

    expect(res.uploadUrl).toBe("https://signed.example/put");
  });
});

// ─── download ────────────────────────────────────────────────────────────────────────────────────

describe("FileService.getDownloadUrl — kiểu đã đăng ký đi xuống tầng ký", () => {
  it("F7 — storage.get nhận registeredMimeType = row.mimeType và fileName = row.originalName", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(
      makeFileRow({
        uploadStatus: "Uploaded",
        scanStatus: "Clean",
        mimeType: "application/pdf",
        originalName: "hợp đồng (1).pdf",
      }),
    );

    const dto = await h.service.getDownloadUrl(user, FILE);

    expect(dto.url).toBe("https://signed.example/get");
    expect(h.storage.get).toHaveBeenCalledTimes(1);
    expect(h.storage.get).toHaveBeenCalledWith({
      key: STORAGE_PATH,
      companyId: COMPANY,
      registeredMimeType: "application/pdf",
      fileName: "hợp đồng (1).pdf",
    });
  });

  it("F7 — hai chuỗi của hàng đi NGUYÊN VĂN (thường hoá và quyết định attachment là việc của tầng ký)", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(
      makeFileRow({
        uploadStatus: "Uploaded",
        scanStatus: "NotRequired",
        mimeType: "Text/HTML; charset=utf-8",
        originalName: "trang cũ.html",
      }),
    );

    await h.service.getDownloadUrl(user, FILE);

    expect(h.storage.get).toHaveBeenCalledWith({
      key: STORAGE_PATH,
      companyId: COMPANY,
      registeredMimeType: "Text/HTML; charset=utf-8",
      fileName: "trang cũ.html",
    });
  });

  it("F7 — TỪ CHỐI: hàng chưa Uploaded ⇒ 409, storage.get KHÔNG được gọi (không ký với bất kỳ kiểu nào)", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow({ uploadStatus: "Pending" }));

    await expect(h.service.getDownloadUrl(user, FILE)).rejects.toBeInstanceOf(ConflictException);

    expect(h.storage.get).not.toHaveBeenCalled();
  });
});
