import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FilePolicyAction, type FilePermissionInput } from "../foundation/files/file-policy.types";
import { RecruitCandidateFileResolver } from "./recruit-candidate-file.resolver";

/**
 * S14-RECRUIT-FILEGRANT-1 — `RecruitCandidateFileResolver.canLinkFile` có NĂM vế trạng thái/sở hữu
 * cộng một vế cặp-quyền. Spec này ĐỘT BIẾN **TỪNG VẾ MỘT** từ một trạng thái nền ALLOW.
 *
 * Vì sao từng vế: gỡ cả cụm rồi khẳng định "deny" không chứng minh vế nào đang chặn — cổng chồng nhau
 * làm deny-spec xanh RỖNG (`overdetermined-gate-makes-deny-spec-vacuous`). Ca `ALLOW nền` ở đầu mỗi
 * nhóm là chốt chặn: nếu nó đỏ thì mọi ca deny bên dưới thành vô nghĩa
 * (`deny-cases-vacuous-without-allow-case`).
 *
 * Ca `canUnlinkFile`/`canDeleteFile` ghim BẤT ĐỐI XỨNG CÓ CHỦ ĐÍCH: cặp `upload:candidate-file` mở
 * đường GẮN nhưng KHÔNG mở đường gỡ/xoá. Ca này đo được ở đây chứ không đo được qua HTTP — route
 * FOUNDATION tương ứng còn bị decorator `unlink:foundation-file` chặn TRƯỚC, nên ca HTTP sẽ xanh vì
 * lý do SAI (`overdetermined-gate-makes-deny-spec-vacuous`, plan §7.2).
 */

const COMPANY = "c1";
const ACTOR = "u1";
const CANDIDATE = "cand-1";
const FILE = "file-1";

const INPUT: FilePermissionInput = {
  companyId: COMPANY,
  userId: ACTOR,
  fileId: FILE,
  moduleCode: "RECRUIT",
  entityType: "candidate",
  entityId: CANDIDATE,
  action: FilePolicyAction.Link,
};

interface Overrides {
  /** Kết quả `resolveManyOrNull` cho [create:candidate, update:candidate, upload:candidate-file]. */
  writeScopes?: (string | null)[];
  /** Kết quả `resolveOrNull` (đường đọc/xoá) — `null` = không có cặp. */
  readScope?: string | null;
  file?: {
    ownerUserId: string;
    uploadStatus: string;
    scanStatus: string;
  } | null;
  everLinked?: boolean;
  candidateLive?: boolean;
}

function makeResolver(over: Overrides = {}) {
  const resolveManyOrNull = vi.fn().mockResolvedValue(over.writeScopes ?? [null, null, "Company"]);
  const resolveOrNull = vi
    .fn()
    .mockResolvedValue(over.readScope === undefined ? "Company" : over.readScope);
  const findByIdTx = vi
    .fn()
    .mockResolvedValue(
      over.file === undefined
        ? { ownerUserId: ACTOR, uploadStatus: "Uploaded", scanStatus: "Clean" }
        : over.file,
    );
  const hasEverBeenLinkedTx = vi.fn().mockResolvedValue(over.everLinked ?? false);
  const findTx = vi.fn().mockResolvedValue((over.candidateLive ?? true) ? { id: CANDIDATE } : null);

  const db = {
    withTenant: vi.fn((_c: string, fn: (tx: unknown) => unknown) => fn({})),
  };
  const resolver = new RecruitCandidateFileResolver(
    db as never,
    { resolveManyOrNull, resolveOrNull } as never,
    { findTx } as never,
    { findByIdTx } as never,
    { hasEverBeenLinkedTx } as never,
  );
  return { resolver, resolveManyOrNull, resolveOrNull, findByIdTx, hasEverBeenLinkedTx, findTx };
}

beforeEach(() => vi.clearAllMocks());

describe("canLinkFile — đột biến TỪNG VẾ của năm vế + vế cặp quyền", () => {
  it("ALLOW nền: đủ sáu vế (chỉ có `upload:candidate-file`, đúng hình dạng role `hr`) ⇒ true", async () => {
    const { resolver } = makeResolver();
    expect(await resolver.canLinkFile(INPUT)).toBe(true);
  });

  it("ALLOW: chỉ có `create:candidate` (hình dạng role `recruiter`) ⇒ true", async () => {
    const { resolver } = makeResolver({ writeScopes: ["Company", null, null] });
    expect(await resolver.canLinkFile(INPUT)).toBe(true);
  });

  it("ALLOW: chỉ có `update:candidate` ⇒ true", async () => {
    const { resolver } = makeResolver({ writeScopes: [null, "Company", null] });
    expect(await resolver.canLinkFile(INPUT)).toBe(true);
  });

  // ── vế 1: fileId ────────────────────────────────────────────────────────────

  it("vế 1 — `fileId` vắng (pre-link check) ⇒ DENY, KHÔNG chạm DB và KHÔNG hỏi quyền", async () => {
    const { resolver, resolveManyOrNull, findByIdTx } = makeResolver();
    expect(await resolver.canLinkFile({ ...INPUT, fileId: undefined })).toBe(false);
    expect(resolveManyOrNull).not.toHaveBeenCalled();
    expect(findByIdTx).not.toHaveBeenCalled();
  });

  // ── vế 2: chủ sở hữu tệp ────────────────────────────────────────────────────

  it("vế 2 — tệp của NGƯỜI KHÁC ⇒ DENY (chốt chặn tại nguồn, không mượn kênh CV phát tán tệp)", async () => {
    const { resolver } = makeResolver({
      file: { ownerUserId: "someone-else", uploadStatus: "Uploaded", scanStatus: "Clean" },
    });
    expect(await resolver.canLinkFile(INPUT)).toBe(false);
  });

  // ── vế 3: upload_status ─────────────────────────────────────────────────────

  it("vế 3 — tệp còn `Pending` (chưa PUT bytes) ⇒ DENY", async () => {
    const { resolver } = makeResolver({
      file: { ownerUserId: ACTOR, uploadStatus: "Pending", scanStatus: "Clean" },
    });
    expect(await resolver.canLinkFile(INPUT)).toBe(false);
  });

  // ── vế 4: scan_status ───────────────────────────────────────────────────────

  it("vế 4 — `scan_status='Infected'` ⇒ DENY", async () => {
    const { resolver } = makeResolver({
      file: { ownerUserId: ACTOR, uploadStatus: "Uploaded", scanStatus: "Infected" },
    });
    expect(await resolver.canLinkFile(INPUT)).toBe(false);
  });

  it("vế 4 — `scan_status='Pending'` (chưa quét) ⇒ DENY, CHẶT HƠN FileService (nó chỉ chặn Infected)", async () => {
    const { resolver } = makeResolver({
      file: { ownerUserId: ACTOR, uploadStatus: "Uploaded", scanStatus: "Pending" },
    });
    expect(await resolver.canLinkFile(INPUT)).toBe(false);
  });

  it("vế 4 — `scan_status='NotRequired'` vẫn ALLOW (đường thường của tenant không bật scan)", async () => {
    const { resolver } = makeResolver({
      file: { ownerUserId: ACTOR, uploadStatus: "Uploaded", scanStatus: "NotRequired" },
    });
    expect(await resolver.canLinkFile(INPUT)).toBe(true);
  });

  // ── vế 5: chưa từng link ────────────────────────────────────────────────────

  it("[crown] vế 5 — tệp ĐÃ TỪNG có link (kể cả đã gỡ = THU HỒI) ⇒ DENY", async () => {
    // Đây là vế chống bypass thu hồi: thiếu nó, gắn lại tệp đã gỡ vào một ứng viên bất kỳ làm
    // `decideForLinkedFile` hết rơi nhánh links-rỗng ⇒ đường tải mở lại VĨNH VIỄN.
    const { resolver } = makeResolver({ everLinked: true });
    expect(await resolver.canLinkFile(INPUT)).toBe(false);
  });

  it("vế 5 — tệp không tồn tại / khác tenant (RLS 0 hàng) ⇒ DENY", async () => {
    const { resolver, hasEverBeenLinkedTx } = makeResolver({ file: null });
    expect(await resolver.canLinkFile(INPUT)).toBe(false);
    expect(hasEverBeenLinkedTx).not.toHaveBeenCalled();
  });

  // ── vế 6: cặp quyền + ứng viên sống ─────────────────────────────────────────

  it("vế 6a — KHÔNG cặp ghi nào ⇒ DENY TRƯỚC khi chạm DB tệp", async () => {
    const { resolver, findByIdTx } = makeResolver({ writeScopes: [null, null, null] });
    expect(await resolver.canLinkFile(INPUT)).toBe(false);
    expect(findByIdTx).not.toHaveBeenCalled();
  });

  it("vế 6a — cả ba cặp ghi đều hỏi với `isSensitive: true` (wildcard KHÔNG kế thừa)", async () => {
    const { resolver, resolveManyOrNull } = makeResolver();
    await resolver.canLinkFile(INPUT);
    expect(resolveManyOrNull).toHaveBeenCalledWith(ACTOR, COMPANY, [
      { action: "create", resourceType: "candidate", isSensitive: true },
      { action: "update", resourceType: "candidate", isSensitive: true },
      { action: "upload", resourceType: "candidate-file", isSensitive: true },
    ]);
  });

  it("vế 6b — ứng viên không tồn tại/xoá mềm/khác tenant ⇒ DENY", async () => {
    const { resolver } = makeResolver({ candidateLive: false });
    expect(await resolver.canLinkFile(INPUT)).toBe(false);
  });
});

describe("canUnlinkFile / canDeleteFile — bất đối xứng CÓ CHỦ ĐÍCH", () => {
  it("[crown] `upload:candidate-file` KHÔNG mở đường gỡ link", async () => {
    // `resolveOrNull` chỉ được hỏi cho create/update:candidate; ở đây cả hai đều null.
    const { resolver, resolveOrNull } = makeResolver({ readScope: null });
    expect(await resolver.canUnlinkFile(INPUT)).toBe(false);
    expect(resolveOrNull).toHaveBeenCalledWith(ACTOR, COMPANY, "create", "candidate", {
      isSensitive: true,
    });
    expect(resolveOrNull).toHaveBeenCalledWith(ACTOR, COMPANY, "update", "candidate", {
      isSensitive: true,
    });
    expect(
      resolveOrNull.mock.calls.some((c: unknown[]) => c[3] === "candidate-file"),
      "canUnlinkFile KHÔNG được hỏi cặp candidate-file",
    ).toBe(false);
  });

  it("[crown] `upload:candidate-file` KHÔNG mở đường xoá tệp", async () => {
    const { resolver, resolveOrNull } = makeResolver({ readScope: null });
    expect(await resolver.canDeleteFile(INPUT)).toBe(false);
    expect(
      resolveOrNull.mock.calls.some((c: unknown[]) => c[3] === "candidate-file"),
      "canDeleteFile KHÔNG được hỏi cặp candidate-file",
    ).toBe(false);
  });

  it("ALLOW đối chứng: có `create`/`update:candidate` ⇒ gỡ/xoá được (ca deny trên không xanh-rỗng)", async () => {
    const { resolver } = makeResolver({ readScope: "Company" });
    expect(await resolver.canUnlinkFile(INPUT)).toBe(true);
    expect(await resolver.canDeleteFile(INPUT)).toBe(true);
  });
});

describe("canViewFile / canDownloadFile — cặp đọc KHÔNG đổi", () => {
  it("`view:candidate` (isSensitive) mở CẢ metadata lẫn tải", async () => {
    const { resolver, resolveOrNull } = makeResolver({ readScope: "Company" });
    expect(await resolver.canViewFile(INPUT)).toBe(true);
    expect(await resolver.canDownloadFile(INPUT)).toBe(true);
    expect(resolveOrNull).toHaveBeenCalledWith(ACTOR, COMPANY, "view", "candidate", {
      isSensitive: true,
    });
  });

  it("không có `view:candidate` ⇒ DENY cả hai (cặp gác MÀN = cặp gác ĐƯỜNG TẢI)", async () => {
    const { resolver } = makeResolver({ readScope: null });
    expect(await resolver.canViewFile(INPUT)).toBe(false);
    expect(await resolver.canDownloadFile(INPUT)).toBe(false);
  });

  it("có `view:candidate` nhưng ứng viên đã xoá mềm ⇒ DENY", async () => {
    const { resolver } = makeResolver({ readScope: "Company", candidateLive: false });
    expect(await resolver.canDownloadFile(INPUT)).toBe(false);
  });
});
