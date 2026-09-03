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
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
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
