/**
 * S20-CHAT-DRAFT-1 — nháp theo từng phòng ở tầng component (US-CHAT-NV-06 · SPEC-15 §14).
 *
 * «Đổi phòng» ở đây là THÁO rồi DỰNG LẠI `MessageComposer` — đúng điều cây thật làm: `ChatPage` gắn
 * `key={`conv-${id}`}` cho `ConversationPanel`, drawer gắn `key={roomId}` cho `ChatDrawerConversation`,
 * nên ô soạn của phòng cũ luôn bị gỡ hẳn. Một bài chỉ đổi prop `roomId` sẽ đo một đường không tồn tại.
 *
 * Luật store thuần (reset theo phiên, chốt epoch, quét storage) đo ở `chat-draft.store.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    // Gõ chữ ⇒ ping "đang gõ" ⇒ `apiFetch` thật ⇒ tiếng ồn mạng không thuộc phép đo nào ở đây.
    chatApi: { ...actual.chatApi, pingTyping: vi.fn().mockResolvedValue(undefined) },
  };
});

vi.mock("./chat-upload", () => ({ uploadChatAttachment: vi.fn() }));

import { useAuthStore } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import { MessageComposer, type ComposerSubmitPayload } from "./MessageComposer";
import { uploadChatAttachment } from "./chat-upload";
import { useChatDraftStore } from "./chat-draft.store";
import type { MentionCandidate } from "./use-mention-autocomplete";

const upload = uploadChatAttachment as unknown as ReturnType<typeof vi.fn>;

const ROOM_A = "aaaaaaaa-1111-4111-8111-111111111111";
const ROOM_B = "bbbbbbbb-1111-4111-8111-111111111111";
const LAN_ID = "00000003-1111-4111-8111-111111111113";
const CANDIDATES: MentionCandidate[] = [{ userId: LAN_ID, name: "Lan", avatarUrl: null }];

type Submit = (payload: ComposerSubmitPayload) => Promise<boolean>;

function mount(roomId: string, onSubmit: Submit = vi.fn().mockResolvedValue(true)) {
  const view = render(
    <I18nextProvider i18n={i18n}>
      <MessageComposer
        roomId={roomId}
        isArchived={false}
        replyTo={null}
        onCancelReply={vi.fn()}
        mentionCandidates={CANDIDATES}
        onSubmit={onSubmit}
      />
    </I18nextProvider>,
  );
  return { onSubmit, unmount: view.unmount };
}

const textbox = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(textbox(), { target: { value } });
const sendButton = () => screen.getByLabelText("Gửi tin nhắn");

/** Gõ «Anh xem giúp @Lan báo cáo» bằng ĐÚNG đường người dùng đi: gõ `@La` → chọn gợi ý → gõ tiếp. */
async function typeDraftWithMention(): Promise<string> {
  type("Anh xem giúp @La");
  fireEvent.mouseDown((await screen.findAllByRole("option"))[0]);
  type(`${textbox().value}báo cáo`);
  return textbox().value;
}

function signIn(userId: string): void {
  useAuthStore.getState().setUser(
    {
      id: userId,
      companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      email: `${userId.slice(0, 4)}@example.test`,
      fullName: null,
      status: "active",
    },
    {},
  );
}

beforeEach(() => {
  useChatDraftStore.getState().resetChatDrafts();
  useAuthStore.getState().logout();
  upload.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:preview") as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
});

afterEach(() => {
  cleanup();
});

describe("MessageComposer · nháp sống qua đổi phòng", () => {
  it("gõ ở A, sang B rồi về A ⇒ ô soạn còn NGUYÊN; B có ô trống của riêng nó", async () => {
    const a = mount(ROOM_A);
    type("Anh xem giúp báo cáo");
    a.unmount();

    const b = mount(ROOM_B);
    // ĐỐI CHỨNG: nháp thuộc về PHÒNG — một store chung cho mọi phòng cũng làm vế "về A còn nháp" xanh.
    expect(textbox().value).toBe("");
    b.unmount();

    mount(ROOM_A);
    expect(textbox().value).toBe("Anh xem giúp báo cáo");
  });

  it("@mention đã chèn vẫn được GỬI sau khi đổi phòng rồi quay lại", async () => {
    const a = mount(ROOM_A);
    const text = await typeDraftWithMention();
    expect(text).toContain("@Lan");
    a.unmount();
    mount(ROOM_B).unmount();

    const { onSubmit } = mount(ROOM_A);
    expect(textbox().value).toBe(text);
    fireEvent.click(sendButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = (onSubmit as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as ComposerSubmitPayload;
    expect(payload.body).toBe(text);
    expect(payload.mentions).toEqual([LAN_ID]);
  });
});

describe("MessageComposer · gửi thành công / gửi lỗi", () => {
  it("gửi thành công ⇒ ô trống, và quay lại phòng vẫn trống", async () => {
    const a = mount(ROOM_A);
    type("tin sẽ gửi được");
    fireEvent.click(sendButton());
    await waitFor(() => expect(textbox().value).toBe(""));
    a.unmount();

    mount(ROOM_A);
    expect(textbox().value).toBe("");
  });

  it("gửi LỖI ⇒ giữ nháp qua đổi phòng, và lần gửi lại dùng CÙNG clientMessageId (chống trùng)", async () => {
    const failing = vi.fn().mockResolvedValue(false);
    const a = mount(ROOM_A, failing);
    type("tin gửi lỗi");
    fireEvent.click(sendButton());
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
    expect(textbox().value).toBe("tin gửi lỗi");
    a.unmount();

    const retry = vi.fn().mockResolvedValue(true);
    mount(ROOM_A, retry);
    expect(textbox().value).toBe("tin gửi lỗi");
    fireEvent.click(sendButton());

    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    const first = failing.mock.calls[0][0] as ComposerSubmitPayload;
    const second = retry.mock.calls[0][0] as ComposerSubmitPayload;
    // Khoá mới sau khi dựng lại = server thấy HAI tin khác nhau nếu lần đầu thật ra đã tới nơi.
    expect(second.clientMessageId).toBe(first.clientMessageId);
  });

  it("đang gửi mà đổi phòng, server nhận ⇒ quay lại KHÔNG còn nháp cũ (không gửi trùng)", async () => {
    let resolveSend: (ok: boolean) => void = () => undefined;
    const slow = vi.fn(() => new Promise<boolean>((r) => (resolveSend = r)));
    const a = mount(ROOM_A, slow);
    type("tin bay chậm");
    fireEvent.click(sendButton());
    await waitFor(() => expect(slow).toHaveBeenCalledTimes(1));
    a.unmount();

    resolveSend(true);
    await waitFor(() => expect(useChatDraftStore.getState().drafts[ROOM_A]).toBeUndefined());
    mount(ROOM_A);
    expect(textbox().value).toBe("");
  });
});

describe("MessageComposer · tệp chờ KHÔNG được giữ", () => {
  it("có tệp chưa gửi mà đổi phòng ⇒ về lại: chữ còn, tệp không, có cảnh báo nhẹ", async () => {
    upload.mockResolvedValue({
      fileId: "f1",
      name: "bao-cao.txt",
      sizeBytes: 5,
      mimeType: "text/plain",
      isImage: false,
    });
    const a = mount(ROOM_A);
    type("kèm báo cáo");
    fireEvent.paste(textbox(), {
      clipboardData: { files: [new File(["x"], "bao-cao.txt", { type: "text/plain" })] },
    });
    await screen.findByText("bao-cao.txt");
    a.unmount();

    mount(ROOM_A);
    expect(textbox().value).toBe("kèm báo cáo");
    expect(screen.queryByText("bao-cao.txt")).toBeNull();
    expect(screen.getByTestId("chat-composer-files-not-kept").textContent).toMatch(/1 tệp/);
  });

  it("ĐỐI CHỨNG: không có tệp chờ ⇒ không cảnh báo", () => {
    const a = mount(ROOM_A);
    type("chỉ có chữ");
    a.unmount();

    mount(ROOM_A);
    expect(screen.queryByTestId("chat-composer-files-not-kept")).toBeNull();
  });
});

describe("MessageComposer · đăng xuất / đổi phiên", () => {
  it("đăng xuất rồi người khác đăng nhập cùng tab ⇒ KHÔNG thấy nháp", () => {
    signIn("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const a = mount(ROOM_A);
    type("nháp của người trước");
    a.unmount();

    useAuthStore.getState().logout();
    signIn("22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    mount(ROOM_A);
    expect(textbox().value).toBe("");
  });

  it("đổi phiên TẠI CHỖ (không qua logout) khi ô soạn còn mở ⇒ nháp biến mất ngay", async () => {
    signIn("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    mount(ROOM_A);
    type("nháp đang mở");

    signIn("22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    await waitFor(() => expect(textbox().value).toBe(""));
  });

  it("ĐỐI CHỨNG: /me làm mới CÙNG người ⇒ nháp còn", () => {
    signIn("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    mount(ROOM_A);
    type("nháp giữ lại");

    signIn("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(textbox().value).toBe("nháp giữ lại");
  });
});

/**
 * S20-CHAT-FEDEBT-1 — cảnh báo tệp chưa gửi NGAY LÚC RỜI phòng, không đợi người dùng quay lại mới biết.
 * «Tệp chưa gửi» gồm cả tệp ĐANG TẢI DỞ: tải xong sau khi ô soạn đã tháo thì tệp bị bỏ (blob xem trước
 * không còn ai thu hồi), nên nó mất y như tệp đã nằm trong khay.
 */
describe("MessageComposer · cảnh báo tệp chưa gửi lúc rời phòng (S20-CHAT-FEDEBT-1)", () => {
  const FILE_META = {
    fileId: "f1",
    name: "bao-cao.txt",
    sizeBytes: 5,
    mimeType: "text/plain",
    isImage: false,
  };
  const pasteFile = (name = "bao-cao.txt") =>
    fireEvent.paste(textbox(), {
      clipboardData: { files: [new File(["x"], name, { type: "text/plain" })] },
    });

  let warning: MockInstance<typeof toast.warning>;
  beforeEach(() => {
    warning = vi.spyOn(toast, "warning");
  });
  afterEach(() => {
    warning.mockRestore();
  });

  it("tệp đã nằm trong khay mà rời phòng ⇒ cảnh báo NGAY khi ô soạn tháo", async () => {
    upload.mockResolvedValue(FILE_META);
    const a = mount(ROOM_A);
    pasteFile();
    await screen.findByText("bao-cao.txt");
    expect(warning).not.toHaveBeenCalled();

    a.unmount();

    expect(warning).toHaveBeenCalledTimes(1);
    expect(String(warning.mock.calls[0]?.[0])).toMatch(/1 tệp/);
  });

  it("tệp ĐANG TẢI DỞ mà rời phòng ⇒ cũng cảnh báo, và quay lại phòng vẫn thấy cảnh báo nhẹ", async () => {
    upload.mockReturnValue(new Promise(() => {})); // không bao giờ xong
    const a = mount(ROOM_A);
    pasteFile();
    await screen.findByText(/Đang tải/);

    a.unmount();

    expect(warning).toHaveBeenCalledTimes(1);
    expect(String(warning.mock.calls[0]?.[0])).toMatch(/1 tệp/);
    mount(ROOM_A);
    expect(screen.getByTestId("chat-composer-files-not-kept").textContent).toMatch(/1 tệp/);
  });

  it("ĐỐI CHỨNG: chỉ có chữ ⇒ rời phòng KHÔNG cảnh báo", () => {
    const a = mount(ROOM_A);
    type("chỉ có chữ");
    a.unmount();
    expect(warning).not.toHaveBeenCalled();
  });

  it("ĐỐI CHỨNG: đăng xuất TRƯỚC khi ô soạn tháo ⇒ KHÔNG cảnh báo cho người đăng nhập sau", async () => {
    upload.mockResolvedValue(FILE_META);
    signIn("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const a = mount(ROOM_A);
    pasteFile();
    await screen.findByText("bao-cao.txt");

    useAuthStore.getState().logout();
    a.unmount();

    expect(warning).not.toHaveBeenCalled();
  });

  /**
   * Gửi xong ⇒ `setAttachments([])` mới chỉ được XẾP lịch; ô soạn tháo trước khi lượt vẽ đó (và effect
   * đồng bộ bộ đếm) kịp chạy thì cleanup đọc bộ đếm cũ ⇒ cảnh báo «tệp bị bỏ» cho tệp vừa gửi đi.
   */
  it("gửi thành công rồi tháo NGAY, trước khi khay kịp vẽ lại ⇒ KHÔNG cảnh báo tệp vừa gửi", async () => {
    upload.mockResolvedValue(FILE_META);
    let resolveSend: (ok: boolean) => void = () => {};
    const a = mount(
      ROOM_A,
      () =>
        new Promise<boolean>((resolve) => {
          resolveSend = resolve;
        }),
    );
    pasteFile();
    await screen.findByText("bao-cao.txt");
    fireEvent.click(sendButton());

    await act(async () => {
      resolveSend(true);
      await Promise.resolve(); // để phần sau `await onSubmit` chạy (xếp lịch dọn khay), chưa vẽ lại
      a.unmount();
    });

    expect(warning).not.toHaveBeenCalled();
  });
});
