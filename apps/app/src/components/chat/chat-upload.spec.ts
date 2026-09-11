/**
 * S17-CHAT-UX2-QA-1 — `uploadChatAttachment`: ba pha register → PUT → confirm (SPEC-15 §13.5).
 *
 * Vì sao file này ra đời muộn (QA của wave, không phải của S7): `chat-upload.ts` là module DUY NHẤT
 * của cụm chat chưa từng có một dòng thân hàm nào chạy — `MessageComposer.attach.spec.tsx` mock nó
 * (`vi.mock("./chat-upload")`) để đo số-lần-gọi ở tầng trên. Nghĩa là toàn bộ luật dưới đây chưa từng
 * được canh: mock ở tầng trên KHÔNG canh được gì bên trong tầng dưới.
 *
 * Ba luật đắt nhất, và hỏng thì hỏng ở đâu:
 *  (a) **Pha lỗi ⇒ NÉM NGAY, không đi tiếp.** Nuốt lỗi PUT rồi vẫn `confirm`/trả `fileId` là trả về
 *      một tệp CHƯA có bytes: người dùng thấy "đính kèm xong", rồi `POST /chat/rooms/:id/messages`
 *      trả CHAT-ERR-015 — lỗi nổ ở màn GỬI TIN, cách chỗ hỏng thật một bước.
 *  (b) **`contentType` lúc PUT phải ĐÚNG chuỗi đã khai lúc register.** Server ký PutObject KÈM
 *      ContentType; lệch một ký tự là 403 SignatureDoesNotMatch từ storage — không phải lỗi của ta,
 *      nhưng người dùng chỉ thấy "tải tệp thất bại".
 *  (c) **Body register KHÔNG được mang `moduleCode`/`entityType`/`entityId`/`visibility`.** Link
 *      `file_links` do CHAT tạo trong cùng transaction với INSERT tin (client gắn tay là bỏ qua kiểm
 *      "tệp thuộc người gửi"); `visibility` do server ép `Private`. Ca này canh CHIỀU NGƯỢC — thêm
 *      khoá vào body thì đỏ — vì một khoá thừa ở đây không làm hỏng màn hình nào, nó chỉ âm thầm
 *      đổi ý nghĩa của tệp ở phía server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
const putBytesToStorage = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    apiFetch: (...a: unknown[]) => apiFetch(...a),
    putBytesToStorage: (...a: unknown[]) => putBytesToStorage(...a),
  };
});

import { DEFAULT_UPLOAD_MIME } from "@mediaos/web-core";
import { uploadChatAttachment } from "./chat-upload";

const FILE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/** Thứ tự các pha đã chạy — ca (a) đo THỨ TỰ, không chỉ đo "có gọi hay không". */
let phases: string[];

function file(name: string, type: string, bytes = "0123456789"): File {
  return new File([bytes], name, { type });
}

/** register trả `uploadUrl` + `fileId`; confirm trả rỗng. Cả hai đi qua CÙNG một mock `apiFetch`. */
function wireHappyPath(): void {
  apiFetch.mockImplementation((path: string) => {
    if (path === "/chat/files/upload-url") {
      phases.push("register");
      return Promise.resolve({ fileId: FILE_ID, uploadUrl: "https://r2.test/put?sig=abc" });
    }
    phases.push("confirm");
    return Promise.resolve({});
  });
  putBytesToStorage.mockImplementation(() => {
    phases.push("put");
    return Promise.resolve();
  });
}

/** Body JSON của lượt register — đọc lại đúng chuỗi client đã gửi. */
function registerBody(): Record<string, unknown> {
  const call = apiFetch.mock.calls.find((c) => c[0] === "/chat/files/upload-url");
  return JSON.parse((call?.[2] as { body: string }).body) as Record<string, unknown>;
}

beforeEach(() => {
  phases = [];
  apiFetch.mockReset();
  putBytesToStorage.mockReset();
  wireHappyPath();
});

describe("uploadChatAttachment — ba pha", () => {
  it("chạy register → PUT → confirm ĐÚNG thứ tự rồi trả mô tả tệp", async () => {
    const result = await uploadChatAttachment(file("bao-cao.pdf", "application/pdf"));

    expect(phases).toEqual(["register", "put", "confirm"]);
    expect(result).toEqual({
      fileId: FILE_ID,
      name: "bao-cao.pdf",
      sizeBytes: 10,
      mimeType: "application/pdf",
      isImage: false,
    });
  });

  it("confirm gọi ĐÚNG fileId mà register trả về", async () => {
    await uploadChatAttachment(file("a.png", "image/png"));

    const confirmCall = apiFetch.mock.calls.find((c) => c[0] !== "/chat/files/upload-url");
    expect(confirmCall?.[0]).toBe(`/chat/files/${FILE_ID}/confirm`);
    expect((confirmCall?.[2] as { method: string }).method).toBe("POST");
  });

  it("đi route CHAT (own-scope `send:chat-message`), KHÔNG phải route FOUNDATION", async () => {
    // Đổi ngược hai URL này về `/foundation/files/*` là khoá tính năng đính kèm cho gần hết công ty:
    // cặp `upload:foundation-file` chỉ có ở SA · company-admin · QUẢN LÝ CẤP CAO (docblock chat-upload).
    await uploadChatAttachment(file("a.png", "image/png"));

    const paths = apiFetch.mock.calls.map((c) => c[0] as string);
    expect(paths[0]).toBe("/chat/files/upload-url");
    expect(paths.every((p) => !p.startsWith("/foundation/"))).toBe(true);
  });
});

describe("uploadChatAttachment — mime đã khai", () => {
  it("PUT dùng ĐÚNG chuỗi mime đã khai lúc register (lệch ⇒ 403 SignatureDoesNotMatch)", async () => {
    await uploadChatAttachment(file("anh.png", "image/png"));

    expect(registerBody().declaredMimeType).toBe("image/png");
    expect(putBytesToStorage.mock.calls[0]?.[2]).toBe("image/png");
    expect(putBytesToStorage.mock.calls[0]?.[0]).toBe("https://r2.test/put?sig=abc");
  });

  it("tệp không có `type` ⇒ khai DEFAULT_UPLOAD_MIME, và PUT dùng CHÍNH nó", async () => {
    const result = await uploadChatAttachment(file("khong-ro", ""));

    expect(registerBody().declaredMimeType).toBe(DEFAULT_UPLOAD_MIME);
    expect(putBytesToStorage.mock.calls[0]?.[2]).toBe(DEFAULT_UPLOAD_MIME);
    expect(result.mimeType).toBe(DEFAULT_UPLOAD_MIME);
    expect(result.isImage).toBe(false);
  });

  it("`isImage` suy từ mime đã khai, KHÔNG phân biệt hoa-thường", async () => {
    await expect(uploadChatAttachment(file("a.PNG", "IMAGE/PNG"))).resolves.toMatchObject({
      isImage: true,
    });
    await expect(uploadChatAttachment(file("b.txt", "text/plain"))).resolves.toMatchObject({
      isImage: false,
    });
    // "image" lọt giữa chuỗi không phải ảnh — `startsWith`, không phải `includes`.
    await expect(
      uploadChatAttachment(file("c.bin", "application/x-image-archive")),
    ).resolves.toMatchObject({ isImage: false });
  });
});

describe("uploadChatAttachment — body register", () => {
  it("chỉ khai originalName · declaredMimeType · sizeBytes", async () => {
    await uploadChatAttachment(file("bao-cao.pdf", "application/pdf", "abcdefghijklmno"));

    expect(registerBody()).toEqual({
      originalName: "bao-cao.pdf",
      declaredMimeType: "application/pdf",
      sizeBytes: 15,
    });
  });

  it("KHÔNG gửi moduleCode/entityType/entityId (link do CHAT tạo) và KHÔNG gửi visibility", async () => {
    await uploadChatAttachment(file("a.png", "image/png"));

    const keys = Object.keys(registerBody());
    for (const forbidden of ["moduleCode", "entityType", "entityId", "visibility"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("uploadChatAttachment — pha lỗi thì DỪNG, không đi tiếp", () => {
  it("register lỗi ⇒ ném, KHÔNG PUT, KHÔNG confirm", async () => {
    apiFetch.mockReset();
    apiFetch.mockRejectedValue(new Error("register-500"));

    await expect(uploadChatAttachment(file("a.png", "image/png"))).rejects.toThrow("register-500");
    expect(putBytesToStorage).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("PUT lỗi ⇒ ném và KHÔNG confirm — cấm trả fileId của tệp chưa có bytes", async () => {
    putBytesToStorage.mockReset();
    putBytesToStorage.mockRejectedValue(new Error("put-403"));

    await expect(uploadChatAttachment(file("a.png", "image/png"))).rejects.toThrow("put-403");
    expect(phases).toEqual(["register"]);
    expect(apiFetch.mock.calls.some((c) => String(c[0]).endsWith("/confirm"))).toBe(false);
  });

  it("confirm lỗi ⇒ ném, không trả về mô tả tệp", async () => {
    apiFetch.mockImplementation((path: string) =>
      path === "/chat/files/upload-url"
        ? Promise.resolve({ fileId: FILE_ID, uploadUrl: "https://r2.test/put" })
        : Promise.reject(new Error("confirm-409")),
    );

    await expect(uploadChatAttachment(file("a.png", "image/png"))).rejects.toThrow("confirm-409");
    expect(putBytesToStorage).toHaveBeenCalledTimes(1);
  });
});

describe("uploadChatAttachment — huỷ giữa chừng", () => {
  it("`signal` được chuyển cho CẢ hai lượt apiFetch", async () => {
    const controller = new AbortController();

    await uploadChatAttachment(file("a.png", "image/png"), { signal: controller.signal });

    expect(apiFetch).toHaveBeenCalledTimes(2);
    for (const call of apiFetch.mock.calls) {
      expect((call[2] as { signal?: AbortSignal }).signal).toBe(controller.signal);
    }
  });

  it("không truyền options ⇒ signal undefined, không nổ", async () => {
    await uploadChatAttachment(file("a.png", "image/png"));

    for (const call of apiFetch.mock.calls) {
      expect((call[2] as { signal?: AbortSignal }).signal).toBeUndefined();
    }
  });
});
