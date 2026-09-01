// @vitest-environment jsdom
/**
 * S13-PAYROLL-FE-1 — **thanh hành động kỳ lương ở tầng DOM**: nút không khả dụng thì KHÔNG RENDER
 * (SPEC-11 §14 — «nút không hiện thay vì hiện rồi 409»).
 *
 * `payroll-actions.spec.ts` đã neo ma trận ở tầng hàm thuần. Spec này neo thứ hàm thuần KHÔNG chứng
 * minh được: component gọi ĐÚNG hook cho đúng loại cặp.
 *
 * ⚠️ `useCan` và `useCanExact` được mock RIÊNG và trả GIÁ TRỊ NGƯỢC NHAU trong nhóm ca cuối. Đó là
 * điểm của spec: 7/9 hành động gác bằng cặp SENSITIVE (wildcard `*:*` KHÔNG kế thừa ⇒ phải
 * `useCanExact`), riêng `lock` là cặp thường (`manage:payroll-period`, `useCan`). Mock cả hai cùng
 * `true` thì đảo nhầm hook vẫn xanh — đúng lớp lỗi `same-builder-twice-makes-unit-spec-vacuous`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => false),
  useCanExact: vi.fn(() => false),
}));

import { useCan, useCanExact } from "@mediaos/web-core";
import { PeriodActionBar } from "./PeriodActionBar";
import type { PeriodActionSubject } from "../payroll-actions";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;

const subject = (over: Partial<PeriodActionSubject> = {}): PeriodActionSubject => ({
  status: "Reviewing",
  payslipsGeneratedAt: null,
  submittedBy: null,
  ...over,
});

function renderBar(period: PeriodActionSubject, currentUserId: string | null) {
  return render(
    <I18nextProvider i18n={i18n}>
      <PeriodActionBar
        period={period}
        currentUserId={currentUserId}
        pendingAction={null}
        onAction={() => {}}
      />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(false);
  mockUseCanExact.mockReturnValue(false);
});

describe("PeriodActionBar — four-eyes ẩn nút Duyệt", () => {
  it("[allow đối chứng] người KHÁC người gửi duyệt THẤY nút «Duyệt»", () => {
    mockUseCanExact.mockReturnValue(true);
    renderBar(subject({ submittedBy: "u-submitter" }), "u-approver");
    expect(screen.getByText("Duyệt")).toBeTruthy();
  });

  it("[deny] chính người gửi duyệt KHÔNG thấy nút «Duyệt»…", () => {
    mockUseCanExact.mockReturnValue(true);
    renderBar(subject({ submittedBy: "u-submitter" }), "u-submitter");
    expect(screen.queryByText("Duyệt")).toBeNull();
  });

  it("…nhưng thanh hành động KHÔNG rỗng — «Từ chối» vẫn còn", () => {
    mockUseCanExact.mockReturnValue(true);
    renderBar(subject({ submittedBy: "u-submitter" }), "u-submitter");
    expect(screen.getByText("Từ chối")).toBeTruthy();
  });

  it("nút bị chặn KHÔNG render dạng disabled — nó VẮNG khỏi DOM", () => {
    mockUseCanExact.mockReturnValue(true);
    const { container } = renderBar(subject({ submittedBy: "u-me" }), "u-me");
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).not.toContain("Duyệt");
  });
});

describe("PeriodActionBar — chọn ĐÚNG hook theo loại cặp", () => {
  it("cặp SENSITIVE đi useCanExact: exact=true / can=false ⇒ CÓ «Duyệt», KHÔNG «Khoá kỳ»", () => {
    mockUseCanExact.mockReturnValue(true);
    mockUseCan.mockReturnValue(false);
    renderBar(subject({ status: "Reviewing" }), "u1");
    expect(screen.getByText("Duyệt")).toBeTruthy();
    // `lock` (cặp thường) không hợp lệ ở Reviewing nữa — dùng kỳ Paid ở ca dưới để tách bạch.
  });

  it("cặp THƯỜNG `lock` đi useCan: can=true / exact=false ⇒ CÓ «Khoá kỳ»", () => {
    mockUseCan.mockReturnValue(true);
    mockUseCanExact.mockReturnValue(false);
    renderBar(subject({ status: "Paid" }), "u1");
    expect(screen.getByText("Khoá kỳ")).toBeTruthy();
  });

  it("[deny đối chứng] `lock` biến mất khi useCan=false dù useCanExact=true", () => {
    mockUseCan.mockReturnValue(false);
    mockUseCanExact.mockReturnValue(true);
    renderBar(subject({ status: "Paid" }), "u1");
    expect(screen.queryByText("Khoá kỳ")).toBeNull();
  });
});

describe("PeriodActionBar — reopen bị chặn khi đã sinh phiếu", () => {
  it("[allow đối chứng] Approved + chưa sinh phiếu ⇒ CÓ «Mở lại»", () => {
    mockUseCanExact.mockReturnValue(true);
    renderBar(subject({ status: "Approved" }), "u1");
    expect(screen.getByText("Mở lại")).toBeTruthy();
  });

  it("[deny] đã sinh phiếu ⇒ KHÔNG «Mở lại», nhưng VẪN «Phát hành»", () => {
    mockUseCanExact.mockReturnValue(true);
    renderBar(
      subject({ status: "Approved", payslipsGeneratedAt: "2026-09-01T00:00:00.000Z" }),
      "u1",
    );
    expect(screen.queryByText("Mở lại")).toBeNull();
    expect(screen.getByText("Phát hành")).toBeTruthy();
  });
});

describe("PeriodActionBar — không quyền / terminal", () => {
  it("không quyền nào ⇒ component trả null (không render khung rỗng)", () => {
    const { container } = renderBar(subject({ status: "Reviewing" }), "u1");
    expect(container.querySelector('[data-testid="payroll-period-actions"]')).toBeNull();
  });

  it("kỳ Locked ⇒ không hành động nào, kể cả khi có đủ mọi quyền", () => {
    mockUseCan.mockReturnValue(true);
    mockUseCanExact.mockReturnValue(true);
    const { container } = renderBar(subject({ status: "Locked" }), "u1");
    expect(container.querySelector('[data-testid="payroll-period-actions"]')).toBeNull();
  });
});
