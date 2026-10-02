/**
 * S16-SOCIAL-FE-2C — ca **KF** (ô chọn người nhận · huy hiệu · cờ chính thức) và **KS** (gửi qua
 * `FeedComposer`) — plan §4 + §8.
 *
 * - Ca DENY «không gọi 059» chờ QUA nhịp debounce (§8 M-b): assert ngay sau khi gõ thì xanh hiển nhiên
 *   vì debounce chưa nổ — mutant cổng `q.length>=2` cũng xanh theo. Ca ALLOW cùng nhịp.
 * - Ứng viên mang `avatarUrl` URL ký ⇒ ứng viên + chip VẼ ảnh (S16-SOCIAL-AVATARPRESIGN-1, owner D4);
 *   ca «không `<img>`» dùng fileId thô (khác rỗng) — với `null` thì code lỡ truyền thô vẫn xanh.
 * - `<select>` huy hiệu nạp bất đồng bộ: đợi option xuất hiện rồi mới `change` (bẫy race đã ghi).
 */
import * as React from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFeedPostSchema, type KudosRecipientCandidateDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { renderWithProviders, resetCaps, setCaps } from "../../feed/social-test-doubles";
import { FeedComposer } from "../../feed/components/FeedComposer";
import { KudosComposerFields, KUDOS_SEARCH_DEBOUNCE_MS } from "./KudosComposerFields";
import { EMPTY_KUDOS_DRAFT, type KudosDraft } from "../lib/kudos-draft";

const searchRecipients = vi.fn();
const listBadges = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialKudosApi: {
      ...actual.socialKudosApi,
      searchRecipients: (...a: unknown[]) => searchRecipients(...a),
      listBadges: (...a: unknown[]) => listBadges(...a),
    },
  };
});

const t = i18n.getFixedT("vi", "social");
const BADGE_ID = "55555555-5555-4555-8555-555555555555";
const person = (n: number, name = `Người ${n}`): KudosRecipientCandidateDto => ({
  employeeId: `${String(n).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
  fullName: name,
  avatarUrl: "https://x.invalid/p.png",
});
const badgePage = {
  data: [{ id: BADGE_ID, code: "team-player", name: "Đồng đội", description: null, icon: "users-round", position: 1 }],
  page: 1,
  limit: 100,
  total: 1,
};

/** Chờ QUA nhịp debounce (thời gian thật — không fake timer, để react-query giữ nhịp của nó). */
const pastDebounce = () =>
  act(() => new Promise<void>((r) => setTimeout(r, KUDOS_SEARCH_DEBOUNCE_MS + 150)));

function Harness({ initial = EMPTY_KUDOS_DRAFT }: { initial?: KudosDraft }) {
  const [draft, setDraft] = React.useState<KudosDraft>(initial);
  return (
    <>
      <KudosComposerFields draft={draft} onChange={setDraft} />
      <output data-testid="draft-state">
        {JSON.stringify({
          ids: draft.recipients.map((r) => r.employeeId),
          badgeId: draft.badgeId,
          isOfficial: draft.isOfficial,
        })}
      </output>
    </>
  );
}
const draftState = () =>
  JSON.parse(screen.getByTestId("draft-state").textContent ?? "{}") as {
    ids: string[];
    badgeId: string | null;
    isOfficial: boolean;
  };
const typeQuery = (value: string) =>
  fireEvent.change(screen.getByLabelText(t("composer.kudos.searchLabel")), { target: { value } });

beforeEach(() => {
  setCaps({ "view:feed": true, "create:feed-post": true, "create:feed-kudos": true });
  searchRecipients.mockResolvedValue({ data: [person(1, "An Nguyễn"), person(2, "Anh Trần")], truncated: false });
  listBadges.mockResolvedValue(badgePage);
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("KF — cổng gọi 059 (schema + cặp `create:feed-kudos`)", () => {
  it.each([["a"], ["a."]])("DENY: gõ %j ⇒ qua debounce vẫn KHÔNG gọi 059 + hiện gợi ý", async (q) => {
    renderWithProviders(<Harness />);
    typeQuery(q);
    await pastDebounce();
    expect(searchRecipients).not.toHaveBeenCalled();
    expect(screen.getByTestId("kudos-search-hint")).toHaveTextContent(t("composer.kudos.searchHint"));
  });

  it("ALLOW: gõ `  An  ` ⇒ gọi 059 với `q` ĐÃ chuẩn hoá `An`", async () => {
    renderWithProviders(<Harness />);
    typeQuery("  An  ");
    await pastDebounce();
    await waitFor(() => expect(searchRecipients).toHaveBeenCalledWith("An"));
  });

  it("DENY: không `create:feed-kudos` ⇒ gõ `an` qua debounce vẫn KHÔNG gọi 059", async () => {
    setCaps({ "view:feed": true, "create:feed-post": true });
    renderWithProviders(<Harness />);
    typeQuery("an");
    await pastDebounce();
    expect(searchRecipients).not.toHaveBeenCalled();
  });
});

describe("KF — chọn người nhận", () => {
  it("bấm ứng viên ⇒ thành chip; ứng viên đã chọn bị khoá; ảnh ứng viên + chip = URL ký", async () => {
    renderWithProviders(<Harness />);
    typeQuery("an");
    const [first] = await screen.findAllByTestId("kudos-candidate");
    expect(within(first).getByRole("img", { name: "An Nguyễn" })).toHaveAttribute(
      "src",
      "https://x.invalid/p.png",
    );
    fireEvent.click(first);
    expect(draftState().ids).toEqual([person(1).employeeId]);
    const chips = screen.getAllByTestId("kudos-selected");
    expect(chips).toHaveLength(1);
    expect(within(chips[0]!).getByRole("img", { name: "An Nguyễn" })).toHaveAttribute(
      "src",
      "https://x.invalid/p.png",
    );
    expect(screen.getAllByTestId("kudos-candidate")[0]).toBeDisabled();
  });

  it("fileId THÔ (API chưa ký) ⇒ ứng viên + chip KHÔNG `<img>` (chữ cái đầu)", async () => {
    searchRecipients.mockResolvedValue({
      data: [{ ...person(1, "An Nguyễn"), avatarUrl: "00000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
      truncated: false,
    });
    const { container } = renderWithProviders(<Harness />);
    typeQuery("an");
    const [first] = await screen.findAllByTestId("kudos-candidate");
    expect(first).toHaveTextContent("AN");
    fireEvent.click(first);
    expect(screen.getAllByTestId("kudos-selected")).toHaveLength(1);
    expect(container.querySelector("img")).toBeNull();
  });

  it("`truncated` ⇒ nhắc gõ thêm; kết quả rỗng ⇒ câu rỗng", async () => {
    searchRecipients.mockResolvedValueOnce({ data: [person(1)], truncated: true });
    renderWithProviders(<Harness />);
    typeQuery("an");
    expect(await screen.findByTestId("kudos-search-truncated")).toBeInTheDocument();
    searchRecipients.mockResolvedValueOnce({ data: [], truncated: false });
    typeQuery("xyz");
    expect(await screen.findByTestId("kudos-search-empty")).toBeInTheDocument();
  });

  it("lỗi danh bạ KHÔNG chặn soạn — chỉ báo", async () => {
    searchRecipients.mockRejectedValueOnce(new Error("boom"));
    renderWithProviders(<Harness />);
    typeQuery("an");
    expect(await screen.findByTestId("kudos-search-error")).toBeInTheDocument();
    expect(screen.getByTestId("kudos-badge-select")).toBeInTheDocument();
  });

  it("đủ 10 người ⇒ mọi ứng viên khoá + câu «đã đủ»", async () => {
    const full: KudosDraft = {
      ...EMPTY_KUDOS_DRAFT,
      recipients: Array.from({ length: 10 }, (_, i) => person(i + 10)),
    };
    renderWithProviders(<Harness initial={full} />);
    typeQuery("an");
    const candidates = await screen.findAllByTestId("kudos-candidate");
    for (const c of candidates) expect(c).toBeDisabled();
    expect(screen.getByTestId("kudos-selected-count")).toHaveTextContent(
      t("composer.kudos.full", { max: 10 }),
    );
  });

  it("bỏ chip ⇒ khỏi nháp", () => {
    renderWithProviders(<Harness initial={{ ...EMPTY_KUDOS_DRAFT, recipients: [person(1, "An Nguyễn")] }} />);
    fireEvent.click(screen.getByRole("button", { name: t("composer.kudos.remove", { name: "An Nguyễn" }) }));
    expect(draftState().ids).toEqual([]);
  });
});

describe("KF — huy hiệu · cờ chính thức", () => {
  it("select mặc định «Không gắn»; chọn huy hiệu 048 ⇒ nháp mang id", async () => {
    renderWithProviders(<Harness />);
    await screen.findByRole("option", { name: "Đồng đội" });
    const select = screen.getByTestId("kudos-badge-select") as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: BADGE_ID } });
    expect(draftState().badgeId).toBe(BADGE_ID);
  });

  it("§8 M-d: huy hiệu trong nháp KHÔNG còn trong catalog ⇒ tự bỏ chọn", async () => {
    const gone = "99999999-9999-4999-8999-999999999999";
    renderWithProviders(<Harness initial={{ ...EMPTY_KUDOS_DRAFT, badgeId: gone }} />);
    await waitFor(() => expect(draftState().badgeId).toBeNull());
  });

  it("DENY: không `manage:feed-kudos` ⇒ không ô «chính thức»", () => {
    renderWithProviders(<Harness />);
    expect(screen.queryByTestId("kudos-official-toggle")).toBeNull();
  });

  it("ALLOW: có `manage:feed-kudos` ⇒ ô «chính thức» bật được", () => {
    setCaps({ "view:feed": true, "create:feed-post": true, "create:feed-kudos": true, "manage:feed-kudos": true });
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByTestId("kudos-official-toggle"));
    expect(draftState().isOfficial).toBe(true);
  });
});

describe("KS — gửi lời vinh danh qua `FeedComposer`", () => {
  async function composeKudos(onSubmit: (dto: unknown) => unknown) {
    renderWithProviders(<FeedComposer onSubmit={onSubmit as never} isSubmitting={false} />);
    fireEvent.click(screen.getByTestId("composer-type-kudos"));
    typeQuery("an");
    fireEvent.click((await screen.findAllByTestId("kudos-candidate"))[1]);
    fireEvent.click(screen.getAllByTestId("kudos-candidate")[0]);
    fireEvent.change(screen.getByPlaceholderText(t("composer.kudosPlaceholder")), {
      target: { value: "  Cảm ơn cả hai!  " },
    });
  }

  it("payload hợp đồng: `type:'kudos'`, company, KHÔNG `body`, người nhận đã SẮP XẾP", async () => {
    const onSubmit = vi.fn().mockResolvedValue({});
    await composeKudos(onSubmit);
    fireEvent.click(screen.getByTestId("composer-submit"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const dto = onSubmit.mock.calls[0][0];
    expect(createFeedPostSchema.safeParse(dto).success).toBe(true);
    expect(dto).not.toHaveProperty("body");
    expect(dto).toMatchObject({ type: "kudos", audience: "company", requiresAck: false });
    expect(dto.kudos.recipientEmployeeIds).toEqual([person(1).employeeId, person(2).employeeId]);
    expect(dto.kudos.message).toBe("Cảm ơn cả hai!");
    expect(dto.kudos.isOfficial).toBe(false);
    // Promise resolve ⇒ ô soạn dọn nháp; chờ cho xong để không rò cập nhật state ra ngoài `act`.
    await waitFor(() => expect(screen.queryAllByTestId("kudos-selected")).toHaveLength(0));
  });

  it("reject ⇒ giữ nguyên chip + lời nhắn; resolve ⇒ dọn", async () => {
    let rejectFn: (e: unknown) => void = () => undefined;
    const onSubmit = vi
      .fn()
      .mockImplementationOnce(() => new Promise((_, rej) => (rejectFn = rej)))
      .mockResolvedValueOnce({});
    await composeKudos(onSubmit);
    fireEvent.click(screen.getByTestId("composer-submit"));
    await act(async () => rejectFn(new Error("x")));
    expect(screen.getAllByTestId("kudos-selected")).toHaveLength(2);
    expect(screen.getByPlaceholderText(t("composer.kudosPlaceholder"))).toHaveValue("  Cảm ơn cả hai!  ");

    fireEvent.click(screen.getByTestId("composer-submit"));
    await waitFor(() => expect(screen.queryAllByTestId("kudos-selected")).toHaveLength(0));
    expect(screen.getByPlaceholderText(t("composer.kudosPlaceholder"))).toHaveValue("");
  });

  it("gate LIGHT React LOW-2: chỉ gõ lời nhắn, chưa chọn ai ⇒ nói lý do (không để nút xám câm)", () => {
    renderWithProviders(<FeedComposer onSubmit={vi.fn()} isSubmitting={false} />);
    fireEvent.click(screen.getByTestId("composer-type-kudos"));
    fireEvent.change(screen.getByPlaceholderText(t("composer.kudosPlaceholder")), {
      target: { value: "Cảm ơn!" },
    });
    expect(screen.getByTestId("composer-kudos-error")).toHaveTextContent(
      t("composer.kudos.recipientsRequired"),
    );
    expect(screen.getByTestId("composer-submit")).toBeDisabled();
  });

  it("§8 M-e: có người nhận, lời nhắn rỗng ⇒ ĐÚNG MỘT alert (của nháp kudos), nút khoá", async () => {
    renderWithProviders(<FeedComposer onSubmit={vi.fn()} isSubmitting={false} />);
    fireEvent.click(screen.getByTestId("composer-type-kudos"));
    typeQuery("an");
    fireEvent.click((await screen.findAllByTestId("kudos-candidate"))[0]);
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(within(alerts[0]).getByText(t("composer.kudos.messageRequired"))).toBeInTheDocument();
    expect(screen.getByTestId("composer-submit")).toBeDisabled();
  });
});
