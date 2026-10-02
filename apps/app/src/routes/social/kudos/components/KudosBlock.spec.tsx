/**
 * S16-SOCIAL-FE-2C — ca **KB** trên `KudosBlock` + `KudosBadgeIcon` (plan §4 + §8 H2/M-a).
 *
 * - Mock `Link` NỘI SUY `params` (khuôn `PollsPage.spec`): mock `<a href={to}>` trần chỉ in khuôn
 *   `/feed/profiles/$employeeId` ⇒ link trỏ nhầm id vẫn xanh.
 * - Ảnh (S16-SOCIAL-AVATARPRESIGN-1): `avatarUrl` URL ký ⇒ `<img>`; `null` / fileId thô ⇒ chữ cái đầu.
 *   Ca «không `<img>`» dùng giá trị KHÁC rỗng (fileId) — với `null` thì code lỡ truyền thô vẫn không
 *   vẽ ảnh ⇒ ca xanh vì sai lý do.
 */
import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import type { FeedKudosBlockDto, FeedKudosRecipientDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { KudosBlock } from "./KudosBlock";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      children,
      to,
      params,
    }: {
      children: ReactNode;
      to: string;
      params?: Record<string, string>;
    }) => (
      <a href={Object.entries(params ?? {}).reduce((h, [k, v]) => h.replace(`$${k}`, v), to)}>
        {children}
      </a>
    ),
  };
});

const t = i18n.getFixedT("vi", "social");
const EMP_A = "33333333-3333-4333-8333-333333333333";
const EMP_B = "66666666-6666-4666-8666-666666666666";
/** URL presign GIẢ (hình dạng `avatarSrc` nhận); chữ ký lặp `ab…` — không phải bí mật. */
const SIGNED_AVATAR = `https://x.invalid/p.png?X-Amz-Signature=${"ab".repeat(32)}`;

const recipient = (over: Partial<FeedKudosRecipientDto> = {}): FeedKudosRecipientDto => ({
  employeeId: EMP_A,
  fullName: "Bình Trần",
  avatarUrl: SIGNED_AVATAR,
  isFormerEmployee: false,
  ...over,
});

const block = (over: Partial<FeedKudosBlockDto> = {}): FeedKudosBlockDto => ({
  kudosId: "44444444-4444-4444-8444-444444444444",
  message: "Cảm ơn đã hỗ trợ!",
  isOfficial: false,
  badge: {
    id: "55555555-5555-4555-8555-555555555555",
    code: "team-player",
    name: "Đồng đội",
    icon: "users-round",
  },
  recipients: [recipient()],
  ...over,
});

const renderBlock = (b: FeedKudosBlockDto) =>
  render(
    <I18nextProvider i18n={i18n}>
      <KudosBlock block={b} />
    </I18nextProvider>,
  );

afterEach(cleanup);

describe("KB — người nhận", () => {
  it("tên là link hồ sơ với ĐÚNG employeeId (không phải khuôn `$employeeId`)", () => {
    renderBlock(block());
    const link = screen.getByRole("link", { name: "Bình Trần" });
    expect(link.getAttribute("href")).toBe(`/feed/profiles/${EMP_A}`);
  });

  it("DENY/ALLOW nhãn «Đã nghỉ việc»: chỉ theo `isFormerEmployee`", () => {
    renderBlock(
      block({
        recipients: [
          recipient(),
          recipient({ employeeId: EMP_B, fullName: "Cường Lê", isFormerEmployee: true }),
        ],
      }),
    );
    const items = screen.getAllByTestId("kudos-recipient");
    expect(within(items[0]).queryByTestId("kudos-former")).toBeNull();
    expect(within(items[1]).getByTestId("kudos-former")).toHaveTextContent(
      t("kudos.formerEmployee"),
    );
    // Người đã nghỉ (hồ sơ còn) vẫn giữ tên + link — vinh danh là lịch sử.
    expect(within(items[1]).getByRole("link").getAttribute("href")).toBe(`/feed/profiles/${EMP_B}`);
  });

  it("`fullName:null` + KHÔNG nghỉ (không có TK) ⇒ «Đồng nghiệp», KHÔNG nhãn, KHÔNG link", () => {
    renderBlock(block({ recipients: [recipient({ fullName: null, avatarUrl: null })] }));
    const item = screen.getByTestId("kudos-recipient");
    expect(item).toHaveTextContent(t("kudos.unknownRecipient"));
    expect(within(item).queryByTestId("kudos-former")).toBeNull();
    expect(within(item).queryByRole("link")).toBeNull();
    expect(item.textContent).not.toMatch(/rời công ty/);
  });

  it("`fullName:null` + đã nghỉ (hồ sơ xoá mềm) ⇒ «Đồng nghiệp» + nhãn, KHÔNG link", () => {
    renderBlock(
      block({
        recipients: [recipient({ fullName: null, avatarUrl: null, isFormerEmployee: true })],
      }),
    );
    const item = screen.getByTestId("kudos-recipient");
    expect(within(item).getByTestId("kudos-former")).toBeInTheDocument();
    expect(within(item).queryByRole("link")).toBeNull();
  });

  // ⟲ S16-SOCIAL-AVATARPRESIGN-1 (owner D4) — `avatarUrl` giờ là URL ĐÃ KÝ ⇒ vẽ ảnh. Vệ sinh render
  // (`avatarSrc`): CHỈ URL presign thành `src`; `null` / fileId thô / URL http(s) chưa ký (cột thô của
  // API cũ khi FE deploy trước) ⇒ chữ cái đầu, KHÔNG `<img>`.
  it("`avatarUrl` URL ký ⇒ `<img>` đúng `src`", () => {
    renderBlock(block());
    expect(screen.getByRole("img", { name: "Bình Trần" })).toHaveAttribute("src", SIGNED_AVATAR);
  });

  it("URL http(s) CHƯA ký (cột thô API cũ — beacon host lạ) ⇒ chữ cái đầu, KHÔNG `<img>`", () => {
    const { container } = renderBlock(
      block({ recipients: [recipient({ avatarUrl: "https://tracker.example/p.gif" })] }),
    );
    expect(screen.getByTestId("kudos-recipient")).toHaveTextContent("BT");
    expect(container.querySelector("img")).toBeNull();
  });

  it("`avatarUrl:null` ⇒ chữ cái đầu, KHÔNG `<img>`", () => {
    const { container } = renderBlock(block({ recipients: [recipient({ avatarUrl: null })] }));
    expect(screen.getByTestId("kudos-recipient")).toHaveTextContent("BT");
    expect(container.querySelector("img")).toBeNull();
  });

  it('fileId THÔ (API chưa ký) ⇒ KHÔNG `<img src="<uuid>">` (URL tương đối = ảnh vỡ)', () => {
    const { container } = renderBlock(block({ recipients: [recipient({ avatarUrl: EMP_B })] }));
    expect(screen.getByTestId("kudos-recipient")).toHaveTextContent("BT");
    expect(container.querySelector("img")).toBeNull();
  });

  it("`recipients: []` ⇒ không ném, không danh sách", () => {
    renderBlock(block({ recipients: [] }));
    expect(screen.queryByTestId("kudos-recipient")).toBeNull();
    expect(screen.getByTestId("kudos-block")).toBeInTheDocument();
  });
});

describe("KB — huy hiệu · chính thức · lời nhắn", () => {
  it("`badge:null` ⇒ nhãn «Vinh danh» + icon mặc định", () => {
    renderBlock(block({ badge: null }));
    expect(screen.getByTestId("kudos-badge-name")).toHaveTextContent(t("kudos.label"));
    expect(screen.getByTestId("kudos-badge-icon-default")).toBeInTheDocument();
  });

  it("icon seed ⇒ icon map; icon lạ ⇒ mặc định; emoji ⇒ vẽ như chữ", () => {
    renderBlock(block());
    expect(screen.getByTestId("kudos-badge-icon")).toBeInTheDocument();
    cleanup();
    renderBlock(block({ badge: { ...block().badge!, icon: "không-có-icon-này" } }));
    expect(screen.getByTestId("kudos-badge-icon-default")).toBeInTheDocument();
    cleanup();
    renderBlock(block({ badge: { ...block().badge!, icon: "🏆" } }));
    expect(screen.getByTestId("kudos-badge-emoji")).toHaveTextContent("🏆");
  });

  it.each([["constructor"], ["__proto__"], ["toString"], ["hasOwnProperty"]])(
    "🔴 gate LIGHT H1: icon do quản trị nhập = %j (thuộc tính kế thừa của Object) ⇒ KHÔNG ném, icon mặc định",
    (icon) => {
      expect(() => renderBlock(block({ badge: { ...block().badge!, icon } }))).not.toThrow();
      expect(screen.getByTestId("kudos-badge-icon-default")).toBeInTheDocument();
    },
  );

  it("DENY/ALLOW pill «Chính thức» theo `isOfficial`", () => {
    renderBlock(block());
    expect(screen.queryByTestId("kudos-official")).toBeNull();
    cleanup();
    renderBlock(block({ isOfficial: true }));
    expect(screen.getByTestId("kudos-official")).toHaveTextContent(t("kudos.official"));
  });

  it("`message:null` ⇒ không khối lời nhắn, không chữ «null»", () => {
    renderBlock(block({ message: null }));
    expect(screen.queryByTestId("kudos-message")).toBeNull();
    expect(screen.queryByText(/null|undefined/)).toBeNull();
  });

  it("lời nhắn là CHỮ THUẦN — `#tag` không thành link", () => {
    renderBlock(block({ message: "Cảm ơn #teamwork" }));
    expect(screen.getByTestId("kudos-message")).toHaveTextContent("Cảm ơn #teamwork");
    expect(within(screen.getByTestId("kudos-message")).queryByRole("link")).toBeNull();
  });
});
