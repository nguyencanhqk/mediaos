/**
 * S16-SOCIAL-FE-2B — ca M1 (Thành viên) · R1 (Yêu cầu) · S1 (Cài đặt), plan D11–D13 + §8 M2.
 *
 * Double của `037` TRẢ theo `status` được hỏi (server: không truyền = lẫn cả pending) — double bỏ qua
 * tham số thì ca «tab Thành viên chỉ hiện active» xanh kể cả khi quên gửi `status`.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { socialKeys } from "@mediaos/web-core";
import i18n from "@/i18n";
import {
  GROUP_ERR,
  GROUP_ID,
  makeGroup,
  makeMember,
  offsetPage,
  renderWithProviders,
  resetCaps,
  setCaps,
} from "../feed/social-test-doubles";
import { groupCapabilities } from "./lib/group-capabilities";
import { GroupMembersTab } from "./components/GroupMembersTab";
import { GroupRequestsTab } from "./components/GroupRequestsTab";
import { GroupSettingsTab, changedGroupFields } from "./components/GroupSettingsTab";

const listMembers = vi.fn();
const decideMember = vi.fn();
const removeMember = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const navigateSpy = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialGroupsApi: {
      ...actual.socialGroupsApi,
      listMembers: (...a: unknown[]) => listMembers(...a),
      decideMember: (...a: unknown[]) => decideMember(...a),
      removeMember: (...a: unknown[]) => removeMember(...a),
      update: (...a: unknown[]) => update(...a),
      remove: (...a: unknown[]) => remove(...a),
    },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
    useNavigate: () => navigateSpy,
  };
});

const t = i18n.getFixedT("vi", "social");
const ME = "u1"; // setCaps đặt user.id = "u1"
const OWNER = makeMember({
  userId: "11111111-0000-4000-8000-000000000001",
  fullName: "Chủ Nhóm",
  role: "owner",
});
const ADMIN = makeMember({
  userId: "11111111-0000-4000-8000-000000000002",
  fullName: "Quản Trị",
  role: "admin",
});
const MEMBER = makeMember({
  userId: "11111111-0000-4000-8000-000000000003",
  fullName: "Thành Viên",
});
const SELF = makeMember({ userId: ME, fullName: "Tôi", role: "admin" });
const PENDING = makeMember({
  userId: "11111111-0000-4000-8000-000000000009",
  fullName: "Người Xin",
  status: "pending",
  joinedAt: null,
});

const capsFor = (myRole: "owner" | "admin" | "member", manage = false) =>
  groupCapabilities({ visibility: "public", myRole, myStatus: "active" }, manage);

const confirmInDialog = (name: string): void => {
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name }));
};

beforeEach(() => {
  setCaps({ "view:feed": true });
  listMembers.mockImplementation((_g: string, q: { status?: string }) =>
    Promise.resolve(
      offsetPage(
        q.status === "pending"
          ? [PENDING]
          : q.status === "active"
            ? [OWNER, ADMIN, MEMBER, SELF]
            : [OWNER, ADMIN, MEMBER, SELF, PENDING],
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("M1 — tab Thành viên", () => {
  it("gửi `status:'active'` ⇒ không lẫn người đang chờ", async () => {
    renderWithProviders(<GroupMembersTab groupId={GROUP_ID} caps={capsFor("member")} />);
    await screen.findByText("Chủ Nhóm");
    expect(listMembers.mock.calls[0]?.[1]).toMatchObject({ status: "active", page: 1 });
    expect(screen.queryByText("Người Xin")).toBeNull();
  });

  it("DENY: member thường ⇒ KHÔNG ô chọn vai, KHÔNG «Mời ra» (chỉ nhãn vai)", async () => {
    renderWithProviders(<GroupMembersTab groupId={GROUP_ID} caps={capsFor("member")} />);
    await screen.findByText("Chủ Nhóm");
    expect(screen.queryByTestId(`group-member-role-${MEMBER.userId}`)).toBeNull();
    expect(screen.queryByTestId(`group-member-remove-${MEMBER.userId}`)).toBeNull();
    expect(screen.getByTestId(`group-member-${OWNER.userId}`)).toHaveTextContent(
      t("groups.role.owner"),
    );
  });

  it("ALLOW admin: ô chọn vai + «Mời ra» người khác; hàng CỦA TÔI không «Mời ra» nhưng vẫn đổi vai", async () => {
    renderWithProviders(<GroupMembersTab groupId={GROUP_ID} caps={capsFor("admin")} />);
    await screen.findByText("Chủ Nhóm");
    expect(screen.getByTestId(`group-member-remove-${MEMBER.userId}`)).toBeTruthy();
    expect(screen.queryByTestId(`group-member-remove-${ME}`)).toBeNull();
    expect(screen.getByTestId(`group-member-role-${ME}`)).toBeTruthy();
  });

  it("🔴 M2: admin xem hàng CHỦ NHÓM ⇒ select hiện «Chủ nhóm» (option disabled vẫn là giá trị hiện tại); hạ xuống admin gửi {role:'admin'}", async () => {
    decideMember.mockResolvedValue({ userId: OWNER.userId, role: "admin", status: "active" });
    renderWithProviders(<GroupMembersTab groupId={GROUP_ID} caps={capsFor("admin")} />);
    const select = (await screen.findByTestId(
      `group-member-role-${OWNER.userId}`,
    )) as HTMLSelectElement;
    expect(select.value).toBe("owner");
    const ownerOpt = within(select).getByRole("option", {
      name: t("groups.role.owner"),
    }) as HTMLOptionElement;
    expect(ownerOpt.disabled).toBe(true);
    fireEvent.change(select, { target: { value: "admin" } });
    await waitFor(() =>
      expect(decideMember).toHaveBeenCalledWith(GROUP_ID, OWNER.userId, { role: "admin" }),
    );
  });

  it("ALLOW owner: option «Chủ nhóm» BẬT ⇒ phong owner gửi {role:'owner'}", async () => {
    decideMember.mockResolvedValue({ userId: MEMBER.userId, role: "owner", status: "active" });
    renderWithProviders(<GroupMembersTab groupId={GROUP_ID} caps={capsFor("owner")} />);
    const select = (await screen.findByTestId(
      `group-member-role-${MEMBER.userId}`,
    )) as HTMLSelectElement;
    const ownerOpt = within(select).getByRole("option", {
      name: t("groups.role.owner"),
    }) as HTMLOptionElement;
    expect(ownerOpt.disabled).toBe(false);
    fireEvent.change(select, { target: { value: "owner" } });
    await waitFor(() =>
      expect(decideMember).toHaveBeenCalledWith(GROUP_ID, MEMBER.userId, { role: "owner" }),
    );
  });

  it("ALLOW admin KIÊM manage (S16-SOCIAL-GROUPERR-1): option «Chủ nhóm» BẬT ⇒ gửi {role:'owner'}", async () => {
    decideMember.mockResolvedValue({ userId: MEMBER.userId, role: "owner", status: "active" });
    renderWithProviders(<GroupMembersTab groupId={GROUP_ID} caps={capsFor("admin", true)} />);
    const select = (await screen.findByTestId(
      `group-member-role-${MEMBER.userId}`,
    )) as HTMLSelectElement;
    const ownerOpt = within(select).getByRole("option", {
      name: t("groups.role.owner"),
    }) as HTMLOptionElement;
    expect(ownerOpt.disabled, "BE đã cấp được — option tắt là chặn oan").toBe(false);
    fireEvent.change(select, { target: { value: "owner" } });
    await waitFor(() =>
      expect(decideMember).toHaveBeenCalledWith(GROUP_ID, MEMBER.userId, { role: "owner" }),
    );
  });

  it("tự hạ vai khi là chủ cuối ⇒ 409 ERR-015 ⇒ câu lý do + kéo lại nhóm", async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    decideMember.mockRejectedValue(GROUP_ERR.lastOwner());
    renderWithProviders(<GroupMembersTab groupId={GROUP_ID} caps={capsFor("owner")} />);
    fireEvent.change(await screen.findByTestId(`group-member-role-${ME}`), {
      target: { value: "member" },
    });
    const banner = await screen.findByTestId("feed-action-error");
    expect(banner).toHaveAttribute("data-reason", "lastOwner");
    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(
      JSON.stringify(socialKeys.groups.allOf()),
    );
  });

  it("mời ra ⇒ xác nhận ⇒ 039; 409 ERR-015 (mời chủ cuối) ⇒ lý do; 500 ⇒ banner chung", async () => {
    removeMember
      .mockRejectedValueOnce(GROUP_ERR.lastOwner())
      .mockRejectedValueOnce(GROUP_ERR.server());
    renderWithProviders(<GroupMembersTab groupId={GROUP_ID} caps={capsFor("admin")} />);
    fireEvent.click(await screen.findByTestId(`group-member-remove-${OWNER.userId}`));
    confirmInDialog(t("groups.members.remove"));
    await waitFor(() => expect(removeMember).toHaveBeenCalledWith(GROUP_ID, OWNER.userId));
    expect(await screen.findByTestId("feed-action-error")).toHaveAttribute(
      "data-reason",
      "lastOwner",
    );

    fireEvent.click(screen.getByTestId(`group-member-remove-${MEMBER.userId}`));
    confirmInDialog(t("groups.members.remove"));
    await waitFor(() =>
      expect(screen.getByTestId("feed-action-error")).toHaveTextContent(
        t("actionError.generic.memberRemove"),
      ),
    );
  });
});

describe("R1 — tab Yêu cầu", () => {
  it("gửi `status:'pending'`; duyệt ⇒ {decision:'approve'}; từ chối qua xác nhận ⇒ {decision:'reject'}", async () => {
    decideMember.mockResolvedValue({ userId: PENDING.userId, role: "member", status: "active" });
    renderWithProviders(<GroupRequestsTab groupId={GROUP_ID} />);
    await screen.findByText("Người Xin");
    expect(listMembers.mock.calls[0]?.[1]).toMatchObject({ status: "pending" });
    fireEvent.click(screen.getByTestId(`group-request-approve-${PENDING.userId}`));
    await waitFor(() =>
      expect(decideMember).toHaveBeenCalledWith(GROUP_ID, PENDING.userId, { decision: "approve" }),
    );
    fireEvent.click(screen.getByTestId(`group-request-reject-${PENDING.userId}`));
    confirmInDialog(t("groups.requests.reject"));
    await waitFor(() =>
      expect(decideMember).toHaveBeenLastCalledWith(GROUP_ID, PENDING.userId, {
        decision: "reject",
      }),
    );
  });

  it("người khác xử lý trước: 409 (lệch trạng thái) và 404 KHÔNG số ⇒ đều «trạng thái vừa đổi»", async () => {
    decideMember
      .mockRejectedValueOnce(GROUP_ERR.stateMismatch())
      .mockRejectedValueOnce(GROUP_ERR.memberGone());
    renderWithProviders(<GroupRequestsTab groupId={GROUP_ID} />);
    fireEvent.click(await screen.findByTestId(`group-request-approve-${PENDING.userId}`));
    expect(await screen.findByTestId("feed-action-error")).toHaveAttribute(
      "data-reason",
      "stateChanged",
    );
    fireEvent.click(screen.getByTestId(`group-request-approve-${PENDING.userId}`));
    await waitFor(() => expect(decideMember).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("feed-action-error")).toHaveAttribute("data-reason", "stateChanged");
  });

  it("không yêu cầu nào ⇒ câu rỗng riêng", async () => {
    listMembers.mockResolvedValue(offsetPage([]));
    renderWithProviders(<GroupRequestsTab groupId={GROUP_ID} />);
    expect(await screen.findByTestId("group-requests-empty")).toHaveTextContent(
      t("groups.requests.empty"),
    );
  });
});

describe("S1 — tab Cài đặt", () => {
  const GROUP = makeGroup({ myRole: "owner", myStatus: "active", description: null });

  it("changedGroupFields: chỉ trường đổi; mô tả rỗng ⇒ null; không đổi ⇒ {}", () => {
    expect(
      changedGroupFields(GROUP, {
        name: " Bóng đá công ty ",
        description: "",
        visibility: "public",
      }),
    ).toEqual({});
    expect(
      changedGroupFields(GROUP, { name: "Mới", description: "  ", visibility: "private" }),
    ).toEqual({
      name: "Mới",
      visibility: "private",
    });
    expect(
      changedGroupFields(
        { ...GROUP, description: "cũ" },
        { name: GROUP.name, description: "", visibility: "public" },
      ),
    ).toEqual({ description: null });
  });

  it("không đổi ⇒ Lưu KHOÁ; tên chỉ khoảng trắng ⇒ Lưu KHOÁ + lý do; đổi tên ⇒ PATCH đúng một trường", async () => {
    update.mockResolvedValue({ ...GROUP, name: "Tên mới" });
    renderWithProviders(<GroupSettingsTab group={GROUP} caps={capsFor("owner")} />);
    expect(screen.getByTestId("group-settings-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("group-settings-name"), { target: { value: "   " } });
    expect(screen.getByTestId("group-settings-save")).toBeDisabled();
    expect(screen.getByText(t("groups.create.nameRequired"))).toBeTruthy();
    fireEvent.change(screen.getByTestId("group-settings-name"), { target: { value: "Tên mới" } });
    fireEvent.click(screen.getByTestId("group-settings-save"));
    await waitFor(() => expect(update).toHaveBeenCalledWith(GROUP_ID, { name: "Tên mới" }));
  });

  it("đổi chế độ ⇒ ghi chú hệ quả; 409 ⇒ lỗi dưới ô tên", async () => {
    update.mockRejectedValue(GROUP_ERR.nameTaken());
    renderWithProviders(<GroupSettingsTab group={GROUP} caps={capsFor("owner")} />);
    fireEvent.click(screen.getByTestId("group-settings-visibility-private"));
    expect(screen.getByTestId("group-settings-visibility-note")).toHaveTextContent(
      t("groups.settings.toPrivateNote"),
    );
    fireEvent.change(screen.getByTestId("group-settings-name"), { target: { value: "Trùng" } });
    fireEvent.click(screen.getByTestId("group-settings-save"));
    expect(await screen.findByTestId("group-settings-name-taken")).toHaveTextContent(
      t("actionError.reason.nameTaken"),
    );
  });

  it("DENY: admin ⇒ KHÔNG vùng xoá; ALLOW: owner/manage ⇒ có", () => {
    const { unmount } = renderWithProviders(
      <GroupSettingsTab group={GROUP} caps={capsFor("admin")} />,
    );
    expect(screen.queryByTestId("group-settings-delete")).toBeNull();
    unmount();
    const { unmount: u2 } = renderWithProviders(
      <GroupSettingsTab group={GROUP} caps={capsFor("owner")} />,
    );
    expect(screen.getByTestId("group-settings-delete")).toBeTruthy();
    u2();
    renderWithProviders(
      <GroupSettingsTab
        group={GROUP}
        caps={groupCapabilities({ visibility: "public", myRole: null, myStatus: null }, true)}
      />,
    );
    expect(screen.getByTestId("group-settings-delete")).toBeTruthy();
  });

  it("xoá ⇒ xác nhận ⇒ 034 ⇒ điều hướng về danh sách TRƯỚC, rồi invalidate cả module", async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    remove.mockResolvedValue({ deleted: true });
    renderWithProviders(<GroupSettingsTab group={GROUP} caps={capsFor("owner")} />);
    fireEvent.click(screen.getByTestId("group-settings-delete"));
    confirmInDialog(t("groups.settings.delete"));
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/feed/groups", replace: true }),
    );
    await waitFor(() =>
      expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(
        JSON.stringify(socialKeys.all),
      ),
    );
    const navOrder = navigateSpy.mock.invocationCallOrder[0]!;
    const allIdx = invalidate.mock.calls.findIndex(
      (c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(socialKeys.all),
    );
    expect(navOrder).toBeLessThan(invalidate.mock.invocationCallOrder[allIdx]!);
  });

  it("xoá lỗi 403 (admin) ⇒ banner forbidden, không điều hướng", async () => {
    remove.mockRejectedValue(GROUP_ERR.forbidden());
    renderWithProviders(<GroupSettingsTab group={GROUP} caps={capsFor("owner")} />);
    fireEvent.click(screen.getByTestId("group-settings-delete"));
    confirmInDialog(t("groups.settings.delete"));
    expect(await screen.findByTestId("feed-action-error")).toHaveTextContent(
      t("actionError.forbidden.groupDelete"),
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
