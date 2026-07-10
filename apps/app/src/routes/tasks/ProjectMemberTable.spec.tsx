import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { useAuthStore, taskProjectApi } from "@mediaos/web-core";
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
});
