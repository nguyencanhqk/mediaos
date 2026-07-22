import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CompanySettingsDto } from "@mediaos/contracts";
import { CompanySettingsForm } from "./company";

function makeSettings(overrides: Partial<CompanySettingsDto> = {}): CompanySettingsDto {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "MediaOS Co.",
    slug: "mediaos",
    status: "active",
    logoUrl: "https://cdn.example.com/logo.png",
    timezone: "Asia/Ho_Chi_Minh",
    currency: "VND",
    language: "vi",
    workingDaysJson: { days: [1, 2, 3, 4, 5] },
    payrollConfigJson: { cutoffDay: 25, payDay: 5 },
    schemaVersion: 1,
    // CS-5 profile fields
    shortName: null,
    taxCode: null,
    businessType: null,
    companyCode: null,
    regNumber: null,
    regDate: null,
    regPlace: null,
    legalRepName: null,
    legalRepTitle: null,
    establishedDate: null,
    address: null,
    phone: null,
    fax: null,
    email: null,
    website: null,
    ...overrides,
  };
}

describe("CompanySettingsForm — Thiết lập chung tab: submit", () => {
  it("submits the full payload (timezone, currency, language, working days, payroll)", () => {
    const onSubmit = vi.fn();
    render(
      <CompanySettingsForm
        initial={makeSettings()}
        activeTab="general"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({
      timezone: "Asia/Ho_Chi_Minh",
      currency: "VND",
      language: "vi",
      workingDaysJson: { days: [1, 2, 3, 4, 5] },
      payrollConfigJson: { cutoffDay: 25, payDay: 5 },
    });
    // S5-BRAND-FE-1: logo KHÔNG còn thuộc màn này (đường ghi riêng qua /system/company → branding).
    // Gửi lại giá trị cũ trong state sẽ GHI ĐÈ fileId vừa đặt ở tab kia (lost-update).
    expect(payload).not.toHaveProperty("logoUrl");
  });

  it("includes a newly toggled working day in the payload", () => {
    const onSubmit = vi.fn();
    render(
      <CompanySettingsForm initial={makeSettings()} activeTab="general" onSubmit={onSubmit} />,
    );

    // Add Saturday (day 6).
    fireEvent.click(screen.getByRole("checkbox", { name: "T7" }));
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].workingDaysJson.days).toContain(6);
  });

  it("reflects edited payroll config in the payload", () => {
    const onSubmit = vi.fn();
    render(
      <CompanySettingsForm initial={makeSettings()} activeTab="general" onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByLabelText(/Ngày chốt công/), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText(/Ngày trả lương/), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].payrollConfigJson).toEqual({ cutoffDay: 20, payDay: 10 });
  });
});

describe("CompanySettingsForm — reflects fresh server data on remount", () => {
  it("seeds from the new `initial` when remounted with a different key", () => {
    const { rerender } = render(
      <CompanySettingsForm key="a" initial={makeSettings()} activeTab="general" onSubmit={vi.fn()} />,
    );
    expect((screen.getByLabelText(/Múi giờ/) as HTMLInputElement).value).toBe("Asia/Ho_Chi_Minh");

    // Parent supplies a new key when server data changes (post-save refetch) → remount.
    rerender(
      <CompanySettingsForm
        key="b"
        initial={makeSettings({ timezone: "America/New_York" })}
        activeTab="general"
        onSubmit={vi.fn()}
      />,
    );
    expect((screen.getByLabelText(/Múi giờ/) as HTMLInputElement).value).toBe("America/New_York");
  });
});

describe("CompanySettingsForm — Zod validation blocks bad input (Thiết lập chung)", () => {
  it("KHÔNG còn ô nhập logo URL thô — chỉ hiện hướng dẫn (S5-BRAND-FE-1)", () => {
    const onSubmit = vi.fn();
    render(
      <CompanySettingsForm initial={makeSettings()} activeTab="general" onSubmit={onSubmit} />,
    );

    // Ô nhập cũ (TODO G5-FIX) đã gỡ: không còn input nào nhãn "Logo" để gõ URL tuỳ ý.
    expect(screen.queryByLabelText(/Logo/)).not.toBeInTheDocument();
    expect(screen.getByText(/Thương hiệu/)).toBeInTheDocument();
  });

  it("does NOT submit when the payroll cutoff day is out of range", () => {
    const onSubmit = vi.fn();
    render(
      <CompanySettingsForm initial={makeSettings()} activeTab="general" onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByLabelText(/Ngày chốt công/), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("CompanySettingsForm — CS-5 profile tab", () => {
  it("submits CS-5 profile fields when filled in", () => {
    const onSubmit = vi.fn();
    render(
      <CompanySettingsForm initial={makeSettings()} activeTab="profile" onSubmit={onSubmit} />,
    );

    // Find inputs by placeholder since i18n keys may not resolve in test env
    fireEvent.change(screen.getByPlaceholderText(/VD: MediaOS/i), {
      target: { value: "MOS" },
    });
    fireEvent.change(screen.getByPlaceholderText(/0123456789/i), { target: { value: "0123456789" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.shortName).toBe("MOS");
    expect(payload.taxCode).toBe("0123456789");
  });

  it("does NOT submit and shows error when taxCode format is invalid", () => {
    const onSubmit = vi.fn();
    render(
      <CompanySettingsForm initial={makeSettings()} activeTab="profile" onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByPlaceholderText(/0123456789/i), { target: { value: "BAD-CODE" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does NOT submit and shows error when email is invalid", () => {
    const onSubmit = vi.fn();
    render(
      <CompanySettingsForm initial={makeSettings()} activeTab="profile" onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByPlaceholderText(/contact@company.com/i), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does NOT submit and shows error when website URL is invalid", () => {
    const onSubmit = vi.fn();
    render(
      <CompanySettingsForm initial={makeSettings()} activeTab="profile" onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByPlaceholderText(/https:\/\/company\.com/i), {
      target: { value: "not-a-url" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows the companyCode as read-only when provided", () => {
    render(
      <CompanySettingsForm
        initial={makeSettings({ companyCode: "MOS-001" })}
        activeTab="profile"
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("MOS-001")).toBeInTheDocument();
  });
});
