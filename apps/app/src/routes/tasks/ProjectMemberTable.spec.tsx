import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { useAuthStore, taskProjectApi, hrApi } from "@mediaos/web-core";
import { ProjectMemberTable } from "./ProjectMemberTable";
import type { MemberResponseDto } from "@mediaos/contracts";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskProjectApi: {
      listMembers: vi.fn(),
      addMember: vi.fn(),
      updateMemberRole: vi.fn(),
      removeMember: vi.fn(),
    },
    hrApi: {
      listEmployees: vi.fn().mockResolvedValue({ items: [], meta: {} }),
      // Picker mới có filter phòng ban (GET /hr/lookups/departments).
      listDepartments: vi.fn().mockResolvedValue([]),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MOCK_MEMBERS: MemberResponseDto[] = [
  {
    id: "mem-001",
    projectId: "proj-001",
    employeeId: "emp-001",
    employeeName: "Nguyễn Văn A",
    employeeCode: "EMP0001",
    departmentName: "Phòng Kỹ thuật",
    projectRole: "Owner",
    status: "Active",
    joinedAt: "2026-01-01T00:00:00.000Z",
    removedAt: null,
  },
];

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      companyId: "co-001",
    },
  });
}

describe("ProjectMemberTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── ALLOW-PATH: renders member list ───────────────────────────────────────
  it("renders member list", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.listMembers).mockResolvedValue(MOCK_MEMBERS);
    renderWithQuery(<ProjectMemberTable projectId="proj-001" />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.getByText("EMP0001")).toBeInTheDocument();
  });

  // ── DENY-PATH: add-member button hidden without manage-member:project ────
  it("hides 'Thêm thành viên' button without manage-member:project", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.listMembers).mockResolvedValue(MOCK_MEMBERS);
    renderWithQuery(<ProjectMemberTable projectId="proj-001" />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.queryByText(/thêm thành viên/i)).not.toBeInTheDocument();
  });

  // ── ALLOW-PATH: add-member button + remove action visible ────────────────
  it("shows 'Thêm thành viên' button and remove action with manage-member:project", async () => {
    setCapabilities({ "read:project": true, "manage-member:project": true });
    vi.mocked(taskProjectApi.listMembers).mockResolvedValue(MOCK_MEMBERS);
    renderWithQuery(<ProjectMemberTable projectId="proj-001" />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.getByText(/thêm thành viên/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/xóa khỏi dự án/i)).toBeInTheDocument();
  });

  // ── EMPTY state ────────────────────────────────────────────────────────────
  it("shows empty state when no members", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.listMembers).mockResolvedValue([]);
    renderWithQuery(<ProjectMemberTable projectId="proj-001" />);
    await waitFor(() => expect(screen.getByText(/chưa có thành viên/i)).toBeInTheDocument());
  });

  // ── ERROR state ────────────────────────────────────────────────────────────
  it("shows error state when API call fails", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.listMembers).mockRejectedValue(new Error("Network error"));
    renderWithQuery(<ProjectMemberTable projectId="proj-001" />);
    await waitFor(() => expect(screen.getByText(/không thể tải thành viên/i)).toBeInTheDocument());
  });

  // ── S5-TASK-PROJROLE-1 (đợt C, D-24) — canManage = pair OR myProjectRole==='Owner' ───────────
  it("shows 'Thêm thành viên' + remove action when myProjectRole='Owner' dù thiếu manage-member:project", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.listMembers).mockResolvedValue(MOCK_MEMBERS);
    renderWithQuery(<ProjectMemberTable projectId="proj-001" myProjectRole="Owner" />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.getByText(/thêm thành viên/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/xóa khỏi dự án/i)).toBeInTheDocument();
  });

  it("hides 'Thêm thành viên' khi myProjectRole='Member' và thiếu manage-member:project", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.listMembers).mockResolvedValue(MOCK_MEMBERS);
    renderWithQuery(<ProjectMemberTable projectId="proj-001" myProjectRole="Member" />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.queryByText(/thêm thành viên/i)).not.toBeInTheDocument();
  });

  it("hides 'Thêm thành viên' khi myProjectRole='Viewer' và thiếu manage-member:project", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.listMembers).mockResolvedValue(MOCK_MEMBERS);
    renderWithQuery(<ProjectMemberTable projectId="proj-001" myProjectRole="Viewer" />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.queryByText(/thêm thành viên/i)).not.toBeInTheDocument();
  });

  // ── Picker chọn nhiều (nâng cấp theo benchmark Base/AMIS) ──────────────────
  const PICKER_EMPLOYEES = {
    items: [
      {
        id: "emp-001",
        fullName: "Nguyễn Văn A",
        email: "a@demo.local",
        positionName: "Dev",
        orgUnitName: "Kỹ thuật",
        avatarUrl: null,
        employeeCode: "EMP0001",
      },
      {
        id: "emp-002",
        fullName: "Trần Thị B",
        email: "b@demo.local",
        positionName: "Designer",
        orgUnitName: "Nội dung",
        avatarUrl: null,
        employeeCode: "EMP0002",
      },
      {
        id: "emp-003",
        fullName: "Lê Văn C",
        email: "c@demo.local",
        positionName: "QA",
        orgUnitName: "Kỹ thuật",
        avatarUrl: null,
        employeeCode: "EMP0003",
      },
    ],
    meta: { page: 1, pageSize: 10, total: 3, totalPages: 1, hasNext: false, hasPrev: false },
  } as never;

  async function openPicker() {
    renderWithQuery(<ProjectMemberTable projectId="proj-001" />);
    await waitFor(() => expect(screen.getByText(/thêm thành viên/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/thêm thành viên/i));
    await waitFor(() =>
      expect(screen.getByTestId("member-picker-row-emp-002")).toBeInTheDocument(),
    );
  }

  it("picker: chọn nhiều → addMember gọi TỪNG người với vai trò đã chọn; người đã tham gia bị khóa", async () => {
    setCapabilities({ "read:project": true, "manage-member:project": true });
    vi.mocked(taskProjectApi.listMembers).mockResolvedValue(MOCK_MEMBERS);
    vi.mocked(hrApi.listEmployees).mockResolvedValue(PICKER_EMPLOYEES);
    vi.mocked(taskProjectApi.addMember).mockResolvedValue({} as never);
    await openPicker();

    // emp-001 đã là thành viên (MOCK_MEMBERS) → checkbox khóa + badge, không chọn lại được.
    expect(screen.getByLabelText("Nguyễn Văn A")).toBeDisabled();
    expect(screen.getByText("Đã tham gia")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("member-picker-row-emp-002"));
    fireEvent.click(screen.getByTestId("member-picker-row-emp-003"));
    expect(screen.getByTestId("member-picker-confirm")).toHaveTextContent("Thêm (2)");

    fireEvent.click(screen.getByTestId("member-picker-confirm"));
    await waitFor(() => expect(taskProjectApi.addMember).toHaveBeenCalledTimes(2));
    expect(taskProjectApi.addMember).toHaveBeenCalledWith("proj-001", {
      employeeId: "emp-002",
      projectRole: "Member",
    });
    expect(taskProjectApi.addMember).toHaveBeenCalledWith("proj-001", {
      employeeId: "emp-003",
      projectRole: "Member",
    });
    // Thành công hết → dialog tự đóng.
    await waitFor(() =>
      expect(screen.queryByTestId("member-picker-confirm")).not.toBeInTheDocument(),
    );
  });

  it("picker: một người lỗi → GIỮ LẠI trong selection + báo lỗi, người thành công không chọn lại", async () => {
    setCapabilities({ "read:project": true, "manage-member:project": true });
    vi.mocked(taskProjectApi.listMembers).mockResolvedValue(MOCK_MEMBERS);
    vi.mocked(hrApi.listEmployees).mockResolvedValue(PICKER_EMPLOYEES);
    vi.mocked(taskProjectApi.addMember).mockImplementation((_projectId, body) =>
      body.employeeId === "emp-003"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({} as never),
    );
    await openPicker();

    fireEvent.click(screen.getByTestId("member-picker-row-emp-002"));
    fireEvent.click(screen.getByTestId("member-picker-row-emp-003"));
    fireEvent.click(screen.getByTestId("member-picker-confirm"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/1 nhân viên chưa thêm được/i),
    );
    // Chỉ người LỖI còn trong selection để thử lại.
    expect(screen.getByTestId("member-picker-confirm")).toHaveTextContent("Thêm (1)");
  });
});
