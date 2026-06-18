import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SecurityPolicyDto } from "@mediaos/contracts";
import { SecurityPolicyForm } from "./security-policy";

function makePolicy(overrides: Partial<SecurityPolicyDto> = {}): SecurityPolicyDto {
  return {
    autoLogoutMinutes: null,
    ipRestrictionEnabled: false,
    allowlistCidrs: [],
    timeRestrictionEnabled: false,
    timeWindows: [],
    applyScope: "all",
    applyAppKeys: [],
    exemptUserIds: [],
    emailDomainRestrictionEnabled: false,
    allowedEmailDomains: [],
    twoFactorEnforced: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("SecurityPolicyForm — submit", () => {
  it("submits cleaned payload from initial config (no-op edit)", () => {
    const onSubmit = vi.fn();
    render(
      <SecurityPolicyForm
        initial={makePolicy({
          ipRestrictionEnabled: true,
          allowlistCidrs: ["203.0.113.0/24"],
          twoFactorEnforced: true,
        })}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({
      ipRestrictionEnabled: true,
      allowlistCidrs: ["203.0.113.0/24"],
      twoFactorEnforced: true,
    });
  });

  it("CHẶN submit khi CIDR rác (Zod client validate) → hiển thị lỗi, KHÔNG onSubmit", () => {
    const onSubmit = vi.fn();
    render(
      <SecurityPolicyForm
        initial={makePolicy({ ipRestrictionEnabled: true, allowlistCidrs: ["not-a-cidr"] })}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("twoFactorEnforced=false (chưa tick) gửi null (theo global, không ép riêng)", () => {
    const onSubmit = vi.fn();
    render(<SecurityPolicyForm initial={makePolicy()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));
    expect(onSubmit.mock.calls[0][0].twoFactorEnforced).toBeNull();
  });

  it("autoLogout tắt → gửi null", () => {
    const onSubmit = vi.fn();
    render(<SecurityPolicyForm initial={makePolicy()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));
    expect(onSubmit.mock.calls[0][0].autoLogoutMinutes).toBeNull();
  });

  it("render tiêu đề trang section (toggles hiển thị)", () => {
    render(<SecurityPolicyForm initial={makePolicy()} onSubmit={vi.fn()} />);
    expect(screen.getByText(/Giới hạn truy cập theo địa chỉ IP/)).toBeInTheDocument();
    expect(screen.getByText(/Tự động đăng xuất/)).toBeInTheDocument();
  });
});
