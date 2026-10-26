/**
 * S17-CHAT-UX2-FE-2 — `done_when #4`: «đã xem» là **dãy avatar ≤3 + «+N»**, tooltip liệt kê tên.
 *
 * Đo ở 0 · 1 · 3 · 5 người vì mỗi mốc là một NHÁNH khác nhau của component: không vẽ gì · dưới trần ·
 * đúng trần · tràn trần. Chỉ đo 1 và 5 là bỏ lọt đúng cái biên (3 = MAX_FACES) nơi lỗi lệch-một sống.
 *
 * Nhánh **trợ năng** được đo ngang hàng với nhánh hình ảnh: bản S7 nói tên bằng CHỮ, bản này nói bằng
 * ẢNH — nếu nhãn `aria-label` không còn liệt kê đủ tên thì với người đọc màn hình đây là một bước LÙI,
 * và không có bài test nào khác trong repo bắt được điều đó.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { chatApi, useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { useChatStore } from "@/stores/chat.store";
import { ChatRoomOpenerContext } from "./chat-room-opener";
import { SeenByAvatars, type SeenByViewer } from "./SeenByAvatars";

const NAMES = ["An", "Bình", "Cường", "Dung", "En"] as const;

function viewers(count: number): SeenByViewer[] {
  return Array.from({ length: count }, (_, i) => ({
    userId: `u${i}`,
    name: NAMES[i] ?? `N${i}`,
    avatarUrl: null,
  }));
}

function renderSeen(count: number) {
  return render(
    <I18nextProvider i18n={i18n}>
      <SeenByAvatars viewers={viewers(count)} />
    </I18nextProvider>,
  );
}

const faces = (): number => screen.queryAllByTestId("chat-seen-avatar").length;

describe("SeenByAvatars · số mặt hiện ra theo số người đã xem", () => {
  it("0 người ⇒ KHÔNG vẽ gì (không để lại hàng rỗng làm mọi tin dãn ra)", () => {
    const { container } = renderSeen(0);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("chat-seen-by")).toBeNull();
  });

  it("1 người ⇒ 1 mặt, KHÔNG có «+N»", () => {
    renderSeen(1);
    expect(faces()).toBe(1);
    expect(screen.queryByTestId("chat-seen-overflow")).toBeNull();
  });

  it("3 người (đúng TRẦN) ⇒ 3 mặt, vẫn KHÔNG có «+N»", () => {
    renderSeen(3);
    expect(faces()).toBe(3);
    expect(screen.queryByTestId("chat-seen-overflow")).toBeNull();
  });

  it("5 người ⇒ 3 mặt + «+2» (không phải «+5», không phải 5 mặt)", () => {
    renderSeen(5);
    expect(faces()).toBe(3);
    expect(screen.getByTestId("chat-seen-overflow").textContent).toContain("2");
  });
});

describe("SeenByAvatars · nhãn liệt kê ĐỦ tên (không lùi trợ năng so với S7)", () => {
  it("5 người ⇒ nhãn có CẢ tên bị gộp vào «+2», không chỉ 3 tên hiện hình", () => {
    renderSeen(5);
    const label = screen.getByTestId("chat-seen-by").getAttribute("aria-label") ?? "";
    for (const name of NAMES) expect(label).toContain(name);
  });

  it("nhãn cũng nằm ở `title` — chuột và trình đọc màn hình là HAI kênh, cần cả hai", () => {
    renderSeen(2);
    const node = screen.getByTestId("chat-seen-by");
    expect(node.getAttribute("title")).toBe(node.getAttribute("aria-label"));
    expect(node.getAttribute("title")).toContain("An");
  });

  it("người trong roster không có tên ⇒ nhãn dùng chữ dự phòng, KHÔNG để trống", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SeenByAvatars viewers={[{ userId: "u1", name: null, avatarUrl: null }]} />
      </I18nextProvider>,
    );
    const label = screen.getByTestId("chat-seen-by").getAttribute("aria-label") ?? "";
    expect(label.trim().length).toBeGreaterThan("Đã xem: ".length);
  });
});

describe("SeenByAvatars · ảnh lấy từ roster", () => {
  it("có URL ⇒ render <img>; vắng URL ⇒ chữ cái đầu (không ký nhầm ảnh người khác)", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SeenByAvatars
          viewers={[
            { userId: "u1", name: "An", avatarUrl: "https://r2.local/signed/an.png" },
            { userId: "u2", name: "Bình", avatarUrl: null },
          ]}
        />
      </I18nextProvider>,
    );
    const nodes = screen.getAllByTestId("chat-seen-avatar");
    expect(nodes[0].querySelector("img")?.getAttribute("src")).toBe(
      "https://r2.local/signed/an.png",
    );
    expect(nodes[1].querySelector("img")).toBeNull();
  });
});
// ─── S20-CHAT-SEENBY-1 (US-CHAT-QL-03) — dãy «đã xem» thành NÚT mở «Đã xem · Chưa xem» ────────────
//
// Bên gọi (`MessageList`) đã suy sẵn hai danh sách bằng `seenByStatusOf`; ở đây đo phần trình bày:
// nút mở · hai tab có số · trạng thái tải/lỗi KHÔNG vẽ danh sách · «Nhắn riêng» theo quyền · cảm ứng mở
// sheet. Không hiện thời điểm đọc nào (luật §3.2-6: trạng thái đọc là dữ liệu hành vi).

const BINH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DM_ID = "22222222-2222-4222-8222-222222222222";

function people(prefix: string, count: number): SeenByViewer[] {
  return Array.from({ length: count }, (_, i) => ({
    userId: `${prefix}${i}`,
    name: `${prefix.toUpperCase()} ${i}`,
    avatarUrl: null,
  }));
}

interface StatusProps {
  seen?: SeenByViewer[];
  unseen?: SeenByViewer[];
  status?: "loading" | "error" | "ready";
}

function renderStatus(props: StatusProps, opener: ((roomId: string) => void) | null = null) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChatRoomOpenerContext.Provider value={opener}>
        <I18nextProvider i18n={i18n}>
          <SeenByAvatars
            viewers={props.seen ?? []}
            unseen={props.unseen ?? []}
            status={props.status ?? "ready"}
          />
        </I18nextProvider>
      </ChatRoomOpenerContext.Provider>
    </QueryClientProvider>,
  );
}

const trigger = (): HTMLElement => screen.getByTestId("chat-seen-by");

describe("SeenByAvatars · nút mở «Đã xem · Chưa xem»", () => {
  beforeEach(() => {
    useAuthStore.setState({ capabilities: { "view:chat-room": true } });
  });

  it("7 đã xem · 2 chưa xem ⇒ bấm dãy mở bảng có hai tab «Đã xem (7)» / «Chưa xem (2)»", () => {
    renderStatus({ seen: people("s", 7), unseen: people("n", 2) });

    expect(trigger().tagName).toBe("BUTTON");
    fireEvent.click(trigger());

    expect(screen.getByRole("tab", { name: "Đã xem (7)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Chưa xem (2)" })).toBeTruthy();
    // Mở ra ở tab «Đã xem»: đủ 7 dòng, chưa vẽ dòng «Chưa xem» nào.
    expect(screen.getAllByTestId("chat-seen-row")).toHaveLength(7);
    expect(screen.queryAllByTestId("chat-unseen-row")).toHaveLength(0);

    fireEvent.click(screen.getByRole("tab", { name: "Chưa xem (2)" }));
    const rows = screen.getAllByTestId("chat-unseen-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("N 0"),
      expect.stringContaining("N 1"),
    ]);
  });

  it("nhãn trợ năng vẫn đọc đủ «Đã xem: …» khi đã thành nút", () => {
    renderStatus({ seen: people("s", 5), unseen: people("n", 1) });
    const label = trigger().getAttribute("aria-label") ?? "";
    expect(label.startsWith("Đã xem: ")).toBe(true);
    for (let i = 0; i < 5; i += 1) expect(label).toContain(`S ${i}`);
    expect(label).not.toContain("N 0");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("chưa ai xem ⇒ nhãn «Chưa ai xem» bấm được, mở thẳng tab «Chưa xem»", () => {
    renderStatus({ seen: [], unseen: people("n", 3) });

    expect(trigger().textContent).toContain("Chưa ai xem");
    fireEvent.click(trigger());

    expect(screen.getByRole("tab", { name: "Chưa xem (3)" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getAllByTestId("chat-unseen-row")).toHaveLength(3);
  });

  it("không có ai để xem (phòng chỉ còn tôi) ⇒ không vẽ gì", () => {
    const { container } = renderStatus({ seen: [], unseen: [] });
    expect(container.querySelector('[data-testid="chat-seen-by"]')).toBeNull();
  });

  it("không hiện thời điểm đọc nào trong bảng", () => {
    renderStatus({ seen: people("s", 2), unseen: people("n", 1) });
    fireEvent.click(trigger());
    const panel = screen.getByTestId("chat-seen-panel");
    expect(panel.textContent ?? "").not.toMatch(/\d{1,2}:\d{2}/);
    expect(panel.querySelector("time")).toBeNull();
  });
});

describe("SeenByAvatars · roster chưa tải / lỗi ⇒ KHÔNG danh sách sai", () => {
  beforeEach(() => {
    useAuthStore.setState({ capabilities: { "view:chat-room": true } });
  });

  it("đang tải ⇒ bảng báo đang tải, không có tab hay dòng người nào", () => {
    renderStatus({
      seen: people("s", 2),
      unseen: people("n", 2),
      status: "loading",
    });
    fireEvent.click(trigger());
    const panel = screen.getByTestId("chat-seen-panel");
    expect(panel.textContent).toContain("Đang tải danh sách");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryAllByTestId("chat-seen-row")).toHaveLength(0);
    expect(screen.queryAllByTestId("chat-unseen-row")).toHaveLength(0);
  });

  it("lỗi (gồm 404 đồng nhất khi đã rời phòng) ⇒ «Không tải được danh sách», không tên nào", () => {
    renderStatus({
      seen: people("s", 2),
      unseen: people("n", 2),
      status: "error",
    });
    expect(trigger().getAttribute("aria-label") ?? "").not.toContain("S 0");
    fireEvent.click(trigger());
    const panel = screen.getByTestId("chat-seen-panel");
    expect(panel.textContent).toContain("Không tải được danh sách");
    expect(panel.textContent).not.toContain("S 0");
    expect(panel.textContent).not.toContain("N 0");
  });
});

describe("SeenByAvatars · «Nhắn riêng» trên dòng «Chưa xem» (US-CHAT-NV-02)", () => {
  let openDirectSpy: MockInstance<typeof chatApi.openDirect>;

  beforeEach(() => {
    useAuthStore.setState({
      capabilities: { "create:chat-room": true, "view:chat-room": true },
    });
    useChatStore.getState().resetChatStore();
    openDirectSpy = vi.spyOn(chatApi, "openDirect").mockResolvedValue({
      id: DM_ID,
      companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      refId: null,
      roomType: "direct",
      name: null,
      roomCode: "CHAT-0002",
      description: null,
      lastMessageAt: null,
      lastMessageSeq: 0,
      isArchived: false,
      unreadCount: 0,
      createdAt: "2026-10-01T00:00:00.000Z",
    });
  });

  afterEach(() => {
    openDirectSpy.mockRestore();
  });

  it("có khung mở phòng + `create:chat-room` ⇒ mỗi dòng có «Nhắn riêng», bấm là mở DM và đóng bảng", async () => {
    const opener = vi.fn();
    renderStatus(
      {
        seen: people("s", 1),
        unseen: [{ userId: BINH, name: "Lê Bình", avatarUrl: null }],
      },
      opener,
    );
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("tab", { name: "Chưa xem (1)" }));

    fireEvent.click(screen.getByRole("button", { name: "Nhắn riêng với Lê Bình" }));

    await waitFor(() => expect(opener).toHaveBeenCalledWith(DM_ID));
    expect(openDirectSpy).toHaveBeenCalledWith({ peerUserId: BINH });
    expect(screen.queryByTestId("chat-seen-panel")).toBeNull();
  });

  it("dòng «Đã xem» không có «Nhắn riêng»", () => {
    renderStatus({ seen: people("s", 2), unseen: [] }, vi.fn());
    fireEvent.click(trigger());
    expect(screen.queryAllByRole("button", { name: /Nhắn riêng/ })).toHaveLength(0);
  });

  it("thiếu `create:chat-room` ⇒ bảng chỉ đọc (useCan, không hard-code vai trò)", () => {
    useAuthStore.setState({ capabilities: { "view:chat-room": true } });
    renderStatus({ seen: [], unseen: people("n", 2) }, vi.fn());
    fireEvent.click(trigger());
    expect(screen.getAllByTestId("chat-unseen-row")).toHaveLength(2);
    expect(screen.queryAllByRole("button", { name: /Nhắn riêng/ })).toHaveLength(0);
  });

  it("không có khung mở phòng ⇒ không có «Nhắn riêng»", () => {
    renderStatus({ seen: [], unseen: people("n", 1) }, null);
    fireEvent.click(trigger());
    expect(screen.queryAllByRole("button", { name: /Nhắn riêng/ })).toHaveLength(0);
  });
});

describe("SeenByAvatars · cảm ứng mở sheet", () => {
  const original = Object.getOwnPropertyDescriptor(window, "matchMedia");

  beforeEach(() => {
    useAuthStore.setState({ capabilities: { "view:chat-room": true } });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes("coarse"),
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  });

  afterEach(() => {
    if (original) Object.defineProperty(window, "matchMedia", original);
    else delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it("con trỏ thô (điện thoại) ⇒ chạm mở SHEET có cùng hai tab; nút đóng đóng lại", () => {
    renderStatus({ seen: people("s", 7), unseen: people("n", 2) });
    fireEvent.click(trigger());

    expect(screen.getByTestId("chat-seen-sheet")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Đã xem (7)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Chưa xem (2)" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(screen.queryByTestId("chat-seen-sheet")).toBeNull();
  });
});
