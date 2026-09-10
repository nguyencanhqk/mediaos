/**
 * S17-CHAT-UX2-FE-3 — dán / kéo-thả / thumbnail / emoji ở ô soạn (SPEC-15 §22c CHAT-DEC-027).
 *
 * Ba phép đo đắt nhất ở đây, và lý do từng cái tồn tại:
 *  (a) **SỐ LẦN** `uploadChatAttachment` chạy. Gắn `onPaste` ở CẢ textarea lẫn container thì mỗi tệp
 *      lên hai lần — giao diện y hệt, người dùng chỉ thấy tin có 2 ảnh giống nhau khi tin đã gửi xong.
 *  (b) **`revokeObjectURL`**. Không thu hồi = rò bộ nhớ mỗi lần dán ảnh, và KHÔNG có gì báo: jsdom
 *      không kêu, trình duyệt không kêu, chỉ tab chat nặng dần sau một buổi làm việc.
 *  (c) emoji chèn **tại con trỏ**, không nối đuôi chuỗi — sai chỗ này thì tính năng vô dụng ở mọi tin
 *      dài hơn một câu.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/routes/chat/constants";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    chatApi: { ...actual.chatApi, pingTyping: vi.fn().mockResolvedValue(undefined) },
  };
});

vi.mock("./chat-upload", () => ({ uploadChatAttachment: vi.fn() }));

import { MessageComposer } from "./MessageComposer";
import { uploadChatAttachment } from "./chat-upload";

const upload = uploadChatAttachment as unknown as ReturnType<typeof vi.fn>;
const ROOM = "11111111-1111-4111-8111-111111111111";

let createdUrls: string[];
let revoked: string[];

function imageFile(name: string): File {
  return new File(["bytes"], name, { type: "image/png" });
}
function textFile(name: string): File {
  return new File(["bytes"], name, { type: "text/plain" });
}

function renderComposer(over: Partial<Parameters<typeof MessageComposer>[0]> = {}) {
  const onSubmit = over.onSubmit ?? vi.fn().mockResolvedValue(true);
  const view = render(
    <I18nextProvider i18n={i18n}>
      <MessageComposer
        roomId={ROOM}
        isArchived={false}
        replyTo={null}
        onCancelReply={vi.fn()}
        {...over}
        onSubmit={onSubmit}
      />
    </I18nextProvider>,
  );
  return { onSubmit, view };
}

const textbox = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const composer = () => screen.getByTestId("chat-composer");

beforeEach(() => {
  createdUrls = [];
  revoked = [];
  // jsdom KHÔNG có hai hàm này. Gán mới mỗi ca thay vì `spyOn(...).mockRestore()`: `mockRestore` xoá
  // luôn `mock.calls` và làm mọi khẳng định sau đó đọc một sổ rỗng (memory `mockrestore-wipes-mock-calls`).
  URL.createObjectURL = vi.fn((_blob: Blob) => {
    const url = `blob:preview-${createdUrls.length}`;
    createdUrls.push(url);
    return url;
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  }) as unknown as typeof URL.revokeObjectURL;

  upload.mockReset();
  let n = 0;
  upload.mockImplementation((file: File) => {
    n += 1;
    return Promise.resolve({
      fileId: `f${n}`,
      name: file.name,
      sizeBytes: 5,
      mimeType: file.type,
      isImage: file.type.startsWith("image/"),
    });
  });
});

describe("MessageComposer · DÁN ảnh", () => {
  it("dán 2 ảnh ⇒ `uploadChatAttachment` chạy ĐÚNG 2 lần (không nhân đôi vì nổi bọt)", async () => {
    renderComposer();
    fireEvent.paste(textbox(), {
      clipboardData: { files: [imageFile("a.png"), imageFile("b.png")] },
    });

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByRole("img")).toHaveLength(2);
  });

  it("dán CHỮ (không tệp) ⇒ KHÔNG upload gì cả", () => {
    renderComposer();
    fireEvent.paste(textbox(), { clipboardData: { files: [] } });
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("MessageComposer · KÉO-THẢ", () => {
  it("thả 1 ảnh vào ô soạn ⇒ upload 1 lần + hiện thumbnail", async () => {
    renderComposer();
    fireEvent.drop(composer(), {
      dataTransfer: { files: [imageFile("keo-tha.png")], types: ["Files"] },
    });

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")).toBe(createdUrls[0]);
  });

  it("vượt trần tệp/tin ⇒ báo lỗi và KHÔNG upload tệp nào", async () => {
    renderComposer();
    const tooMany = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 1 }, (_, i) =>
      imageFile(`x${i}.png`),
    );
    fireEvent.drop(composer(), { dataTransfer: { files: tooMany, types: ["Files"] } });

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it("phòng đã LƯU TRỮ ⇒ thả tệp không làm gì (cổng giống nút đính kèm)", () => {
    renderComposer({ isArchived: true });
    fireEvent.drop(composer(), {
      dataTransfer: { files: [imageFile("a.png")], types: ["Files"] },
    });
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("MessageComposer · thumbnail và vòng đời blob URL", () => {
  it("tệp KHÔNG phải ảnh ⇒ tile tên + cỡ, KHÔNG tạo blob URL", async () => {
    renderComposer();
    fireEvent.paste(textbox(), { clipboardData: { files: [textFile("bao-cao.txt")] } });

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("bao-cao.txt")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(createdUrls).toHaveLength(0);
  });

  it("GỠ tệp ảnh ⇒ `revokeObjectURL` gọi với ĐÚNG URL của tệp đó", async () => {
    renderComposer();
    fireEvent.paste(textbox(), { clipboardData: { files: [imageFile("a.png")] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByLabelText("Bỏ tệp a.png"));

    await waitFor(() => expect(revoked).toEqual([createdUrls[0]]));
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("GỬI thành công ⇒ thu hồi HẾT blob URL đang giữ", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderComposer({ onSubmit });
    fireEvent.paste(textbox(), {
      clipboardData: { files: [imageFile("a.png"), imageFile("b.png")] },
    });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByLabelText("Gửi tin nhắn"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].fileIds).toEqual(["f1", "f2"]);
    await waitFor(() => expect([...revoked].sort()).toEqual([...createdUrls].sort()));
  });

  /**
   * Phát hiện của `typescript-reviewer` (LIGHT gate 10/09) — KHÔNG có ca này thì bản vá tự do trôi ngược.
   *
   * `handlePickFiles` giữ một `await uploadChatAttachment(file)` bay ngang ranh giới mạng. Đổi phòng
   * giữa chừng ⇒ cây tháo ⇒ cleanup của `useAttachmentPreviews` chạy `revokeAll()` XONG RỒI. Nếu sau
   * mốc đó code vẫn `createObjectURL`, URL ấy nằm trong sổ của một hook đã chết: KHÔNG AI thu hồi được
   * nữa, và nó sống tới khi người dùng tải lại trang. jsdom im, trình duyệt im — chỉ có tab nặng dần.
   */
  it("THÁO CÂY giữa lúc đang upload ⇒ KHÔNG đẻ blob URL mồ côi", async () => {
    let resolveUpload: (v: unknown) => void = () => {};
    upload.mockImplementation(
      () =>
        new Promise((res) => {
          resolveUpload = res;
        }),
    );

    renderComposer();
    fireEvent.paste(textbox(), { clipboardData: { files: [imageFile("a.png")] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(createdUrls).toHaveLength(0); // upload chưa xong ⇒ chưa có URL nào

    cleanup(); // ⇦ người dùng đổi phòng / đóng drawer NGAY LÚC NÀY
    resolveUpload({
      fileId: "f1",
      name: "a.png",
      sizeBytes: 5,
      mimeType: "image/png",
      isImage: true,
    });
    await Promise.resolve();
    await Promise.resolve();

    // Ca đối chứng nằm ngay trên (`thả 1 ảnh ⇒ createdUrls[0]` có thật): nếu code chỉ đơn giản KHÔNG
    // BAO GIỜ tạo URL thì ca kia đỏ ⇒ ca này không thể xanh-RỖNG.
    expect(createdUrls).toEqual([]);
  });

  it("gửi LỖI ⇒ GIỮ tệp và GIỮ blob URL (§14: không mất thứ đang soạn)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    renderComposer({ onSubmit });
    fireEvent.paste(textbox(), { clipboardData: { files: [imageFile("a.png")] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText("Gửi tin nhắn"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(revoked).toEqual([]);
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });
});

describe("MessageComposer · bảng emoji tĩnh", () => {
  it("mở bảng ⇒ nạp bộ emoji (import động) và chèn TẠI CON TRỎ", async () => {
    renderComposer();
    fireEvent.change(textbox(), { target: { value: "abc" } });
    // Con trỏ vào GIỮA chuỗi — nếu code nối đuôi thì ca này đỏ, còn assert "chuỗi có chứa emoji" thì không.
    textbox().setSelectionRange(1, 1);

    fireEvent.click(screen.getByLabelText("Chèn biểu tượng cảm xúc"));
    const panel = await screen.findByTestId("chat-emoji-panel");
    const first = panel.querySelectorAll("button")[0] as HTMLButtonElement;
    const emoji = first.textContent as string;

    fireEvent.mouseDown(first);
    await waitFor(() => expect(textbox().value).toBe(`a${emoji}bc`));
  });

  it("bộ emoji vẫn đủ ~120 ký tự, không nhóm nào bị xoá nhầm", async () => {
    const { EMOJI_COUNT, EMOJI_GROUPS } = await import("./chat-emoji");
    expect(EMOJI_GROUPS).toHaveLength(5);
    expect(EMOJI_COUNT).toBeGreaterThanOrEqual(110);
  });

  it("phòng đã LƯU TRỮ ⇒ KHÔNG hiện nút emoji (cùng cổng với nút đính kèm)", () => {
    renderComposer({ isArchived: true });
    expect(screen.queryByLabelText("Chèn biểu tượng cảm xúc")).toBeNull();
  });
});
