import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EmployeeProfileDto } from "@mediaos/contracts";
import { EmployeeDetailView } from "./employees-detail";

/** Base fixture — salary visible (HR view). Override per-test. */
function makeEmployee(overrides: Partial<EmployeeProfileDto> = {}): EmployeeProfileDto {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    companyId: "22222222-2222-2222-2222-222222222222",
    userId: "33333333-3333-3333-3333-333333333333",
    employeeCode: "NV-001",
    orgUnitId: null,
    orgUnitName: "Phòng Sản xuất",
    positionId: null,
    positionName: "Editor",
    directManagerId: null,
    directManagerName: "Trần Quản Lý",
    workType: "offline",
    employmentType: "full_time",
    startDate: "2024-01-15",
    endDate: null,
    contractType: "official",
    baseSalary: 25_000_000,
    salaryType: "monthly",
    phone: "0900000000",
    avatarUrl: null,
    notes: null,
    status: "active",
    userFullName: "Nguyễn Văn A",
    userEmail: "a@example.com",
    createdAt: "2024-01-15T00:00:00.000Z",
    updatedAt: "2024-01-15T00:00:00.000Z",
    ...overrides,
  };
}

const TAB_NAMES = ["Tổng quan", "Công việc", "Team/Project", "Task", "KPI", "Lương"];

describe("EmployeeDetailView — tabs", () => {
  it("renders all 6 tabs", () => {
    render(<EmployeeDetailView employee={makeEmployee()} />);
    for (const name of TAB_NAMES) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("shows the employee name and defaults to the overview tab", () => {
    render(<EmployeeDetailView employee={makeEmployee()} />);
    expect(screen.getByRole("heading", { name: /Nguyễn Văn A/ })).toBeInTheDocument();
    // Overview is the active tab by default.
    expect(screen.getByRole("tab", { name: "Tổng quan" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("a@example.com")).toBeInTheDocument();
  });

  it("shows work info on the Công việc tab", () => {
    render(<EmployeeDetailView employee={makeEmployee()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Công việc" }));
    expect(screen.getByText("Phòng Sản xuất")).toBeInTheDocument();
    expect(screen.getByText("Editor")).toBeInTheDocument();
    expect(screen.getByText("Trần Quản Lý")).toBeInTheDocument();
  });

  it("renders the KPI tab as a G8 placeholder", () => {
    render(<EmployeeDetailView employee={makeEmployee()} />);
    fireEvent.click(screen.getByRole("tab", { name: "KPI" }));
    expect(screen.getByText(/Sẽ có ở G8/)).toBeInTheDocument();
  });

  it("renders the Lương tab as a G12 placeholder", () => {
    render(<EmployeeDetailView employee={makeEmployee()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Lương" }));
    expect(screen.getByText(/Sẽ có ở G12/)).toBeInTheDocument();
  });
});

describe("EmployeeDetailView — salary mask (server-driven)", () => {
  it("shows the formatted base salary on the Lương tab when allowed (number)", () => {
    render(<EmployeeDetailView employee={makeEmployee({ baseSalary: 25_000_000 })} />);
    fireEvent.click(screen.getByRole("tab", { name: "Lương" }));
    // Same formatting the component uses — locale-stable assertion.
    const expected = (25_000_000).toLocaleString("vi-VN");
    expect(screen.getByText(new RegExp(expected.replace(/[.]/g, "\\.")))).toBeInTheDocument();
    expect(screen.queryByText(/Không có quyền xem/)).not.toBeInTheDocument();
  });

  it("shows '— (Không có quyền xem)' on the Lương tab when masked (null)", () => {
    render(<EmployeeDetailView employee={makeEmployee({ baseSalary: null })} />);
    fireEvent.click(screen.getByRole("tab", { name: "Lương" }));
    expect(screen.getByText(/— \(Không có quyền xem\)/)).toBeInTheDocument();
  });
});
