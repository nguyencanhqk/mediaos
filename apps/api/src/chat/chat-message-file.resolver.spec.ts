import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../db/db.service";
import type { PermissionService } from "../permission/permission.service";
import { FilePolicyAction, type FilePermissionInput } from "../foundation/files/file-policy.types";
import type { ChatAccessService } from "./chat-access.service";
import type {
  ChatAttachmentsRepository,
  ChatCandidateFileRow,
} from "./chat-attachments.repository";
import { CHAT_MAX_ATTACHMENTS_PER_MESSAGE } from "./chat-file.constants";
import { ChatMessageFileResolver } from "./chat-message-file.resolver";

/**
 * S7-CHAT-BE-3 — `ChatMessageFileResolver`.
 *
 * Suite này kiểm HÌNH DẠNG QUYẾT ĐỊNH (ai được gì, và các nhánh từ chối có fail-closed không) — thứ
 * chạy được trong CI mà không cần Postgres. Hành vi đầu-cuối (403 thật trên route FOUNDATION, link tạo
 * cùng tx, thu hồi gỡ link) do `chat-be3-attachments.int-spec.ts` phủ trên DB thật với `LANE_DB`.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const MESSAGE = "44444444-4444-4444-8444-444444444444";
const FILE = "55555555-5555-4555-8555-555555555555";

const CLEAN_FILE: ChatCandidateFileRow = {
  id: FILE,
  mimeType: "image/png",
  scanStatus: "Clean",
  uploadStatus: "Uploaded",
};

interface Harness {
  resolver: ChatMessageFileResolver;
  assertMessageAccess: ReturnType<typeof vi.fn>;
  can: ReturnType<typeof vi.fn>;
  findOwnedFiles: ReturnType<typeof vi.fn>;
}

function build(opts?: {
  allow?: boolean;
  senderId?: string;
  accessError?: unknown;
  ownedFiles?: ChatCandidateFileRow[];
  recalledAt?: Date | null;
  isArchived?: boolean;
  activeLinks?: number;
}): Harness {
  // `withTenant` chỉ chạy callback với một `tx` giả — resolver không tự viết SQL, mọi truy vấn đi qua
  // `access`/`repo` đã mock, nên tx không cần là object thật.
  const db = {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as DatabaseService;

  const assertMessageAccess = vi.fn(async () => {
    if (opts?.accessError) throw opts.accessError;
    return {
      room: { isArchived: opts?.isArchived ?? false },
      message: {
        senderId: opts?.senderId ?? ACTOR,
        recalledAt: opts?.recalledAt ?? null,
      },
    };
  });
  const access = { assertMessageAccess } as unknown as ChatAccessService;

  const can = vi.fn(async () => ({ allow: opts?.allow ?? true }));
  const permission = { can } as unknown as PermissionService;

  const findOwnedFiles = vi.fn(async () => opts?.ownedFiles ?? [CLEAN_FILE]);
  const countActiveLinks = vi.fn(async () => opts?.activeLinks ?? 0);
  const repo = { findOwnedFiles, countActiveLinks } as unknown as ChatAttachmentsRepository;

  return {
    resolver: new ChatMessageFileResolver(db, permission, access, repo),
    assertMessageAccess,
    can,
    findOwnedFiles,
  };
}

function input(overrides?: Partial<FilePermissionInput>): FilePermissionInput {
  return {
    companyId: COMPANY,
    userId: ACTOR,
    fileId: FILE,
    moduleCode: "CHAT",
    entityType: "chat_message",
    // `entityId` của link CHAT là messageId — KHÔNG phải roomId. Ca này đóng đinh điều đó: resolver tra
    // TIN rồi mới suy ra phòng.
    entityId: MESSAGE,
    action: FilePolicyAction.Download,
    ...overrides,
  };
}

describe("khoá điều phối — phải khớp NGUYÊN VĂN nơi tạo file_links", () => {
  it("moduleCode='CHAT' + entityTypes=['chat_message']", () => {
    const { resolver } = build();
    // Lệch một ký tự giữa đăng ký / tạo link / tra link ⇒ `deny-no-resolver` ⇒ gửi được tệp mà không ai
    // tải được. Đóng đinh literal ở đây vì registry ghép key bằng so-chuỗi đã chuẩn hoá.
    expect(resolver.moduleCode).toBe("CHAT");
    expect(resolver.entityTypes).toEqual(["chat_message"]);
  });
});

describe("ĐỌC — cặp `view:chat-room` VÀ thấy được tin chứa tệp", () => {
  it("đủ hai vế → cho phép, và cặp quyền đúng là view:chat-room", async () => {
    const h = build();
    await expect(h.resolver.canDownloadFile(input())).resolves.toBe(true);
    expect(h.can).toHaveBeenCalledWith(
      expect.objectContaining({ action: "view", resourceType: "chat-room" }),
    );
    expect(h.assertMessageAccess).toHaveBeenCalledWith(expect.anything(), COMPANY, MESSAGE, ACTOR);
  });

  it("thiếu cặp quyền → từ chối, và KHÔNG tốn truy vấn membership", async () => {
    const h = build({ allow: false });
    await expect(h.resolver.canViewFile(input())).resolves.toBe(false);
    expect(h.assertMessageAccess).not.toHaveBeenCalled();
  });

  it("không thấy tin (404 của ChatAccessService) → từ chối SẠCH, không ném ra policy layer", async () => {
    // Ném ra ngoài cũng an toàn (`decideViaResolver` bắt → `deny-error`) nhưng sẽ làm đường từ chối
    // THƯỜNG GẶP nhất — người ngoài phòng — ghi log lỗi mỗi lần. Bắt tại chỗ giữ log sạch.
    const h = build({ accessError: new NotFoundException("CHAT-ERR-001") });
    await expect(h.resolver.canDownloadFile(input())).resolves.toBe(false);
  });

  it("lỗi KHÔNG phải 404 → NÉM TIẾP (deny-error có log), không nuốt thành 'không có quyền'", async () => {
    // Nuốt trắng mọi exception là biến một sự cố DB thật thành một lời từ chối im lặng — tệp biến mất
    // khỏi giao diện và không ai biết vì sao (silent-failure-hunter).
    const h = build({ accessError: new Error("connection terminated") });
    await expect(h.resolver.canDownloadFile(input())).rejects.toThrow("connection terminated");
  });
});

describe("GHI — ba vế cùng đúng mới gắn được tệp", () => {
  it("đủ ba vế → cho phép, cặp quyền là send:chat-message", async () => {
    const h = build();
    await expect(h.resolver.canLinkFile(input({ action: FilePolicyAction.Link }))).resolves.toBe(
      true,
    );
    expect(h.can).toHaveBeenCalledWith(
      expect.objectContaining({ action: "send", resourceType: "chat-message" }),
    );
  });

  it("thiếu `fileId` (pre-link check) → từ chối, KHÔNG tốn truy vấn nào", async () => {
    const h = build();
    await expect(
      h.resolver.canLinkFile(input({ fileId: undefined, action: FilePolicyAction.Link })),
    ).resolves.toBe(false);
    expect(h.can).not.toHaveBeenCalled();
    expect(h.assertMessageAccess).not.toHaveBeenCalled();
  });

  it("tin của NGƯỜI KHÁC → từ chối (chèn tệp vào phát ngôn người khác)", async () => {
    const h = build({ senderId: OTHER });
    await expect(h.resolver.canLinkFile(input({ action: FilePolicyAction.Link }))).resolves.toBe(
      false,
    );
    // Dừng TRƯỚC khi tra sở hữu tệp — không có nhánh nào bù lại vế người-gửi.
    expect(h.findOwnedFiles).not.toHaveBeenCalled();
  });

  it("tệp KHÔNG do mình upload → từ chối (chốt tại nguồn, cửa hậu branding)", async () => {
    const h = build({ ownedFiles: [] });
    await expect(h.resolver.canLinkFile(input({ action: FilePolicyAction.Link }))).resolves.toBe(
      false,
    );
  });

  it("tệp của mình nhưng `Infected` → từ chối (cùng luật trạng thái với FOUNDATION)", async () => {
    const h = build({ ownedFiles: [{ ...CLEAN_FILE, scanStatus: "Infected" }] });
    await expect(h.resolver.canLinkFile(input({ action: FilePolicyAction.Link }))).resolves.toBe(
      false,
    );
  });

  it("tệp của mình nhưng chưa `Uploaded` → từ chối", async () => {
    const h = build({ ownedFiles: [{ ...CLEAN_FILE, uploadStatus: "Pending" }] });
    await expect(h.resolver.canLinkFile(input({ action: FilePolicyAction.Link }))).resolves.toBe(
      false,
    );
  });

  // ── Ba vế của `sendMessage` mà đường FOUNDATION không hề biết (FULL gate) ───────────────────
  //
  // `POST /foundation/files/:id/links` KHÔNG đi qua `ChatMessagesService.sendMessage`. Mọi bất biến mà
  // hàm đó ép ở tầng service chỉ là bất biến của MỘT trong hai đường ghi cho tới khi được ép lại ở đây.

  it("phòng ĐÃ LƯU TRỮ → từ chối (CHAT-ERR-005 không được vòng qua bằng đường FOUNDATION)", async () => {
    const h = build({ isArchived: true });
    await expect(h.resolver.canLinkFile(input({ action: FilePolicyAction.Link }))).resolves.toBe(
      false,
    );
  });

  it("tin ĐÃ THU HỒI → từ chối (gắn lại làm link sống lại ⇒ mở lại đường tải)", async () => {
    const h = build({ recalledAt: new Date() });
    await expect(h.resolver.canLinkFile(input({ action: FilePolicyAction.Link }))).resolves.toBe(
      false,
    );
  });

  it("đã chạm trần tệp/tin → từ chối (điều kiện tiên quyết của trimToMessageBoundary)", async () => {
    const h = build({ activeLinks: CHAT_MAX_ATTACHMENTS_PER_MESSAGE });
    await expect(h.resolver.canLinkFile(input({ action: FilePolicyAction.Link }))).resolves.toBe(
      false,
    );
  });

  it("dưới trần đúng 1 đơn vị → vẫn cho phép (đối chứng dương của ca trần)", async () => {
    const h = build({ activeLinks: CHAT_MAX_ATTACHMENTS_PER_MESSAGE - 1 });
    await expect(h.resolver.canLinkFile(input({ action: FilePolicyAction.Link }))).resolves.toBe(
      true,
    );
  });
});

describe("ĐỌC — tin đã thu hồi", () => {
  /**
   * ⚠️ Đây là vế DUY NHẤT chặn đường tải sau thu hồi. Thu hồi CỐ Ý không gỡ `file_links`: gỡ link làm
   * tệp hết module-owned ⇒ `decideForLinkedFile` tụt xuống fallback `FOUNDATION.FILE.DOWNLOAD` (cặp
   * company-admin đang giữ) ⇒ thu hồi MỞ RỘNG phạm vi tải. Xoá vế này là mở lại đúng lỗ đó.
   */
  it("tin đã thu hồi → canDownloadFile/canViewFile đều false", async () => {
    const h = build({ recalledAt: new Date() });
    await expect(h.resolver.canDownloadFile(input())).resolves.toBe(false);
    await expect(h.resolver.canViewFile(input())).resolves.toBe(false);
  });

  it("tin CHƯA thu hồi → cho phép (đối chứng dương)", async () => {
    const h = build({ recalledAt: null });
    await expect(h.resolver.canDownloadFile(input())).resolves.toBe(true);
  });
});

describe("UNLINK / DELETE — luôn từ chối, và phải khai TƯỜNG MINH", () => {
  it("canUnlinkFile → false", async () => {
    // ⚠️ `canUnlinkFile` là OPTIONAL trên interface: BỎ TRỐNG method sẽ làm policy layer rơi xuống
    // fallback `FOUNDATION.FILE.UNLINK` — cặp company-admin ĐANG giữ (bulk grant 0005) ⇒ company-admin
    // bóc được tệp khỏi tin của bất kỳ ai. Ca này khoá method lại để không ai "dọn" nó đi.
    const h = build();
    expect(typeof h.resolver.canUnlinkFile).toBe("function");
    await expect(h.resolver.canUnlinkFile()).resolves.toBe(false);
  });

  it("canDeleteFile → false (tin append-only không sửa lại được nếu tệp biến mất)", async () => {
    const h = build();
    await expect(h.resolver.canDeleteFile()).resolves.toBe(false);
  });
});
