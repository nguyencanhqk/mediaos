/**
 * S1-FND-FILE-1 — FileService deny-path / validation RED suite (colocated unit, no DB).
 *
 * Crown-jewel: fail-closed file lifecycle. These specs are written RED-first and cover the testTasks
 * of docs/plans/S1-FND-FILE-1.md that do NOT need Postgres:
 *   1. FilePolicy DENY → ForbiddenException + file_access_log access_granted=false + denied_reason set.
 *   2. upload MIME outside allowlist + size over ceiling → 4xx, NO metadata written; spoofed
 *      Content-Type (declaredMimeType) cannot bypass the server allowlist.
 *   3. filename path-traversal ('../', '/etc/x', NUL, backslash) → sanitized; storage_path is ALWAYS
 *      inside prefix {companyId}/files/ (server-derived key, never from originalName).
 *   4. link cross-company → reject; link when file.scan_status='Infected' → reject.
 *   7. audit masking — storage_path / signed_url in before/after become '***'.
 *
 * withTenant is mocked to invoke the callback with a fake tx (we assert the repo/audit/log calls it
 * receives). Integration (real RLS / append-only / happy-path) lives in test/integration/*.int-spec.ts.
 */

import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "../../events/audit.service";
import type { FilePolicyDecision } from "./file-policy.types";
import { FileAccessLogService } from "./file-access-log.service";
import { FileService } from "./files.service";

// ─── Fakes ──────────────────────────────────────────────────────────────────────

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const FILE = "33333333-3333-3333-3333-333333333333";

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
    storagePath: `${COMPANY}/files/${FILE}`,
    checksumSha256: null,
    contentHash: null,
    visibility: "Private",
    uploadStatus: "Pending",
    scanStatus: "NotRequired",
    scanResult: null,
    ownerUserId: USER,
    uploadedBy: USER,
    uploadedAt: new Date("2026-06-24T00:00:00Z"),
    lastAccessedAt: null,
    downloadCount: 0,
    isTemporary: false,
    expiresAt: null,
    retentionUntil: null,
    metadata: null,
    createdAt: new Date("2026-06-24T00:00:00Z"),
    updatedAt: new Date("2026-06-24T00:00:00Z"),
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

const ALLOW: FilePolicyDecision = { allow: true, reason: "allow-foundation" };
const DENY: FilePolicyDecision = { allow: false, reason: "deny-foundation" };

interface Harness {
  service: FileService;
  fileRepo: {
    findByIdTx: ReturnType<typeof vi.fn>;
    insertTx: ReturnType<typeof vi.fn>;
    listTx: ReturnType<typeof vi.fn>;
    countTx: ReturnType<typeof vi.fn>;
    softDeleteTx: ReturnType<typeof vi.fn>;
  };
  linkRepo: {
    insertTx: ReturnType<typeof vi.fn>;
    findByIdTx: ReturnType<typeof vi.fn>;
    listByFileTx: ReturnType<typeof vi.fn>;
    softDeleteTx: ReturnType<typeof vi.fn>;
  };
  accessLog: FileAccessLogService;
  accessLogSpy: ReturnType<typeof vi.fn>;
  policy: {
    canView: ReturnType<typeof vi.fn>;
    canDownload: ReturnType<typeof vi.fn>;
    canLink: ReturnType<typeof vi.fn>;
    canUnlink: ReturnType<typeof vi.fn>;
    canDelete: ReturnType<typeof vi.fn>;
    decideForLinkedFile: ReturnType<typeof vi.fn>;
  };
  storage: {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    signedUrl: ReturnType<typeof vi.fn>;
  };
  settings: { resolveMany: ReturnType<typeof vi.fn> };
  txInserts: { table: string; row: Record<string, unknown> }[];
}

function makeHarness(policyDecision: FilePolicyDecision = ALLOW): Harness {
  const txInserts: { table: string; row: Record<string, unknown> }[] = [];

  // Fake tx — records access-log inserts so we can assert access_granted/denied_reason.
  const fakeTx = {
    insert: (_table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        txInserts.push({ table: "fileAccessLogs", row });
        return { returning: async () => [row] };
      },
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
  };
  const linkRepo = {
    insertTx: vi.fn(),
    findByIdTx: vi.fn(),
    listByFileTx: vi.fn(async () => []),
    softDeleteTx: vi.fn(async () => 1),
  };

  // Real FileAccessLogService but spy its record to assert entries (it writes to fakeTx anyway).
  const accessLog = new FileAccessLogService();
  const accessLogSpy = vi.fn(accessLog.record.bind(accessLog));
  accessLog.record = accessLogSpy as typeof accessLog.record;

  const audit = { record: vi.fn(async () => undefined) };

  const policy = {
    canView: vi.fn(async () => policyDecision),
    canDownload: vi.fn(async () => policyDecision),
    canLink: vi.fn(async () => policyDecision),
    canUnlink: vi.fn(async () => policyDecision),
    canDelete: vi.fn(async () => policyDecision),
    // S2-FND-BE-4 (H1): view/download/delete now go through the link-aware decision point. The default
    // mirrors the single-file decision (returns policyDecision) so existing ALLOW/DENY cases still hold;
    // link-aware branching itself is unit-tested in file-policy.service.spec.ts.
    decideForLinkedFile: vi.fn(async () => policyDecision),
  };

  const storage = {
    get: vi.fn(async () => ({
      url: "https://signed.example/x",
      expiresAt: new Date("2026-06-24T00:05:00Z"),
    })),
    put: vi.fn(),
    delete: vi.fn(),
    signedUrl: vi.fn(),
  };

  const settings = {
    resolveMany: vi.fn(async () => [
      {
        key: "file.allowed_mime_types",
        value: ["application/pdf", "image/png"],
        scope: "default",
        found: true,
      },
      { key: "file.max_upload_size_mb", value: 25, scope: "default", found: true },
    ]),
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

  return {
    service,
    fileRepo,
    linkRepo,
    accessLog,
    accessLogSpy,
    policy,
    storage,
    settings,
    txInserts,
  };
}

const user = { id: USER, companyId: COMPANY };

// ─── Suite ──────────────────────────────────────────────────────────────────────

describe("FileService (deny-path / validation RED)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  // 1. FilePolicy DENY → 403 + access_granted=false + denied_reason ────────────────
  describe("FilePolicy DENY → 403 + access-log denied", () => {
    it("getMetadata: deny → ForbiddenException + Preview log access_granted=false + denied_reason", async () => {
      h = makeHarness(DENY);
      h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());

      await expect(h.service.getMetadata(user, FILE)).rejects.toBeInstanceOf(ForbiddenException);

      const denyLog = h.accessLogSpy.mock.calls.find((c) => c[1].action === "Preview");
      expect(denyLog).toBeDefined();
      expect(denyLog![1].accessGranted).toBe(false);
      expect(denyLog![1].deniedReason).toBe("deny-foundation");
    });

    it("download: deny → ForbiddenException + NO signed-url generated (storage.get not called)", async () => {
      h = makeHarness(DENY);
      h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());

      await expect(h.service.getDownloadUrl(user, FILE)).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.storage.get).not.toHaveBeenCalled(); // binary/url never produced on deny

      const denyLog = h.accessLogSpy.mock.calls.find((c) => c[1].action === "Download");
      expect(denyLog![1].accessGranted).toBe(false);
      expect(denyLog![1].deniedReason).toBe("deny-foundation");
    });

    it("delete: deny → ForbiddenException + soft-delete NOT performed", async () => {
      h = makeHarness(DENY);
      h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());

      await expect(h.service.deleteFile(user, FILE)).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.fileRepo.softDeleteTx).not.toHaveBeenCalled();
    });
  });

  // 1b. Missing / soft-deleted row (findByIdTx → undefined) → 404 BEFORE policy / storage ──────
  // S1-QA-FND-1 (QA05-SYS-006 / QA06-FILE-002): a soft-deleted file (repo filters deleted_at) — or a
  // cross-tenant one (RLS 0 row) — resolves to undefined ⇒ download/metadata/delete must 404 WITHOUT
  // consulting FilePolicy and WITHOUT generating a signed-url. (Integration F3 covers the real DB path;
  // this is the fast colocated unit gate for "soft-deleted is not downloadable".)
  describe("missing / soft-deleted row → 404 (no policy, no signed-url)", () => {
    it("download: row undefined (soft-deleted/cross-tenant) → NotFound, storage.get NOT called, policy NOT consulted", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(undefined);
      await expect(h.service.getDownloadUrl(user, FILE)).rejects.toBeInstanceOf(NotFoundException);
      expect(h.storage.get).not.toHaveBeenCalled();
      expect(h.policy.decideForLinkedFile).not.toHaveBeenCalled();
    });

    it("getMetadata: row undefined → NotFound, policy NOT consulted", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(undefined);
      await expect(h.service.getMetadata(user, FILE)).rejects.toBeInstanceOf(NotFoundException);
      expect(h.policy.decideForLinkedFile).not.toHaveBeenCalled();
    });

    it("delete: row undefined → NotFound, softDelete NOT called, policy NOT consulted", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(undefined);
      await expect(h.service.deleteFile(user, FILE)).rejects.toBeInstanceOf(NotFoundException);
      expect(h.fileRepo.softDeleteTx).not.toHaveBeenCalled();
      expect(h.policy.decideForLinkedFile).not.toHaveBeenCalled();
    });
  });

  // 2. upload MIME / size validation (server does not trust client) ────────────────
  describe("upload validation from system_settings (server does not trust client MIME)", () => {
    const baseUpload = {
      originalName: "report.pdf",
      declaredMimeType: "application/pdf",
      sizeBytes: 1024,
      visibility: "Private" as const,
    };

    it("MIME outside allowlist → 415, NO metadata written", async () => {
      await expect(
        h.service.upload(user, { ...baseUpload, declaredMimeType: "application/x-evil" }),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
      expect(h.fileRepo.insertTx).not.toHaveBeenCalled();
    });

    it("spoofed Content-Type claiming an allowed type but actually not in allowlist is rejected", async () => {
      // allowlist = [pdf, png]; a spoofed 'text/html' is NOT in it → rejected regardless of client claim.
      await expect(
        h.service.upload(user, { ...baseUpload, declaredMimeType: "text/html" }),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
      expect(h.fileRepo.insertTx).not.toHaveBeenCalled();
    });

    it("size over ceiling (25MB) → 413, NO metadata written", async () => {
      await expect(
        h.service.upload(user, { ...baseUpload, sizeBytes: 26 * 1024 * 1024 }),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(h.fileRepo.insertTx).not.toHaveBeenCalled();
    });

    it("valid upload writes metadata Private/Pending with server-derived extension", async () => {
      h.fileRepo.insertTx.mockImplementation(async (row) => makeFileRow(row));
      const dto = await h.service.upload(user, baseUpload);

      expect(h.fileRepo.insertTx).toHaveBeenCalledTimes(1);
      const inserted = h.fileRepo.insertTx.mock.calls[0][0];
      expect(inserted.visibility).toBe("Private");
      expect(inserted.uploadStatus).toBe("Pending");
      expect(inserted.fileExtension).toBe("pdf"); // server-derived
      expect(dto).not.toHaveProperty("storagePath");
      expect(dto).not.toHaveProperty("storedName");
    });
  });

  // 3. path-traversal filename → key always inside tenant prefix ────────────────────
  describe("filename path-traversal → server-derived key inside {companyId}/files/", () => {
    const prefix = `${COMPANY}/files/`;

    it.each([
      ["../../../etc/passwd", "passwd"],
      ["/etc/shadow", "shadow"],
      ["..\\..\\windows\\system32\\cmd.exe", "cmd.exe"],
      ["normal name.png", "normal name.png"],
    ])(
      "originalName %j → stored basename %j, storage_path inside tenant prefix",
      async (rawName, expectBase) => {
        h.fileRepo.insertTx.mockImplementation(async (row) => makeFileRow(row));
        await h.service.upload(user, {
          originalName: rawName,
          declaredMimeType: "image/png",
          sizeBytes: 16,
          visibility: "Private",
        });

        const inserted = h.fileRepo.insertTx.mock.calls[0][0];
        expect(inserted.originalName).toBe(expectBase);
        expect(String(inserted.storagePath).startsWith(prefix)).toBe(true);
        // key has exactly {companyId}/files/{uuid} shape — no traversal segment leaked from the name.
        expect(inserted.storagePath).toMatch(new RegExp(`^${COMPANY}/files/[0-9a-f-]{36}$`));
      },
    );

    it("NUL byte / control chars stripped; name reducing to empty/.. → 400", async () => {
      await expect(
        h.service.upload(user, {
          originalName: ".. ",
          declaredMimeType: "image/png",
          sizeBytes: 16,
          visibility: "Private",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.fileRepo.insertTx).not.toHaveBeenCalled();
    });
  });

  // 4. link cross-company / Infected → reject ──────────────────────────────────────
  describe("link guards", () => {
    const linkInput = {
      fileId: FILE,
      moduleCode: "HR",
      entityType: "EmployeeContract",
      entityId: randomUUID(),
      linkType: "Attachment" as const,
      accessScope: "Company" as const,
      isPrimary: false,
    };

    it("cross-company (file not visible in tenant → RLS 0 row) → 400, NO link inserted", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(undefined); // RLS filters cross-company file
      await expect(h.service.link(user, linkInput)).rejects.toBeInstanceOf(BadRequestException);
      expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
    });

    it("file.scan_status='Infected' → 400, NO link inserted", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow({ scanStatus: "Infected" }));
      await expect(h.service.link(user, linkInput)).rejects.toBeInstanceOf(BadRequestException);
      expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
    });

    it("policy DENY on link → 403 + denied access-log, NO link inserted", async () => {
      h = makeHarness(DENY);
      await expect(h.service.link(user, linkInput)).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
      const denyLog = h.accessLogSpy.mock.calls.find((c) => c[1].action === "Link");
      expect(denyLog![1].accessGranted).toBe(false);
    });
  });

  // ALLOW-path mapping coverage (DTO never leaks storage internals) ─────────────────
  describe("allow-path DTO mapping (no storage leak)", () => {
    it("getMetadata ALLOW → eager-loads links + DTO has no storagePath/storedName", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());
      h.linkRepo.listByFileTx.mockResolvedValue([
        {
          id: randomUUID(),
          fileId: FILE,
          moduleCode: "HR",
          entityType: "EmployeeContract",
          entityId: randomUUID(),
          linkType: "Contract",
          accessScope: "Company",
          isPrimary: true,
          purpose: null,
          createdAt: new Date(),
        },
      ]);

      const dto = await h.service.getMetadata(user, FILE);
      expect(dto.id).toBe(FILE);
      expect(dto.links).toHaveLength(1);
      expect(dto.links![0].linkType).toBe("Contract");
      expect(dto).not.toHaveProperty("storagePath");
      expect(dto).not.toHaveProperty("storedName");
      expect(dto).not.toHaveProperty("checksumSha256");
    });

    it("list ALLOW → {data, meta} with page/limit/total", async () => {
      h.fileRepo.listTx.mockResolvedValue([makeFileRow()]);
      h.fileRepo.countTx.mockResolvedValue(1);
      const res = await h.service.list(user, { page: 2, limit: 10 });
      expect(res.meta).toEqual({ total: 1, page: 2, limit: 10 });
      expect(res.data[0]).not.toHaveProperty("storagePath");
    });

    it("download ALLOW → DownloadUrlDto {url, expiresAt} short-TTL + Download log granted", async () => {
      // S2-FND-BE-4 (H2): a downloadable file MUST be upload_status='Uploaded' AND not scan_status='Infected'.
      // The fixture now reflects a ready file (Uploaded/Clean) so the ALLOW path reaches storage.get.
      h.fileRepo.findByIdTx.mockResolvedValue(
        makeFileRow({ uploadStatus: "Uploaded", scanStatus: "Clean" }),
      );
      const dto = await h.service.getDownloadUrl(user, FILE);
      expect(dto.url).toMatch(/^https:\/\//);
      expect(typeof dto.expiresAt).toBe("string");
      expect(dto).not.toHaveProperty("storagePath");
      const log = h.accessLogSpy.mock.calls.find((c) => c[1].action === "Download");
      expect(log![1].accessGranted).toBe(true);
    });

    it("unlink ALLOW → soft-delete repo called; 404 when link missing", async () => {
      h.linkRepo.findByIdTx.mockResolvedValue({
        id: "link-1",
        fileId: FILE,
        moduleCode: "HR",
        entityType: "EmployeeContract",
        entityId: randomUUID(),
        linkType: "Contract",
        accessScope: "Company",
        isPrimary: false,
        purpose: null,
        createdAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        companyId: COMPANY,
      });
      await h.service.unlink(user, "link-1");
      expect(h.linkRepo.softDeleteTx).toHaveBeenCalledWith(
        COMPANY,
        "link-1",
        USER,
        expect.anything(),
      );
    });

    it("unlink missing link → NotFound, policy not consulted", async () => {
      h.linkRepo.findByIdTx.mockResolvedValue(undefined);
      await expect(h.service.unlink(user, "nope")).rejects.toThrow();
      expect(h.policy.canUnlink).not.toHaveBeenCalled();
    });
  });

  // S2-FND-BE-4 — H1 link-aware fail-closed + H2 download state-guard ─────────────────
  // H1: view/download/delete load file_links and hand the decision to FilePolicy.decideForLinkedFile
  //     (the link-aware decision lives in the POLICY layer; the service is thin and does NOT re-implement
  //     a fallback for linked files). A link with no registered resolver → deny-no-resolver → 403.
  // H2: getDownloadUrl, AFTER authz ALLOW, blocks non-downloadable states (upload_status != 'Uploaded'
  //     OR scan_status == 'Infected') BEFORE storage.get → 409 + deny-log (never a signed URL for those).
  describe("H1 link-aware DENY + H2 download state-guard", () => {
    const twoLinks = [
      {
        id: "l1",
        fileId: FILE,
        moduleCode: "HR",
        entityType: "EmployeeContract",
        entityId: randomUUID(),
        linkType: "Contract",
        accessScope: "Company",
        isPrimary: true,
        purpose: null,
        createdAt: new Date(),
      },
      {
        id: "l2",
        fileId: FILE,
        moduleCode: "LEAVE",
        entityType: "LeaveAttachment",
        entityId: randomUUID(),
        linkType: "Attachment",
        accessScope: "Company",
        isPrimary: false,
        purpose: null,
        createdAt: new Date(),
      },
    ];

    it("getDownloadUrl: linked file → decideForLinkedFile(links) DENY (deny-no-resolver) → 403, storage NOT called, deny-log", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(
        makeFileRow({ uploadStatus: "Uploaded", scanStatus: "Clean" }),
      );
      h.linkRepo.listByFileTx.mockResolvedValue(twoLinks);
      h.policy.decideForLinkedFile.mockResolvedValue({ allow: false, reason: "deny-no-resolver" });

      await expect(h.service.getDownloadUrl(user, FILE)).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.storage.get).not.toHaveBeenCalled();
      // policy received the loaded links (link-aware decision is made in the POLICY layer, not the service).
      const call = h.policy.decideForLinkedFile.mock.calls[0];
      expect(call[1]).toHaveLength(2);
      const denyLog = h.accessLogSpy.mock.calls.find((c) => c[1].action === "Download");
      expect(denyLog![1].accessGranted).toBe(false);
      expect(denyLog![1].deniedReason).toBe("deny-no-resolver");
    });

    it("getMetadata: linked file → decideForLinkedFile DENY → 403 (view is link-aware too)", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());
      h.linkRepo.listByFileTx.mockResolvedValue(twoLinks);
      h.policy.decideForLinkedFile.mockResolvedValue({ allow: false, reason: "deny-no-resolver" });
      await expect(h.service.getMetadata(user, FILE)).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.policy.decideForLinkedFile).toHaveBeenCalledTimes(1);
    });

    it("deleteFile: linked file → decideForLinkedFile DENY → 403, softDelete NOT called", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow());
      h.linkRepo.listByFileTx.mockResolvedValue(twoLinks);
      h.policy.decideForLinkedFile.mockResolvedValue({ allow: false, reason: "deny-no-resolver" });
      await expect(h.service.deleteFile(user, FILE)).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.fileRepo.softDeleteTx).not.toHaveBeenCalled();
    });

    it("H2: authz ALLOW but upload_status='Pending' → 409, storage NOT called, deny-log 'not-uploaded'", async () => {
      // default harness policy = ALLOW; 0 links ⇒ foundation-owned; state-guard is the ONLY blocker.
      h.fileRepo.findByIdTx.mockResolvedValue(
        makeFileRow({ uploadStatus: "Pending", scanStatus: "NotRequired" }),
      );
      await expect(h.service.getDownloadUrl(user, FILE)).rejects.toBeInstanceOf(ConflictException);
      expect(h.storage.get).not.toHaveBeenCalled();
      const denyLog = h.accessLogSpy.mock.calls.find((c) => c[1].action === "Download");
      expect(denyLog![1].accessGranted).toBe(false);
      expect(denyLog![1].deniedReason).toBe("not-uploaded");
    });

    it("H2: authz ALLOW but scan_status='Infected' → 409, storage NOT called, deny-log 'infected'", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(
        makeFileRow({ uploadStatus: "Uploaded", scanStatus: "Infected" }),
      );
      await expect(h.service.getDownloadUrl(user, FILE)).rejects.toBeInstanceOf(ConflictException);
      expect(h.storage.get).not.toHaveBeenCalled();
      const denyLog = h.accessLogSpy.mock.calls.find((c) => c[1].action === "Download");
      expect(denyLog![1].deniedReason).toBe("infected");
    });

    // S2-FND-BE-4 (H2, acceptance-criterion lock): ONLY 'Infected' blocks a fully-Uploaded file. AV is
    // not yet wired (default scan_status='NotRequired'), so an Uploaded file whose scan is still
    // Pending/Failed — or Clean/NotRequired — MUST still presign. This locks "scan Pending/Failed vẫn
    // tải" against a future over-restrictive regression (Đội-3 flagged only Clean/NotRequired was tested).
    it.each(["Pending", "Failed", "NotRequired", "Clean"] as const)(
      "H2: Uploaded + scan_status='%s' (not Infected) still presigns → DownloadUrlDto + Download log granted",
      async (scanStatus) => {
        h.fileRepo.findByIdTx.mockResolvedValue(
          makeFileRow({ uploadStatus: "Uploaded", scanStatus }),
        );
        const dto = await h.service.getDownloadUrl(user, FILE);
        expect(dto.url).toMatch(/^https:\/\//);
        expect(typeof dto.expiresAt).toBe("string");
        expect(h.storage.get).toHaveBeenCalledTimes(1);
        const log = h.accessLogSpy.mock.calls.find((c) => c[1].action === "Download");
        expect(log![1].accessGranted).toBe(true);
      },
    );

    it("H2 does NOT restrict view: metadata of a Pending/Infected file (authz ALLOW) → 200 DTO", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(
        makeFileRow({ uploadStatus: "Pending", scanStatus: "Infected" }),
      );
      const dto = await h.service.getMetadata(user, FILE);
      expect(dto.id).toBe(FILE);
      expect(dto.uploadStatus).toBe("Pending");
      expect(dto.scanStatus).toBe("Infected");
    });
  });
});

// 7. audit masking — storage_path/signed_url → '***' ────────────────────────────────
describe("AuditService masking (storage_path / signed_url → '***')", () => {
  it("masks before/after keys containing storage_path and signed_url", async () => {
    const audit = new AuditService();
    const captured: Record<string, unknown>[] = [];
    const tx = {
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          captured.push(row);
        },
      }),
    };

    await audit.record(tx as never, {
      action: "FileUploaded",
      objectType: "file",
      objectId: FILE,
      after: {
        storage_path: `${COMPANY}/files/${FILE}`,
        signed_url: "https://x/y?sig=abc",
        originalName: "doc.pdf",
      },
    });

    const row = captured[0];
    const after = row.after as Record<string, unknown>;
    expect(after.storage_path).toBe("***");
    expect(after.signed_url).toBe("***");
    expect(after.originalName).toBe("doc.pdf"); // non-sensitive preserved
  });
});
