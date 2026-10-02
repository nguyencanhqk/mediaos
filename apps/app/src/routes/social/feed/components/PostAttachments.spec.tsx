/**
 * S16-SOCIAL-FE-2D — FULL gate lượt 1 trên `PostAttachments` (ca **G2 · G3 · G5c · bdi**).
 *
 * URL ký GET đổi ở MỖI lần refetch: `getSignedUrl` không ghim `signingDate` ⇒ mỗi GET bảng tin trả chữ ký
 * mới, và `invalidatePostLists` chạy sau thả cảm xúc · lưu · bình luận · kiểm duyệt. Hai lời hứa ca này giữ:
 *  - **G2** ô media GIỮ URL đầu tiên suốt vòng đời — đổi `src` là trình duyệt nạp lại (video về 0:00 giữa
 *    lúc xem, ảnh tải lại toàn bộ);
 *  - **G3** ô trung tính (URL hết hạn 300 s) HỒI khi server đã ký URL khác — không dính tới khi tải lại trang.
 *
 * Ca R1/R2/R2b/R5 (lọc `url:null` · lược đồ URL · ô trung tính) nằm ở `PostCard.spec.tsx`.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import type { FeedAttachmentDto } from "@mediaos/contracts";
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
