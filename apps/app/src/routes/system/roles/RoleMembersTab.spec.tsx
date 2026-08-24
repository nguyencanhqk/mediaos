/**
 * RoleMembersTab — S2-AUTH-ROLEMEM-1.
 * Gate đọc: view:user (thiếu → forbidden, KHÔNG gọi API). Nút mutation (Thêm người / Thêm theo
 * phòng ban / Gỡ) bọc PermissionGate assign-role:user (sensitive — cờ từ /auth/me allowlist,
 * KHÔNG kế thừa wildcard qua PermissionGate exact-pair? — PermissionGate dùng useCan; cờ sensitive
 * chỉ xuất hiện khi allowlist phơi đúng grant thật nên wildcard '*:*' KHÔNG tự mở nút).
 * States: forbidden · members list · empty · remove flow gọi đúng revokeRole(userId, roleId).
 * "Thêm người" = EmployeeMultiPickerDialog (GET /hr/employees): hàng đã giữ vai trò / chưa link
 * tài khoản bị khóa; chọn nhiều → assignRole(userId, {roleId}) TỪNG người.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, roleAdminApi, authUsersApi, hrApi, orgApi } from "@mediaos/web-core";
import { RoleMembersTab } from "./RoleMembersTab";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    roleAdminApi: {
      ...actual.roleAdminApi,
      getMembers: vi.fn(),
    },
    authUsersApi: {
      ...actual.authUsersApi,
      assignRole: vi.fn(),
      revokeRole: vi.fn(),
    },
    hrApi: {
      ...actual.hrApi,
      listEmployees: vi.fn().mockResolvedValue({ items: [], meta: {} }),
      listDepartments: vi.fn().mockResolvedValue([]),
    },
    // KI-073 (S10-SEC-ROLEMEMBERFE-1): ca F1/F2 đi qua AddOrgUnitDialog → cần org tree.
    orgApi: {
      ...actual.orgApi,
      getTree: vi.fn().mockResolvedValue([]),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const MEMBERS = {
  members: [
    {
      userId: "u-100",
      email: "linh.bui@demo.local",
      fullName: "Bùi Mỹ Linh",
      status: "active",
      expiresAt: null,
      grantedAt: new Date("2026-07-01T00:00:00Z"),
    },
  ],
  // KI-073 (D4): fixture mặc định giữ NGUYÊN ý nghĩa cũ — actor thấy đủ (complete=true).
  complete: true,
};

describe("RoleMembersTab", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(roleAdminApi.getMembers).mockResolvedValue(MEMBERS);
  });

  // ── DENY-PATH: thiếu view:user → forbidden, KHÔNG gọi API ──────────────────
  it("thiếu view:user → forbidden, KHÔNG fetch members", () => {
    setCaps({});
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    expect(screen.getByText("Không có quyền xem")).toBeInTheDocument();
    expect(roleAdminApi.getMembers).not.toHaveBeenCalled();
  });

  it("có view:user nhưng THIẾU assign-role:user → thấy danh sách, KHÔNG thấy nút mutation", async () => {
    setCaps({ "view:user": true });
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    expect(await screen.findByText("Bùi Mỹ Linh")).toBeInTheDocument();
    expect(screen.queryByText("Thêm người")).not.toBeInTheDocument();
    expect(screen.queryByText("Thêm theo phòng ban")).not.toBeInTheDocument();
    expect(screen.queryByText("Gỡ")).not.toBeInTheDocument();
  });

  it("đủ view:user + assign-role:user → thấy nút Thêm người/Thêm theo phòng ban/Gỡ", async () => {
    setCaps({ "view:user": true, "assign-role:user": true });
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    expect(await screen.findByText("Bùi Mỹ Linh")).toBeInTheDocument();
    expect(screen.getByText("Thêm người")).toBeInTheDocument();
    expect(screen.getByText("Thêm theo phòng ban")).toBeInTheDocument();
    expect(screen.getByText("Gỡ")).toBeInTheDocument();
  });

  it("members rỗng → empty state", async () => {
    // KI-073: complete:true để ca này GIỮ ý nghĩa cũ ("role thật sự chưa có ai") — nhánh
    // complete:false + 0 hàng có empty-state RIÊNG, ghim ở F3.
    vi.mocked(roleAdminApi.getMembers).mockResolvedValue({ members: [], complete: true });
    setCaps({ "view:user": true });
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    expect(await screen.findByText("Chưa có thành viên")).toBeInTheDocument();
  });

  // ── Picker "Thêm người" (EmployeeMultiPickerDialog) ────────────────────────
  const PICKER_EMPLOYEES = {
    items: [
      {
        id: "emp-1",
        userId: "u-100", // đã là member (MEMBERS) → khóa + badge "Đã giữ vai trò"
        fullName: "Bùi Mỹ Linh",
        email: "linh.bui@demo.local",
        positionName: "Nhân viên đăng tải",
        orgUnitName: "Nội dung",
        avatarUrl: null,
        employeeCode: "EMP0001",
      },
      {
        id: "emp-2",
        userId: "u-200", // chọn được
        fullName: "Trần Thị B",
        email: "b@demo.local",
        positionName: "Designer",
        orgUnitName: "Nội dung",
        avatarUrl: null,
        employeeCode: "EMP0002",
      },
      {
        id: "emp-3",
        userId: null, // chưa link tài khoản → khóa + badge "Chưa có tài khoản"
        fullName: "Lê Văn C",
        email: "c@demo.local",
        positionName: "QA",
        orgUnitName: "Kỹ thuật",
        avatarUrl: null,
        employeeCode: "EMP0003",
      },
    ],
    meta: { page: 1, pageSize: 10, total: 3, totalPages: 1, hasNext: false, hasPrev: false },
  };

  it("Thêm người → picker: hàng đã giữ vai trò / chưa có tài khoản bị khóa với badge riêng", async () => {
    setCaps({ "view:user": true, "assign-role:user": true });
    vi.mocked(hrApi.listEmployees).mockResolvedValue(PICKER_EMPLOYEES as never);
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    fireEvent.click(await screen.findByText("Thêm người"));
    await waitFor(() =>
      expect(screen.getByTestId("role-member-picker-row-emp-2")).toBeInTheDocument(),
    );

    expect(screen.getByLabelText("Bùi Mỹ Linh")).toBeDisabled();
    expect(screen.getByText("Đã giữ vai trò")).toBeInTheDocument();
    expect(screen.getByLabelText("Lê Văn C")).toBeDisabled();
    // Hàng chưa link tài khoản KHÔNG hiện dấu tích (khác hàng "đã ở trong").
    expect(screen.getByLabelText("Lê Văn C")).not.toBeChecked();
    expect(screen.getByText("Chưa có tài khoản")).toBeInTheDocument();
  });

  it("Thêm người → chọn nhân viên → assignRole gọi với userId (không phải employeeId)", async () => {
    setCaps({ "view:user": true, "assign-role:user": true });
    vi.mocked(hrApi.listEmployees).mockResolvedValue(PICKER_EMPLOYEES as never);
    vi.mocked(authUsersApi.assignRole).mockResolvedValue({} as never);
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    fireEvent.click(await screen.findByText("Thêm người"));
    await waitFor(() =>
      expect(screen.getByTestId("role-member-picker-row-emp-2")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("role-member-picker-row-emp-2"));
    fireEvent.click(screen.getByTestId("role-member-picker-confirm"));
    await waitFor(() => {
      expect(authUsersApi.assignRole).toHaveBeenCalledWith("u-200", { roleId: "role-1" });
    });
    // Thành công hết → dialog tự đóng.
    await waitFor(() =>
      expect(screen.queryByTestId("role-member-picker-confirm")).not.toBeInTheDocument(),
    );
  });

  it("Gỡ → confirm dialog → xác nhận gọi revokeRole(userId, roleId) + refetch", async () => {
    vi.mocked(authUsersApi.revokeRole).mockResolvedValue(undefined);
    setCaps({ "view:user": true, "assign-role:user": true });
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    fireEvent.click(await screen.findByText("Gỡ"));
    expect(screen.getByText("Gỡ thành viên khỏi vai trò?")).toBeInTheDocument();
    // Nút "Gỡ" trong footer dialog (nút thứ 2 cùng label).
    const buttons = screen.getAllByText("Gỡ");
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => {
      expect(authUsersApi.revokeRole).toHaveBeenCalledWith("u-100", "role-1");
    });
  });
  // ── S6-SEC-IDENTITY-PROJ-1 (KI-053): hàng NGOÀI scope danh bạ ────────────────
  //
  // Server BỎ HẲN KHOÁ `email`/`fullName` khi actor ngoài `data_scope` của `view:user` (contract nay
  // `.optional()`). Ca này khoá hai thứ mà bản vá BE một mình không khoá được:
  //   1. FE không vỡ TRẮNG — bẫy đã cắn thật ở KI-051, nơi schema console khai hai khoá BẮT BUỘC nên
  //      server bỏ khoá = ZodError runtime dù HTTP 200, vỡ trang cho ĐÚNG vai mà bản vá bảo vệ.
  //   2. Hàng ngoài scope vẫn NHẬN DIỆN được (rơi về `userId`), không render rỗng trông như hỏng dữ liệu.
  it("hàng ngoài scope danh bạ (thiếu khoá email/fullName) vẫn render, rơi về userId", async () => {
    vi.mocked(roleAdminApi.getMembers).mockResolvedValue({
      members: [
        {
          userId: "u-200",
          // KHÔNG có `email`, KHÔNG có `fullName` — đúng hình dạng server trả khi ngoài scope.
          status: "active",
          expiresAt: null,
          grantedAt: new Date("2026-07-01T00:00:00Z"),
        },
      ],
      complete: true,
    } as unknown as Awaited<ReturnType<typeof roleAdminApi.getMembers>>);
    setCaps({ "view:user": true });
    renderWithQuery(<RoleMembersTab roleId="role-1" />);
    // Nhãn phải NÓI RA LÝ DO. Rơi về UUID cũng "không vỡ trang" nhưng đọc thành lỗi join —
    // ca này khoá đúng vế đó: KHÔNG được hiển thị userId thô ở ô tên.
    expect(await screen.findByText("(không có quyền xem danh tính)")).toBeInTheDocument();
    expect(screen.queryByText("u-200")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // ── KI-073 (S10-SEC-ROLEMEMBERFE-1) · cờ `complete` — FE thôi khẳng định điều nó không biết ────
  //
  // Server phát `complete = scope ∈ {Company, System}` (D4). `complete === false` ⇒ `memberIds` là
  // TẬP CON không biết thiếu bao nhiêu ⇒ mọi lời khẳng định dựng trên nó (bộ đếm, badge "đã là thành
  // viên", preview dedup, empty-state) phải đổi sang câu KHÔNG nói dối (D5). Mock `getMembers` cast
  // qua `as unknown as` vì contract HIỆN TẠI chưa có khoá `complete` — đúng hình dạng RED-trước.
  describe("KI-073 — complete=false: FE thôi khẳng định điều nó không biết", () => {
    const membersWith = (complete: boolean) =>
      ({ ...MEMBERS, complete }) as unknown as Awaited<ReturnType<typeof roleAdminApi.getMembers>>;

    const ORG_TREE = [{ id: "org-1", name: "Nội dung", children: [] }];
    /**
     * u-100 ĐÃ là member (MEMBERS) · u-200 chưa · emp-self là CHÍNH ACTOR (me.userId = "u1",
     * setCaps) · emp-nolink chưa link tài khoản. Partial-mode: dedup theo memberIds TẮT nhưng
     * (1) vẫn TRỪ chính mình (SoD — self-assign nổ 403 từng dòng) và (2) vẫn loại người chưa link.
     */
    const KI073_EMPLOYEES = {
      items: [
        {
          id: "emp-a",
          userId: "u-100",
          fullName: "Bùi Mỹ Linh",
          email: "linh.bui@demo.local",
          positionName: "Nhân viên đăng tải",
          orgUnitName: "Nội dung",
          avatarUrl: null,
          employeeCode: "EMP0001",
        },
        {
          id: "emp-b",
          userId: "u-200",
          fullName: "Trần Thị B",
          email: "b@demo.local",
          positionName: "Designer",
          orgUnitName: "Nội dung",
          avatarUrl: null,
          employeeCode: "EMP0002",
        },
        {
          id: "emp-self",
          userId: "u1",
          fullName: "T (chính mình)",
          email: "t@demo.local",
          positionName: "Admin",
          orgUnitName: "Nội dung",
          avatarUrl: null,
          employeeCode: "EMP0009",
        },
        {
          id: "emp-nolink",
          userId: null,
          fullName: "Lê Văn C",
          email: "c@demo.local",
          positionName: "QA",
          orgUnitName: "Kỹ thuật",
          avatarUrl: null,
          employeeCode: "EMP0003",
        },
      ],
      meta: { page: 1, pageSize: 10, total: 4, totalPages: 1, hasNext: false, hasPrev: false },
    };

    async function openOrgDialogAndPick() {
      fireEvent.click(await screen.findByText("Thêm theo phòng ban"));
      fireEvent.change(await screen.findByLabelText("Phòng ban"), {
        target: { value: "org-1" },
      });
    }

    it("F1 — complete:false ⇒ nhãn đếm partial, KHÔNG alreadyMembers, CÓ dòng 'phạm vi hạn chế', toAssign = linked trừ mình", async () => {
      vi.mocked(roleAdminApi.getMembers).mockResolvedValue(membersWith(false));
      vi.mocked(orgApi.getTree).mockResolvedValue(ORG_TREE as never);
      vi.mocked(hrApi.listEmployees).mockResolvedValue(KI073_EMPLOYEES as never);
      setCaps({ "view:user": true, "assign-role:user": true });
      renderWithQuery(<RoleMembersTab roleId="role-1" />);

      // Bộ đếm KHÔNG được nói "1 thành viên đang giữ vai trò này" — nó không biết điều đó.
      expect(await screen.findByText("1 thành viên bạn xem được")).toBeInTheDocument();

      await openOrgDialogAndPick();
      // toAssign = linked (u-100 + u-200 + self) TRỪ chính mình = 2 — dedup theo memberIds TẮT.
      await waitFor(() => expect(screen.getByText("Sẽ gán: 2 tài khoản")).toBeInTheDocument());
      // Dòng khẳng định sai bị ẨN, thay bằng dòng nói rõ giới hạn phạm vi.
      expect(screen.queryByText(/Bỏ qua \(đã là thành viên\)/)).not.toBeInTheDocument();
      expect(screen.getByText(/không xác định được ai đã là thành viên/i)).toBeInTheDocument();
    });

    it("F2 (neo ALLOW) — complete:true ⇒ hành vi cũ NGUYÊN VẸN: dedup đúng, alreadyMembers hiện", async () => {
      vi.mocked(roleAdminApi.getMembers).mockResolvedValue(membersWith(true));
      vi.mocked(orgApi.getTree).mockResolvedValue(ORG_TREE as never);
      // KHÔNG có hàng self trong fixture này — F2 ghim đường CŨ, không ghim luật trừ-mình mới.
      vi.mocked(hrApi.listEmployees).mockResolvedValue({
        ...KI073_EMPLOYEES,
        items: KI073_EMPLOYEES.items.filter((e) => e.id !== "emp-self"),
      } as never);
      setCaps({ "view:user": true, "assign-role:user": true });
      renderWithQuery(<RoleMembersTab roleId="role-1" />);

      expect(await screen.findByText("1 thành viên đang giữ vai trò này")).toBeInTheDocument();

      await openOrgDialogAndPick();
      // linked = u-100 + u-200; u-100 đã là member ⇒ toAssign = 1, alreadyMembers = 1.
      await waitFor(() => expect(screen.getByText("Sẽ gán: 1 tài khoản")).toBeInTheDocument());
      expect(screen.getByText("Bỏ qua (đã là thành viên): 1")).toBeInTheDocument();
      expect(
        screen.queryByText(/không xác định được ai đã là thành viên/i),
      ).not.toBeInTheDocument();
    });

    it("F3 — complete:false + 0 hàng ⇒ empty-state RIÊNG, không phải 'Chưa có thành viên'", async () => {
      // 0 hàng là trạng thái MẶC ĐỊNH của @Own không có chân trong role (ngữ nghĩa KI-071) —
      // "Chưa có thành viên" ở đó là lời khẳng định sai về CẢ role.
      vi.mocked(roleAdminApi.getMembers).mockResolvedValue({
        members: [],
        complete: false,
      } as unknown as Awaited<ReturnType<typeof roleAdminApi.getMembers>>);
      setCaps({ "view:user": true });
      renderWithQuery(<RoleMembersTab roleId="role-1" />);

      expect(await screen.findByText(/trong phạm vi bạn xem được/i)).toBeInTheDocument();
      expect(screen.queryByText("Chưa có thành viên")).not.toBeInTheDocument();
    });
  });
});
