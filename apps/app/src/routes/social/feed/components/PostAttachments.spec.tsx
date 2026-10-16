/**
 * S16-SOCIAL-FE-2D — FULL gate lượt 1 trên `PostAttachments` (ca **G2 · G3 · G5c · bdi**) + plan §13.3 **V3** (link tệp
 * là link tải xuống — khối cuối file).
 *
 * URL ký GET đổi ở MỖI lần refetch: `getSignedUrl` không ghim `signingDate` ⇒ mỗi GET bảng tin trả chữ ký
 * mới, và `invalidatePostLists` chạy sau thả cảm xúc · lưu · bình luận · kiểm duyệt. Hai lời hứa ca này giữ:
 *  - **G2** ô media GIỮ URL đầu tiên suốt vòng đời — đổi `src` là trình duyệt nạp lại (video về 0:00 giữa
 *    lúc xem, ảnh tải lại toàn bộ);
 *  - **G3** ô trung tính (URL hết hạn 300 s) HỒI khi server đã ký URL khác — không dính tới khi tải lại trang.
 *
 * Ca R1/R2/R2b/R5 (lọc `url:null` · lược đồ URL · ô trung tính) nằm ở `PostCard.spec.tsx`.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import { FEED_MAX_IMAGES_PER_POST, type FeedAttachmentDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { PostAttachments } from "./PostAttachments";

const t = i18n.getFixedT("vi", "social");

const ui = (attachments: FeedAttachmentDto[]) => (
  <I18nextProvider i18n={i18n}>
    <PostAttachments attachments={attachments} />
  </I18nextProvider>
);

const videoAt = (sig: number, fileName: string | null = "hop-giao-ban.mp4"): FeedAttachmentDto => ({
  fileId: "v1",
  kind: "video",
  fileName,
  sizeBytes: 2048,
  url: `https://cdn.invalid/v1.mp4?sig=${sig}`,
});
const imageAt = (sig: number): FeedAttachmentDto => ({
  fileId: "i1",
  kind: "image",
  fileName: "anh.png",
  sizeBytes: 2048,
  url: `https://cdn.invalid/i1.png?sig=${sig}`,
});

afterEach(cleanup);

describe("G2 — refetch ký URL MỚI ⇒ ô media KHÔNG nạp lại", () => {
  it("video: CÙNG phần tử, `src` GIỮ URL đầu (đổi `src` = nạp lại, mất vị trí đang xem)", () => {
    const { container, rerender } = render(ui([videoAt(1)]));
    const before = container.querySelector("video");

    rerender(ui([videoAt(2)]));

    const after = container.querySelector("video");
    expect(after?.getAttribute("src")).toBe("https://cdn.invalid/v1.mp4?sig=1");
    expect(after).toBe(before);
  });

  it("ảnh: `src` GIỮ URL đầu (không tải lại ảnh đã hiện sau mỗi lần thả cảm xúc)", () => {
    const { container, rerender } = render(ui([imageAt(1)]));

    rerender(ui([imageAt(2)]));

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.invalid/i1.png?sig=1",
    );
  });
});

describe("G3 — ô trung tính HỒI khi server ký URL khác", () => {
  it("ảnh lỗi ⇒ trung tính; refetch CÙNG URL ⇒ vẫn trung tính; URL MỚI ⇒ vẽ lại ảnh bằng URL mới", () => {
    const { container, rerender } = render(ui([imageAt(1)]));
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(screen.getByTestId("attachment-image-unavailable")).toBeInTheDocument();

    // Chưa có chữ ký mới ⇒ không nạp lại URL đã chết (không vòng lỗi).
    rerender(ui([imageAt(1)]));
    expect(screen.getByTestId("attachment-image-unavailable")).toBeInTheDocument();

    rerender(ui([imageAt(2)]));
    expect(screen.queryByTestId("attachment-image-unavailable")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.invalid/i1.png?sig=2",
    );
  });

  it("video lỗi ⇒ trung tính; URL mới ⇒ trình phát trở lại; URL mới lỗi tiếp ⇒ trung tính (KHÔNG quay về URL cũ)", () => {
    const { container, rerender } = render(ui([videoAt(1)]));
    fireEvent.error(container.querySelector("video") as HTMLVideoElement);
    expect(screen.getByTestId("attachment-video-unavailable")).toBeInTheDocument();

    rerender(ui([videoAt(2)]));
    expect(screen.queryByTestId("attachment-video-unavailable")).toBeNull();
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "https://cdn.invalid/v1.mp4?sig=2",
    );

    fireEvent.error(container.querySelector("video") as HTMLVideoElement);
    expect(screen.getByTestId("attachment-video-unavailable")).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
  });

  it("server ĐÃ ký URL mới trước lúc URL đang dùng lỗi ⇒ đổi NGAY sang URL mới, không qua ô trung tính", () => {
    const { container, rerender } = render(ui([videoAt(1)]));
    rerender(ui([videoAt(2)]));

    fireEvent.error(container.querySelector("video") as HTMLVideoElement);

    expect(screen.queryByTestId("attachment-video-unavailable")).toBeNull();
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "https://cdn.invalid/v1.mp4?sig=2",
    );
  });
});

describe("G5c + bdi — tên truy cập được, tên tệp cô lập hướng chữ", () => {
  it("`<video>` mang tên tệp làm `aria-label`; tệp vô danh ⇒ chữ «Tệp đính kèm»", () => {
    const named = render(ui([videoAt(1)]));
    expect(named.container.querySelector("video")?.getAttribute("aria-label")).toBe(
      "hop-giao-ban.mp4",
    );

    cleanup();
    const unnamed = render(ui([videoAt(1, null)]));
    expect(unnamed.container.querySelector("video")?.getAttribute("aria-label")).toBe(
      t("attachment.unnamed"),
    );
  });

  it("tên tệp trong link nằm trong `<bdi>` — ký tự đảo chiều (RTLO) không lật được phần chữ quanh nó", () => {
    const rtlo = ["bao-cao", String.fromCharCode(0x202e), "fdp.exe"].join("");
    render(
      ui([
        {
          fileId: "d1",
          kind: "file",
          fileName: rtlo,
          sizeBytes: 2048,
          url: "https://cdn.invalid/d1.bin",
        },
      ]),
    );

    const link = screen.getByRole("link");
    const isolated = link.querySelector("bdi");
    expect(isolated?.textContent).toBe(rtlo);
  });
});

/**
 * Plan §13.3 V3 — tệp KHÔNG phải ảnh/video luôn về máy dưới dạng TẢI XUỐNG khi bấm link. Link nói rõ điều đó cho cả
 * người nhìn (icon tải cuối link, `aria-hidden`) lẫn trình đọc màn hình (chữ ẩn nối SAU tên + cỡ tệp, ngoài `<bdi>`).
 * Chữ kỳ vọng VIẾT TAY.
 */
describe("V3 — link tệp nói rõ là link TẢI XUỐNG", () => {
  const FILE_URL = "https://cdn.invalid/d1.pdf?sig=1";
  const fileNamed = (fileName: string): FeedAttachmentDto => ({
    fileId: "d1",
    kind: "file",
    fileName,
    sizeBytes: 2048,
    url: FILE_URL,
  });

  it("tên trợ năng của link tệp chứa CẢ tên tệp LẪN «tải xuống»; icon tải `aria-hidden` đứng CUỐI link", () => {
    render(ui([fileNamed("bao-cao-quy-3.pdf")]));
    const link = screen.getByRole("link");

    expect(link).toHaveAccessibleName(expect.stringContaining("bao-cao-quy-3.pdf"));
    expect(link).toHaveAccessibleName(expect.stringContaining("tải xuống"));
    // Chữ ẩn là phần chữ CUỐI của link (sau tên + cỡ tệp) và KHÔNG đi qua `aria-label` — nhãn đó đè mất tên tệp.
    expect(link.textContent?.endsWith("tải xuống")).toBe(true);
    expect(link).not.toHaveAttribute("aria-label");

    const icons = Array.from(link.querySelectorAll("svg"));
    expect(icons).toHaveLength(2);
    expect(icons.every((icon) => icon.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(link.lastElementChild).toBe(icons[1]);
  });

  it("DENY: link tệp KHÔNG mang thuộc tính `download`; vẫn mở tab mới với `noopener noreferrer`", () => {
    render(ui([fileNamed("bao-cao-quy-3.pdf")]));
    const link = screen.getByRole("link");

    expect(link).not.toHaveAttribute("download");
    expect(link).toHaveAttribute("href", FILE_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("ô ảnh / video KHÔNG có chữ «tải xuống» — chúng hiển thị tại chỗ, không phải link", () => {
    const { container } = render(ui([imageAt(1), videoAt(1)]));

    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("video")).not.toBeNull();
    expect(container).not.toHaveTextContent("tải xuống");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

/**
 * `showAllImages` (trang chi tiết bài): vẽ ĐỦ ảnh tới trần ảnh mỗi bài; mặc định (thẻ bảng tin · bình luận ·
 * tin) vẫn 4 ô + «+N». Cả hai chế độ: ảnh `url:null` không chiếm ô và không vào «+N»; ô ảnh là `<img>` TRẦN,
 * lớp «+N» là chữ không bấm được.
 */
describe("video `url:null` ẩn HẲN — không có ô «không xem được» (plan §6 D4)", () => {
  it("DENY: video `url:null` ⇒ không trình phát, không ô trung tính, cả khối không vẽ", () => {
    const { container } = render(ui([{ ...videoAt(1), url: null }]));

    expect(screen.queryByTestId("attachment-video-unavailable")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
    expect(screen.queryByTestId("post-attachments")).toBeNull();
  });

  it("ALLOW (đối chứng): video có URL ⇒ có trình phát", () => {
    const { container } = render(ui([videoAt(1)]));

    expect(container.querySelector("video")).not.toBeNull();
  });
});

describe("showAllImages — trang chi tiết vẽ đủ ảnh, thẻ bảng tin giữ 4 ô + «+N»", () => {
  const imageNo = (
    n: number,
    url: string | null = `https://cdn.invalid/a${n}.png`,
  ): FeedAttachmentDto => ({
    fileId: `a${n}`,
    kind: "image",
    fileName: `a${n}.png`,
    sizeBytes: 2048,
    url,
  });
  /** 6 ảnh, ảnh thứ 3 bị từ chối presign ⇒ 5 ảnh vẽ được. */
  const sixOneHidden = [
    imageNo(1),
    imageNo(2),
    imageNo(3, null),
    imageNo(4),
    imageNo(5),
    imageNo(6),
  ];
  const srcsOf = (grid: HTMLElement) =>
    Array.from(grid.querySelectorAll("img")).map((el) => el.getAttribute("src"));

  it("`showAllImages` ⇒ ĐÚNG 5 `<img>` theo thứ tự, không «+N»", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PostAttachments attachments={sixOneHidden} showAllImages />
      </I18nextProvider>,
    );
    const grid = screen.getByTestId("post-image-grid");

    expect(srcsOf(grid)).toEqual([
      "https://cdn.invalid/a1.png",
      "https://cdn.invalid/a2.png",
      "https://cdn.invalid/a4.png",
      "https://cdn.invalid/a5.png",
      "https://cdn.invalid/a6.png",
    ]);
    expect(grid).not.toHaveTextContent("+");
  });

  it("mặc định (cùng dữ liệu) ⇒ 4 `<img>` + «+1»", () => {
    render(ui(sixOneHidden));
    const grid = screen.getByTestId("post-image-grid");

    expect(srcsOf(grid)).toEqual([
      "https://cdn.invalid/a1.png",
      "https://cdn.invalid/a2.png",
      "https://cdn.invalid/a4.png",
      "https://cdn.invalid/a5.png",
    ]);
    expect(within(grid).getByText("+1")).toBeInTheDocument();
  });

  it("`showAllImages` vẫn có TRẦN: nhiều hơn trần ảnh mỗi bài 2 ảnh ⇒ vẽ đúng trần + «+2»", () => {
    const overCap = Array.from({ length: FEED_MAX_IMAGES_PER_POST + 2 }, (_, i) => imageNo(i + 1));
    render(
      <I18nextProvider i18n={i18n}>
        <PostAttachments attachments={overCap} showAllImages />
      </I18nextProvider>,
    );
    const grid = screen.getByTestId("post-image-grid");

    expect(srcsOf(grid)).toHaveLength(FEED_MAX_IMAGES_PER_POST);
    expect(within(grid).getByText("+2")).toBeInTheDocument();
  });

  it.each([
    ["showAllImages", true],
    ["mặc định", false],
  ])(
    "DENY (%s): ô ảnh là `<img>` trần — không link, không nút; «+N» là `<span>`",
    (_label, all) => {
      const { container } = render(
        <I18nextProvider i18n={i18n}>
          <PostAttachments attachments={sixOneHidden} showAllImages={all} />
        </I18nextProvider>,
      );

      expect(container.querySelector("a")).toBeNull();
      expect(container.querySelector("button")).toBeNull();
      expect(container.querySelector("[role='button'], [role='link'], [tabindex]")).toBeNull();
      for (const img of Array.from(container.querySelectorAll("img"))) {
        expect(img.parentElement?.tagName).toBe("DIV");
      }
      // Chế độ mặc định có «+1» (ca trên) ⇒ phải là `<span>`; `showAllImages` thì không có lớp phủ nào.
      const more = within(screen.getByTestId("post-image-grid")).queryByText(/^\+\d+$/);
      expect(more?.tagName).toBe(all ? undefined : "SPAN");
    },
  );
});
