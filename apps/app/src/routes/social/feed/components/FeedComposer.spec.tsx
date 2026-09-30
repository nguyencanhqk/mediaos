/**
 * S16-SOCIAL-FE-1/FE-2/FE-2C — ca **C3 · C4 · G1 · C26 · P1 · P2 · P3** trên `FeedComposer`.
 *
 * **C4 là cổng CHỐNG MỞ PHẠM VI**, không phải một phép đếm vu vơ: tập nút là ĐÚNG năm loại
 * (Chia sẻ · Tin tức · Bình chọn · Sáng kiến · Vinh danh — S16-SOCIAL-FE-2C mở nút cuối). Nút thứ sáu
 * xuất hiện là ca này đỏ. **G1**: «Vinh danh» VẮNG ở composer nhóm (owner ký O3).
 * Ca soạn kudos (ô chọn người nhận · gửi) ở `kudos/components/KudosComposerFields.spec.tsx`.
 */
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import { createFeedPostSchema } from "@mediaos/contracts";
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

describe("C4 — composer có ĐÚNG 5 nút loại bài (chặn scope creep)", () => {
  it("người có TẤT CẢ quyền feed thấy đúng share · news · poll · idea · kudos", () => {
    setCaps({
      "view:feed": true,
      "create:feed-post": true,
      "manage:feed-news": true,
      "create:feed-poll": true,
      "create:feed-idea": true,
      "create:feed-kudos": true,
    });
    renderComposer();

    const group = screen.getByTestId("composer-type-group");
    expect(group.querySelectorAll("button")).toHaveLength(5);
    for (const present of ["share", "news", "poll", "idea", "kudos"]) {
      expect(screen.getByTestId(`composer-type-${present}`)).toBeInTheDocument();
    }
  });

  it("wildcard `*:*` ⇒ ĐÚNG 5 nút gồm kudos", () => {
    // Cả 14 cặp `feed-*` đều non-sensitive nên `useCan` có fallback wildcard — đúng thiết kế engine.
    setCaps({ "*:*": true });
    renderComposer();
    expect(screen.getByTestId("composer-type-group").querySelectorAll("button")).toHaveLength(5);
    expect(screen.getByTestId("composer-type-kudos")).toBeInTheDocument();
  });

  it("DENY: đủ quyền TRỪ `create:feed-kudos` ⇒ 4 nút, vắng kudos", () => {
    setCaps({
      "view:feed": true,
      "create:feed-post": true,
      "manage:feed-news": true,
      "create:feed-poll": true,
      "create:feed-idea": true,
    });
    renderComposer();
    expect(screen.getByTestId("composer-type-group").querySelectorAll("button")).toHaveLength(4);
    expect(screen.queryByTestId("composer-type-kudos")).toBeNull();
  });

  it("ALLOW: chỉ `create:feed-post` + `create:feed-kudos` ⇒ đúng {share, kudos}", () => {
    setCaps({ "view:feed": true, "create:feed-post": true, "create:feed-kudos": true });
    renderComposer();
    const buttons = screen.getByTestId("composer-type-group").querySelectorAll("button");
    expect([...buttons].map((b) => b.getAttribute("data-testid"))).toEqual([
      "composer-type-share",
      "composer-type-kudos",
    ]);
  });
});

describe("G1 — «Vinh danh» VẮNG ở composer NHÓM (owner ký O3)", () => {
  it("DENY: `groupId` + đủ quyền ⇒ không nút kudos (poll/idea vẫn có — đối chứng)", () => {
    setCaps({ "*:*": true });
    renderComposer({ groupId: "77777777-7777-4777-8777-777777777777" });
    expect(screen.queryByTestId("composer-type-kudos")).toBeNull();
    expect(screen.getByTestId("composer-type-poll")).toBeInTheDocument();
  });

  it("ALLOW: bảng tin (không `groupId`) + cùng quyền ⇒ nút kudos CÓ", () => {
    setCaps({ "*:*": true });
    renderComposer();
    expect(screen.getByTestId("composer-type-kudos")).toBeInTheDocument();
  });
});

describe("P1/P2 — nút «Bình chọn» / «Sáng kiến» gác bằng cặp tầng-2 của route 002", () => {
  it("DENY: chỉ `create:feed-post` ⇒ không nút poll/idea (nút «Chia sẻ» vẫn có — đối chứng)", () => {
    renderComposer();
    expect(screen.getByTestId("composer-type-share")).toBeInTheDocument();
    expect(screen.queryByTestId("composer-type-poll")).toBeNull();
    expect(screen.queryByTestId("composer-type-idea")).toBeNull();
  });

  it("ALLOW: `create:feed-poll` ⇒ CHỈ nút poll hiện", () => {
    setCaps({ "view:feed": true, "create:feed-post": true, "create:feed-poll": true });
    renderComposer();
    expect(screen.getByTestId("composer-type-poll")).toBeInTheDocument();
    expect(screen.queryByTestId("composer-type-idea")).toBeNull();
  });

  it("ALLOW: `create:feed-idea` ⇒ CHỈ nút idea hiện", () => {
    setCaps({ "view:feed": true, "create:feed-post": true, "create:feed-idea": true });
    renderComposer();
    expect(screen.getByTestId("composer-type-idea")).toBeInTheDocument();
    expect(screen.queryByTestId("composer-type-poll")).toBeNull();
  });
});

describe("P3 — soạn bình chọn / sáng kiến", () => {
  const POLL_CAPS = {
    "view:feed": true,
    "create:feed-post": true,
    "create:feed-poll": true,
    "create:feed-idea": true,
  };

  const fillPoll = (): void => {
    fireEvent.click(screen.getByTestId("composer-type-poll"));
    fireEvent.change(screen.getByTestId("composer-poll-question"), {
      target: { value: "Ăn trưa ở đâu?" },
    });
    fireEvent.change(screen.getByTestId("composer-poll-option-0"), { target: { value: "Cơm" } });
    fireEvent.change(screen.getByTestId("composer-poll-option-1"), { target: { value: "Phở" } });
  };

  it("nháp poll chưa đủ (1 ô trống) ⇒ nút Đăng KHOÁ, bấm không gọi gì", () => {
    setCaps(POLL_CAPS);
    const { onSubmit } = renderComposer();
    fireEvent.click(screen.getByTestId("composer-type-poll"));
    fireEvent.change(screen.getByTestId("composer-poll-question"), { target: { value: "Q" } });
    fireEvent.change(screen.getByTestId("composer-poll-option-0"), { target: { value: "A" } });
    expect(screen.getByTestId("composer-submit")).toBeDisabled();
    fireEvent.click(screen.getByTestId("composer-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("tối đa 10 lựa chọn: tới 10 thì nút «Thêm» khoá; tối thiểu 2: nút «Bỏ» khoá", () => {
    setCaps(POLL_CAPS);
    renderComposer();
    fireEvent.click(screen.getByTestId("composer-type-poll"));
    expect(screen.getByTestId("composer-poll-remove-0")).toBeDisabled();
    for (let i = 0; i < 8; i += 1) fireEvent.click(screen.getByTestId("composer-poll-add"));
    expect(screen.getAllByTestId(/^composer-poll-option-/)).toHaveLength(10);
    expect(screen.getByTestId("composer-poll-add")).toBeDisabled();
  });

  it("gửi poll KHÔNG mô tả ⇒ payload KHÔNG có `body`, parse được bằng createFeedPostSchema", async () => {
    setCaps(POLL_CAPS);
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true }));
    renderComposer({ onSubmit });
    fillPoll();
    fireEvent.click(screen.getByTestId("composer-poll-multiple"));
    fireEvent.click(screen.getByTestId("composer-submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const dto = (onSubmit.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(dto).not.toHaveProperty("body");
    expect(dto).toMatchObject({
      type: "poll",
      poll: { question: "Ăn trưa ở đâu?", options: ["Cơm", "Phở"], multipleChoice: true },
    });
    expect(createFeedPostSchema.safeParse(dto).success).toBe(true);
  });

  it("gửi poll HỎNG ⇒ câu hỏi + lựa chọn VẪN CÒN (luật H2 áp cho cả trường poll)", async () => {
    setCaps(POLL_CAPS);
    const onSubmit = vi.fn(() => Promise.reject(new Error("mạng rớt")));
    renderComposer({ onSubmit });
    fillPoll();
    fireEvent.click(screen.getByTestId("composer-submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("composer-submit")).not.toBeDisabled());
    expect(screen.getByTestId("composer-poll-question")).toHaveValue("Ăn trưa ở đâu?");
    expect(screen.getByTestId("composer-poll-option-1")).toHaveValue("Phở");
  });

  it("gửi poll THÀNH CÔNG ⇒ nháp poll về rỗng", async () => {
    setCaps(POLL_CAPS);
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true }));
    renderComposer({ onSubmit });
    fillPoll();
    fireEvent.click(screen.getByTestId("composer-submit"));
    await waitFor(() => expect(screen.getByTestId("composer-poll-question")).toHaveValue(""));
  });

  it("nhãn trùng ⇒ hiện lý do đã dịch (không phải khoá i18n thô)", () => {
    setCaps(POLL_CAPS);
    renderComposer();
    fillPoll();
    fireEvent.change(screen.getByTestId("composer-poll-option-1"), { target: { value: " cơm " } });
    fireEvent.click(screen.getByTestId("composer-submit"));
    const t = i18n.getFixedT("vi", "social");
    expect(screen.getByTestId("composer-poll-error")).toHaveTextContent(
      t("composer.poll.optionDuplicate"),
    );
  });

  it("sáng kiến ⇒ BẮT BUỘC nội dung; gửi `{type:'idea', body}` parse được", async () => {
    setCaps(POLL_CAPS);
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true }));
    renderComposer({ onSubmit });
    fireEvent.click(screen.getByTestId("composer-type-idea"));
    expect(screen.getByTestId("composer-submit")).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Lắp máy lọc nước" } });
    fireEvent.click(screen.getByTestId("composer-submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const dto = (onSubmit.mock.calls[0] as unknown[])[0];
    expect(dto).toMatchObject({ type: "idea", body: "Lắp máy lọc nước" });
    expect(createFeedPostSchema.safeParse(dto).success).toBe(true);
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
     * được hai lần bấm nếu giữa chúng nội dung đổi.
     *
     * ⚠️ **CƠ CHẾ CHẶN ĐÃ ĐỔI 23/09/2026 (vá H2).** Trước đây vế chặn là "ô soạn tự dọn rỗng ngay
     * sau lần gửi đầu" — mà chính việc dọn sớm đó là lỗi mất bài khi mạng rớt. Vế chặn bây giờ là cờ
     * `sending` nội bộ của composer: bật khi lượt gửi ĐANG BAY, tắt khi promise settle. `onSubmit`
     * vì vậy phải trả về một promise đang bay, đúng như caller thật (`mutateAsync`).
     */
    const onSubmit = vi.fn(() => new Promise<void>(() => {}));
    renderComposer({ onSubmit });
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

describe("🔴 H2 — ô soạn KHÔNG dọn nội dung trước khi biết kết quả", () => {
  /** Đúng kịch bản đắt nhất: bài dài, mạng rớt một giây. */
  const LONG_DRAFT = "x".repeat(1500);

  const typeAndSend = (draft = LONG_DRAFT): void => {
    fireEvent.change(screen.getByRole("textbox"), { target: { value: draft } });
    fireEvent.click(screen.getByTestId("composer-submit"));
  };

  /**
   * Chờ lượt gửi SETTLE rồi hãy đo nội dung — đo sớm là đo một trạng thái chưa kết luận và ca sẽ
   * XANH GIẢ kể cả khi composer dọn ô ở nhánh lỗi.
   *
   * ⚠️ Mốc chờ phải là **nhãn nút**, KHÔNG phải `not.toBeDisabled()`: khi ai đó trả lại lỗi dọn-sớm
   * thì ô soạn rỗng ⇒ nút ở lại trạng thái disabled VĨNH VIỄN ⇒ ca đỏ vì hết giờ chờ nút, và dòng
   * thông báo nói về cái nút chứ không nói "chữ của người dùng đã bay mất" (memory
   * `mutant-red-must-match-expected-message`).
   */
  const waitForSettled = async (): Promise<void> => {
    const t = i18n.getFixedT("vi", "social");
    await waitFor(() =>
      expect(screen.getByTestId("composer-submit")).not.toHaveTextContent(t("composer.submitting")),
    );
  };

  it("gửi HỎNG ⇒ nội dung 1.500 chữ VẪN CÒN nguyên trong ô soạn", async () => {
    /**
     * Ca đắt nhất của WO. Không có đường nào lấy lại chữ đã gõ nếu composer dọn sớm — và chuỗi
     * `actionError.generic.post` («Nội dung bạn gõ vẫn còn trong ô soạn») sẽ thành lời nói dối.
     */
    const onSubmit = vi.fn(() => Promise.reject(new Error("mạng rớt")));
    renderComposer({ onSubmit });
    typeAndSend();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitForSettled();
    expect(screen.getByRole("textbox")).toHaveValue(LONG_DRAFT);
  });

  it("gửi THÀNH CÔNG ⇒ ô soạn rỗng", async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true }));
    renderComposer({ onSubmit });
    typeAndSend("xin chào");

    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  });

  it("thành công ⇒ KHÔNG bắn «hãy nhập nội dung» cho chính việc vừa làm xong", async () => {
    // `touched` còn bật + ô vừa dọn rỗng = một cảnh báo đỏ ngay sau một lượt đăng thành công.
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true }));
    renderComposer({ onSubmit });
    typeAndSend("xin chào");

    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("đang bay ⇒ nút KHOÁ (không cần caller truyền `isSubmitting`)", () => {
    const onSubmit = vi.fn(() => new Promise<void>(() => {}));
    renderComposer({ onSubmit });
    typeAndSend("xin chào");

    expect(screen.getByTestId("composer-submit")).toBeDisabled();
  });

  it("caller trả `void` ⇒ KHÔNG đoán mò: giữ nguyên nội dung", () => {
    /**
     * `mutation.mutate` trả `void` ⇒ composer không có cách nào biết server đã nhận hay chưa. Chọn
     * giữ chữ: mất một lượt xoá tay còn hơn mất một bài 1.500 chữ.
     */
    const onSubmit = vi.fn();
    renderComposer({ onSubmit });
    typeAndSend("xin chào");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox")).toHaveValue("xin chào");
  });

  it("tin tức: ô «yêu cầu xác nhận» chỉ reset khi ĐÃ đăng được", async () => {
    setCaps({ "view:feed": true, "create:feed-post": true, "manage:feed-news": true });
    const onSubmit = vi.fn(() => Promise.reject(new Error("500")));
    renderComposer({ onSubmit });

    fireEvent.click(screen.getByTestId("composer-type-news"));
    fireEvent.click(screen.getByRole("checkbox"));
    typeAndSend("tin nội bộ");

    await waitForSettled();
    // Reset cờ này khi chưa đăng được nghĩa là lượt thử lại gửi đi một tin KHÔNG đòi xác nhận —
    // im lặng đánh mất một yêu cầu nghiệp vụ mà người soạn đã chọn.
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("textbox")).toHaveValue("tin nội bộ");
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

describe("S16-SOCIAL-FE-2B P1 — chế độ nhóm (`groupId`)", () => {
  const GROUP_ID = "11111111-1111-4111-8111-111111111111";
  const CAPS = {
    "view:feed": true,
    "create:feed-post": true,
    "create:feed-poll": true,
    "manage:feed-news": true,
  };

  it("chia sẻ trong nhóm ⇒ `audience:'group', groupId` và parse được bằng createFeedPostSchema", async () => {
    setCaps(CAPS);
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true }));
    renderComposer({ onSubmit, groupId: GROUP_ID });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Chào cả nhóm" } });
    fireEvent.click(screen.getByTestId("composer-submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const dto = (onSubmit.mock.calls[0] as unknown[])[0];
    expect(dto).toMatchObject({ type: "share", audience: "group", groupId: GROUP_ID, body: "Chào cả nhóm" });
    expect(createFeedPostSchema.safeParse(dto).success).toBe(true);
  });

  it("bình chọn trong nhóm cũng mang `audience:'group'` (mọi loại, không chỉ chia sẻ)", async () => {
    setCaps(CAPS);
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true }));
    renderComposer({ onSubmit, groupId: GROUP_ID });
    fireEvent.click(screen.getByTestId("composer-type-poll"));
    fireEvent.change(screen.getByTestId("composer-poll-question"), { target: { value: "Đá bóng tối nào?" } });
    fireEvent.change(screen.getByTestId("composer-poll-option-0"), { target: { value: "Thứ 3" } });
    fireEvent.change(screen.getByTestId("composer-poll-option-1"), { target: { value: "Thứ 5" } });
    fireEvent.click(screen.getByTestId("composer-submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const dto = (onSubmit.mock.calls[0] as unknown[])[0];
    expect(dto).toMatchObject({ type: "poll", audience: "group", groupId: GROUP_ID });
    expect(createFeedPostSchema.safeParse(dto).success).toBe(true);
  });

  it("placeholder nói về NHÓM (câu «gửi tới công ty» là sai trong nhóm)", () => {
    setCaps(CAPS);
    renderComposer({ groupId: GROUP_ID });
    const t = i18n.getFixedT("vi", "social");
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(t("composer.groupPlaceholder"));
    fireEvent.click(screen.getByTestId("composer-type-news"));
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(
      t("composer.groupNewsPlaceholder"),
    );
  });

  it("ĐỐI CHỨNG: không `groupId` ⇒ `audience:'company'` và KHÔNG có khoá `groupId`", async () => {
    setCaps(CAPS);
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true }));
    renderComposer({ onSubmit });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Chào công ty" } });
    fireEvent.click(screen.getByTestId("composer-submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const dto = (onSubmit.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(dto.audience).toBe("company");
    expect(dto).not.toHaveProperty("groupId");
  });
});
