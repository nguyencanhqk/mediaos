/**
 * S19-SEC-FILEMETAGATE-1 — danh sách tệp FOUNDATION: tên/cỡ/chủ tệp của một hàng đi theo quyết định XEM
 * của chính người gọi cho đúng tệp đó (plan `docs/plans/S19-SEC-FILEMETAGATE-1.md` §2 bất biến 1, 2, 5 · D-1 · D-1b · D-4 · D-5).
 *
 * Unit, không DB: `withTenant` gọi callback với một tx giả. Ca DB thật (RLS, resolver thật, phân trang hai
 * trang) nằm ở `test/integration/s19-sec-filemetagate-1.int-spec.ts`.
 *
 * U-1 mapper che đúng bốn trường · U-2 quyết định chạy SAU tx · U-3 tách link sống / đã-từng-link từ MỘT lô ·
 * U-4 action View + đầu vào chung · U-5 log · U-6 một truy vấn link, có `company_id` · U-8 một nguồn vị từ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as viewDecision from "./file-view-decision";
import { toFileListItemDto, toFileMetadataDto } from "./file-metadata.mapper";
import { FileListService } from "./file-list.service";
import { FileLinkRepository } from "./file-link.repository";
import { FilePolicyAction, type FilePolicyDecision } from "./file-policy.types";
import { FileService } from "./files.service";

// Bọc hàm thật bằng spy — U-8 đếm ai gọi vị từ chung, hành vi giữ nguyên.
vi.mock("./file-view-decision", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./file-view-decision")>();
  return {
    ...actual,
    fileSelfPolicyInput: vi.fn(actual.fileSelfPolicyInput),
    toFileLinkRef: vi.fn(actual.toFileLinkRef),
  };
});

const COMPANY = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OWNER = "44444444-4444-4444-8444-444444444444";
const fid = (n: number): string => `33333333-3333-4333-8333-${String(n).padStart(12, "a")}`;

const ALLOW: FilePolicyDecision = { allow: true, reason: "allow-resolver" };
const DENY: FilePolicyDecision = { allow: false, reason: "deny-resolver" };
const DENY_NO_RESOLVER: FilePolicyDecision = { allow: false, reason: "deny-no-resolver" };
const DENY_ERROR: FilePolicyDecision = { allow: false, reason: "deny-error" };

function fileRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    companyId: COMPANY,
    originalName: `ten-tep-${id.slice(-4)}.pdf`,
    storedName: id,
    fileExtension: "pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 4096,
    storageProvider: "MinIO",
    storageBucket: null,
    storagePath: `${COMPANY}/files/${id}`,
    checksumSha256: null,
    contentHash: null,
    visibility: "Private",
    uploadStatus: "Uploaded",
    scanStatus: "Clean",
    scanResult: null,
    ownerUserId: OWNER,
    uploadedBy: OWNER,
    uploadedAt: new Date("2026-10-01T00:00:00Z"),
    lastAccessedAt: null,
    downloadCount: 2,
    isTemporary: false,
    expiresAt: null,
    retentionUntil: null,
    metadata: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function linkRow(
  fileId: string,
  opts: { module?: string; entity?: string; deleted?: boolean } = {},
) {
  return {
    id: `55555555-5555-4555-8555-${fileId.slice(-12)}`,
    companyId: COMPANY,
    fileId,
    moduleCode: opts.module ?? "SOCIAL",
    entityType: opts.entity ?? "feed_post",
    entityId: `66666666-6666-4666-8666-${fileId.slice(-12)}`,
    linkType: "Attachment",
    accessScope: "Company",
    isPrimary: false,
    sortOrder: 0,
    purpose: null,
    createdBy: OWNER,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    deletedAt: opts.deleted ? new Date("2026-10-02T00:00:00Z") : null,
    deletedBy: null,
  };
}

const user = { id: USER, companyId: COMPANY, email: "viewer@fmg.test" } as never;

interface Harness {
  service: FileListService;
  tx: object;
  inTx: () => boolean;
  db: { withTenant: ReturnType<typeof vi.fn> };
  fileRepo: { listTx: ReturnType<typeof vi.fn>; countTx: ReturnType<typeof vi.fn> };
  linkRepo: {
    listAllByFileIdsTx: ReturnType<typeof vi.fn>;
    listByFileTx: ReturnType<typeof vi.fn>;
    hasEverBeenLinkedTx: ReturnType<typeof vi.fn>;
  };
  policy: { decideForLinkedFile: ReturnType<typeof vi.fn> };
}

function makeHarness(
  rows: ReturnType<typeof fileRow>[],
  links: ReturnType<typeof linkRow>[],
): Harness {
  const tx = { __tx: "fake" };
  let active = false;
  const db = {
    withTenant: vi.fn(async (_companyId: string, fn: (t: object) => Promise<unknown>) => {
      active = true;
      try {
        return await fn(tx);
      } finally {
        active = false;
      }
    }),
  };
  const fileRepo = {
    listTx: vi.fn().mockResolvedValue(rows),
    countTx: vi.fn().mockResolvedValue(rows.length),
  };
  const linkRepo = {
    listAllByFileIdsTx: vi.fn().mockResolvedValue(links),
    listByFileTx: vi.fn().mockResolvedValue([]),
    hasEverBeenLinkedTx: vi.fn().mockResolvedValue(false),
  };
  const policy = { decideForLinkedFile: vi.fn().mockResolvedValue(ALLOW) };
  const service = new FileListService(
    db as never,
    fileRepo as never,
    linkRepo as never,
    policy as never,
  );
  return { service, tx, inTx: () => active, db, fileRepo, linkRepo, policy };
}

const MASKED_KEYS = ["originalName", "fileExtension", "sizeBytes", "ownerUserId"] as const;

describe("S19-SEC-FILEMETAGATE-1 · danh sách tệp theo quyết định xem từng tệp (unit)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  const errorLines = (): string[] =>
    errorSpy.mock.calls.map((args: unknown[]) => args.map((a) => String(a)).join(" "));

  // ── U-1 ──────────────────────────────────────────────────────────────────
  it("U-1 mapper: hàng bị từ chối che đúng bốn trường, giữ nguyên phần còn lại", () => {
    const row = fileRow(fid(1));
    const full = toFileMetadataDto(row as never, []);
    const masked = toFileListItemDto(row as never, false);
    for (const k of MASKED_KEYS) expect(masked[k], `che ${k}`).toBeNull();
    const keep = [
      "id",
      "mimeType",
      "visibility",
      "uploadStatus",
      "scanStatus",
      "uploadedAt",
      "downloadCount",
      "isTemporary",
    ] as const;
    for (const k of keep) expect(masked[k], `giữ ${k}`).toEqual(full[k]);
    expect(masked.links, "hàng danh sách không eager-load link").toEqual([]);
    expect(JSON.stringify(masked), "không mang tên tệp ở bất kỳ trường nào").not.toContain(
      row.originalName,
    );
    expect(masked).not.toHaveProperty("storagePath");
    expect(masked).not.toHaveProperty("storedName");
  });

  it("U-1a mapper: hàng được phép = đúng DTO theo id (links rỗng) — ALLOW đứng cạnh", () => {
    const row = fileRow(fid(2));
    expect(toFileListItemDto(row as never, true)).toEqual(toFileMetadataDto(row as never, []));
    expect(toFileListItemDto(row as never, true).originalName).toBe(row.originalName);
    expect(toFileListItemDto(row as never, true).ownerUserId).toBe(OWNER);
  });

  // ── U-2 ──────────────────────────────────────────────────────────────────
  it("U-2 quyết định chạy SAU khi tx đóng (không lồng withTenant), đúng một tx cho hàng + total + link", async () => {
    const rows = [fileRow(fid(3)), fileRow(fid(4))];
    const h = makeHarness(rows, []);
    const seenInTx: boolean[] = [];
    h.policy.decideForLinkedFile.mockImplementation(async () => {
      seenInTx.push(h.inTx());
      return ALLOW;
    });
    await h.service.list(user, { page: 1, limit: 20 } as never);
    expect(seenInTx, "mỗi hàng một quyết định").toHaveLength(2);
    expect(
      seenInTx.every((v) => v === false),
      "quyết định nằm NGOÀI tx",
    ).toBe(true);
    expect(h.db.withTenant, "hàng + total + link trong CÙNG một withTenant").toHaveBeenCalledTimes(
      1,
    );
    expect(
      h.linkRepo.listAllByFileIdsTx.mock.calls[0]![2],
      "lô link dùng chính tx của listTx",
    ).toBe(h.fileRepo.listTx.mock.calls[0]![2]);
  });

  // ── U-3 ──────────────────────────────────────────────────────────────────
  it("U-3 một lô link ⇒ tách link SỐNG và cờ đã-từng-link cho từng tệp", async () => {
    const a = fid(5);
    const b = fid(6);
    const c = fid(7);
    const h = makeHarness(
      [fileRow(a), fileRow(b), fileRow(c)],
      [
        linkRow(a),
        linkRow(a, { module: "TASK", entity: "task", deleted: true }),
        linkRow(b, { deleted: true }),
      ],
    );
    await h.service.list(user, { page: 1, limit: 20 } as never);
    const byFile = new Map(
      h.policy.decideForLinkedFile.mock.calls.map((call: unknown[]) => [
        (call[0] as { fileId: string }).fileId,
        { links: call[1], everLinked: call[3] },
      ]),
    );
    expect(byFile.get(a), "a: chỉ link sống đi vào quyết định").toEqual({
      links: [{ moduleCode: "SOCIAL", entityType: "feed_post", entityId: linkRow(a).entityId }],
      everLinked: true,
    });
    expect(byFile.get(b), "b: chỉ còn link đã gỡ ⇒ links rỗng + everLinked").toEqual({
      links: [],
      everLinked: true,
    });
    expect(byFile.get(c), "c: chưa từng link").toEqual({ links: [], everLinked: false });
  });

  // ── U-4 ──────────────────────────────────────────────────────────────────
  it("U-4 action = View, đầu vào = khuôn tệp-tự-thân của GET /:id (không phải Download)", async () => {
    const id = fid(8);
    const h = makeHarness([fileRow(id)], []);
    await h.service.list(user, { page: 1, limit: 20 } as never);
    const [input, , action] = h.policy.decideForLinkedFile.mock.calls[0]!;
    expect(action).toBe(FilePolicyAction.View);
    expect(input).toEqual({
      companyId: COMPANY,
      userId: USER,
      fileId: id,
      moduleCode: "FOUNDATION",
      entityType: "File",
      entityId: id,
      action: FilePolicyAction.View,
    });
  });

  it("U-4a DENY che hàng, ALLOW cạnh đó giữ đủ trường; không bỏ hàng, total giữ nguyên", async () => {
    const denied = fid(9);
    const allowed = fid(10);
    const h = makeHarness([fileRow(denied), fileRow(allowed)], []);
    h.fileRepo.countTx.mockResolvedValue(57);
    h.policy.decideForLinkedFile.mockImplementation(async (input: { fileId: string }) =>
      input.fileId === denied ? DENY : ALLOW,
    );
    const res = await h.service.list(user, { page: 3, limit: 2 } as never);
    expect(
      res.data.map((r) => r.id),
      "giữ hàng, giữ thứ tự",
    ).toEqual([denied, allowed]);
    expect(res.meta).toEqual({ total: 57, page: 3, limit: 2 });
    for (const k of MASKED_KEYS) expect(res.data[0]![k], `hàng DENY che ${k}`).toBeNull();
    expect(res.data[1]!.originalName).toBe(fileRow(allowed).originalName);
    expect(res.data[1]!.sizeBytes).toBe(4096);
    expect(res.data[1]!.ownerUserId).toBe(OWNER);
    expect(JSON.stringify(res)).not.toContain(fileRow(denied).originalName);
  });

  // ── U-5 ──────────────────────────────────────────────────────────────────
  it("U-5 N hàng deny-no-resolver ⇒ đúng MỘT logger.error: số hàng + (module, entity) + ≤ 5 fileId, không tên tệp", async () => {
    const ids = [11, 12, 13, 14, 15, 16, 17].map(fid);
    const h = makeHarness(
      ids.map((id) => fileRow(id)),
      ids.map((id) => linkRow(id, { module: "LEAVE", entity: "leave_request" })),
    );
    h.policy.decideForLinkedFile.mockResolvedValue(DENY_NO_RESOLVER);
    const res = await h.service.list(user, { page: 1, limit: 20 } as never);
    expect(
      res.data.every((r) => r.originalName === null),
      "mọi hàng bị che",
    ).toBe(true);
    const lines = errorLines();
    expect(lines, "một dòng mỗi request, không phải mỗi hàng").toHaveLength(1);
    const line = lines[0]!;
    expect(line).toMatch(/\b7\b/);
    expect(line).toContain("LEAVE");
    expect(line).toContain("leave_request");
    const idsInLine = ids.filter((id) => line.includes(id)).length;
    expect(idsInLine, "có fileId để tra").toBeGreaterThan(0);
    expect(idsInLine, "≤ 5 fileId").toBeLessThanOrEqual(5);
    for (const id of ids) expect(line).not.toContain(fileRow(id).originalName);
  });

  it("U-5a deny-error ⇒ danh sách KHÔNG ghi thêm (policy đã log); deny thường ⇒ không log; hàng vẫn che", async () => {
    const e = fid(18);
    const d = fid(19);
    const ok = fid(20);
    const h = makeHarness([fileRow(e), fileRow(d), fileRow(ok)], []);
    h.policy.decideForLinkedFile.mockImplementation(async (input: { fileId: string }) =>
      input.fileId === e ? DENY_ERROR : input.fileId === d ? DENY : ALLOW,
    );
    const res = await h.service.list(user, { page: 1, limit: 20 } as never);
    expect(errorLines(), "không log ở danh sách").toEqual([]);
    expect(res.data[0]!.originalName).toBeNull();
    expect(res.data[1]!.originalName).toBeNull();
    expect(res.data[2]!.originalName).toBe(fileRow(ok).originalName);
  });

  it("U-5b trộn deny-no-resolver + deny-error ⇒ vẫn đúng MỘT dòng", async () => {
    const n1 = fid(21);
    const n2 = fid(22);
    const e = fid(23);
    const h = makeHarness([fileRow(n1), fileRow(n2), fileRow(e)], []);
    h.policy.decideForLinkedFile.mockImplementation(async (input: { fileId: string }) =>
      input.fileId === e ? DENY_ERROR : DENY_NO_RESOLVER,
    );
    await h.service.list(user, { page: 1, limit: 20 } as never);
    expect(errorLines()).toHaveLength(1);
  });

  it("U-5c quyết định ném ⇒ KHÔNG thành ALLOW (ném lên hoặc che — không lộ tên)", async () => {
    const id = fid(24);
    const h = makeHarness([fileRow(id)], []);
    h.policy.decideForLinkedFile.mockRejectedValue(new Error("boom"));
    let body = "";
    try {
      body = JSON.stringify(await h.service.list(user, { page: 1, limit: 20 } as never));
    } catch {
      body = "";
    }
    expect(body, "lỗi quyết định không được mở tên tệp").not.toContain(fileRow(id).originalName);
  });

  // ── U-6 ──────────────────────────────────────────────────────────────────
  it("U-6 MỘT truy vấn link cho N hàng, có company_id; không dùng hai hàm theo-từng-tệp", async () => {
    const ids = [25, 26, 27, 28].map(fid);
    const h = makeHarness(
      ids.map((id) => fileRow(id)),
      [],
    );
    await h.service.list(user, { page: 1, limit: 20 } as never);
    expect(h.linkRepo.listAllByFileIdsTx).toHaveBeenCalledTimes(1);
    const [companyId, batch] = h.linkRepo.listAllByFileIdsTx.mock.calls[0]!;
    expect(companyId).toBe(COMPANY);
    expect([...(batch as string[])].sort()).toEqual([...ids].sort());
    expect(h.linkRepo.listByFileTx, "không N+1").not.toHaveBeenCalled();
    expect(h.linkRepo.hasEverBeenLinkedTx, "không N+1").not.toHaveBeenCalled();
  });

  it("U-6a 0 hàng ⇒ 0 quyết định, data rỗng, total giữ", async () => {
    const h = makeHarness([], []);
    h.fileRepo.countTx.mockResolvedValue(0);
    const res = await h.service.list(user, { page: 1, limit: 20 } as never);
    expect(res.data).toEqual([]);
    expect(res.meta.total).toBe(0);
    expect(h.policy.decideForLinkedFile).not.toHaveBeenCalled();
  });

  it("U-6b repo listAllByFileIdsTx: điều kiện có company_id + file_id IN, KHÔNG lọc deleted_at; ids rỗng ⇒ không truy vấn", async () => {
    const repo = new FileLinkRepository();
    let where: unknown;
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn((cond: unknown) => {
        where = cond;
        return Promise.resolve([]);
      }),
    };
    const tx = { select: vi.fn(() => chain) };

    expect(await repo.listAllByFileIdsTx(COMPANY, [], tx as never)).toEqual([]);
    expect(tx.select, "ids rỗng ⇒ không chạm DB").not.toHaveBeenCalled();

    const ids = [fid(29), fid(30)];
    await repo.listAllByFileIdsTx(COMPANY, ids, tx as never);
    expect(tx.select).toHaveBeenCalledTimes(1);
    const q = new PgDialect().sqlToQuery(where as never);
    expect(q.sql).toMatch(/"company_id"\s*=\s*\$\d+/);
    expect(q.sql).toMatch(/"file_id"\s+in\s*\(/i);
    expect(q.sql, "giữ link đã gỡ để tính everLinked").not.toContain("deleted_at");
    expect(q.params).toContain(COMPANY);
    for (const id of ids) expect(q.params).toContain(id);
  });

  // ── U-8 ──────────────────────────────────────────────────────────────────
  it("U-8 một nguồn: GET /:id và danh sách cùng gọi hàm export của file-view-decision", async () => {
    const id = fid(31);
    const h = makeHarness([fileRow(id)], [linkRow(id)]);
    await h.service.list(user, { page: 1, limit: 20 } as never);
    expect(viewDecision.fileSelfPolicyInput).toHaveBeenCalledWith(user, id, FilePolicyAction.View);
    expect(viewDecision.toFileLinkRef).toHaveBeenCalled();

    vi.mocked(viewDecision.fileSelfPolicyInput).mockClear();
    vi.mocked(viewDecision.toFileLinkRef).mockClear();
    const tx = {};
    const db = { withTenant: vi.fn(async (_c: string, fn: (t: object) => unknown) => fn(tx)) };
    const fileRepo = { findByIdTx: vi.fn().mockResolvedValue(fileRow(id)) };
    const linkRepo = {
      listByFileTx: vi.fn().mockResolvedValue([linkRow(id)]),
      hasEverBeenLinkedTx: vi.fn().mockResolvedValue(true),
    };
    const policy = { decideForLinkedFile: vi.fn().mockResolvedValue(ALLOW) };
    const files = new FileService(
      db as never,
      fileRepo as never,
      linkRepo as never,
      {} as never,
      {} as never,
      policy as never,
      {} as never,
      {} as never,
    );
    await files.getMetadata(user, id);
    expect(viewDecision.fileSelfPolicyInput).toHaveBeenCalledWith(user, id, FilePolicyAction.View);
    expect(viewDecision.toFileLinkRef).toHaveBeenCalled();
  });

  it("U-8a mã nguồn: danh sách không tự dựng đầu vào; files.service không còn bản sao private", () => {
    const listSrc = readFileSync(join(__dirname, "file-list.service.ts"), "utf8");
    expect(listSrc).not.toMatch(/FOUNDATION_(ENTITY|MODULE)|moduleCode:\s*["']FOUNDATION["']/);
    const filesSrc = readFileSync(join(__dirname, "files.service.ts"), "utf8");
    expect(filesSrc).not.toMatch(/private\s+(policyInputForFile|toLinkRef)\s*\(/);
  });
});
