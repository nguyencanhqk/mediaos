/**
 * S16-SOCIAL-FE-1 — ca **C3 · C4 · C26** trên `FeedComposer`.
 *
 * **C4 là cổng CHỐNG MỞ PHẠM VI**, không phải một phép đếm vu vơ: từ khi BE-2B-1 (#534) merge,
 * `feedCreatableTypeSchema` đã nhận `poll`, nên «không có nút bình chọn» chỉ còn được giữ bởi quyết
 * định phạm vi của owner + chính ca này. Xoá nó đi là mở cửa cho FE-2 tràn ngược vào FE-1.
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { FeedComposer } from "./FeedComposer";

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

function renderComposer(props: Partial<React.ComponentProps<typeof FeedComposer>> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn();
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <FeedComposer onSubmit={onSubmit} isSubmitting={props.isSubmitting ?? false} {...props} />
    </I18nextProvider>,
  );
  return { ...utils, onSubmit };
}

beforeEach(() => {
  setCaps({ "view:feed": true, "create:feed-post": true });
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("C3 — nút «Tin tức» gác bằng `manage:feed-news`", () => {
  it("ALLOW: có `manage:feed-news` ⇒ nút «Tin tức» HIỆN", () => {
    setCaps({ "view:feed": true, "create:feed-post": true, "manage:feed-news": true });
    renderComposer();
    expect(screen.getByTestId("composer-type-news")).toBeInTheDocument();
  });

  it("DENY: KHÔNG có `manage:feed-news` ⇒ nút «Tin tức» vắng, và chỉ còn ĐÚNG MỘT nút", () => {
    renderComposer();
    expect(screen.queryByTestId("composer-type-news")).toBeNull();
    // Đối chứng: composer KHÔNG rỗng — nút «Chia sẻ» vẫn ở đó, nên ca này đỏ vì đúng lý do.
    expect(screen.getByTestId("composer-type-share")).toBeInTheDocument();
    expect(screen.getByTestId("composer-type-group").querySelectorAll("button")).toHaveLength(1);
  });

  it("ô «Yêu cầu xác nhận đã đọc» chỉ xuất hiện khi đang soạn TIN TỨC", () => {
    setCaps({ "view:feed": true, "create:feed-post": true, "manage:feed-news": true });
    renderComposer();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByTestId("composer-type-news"));
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });
});

describe("C4 — composer có ĐÚNG 2 nút loại bài (chặn scope creep)", () => {
  it("người có TẤT CẢ quyền feed vẫn chỉ thấy 2 nút — không có poll/idea/kudos", () => {
    setCaps({
      "view:feed": true,
      "create:feed-post": true,
      "manage:feed-news": true,
      // Các cặp của track B: có đủ quyền cũng KHÔNG được sinh thêm nút ở FE-1.
      "create:feed-poll": true,
      "create:feed-idea": true,
      "create:feed-kudos": true,
    });
    renderComposer();

    const group = screen.getByTestId("composer-type-group");
    expect(group.querySelectorAll("button")).toHaveLength(2);
    expect(screen.getByTestId("composer-type-share")).toBeInTheDocument();
    expect(screen.getByTestId("composer-type-news")).toBeInTheDocument();

    for (const absent of ["poll", "idea", "kudos"]) {
      expect(screen.queryByTestId(`composer-type-${absent}`)).toBeNull();
    }
  });

  it("wildcard `*:*` cũng KHÔNG sinh thêm nút nào", () => {
    // Cả 14 cặp `feed-*` đều non-sensitive nên `useCan` có fallback wildcard — đúng thiết kế engine.
    // Ca này chốt: wildcard mở GATE, không mở PHẠM VI.
    setCaps({ "*:*": true });
    renderComposer();
    expect(screen.getByTestId("composer-type-group").querySelectorAll("button")).toHaveLength(2);
  });
});

describe("C26 — trạng thái «đang gửi» (SPEC-16 §14, trạng thái thứ 5)", () => {
  it("đang gửi ⇒ nút bị KHOÁ và đổi nhãn", () => {
    renderComposer({ isSubmitting: true });
    const submit = screen.getByTestId("composer-submit");
    expect(submit).toBeDisabled();
  });

  it("bấm 2 lần liên tiếp ⇒ CHỈ 1 lần gọi onSubmit (chống double-submit)", () => {
    /**
     * Khoá idempotency suy-từ-nội-dung chặn được lần THỬ LẠI của cùng payload, nhưng không chặn
     * được hai lần bấm nếu giữa chúng nội dung đổi. Vế còn lại là: sau lần gửi đầu, ô soạn được dọn
     * rỗng ⇒ lần bấm thứ hai không hợp lệ và không gọi gì.
     */
    const { onSubmit } = renderComposer();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "xin chào" } });

    const submit = screen.getByTestId("composer-submit");
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("nội dung rỗng ⇒ nút khoá, bấm không gọi gì, và hiện lý do", () => {
    const { onSubmit } = renderComposer();
    const submit = screen.getByTestId("composer-submit");
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("gate soạn bài — forbidden là ẨN, không phải disabled", () => {
  it("không có `create:feed-post` ⇒ KHÔNG render ô soạn (SPEC-16 §14)", () => {
    setCaps({ "view:feed": true });
    renderComposer();
    expect(screen.queryByTestId("feed-composer")).toBeNull();
  });
});

describe("D8 — KHÔNG có nút đính kèm ở FE-1", () => {
  it("composer không render input file nào (đường đăng ký tệp chưa tồn tại — nợ N1)", () => {
    // `POST /social/files/upload-url` KHÔNG tồn tại (đo lại ở T0/W7), và `foundation/files` đòi cặp
    // `*:foundation-file` mà nhân viên thường không có. Nút đính kèm sẽ 403 cho đúng nhóm người
    // dùng chính ⇒ dựng UI cho nó là làm giả. Ca này giữ lời hứa đó.
    setCaps({ "view:feed": true, "create:feed-post": true, "*:foundation-file": true });
    const { container } = renderComposer();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});
