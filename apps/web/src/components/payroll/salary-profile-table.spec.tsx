import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SalaryProfileListItemDto } from "@mediaos/contracts";
import { SalaryProfileTable } from "./salary-profile-table";
import { MASKED_SALARY_HINT, MASKED_SALARY_PLACEHOLDER } from "./salary-constants";

const UUID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const MASKED_ROW: SalaryProfileListItemDto = {
  id: UUID,
  userId: UUID,
  salaryType: "monthly",
  payCycle: "monthly",
  effectiveDate: "2026-06-13",
  baseSalary: null,
  allowances: null,
  status: "active",
};

const REVEALED_ROW: SalaryProfileListItemDto = {
  ...MASKED_ROW,
  baseSalary: 25000000,
  allowances: [{ name: "Ăn trưa", amount: 1000000 }],
};

describe("SalaryProfileTable — mask-by-default", () => {
  it("renders the placeholder (no number) when the server masked salary", () => {
    render(<SalaryProfileTable rows={[MASKED_ROW]} />);
    // Server sent baseSalary=null → UI shows ••• + "Không có quyền", NEVER a number.
    expect(screen.getByText(MASKED_SALARY_PLACEHOLDER, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(MASKED_SALARY_HINT, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/25\.000\.000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/25000000/)).not.toBeInTheDocument();
  });

  it("renders the real number when the server revealed salary", () => {
    render(<SalaryProfileTable rows={[REVEALED_ROW]} />);
    expect(screen.getByText(/25\.000\.000/)).toBeInTheDocument();
    expect(screen.queryByText(MASKED_SALARY_HINT, { exact: false })).not.toBeInTheDocument();
  });

  it("renders an empty-state when there are no rows", () => {
    render(<SalaryProfileTable rows={[]} />);
    expect(screen.getByText(/Chưa có hồ sơ lương/)).toBeInTheDocument();
  });
});
