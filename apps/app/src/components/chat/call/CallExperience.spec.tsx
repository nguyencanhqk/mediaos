/**
 * CallExperience.spec.tsx — mặt tiền THUẦN HIỂN THỊ của cuộc gọi (S7-CALL-QA-2, điểm mù #2/1.241 dòng).
 *
 * ⚠️ jsdom KHÔNG implement `HTMLMediaElement.play()` trả `Promise` (nó trả `undefined`) trong khi MỌI
 * trình duyệt thật đều trả `Promise` — component gọi `el.play().catch(...)`. Đây là khoảng trống môi
 * trường TEST, không phải bug sản phẩm (browser thật luôn có Promise). Stub ở `beforeEach`, KHÔNG sửa
 * component.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { CallExperience } from "./CallExperience";
import type { CallPhase } from "./use-chat-call";
import { FakeMediaStream, FakeMediaStreamTrack } from "./call-test-doubles";

/**
 * `CallExperienceProps` không được export từ `CallExperience.tsx` (component thuần hiển thị, props chỉ
 * cần trong nội bộ tệp đó). Khai lại cấu trúc ở đây thay vì export thêm từ production code — tránh mở
 * rộng bề mặt public của component chỉ để phục vụ test.
 */
interface Props {
  phase: CallPhase;
  kind: "audio" | "video";
  peerName: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  isSharingScreen: boolean;
  remoteMicOn: boolean;
  remoteCamOn: boolean;
  remoteSharing: boolean;
  notice: string | null;
  onAccept: () => void;
  onReject: () => void;
  onHangup: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
}

beforeEach(() => {
  Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

function baseProps(): Props {
  return {
    phase: "idle",
    kind: "audio",
    peerName: "Nguyễn Văn A",
    localStream: null,
    remoteStream: null,
    micOn: true,
    camOn: true,
    isSharingScreen: false,
    remoteMicOn: true,
    remoteCamOn: true,
    remoteSharing: false,
    notice: null,
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onHangup: vi.fn(),
    onToggleMic: vi.fn(),
    onToggleCamera: vi.fn(),
    onToggleScreenShare: vi.fn(),
  };
}

function renderExperience(overrides: Partial<Props> = {}) {
  const props = { ...baseProps(), ...overrides };
  const view = render(
    <I18nextProvider i18n={i18n}>
      <CallExperience {...props} />
    </I18nextProvider>,
  );
  return { ...view, props };
}

describe("phase idle", () => {
  it("không render gì (overlay không chiếm chỗ khi không có cuộc gọi)", () => {
    const { container } = renderExperience({ phase: "idle" });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("chuông đến (incoming-ringing)", () => {
  it("hiện dialog + đưa focus vào nút Nhận (bàn phím không phải Tab qua cả trang)", async () => {
    renderExperience({ phase: "incoming-ringing" });
    expect(screen.getByTestId("chat-call-incoming")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("chat-call-accept")).toHaveFocus());
  });

  it("bấm Nhận/Từ chối gọi đúng callback lên trên", () => {
    const { props } = renderExperience({ phase: "incoming-ringing" });
    screen.getByTestId("chat-call-accept").click();
    expect(props.onAccept).toHaveBeenCalledTimes(1);
    expect(props.onReject).not.toHaveBeenCalled();

    screen.getByTestId("chat-call-reject").click();
    expect(props.onReject).toHaveBeenCalledTimes(1);
  });
});

describe("khung đang gọi/kết nối/trong cuộc", () => {
  it("kind video + có remoteStream ⇒ hiện video từ xa, KHÔNG hiện avatar chữ cái", () => {
    const remoteStream = new FakeMediaStream([
      new FakeMediaStreamTrack("video"),
    ]) as unknown as MediaStream;
    renderExperience({ phase: "in-call", kind: "video", remoteStream });
    const video = screen.getByTestId("chat-call-remote-video");
    expect(video.className).not.toContain("hidden");
  });

  it("chưa có remoteStream (hoặc kind audio) ⇒ video ẩn, avatar chữ cái đầu thay thế", () => {
    renderExperience({ phase: "in-call", kind: "audio", remoteStream: null, peerName: "Bình" });
    const video = screen.getByTestId("chat-call-remote-video");
    expect(video.className).toContain("hidden");
    expect(screen.getByText("B")).toBeTruthy();
  });

  it("thu nhỏ (minimize) ⇒ ẩn khung tự xem mình (local video)", () => {
    const localStream = new FakeMediaStream([
      new FakeMediaStreamTrack("video"),
    ]) as unknown as MediaStream;
    renderExperience({ phase: "in-call", kind: "video", localStream });
    expect(screen.getByTestId("chat-call-local-video")).toBeTruthy();

    fireEvent.click(screen.getByTestId("chat-call-toggle-size"));
    expect(screen.queryByTestId("chat-call-local-video")).toBeNull();
  });

  it("nút mic/camera/hangup gọi đúng callback + phản chiếu trạng thái qua aria-pressed", () => {
    const { props } = renderExperience({
      phase: "in-call",
      kind: "video",
      micOn: true,
      camOn: false,
    });
    const micBtn = screen.getByTestId("chat-call-toggle-mic");
    const camBtn = screen.getByTestId("chat-call-toggle-cam");
    expect(camBtn.getAttribute("aria-pressed")).toBe("true"); // camOn=false ⇒ pressed(tắt)=true

    micBtn.click();
    expect(props.onToggleMic).toHaveBeenCalledTimes(1);
    camBtn.click();
    expect(props.onToggleCamera).toHaveBeenCalledTimes(1);

    screen.getByTestId("chat-call-hangup").click();
    expect(props.onHangup).toHaveBeenCalledTimes(1);
  });

  it("nút chia sẻ màn hình CHỈ hiện khi kind video VÀ đã in-call", () => {
    renderExperience({ phase: "connecting", kind: "video" });
    expect(screen.queryByTestId("chat-call-toggle-screen")).toBeNull();

    renderExperience({ phase: "in-call", kind: "audio" });
    expect(screen.queryByTestId("chat-call-toggle-screen")).toBeNull();

    const { props } = renderExperience({ phase: "in-call", kind: "video" });
    const shareBtn = screen.getAllByTestId("chat-call-toggle-screen")[0];
    shareBtn.click();
    expect(props.onToggleScreenShare).toHaveBeenCalledTimes(1);
  });

  it("notice hiển thị đúng nội dung khi có (mềm, cuộc gọi vẫn chạy)", () => {
    renderExperience({ phase: "in-call", notice: "Không tìm thấy camera — gọi bằng âm thanh." });
    expect(screen.getByText("Không tìm thấy camera — gọi bằng âm thanh.")).toBeTruthy();
  });

  it("unmount giữa chừng KHÔNG ném lỗi (dọn ref video an toàn)", () => {
    const remoteStream = new FakeMediaStream([
      new FakeMediaStreamTrack("audio"),
    ]) as unknown as MediaStream;
    const { unmount } = renderExperience({ phase: "in-call", kind: "video", remoteStream });
    expect(() => unmount()).not.toThrow();
  });
});
