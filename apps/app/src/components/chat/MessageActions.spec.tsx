/**
 * S20-CHAT-MSGTOTASK-1 — mục «Tạo việc» trong menu ⋯ của thanh tác vụ tin.
 *
 * Deny-path TRƯỚC: thiếu `create:task` ⇒ không có mục (và tin chỉ có tệp thì không có cả nút ⋯); tin hệ
 * thống / tin thu hồi ⇒ không có mục dù đủ quyền. Sau đó mới tới ca cho phép.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import type { StoredChatMessage } from "@/stores/chat.store";
import { MessageActions } from "./MessageActions";
import { MessageBubble, type MessageBubbleActions } from "./MessageBubble";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATE_TASK = "Tạo việc";

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: ME,
      email: "nv@demo.local",
      fullName: "Nhân viên",
      status: "Active",
      companyId: "co-001",
    },
  });
}

function renderActions(props: Partial<Parameters<typeof MessageActions>[0]> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MessageActions
        isMine={false}
        isPinned={false}
        isLiked={false}
        canPin={false}
        canRecall={false}
        isArchived={false}
        hasBody
        onQuickLike={vi.fn()}
        onReply={vi.fn()}
        onTogglePin={vi.fn()}
        onRecall={vi.fn()}
        onCopy={vi.fn()}
        {...props}
      />
    </I18nextProvider>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByTestId("chat-message-more"));
}

function message(over: Partial<StoredChatMessage> = {}): StoredChatMessage {
  return {
    id: "00000001-1111-4111-8111-111111111111",
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    roomId: "11111111-1111-4111-8111-111111111111",
    senderId: ME,
    senderName: "Nguyễn Văn A",
    body: "Gửi báo cáo tuần trước thứ Sáu",
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: 5,
    createdAt: "2026-11-06T03:00:00.000Z",
    ...over,
  };
}

function renderBubble(over: Partial<StoredChatMessage>, onCreateTask = vi.fn()) {
  const actions: MessageBubbleActions = {
    onReply: vi.fn(),
    onPin: vi.fn(),
    onUnpin: vi.fn(),
    onRecall: vi.fn(),
    onToggleReaction: vi.fn(),
    onCopy: vi.fn(),
    onCreateTask,
  };
  render(
    <I18nextProvider i18n={i18n}>
      <MessageBubble
        message={message(over)}
        isMine
        isGrouped={false}
        isLastOfGroup
        replyTo={undefined}
        canRecall={false}
        canPin={false}
        seenBy={[]}
        senderAvatarUrl={null}
        senderNameFallback={null}
        isArchived={false}
        actions={actions}
      />
    </I18nextProvider>,
  );
  return onCreateTask;
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
});

describe("MessageActions · «Tạo việc» — deny-path", () => {
  it("thiếu create:task ⇒ menu ⋯ không có mục «Tạo việc» (chỉ còn Sao chép)", () => {
    setCapabilities({ "read:task": true });
    renderActions({ onCreateTask: vi.fn() });
    openMenu();
    expect(screen.getByRole("menuitem", { name: /Sao chép/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: CREATE_TASK })).not.toBeInTheDocument();
  });

  it("thiếu create:task + tin chỉ có tệp ⇒ không có nút ⋯ (menu không còn mục nào)", () => {
    setCapabilities({});
    renderActions({ hasBody: false, onCreateTask: vi.fn() });
    expect(screen.queryByTestId("chat-message-more")).not.toBeInTheDocument();
  });

  it("đủ quyền nhưng caller không truyền onCreateTask ⇒ không có mục", () => {
    setCapabilities({ "create:task": true });
    renderActions();
    openMenu();
    expect(screen.queryByRole("menuitem", { name: CREATE_TASK })).not.toBeInTheDocument();
  });

  it("tin HỆ THỐNG ⇒ không có mục dù đủ quyền", () => {
    setCapabilities({ "create:task": true });
    renderBubble({ messageType: "system", body: "Nguyễn Văn A đã vào phòng" });
    expect(screen.getByTestId("chat-system-message")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-message-actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: CREATE_TASK })).not.toBeInTheDocument();
  });

  it("tin ĐÃ THU HỒI ⇒ không có thanh tác vụ, không có mục", () => {
    setCapabilities({ "create:task": true });
    renderBubble({ recalledAt: "2026-11-06T03:05:00.000Z", body: null });
    expect(screen.queryByTestId("chat-message-actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: CREATE_TASK })).not.toBeInTheDocument();
  });
});

describe("MessageActions · «Tạo việc» — cho phép", () => {
  it("có create:task ⇒ mục hiện, bấm ⇒ đóng menu rồi gọi onCreateTask", () => {
    setCapabilities({ "create:task": true });
    const onCreateTask = vi.fn();
    renderActions({ onCreateTask });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: CREATE_TASK }));
    expect(onCreateTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("tin chỉ có tệp + có quyền ⇒ ⋯ vẫn hiện, có «Tạo việc», không có Sao chép", () => {
    setCapabilities({ "create:task": true });
    renderActions({ hasBody: false, onCreateTask: vi.fn() });
    openMenu();
    expect(screen.getByRole("menuitem", { name: CREATE_TASK })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Sao chép/ })).not.toBeInTheDocument();
  });

  it("qua MessageBubble: tin thường ⇒ bấm mục gọi onCreateTask với ĐÚNG tin", () => {
    setCapabilities({ "create:task": true });
    const onCreateTask = renderBubble({});
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: CREATE_TASK }));
    expect(onCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "00000001-1111-4111-8111-111111111111" }),
    );
  });
});
