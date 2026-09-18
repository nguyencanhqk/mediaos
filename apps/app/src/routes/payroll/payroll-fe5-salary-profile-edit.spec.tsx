// @vitest-environment jsdom
/**
 * S15-PAYROLL-FE-5 — sửa / xoá mềm phiên bản hồ sơ lương (PAYROLL-API-022) ở tab «Lịch sử lương» của
 * PAY-SCREEN-007. Đóng nợ G3 của `docs/plans/S15-PAYROLL-FE-1.md` §6.
 *
 * ── VÌ SAO CA DENY Ở ĐÂY PHẢI NEO NHIỀU HƠN «KHÔNG THẤY NÚT» ─────────────────────────────────────
 * 022 (sửa/xoá) và 020 (tạo) gác **CÙNG cặp** `manage:salary-profile` (đo ở
 * `apps/api/src/payroll/payroll-route-pairs.const.ts:86-88`). Bỏ cặp đi thì nút «+ Phiên bản lương»
 * cũng biến mất ⇒ ca «không thấy nút Sửa» xanh cả khi code hỏng hoàn toàn — đúng lớp bẫy đã ăn ở
 * S15-PAYROLL-FE-7 (memory `s15-payroll-fe7-wave-state`: «nút ⋯ vắng ≠ mục vắng»).
 *
 * Nên ca DENY dưới đây neo BA điều cùng lúc: cặp `view` vẫn còn ⇒ **thân thẻ vẫn mở được và có dữ
 * liệu** (ca không rỗng) · KHÔNG nút Sửa/Xoá · `updateSalaryProfile` KHÔNG được gọi.
 *
 * Ca ALLOW đặt cạnh để chứng minh cùng cây DOM đó có nút khi đủ cặp.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => true),
  useCanExact: vi.fn(() => true),
  payrollIdempotencyKey: vi.fn(() => "idem-key"),
  // Bản TRUNG THỰC với hợp đồng: `details` là MẢNG `ErrorDetail{field,message,rule}`, `kind` là phần
  // tử `field==="kind"` (memory `error-details-must-be-errordetail-array`). Mock trả hằng số sẽ làm
  // ca 409 xanh kể cả khi call-site đọc `details` như object.
  parseKindError: (e: {
    code?: string;
    status?: number;
    message?: string;
    details?: Array<{ field: string; message: string }>;
  }) => ({
    code: e?.code ?? null,
    status: e?.status ?? null,
    kind: (e?.details ?? []).find((d) => d.field === "kind")?.message ?? null,
    message: e?.message ?? "",
    fields: new Map((e?.details ?? []).map((d) => [d.field, d.message])),
  }),
  formatNumber: (v: number, o?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("vi-VN", o).format(v),
  formatCurrency: (v: number) => `${new Intl.NumberFormat("vi-VN").format(v)} ₫`,
  payrollApi: {
    listSalaryProfiles: vi.fn(),
    getSalaryProfile: vi.fn(),
    updateSalaryProfile: vi.fn(),
    createSalaryProfile: vi.fn(),
    listSalaryComponents: vi.fn(async () => ({ data: [], pagination: undefined })),
  },
  payrollKeys: {
    employees: { allOf: () => ["payroll", "employees"] },
    salaryProfiles: {
      allOf: () => ["payroll", "salary-profiles"],
      list: (p: unknown) => ["payroll", "salary-profiles", "list", p],
      detail: (id: string) => ["payroll", "salary-profiles", "detail", id],
    },
    catalog: { components: (p: unknown) => ["payroll", "catalog", "components", p] },
  },
}));

import { payrollApi, useCanExact } from "@mediaos/web-core";
import { EmployeeSalaryHistoryTab } from "./components/employee/EmployeeSalaryHistoryTab";

const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;
const mockList = payrollApi.listSalaryProfiles as ReturnType<typeof vi.fn>;
const mockDetail = payrollApi.getSalaryProfile as ReturnType<typeof vi.fn>;
const mockUpdate = payrollApi.updateSalaryProfile as ReturnType<typeof vi.fn>;

const USER = "1a1a1a1a-2b2b-3c3c-4d4d-5e5e5e5e5e5e";
const PROFILE_ID = "9f9f9f9f-8e8e-7d7d-6c6c-5b5b5b5b5b5b";

const LIST_ITEM = {
  id: PROFILE_ID,
  userId: USER,
  effectiveDate: "2026-01-01",
  baseSalary: 20_000_000,
  allowances: [],
  salaryType: "GROSS",
  pitPayer: "EMPLOYEE",
};

const DETAIL = (over: Record<string, unknown> = {}) => ({
  id: PROFILE_ID,
  companyId: "co-1",
  userId: USER,
  effectiveDate: "2026-01-01",
  baseSalary: 20_000_000,
  allowances: [],
  salaryType: "GROSS",
  pitPayer: "EMPLOYEE",
  payRatioPct: 100,
  note: null,
  items: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const PEOPLE = { byUserId: new Map([[USER, "Nguyễn Văn A"]]), isLoading: false, canResolve: true };

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <EmployeeSalaryHistoryTab userId={USER} people={PEOPLE} employeeLabel="Nguyễn Văn A" />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/** Mở thân thẻ phiên bản (chi tiết 021 chỉ tải khi bấm — không prefetch, xem docblock của card). */
async function expandVersion() {
  fireEvent.click(await screen.findByRole("button", { name: /Hiệu lực từ/ }));
  await screen.findByText("Phụ cấp / khấu trừ có định mức");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCanExact.mockReturnValue(true);
  mockList.mockResolvedValue({ data: [LIST_ITEM], pagination: { total: 1 } });
  mockDetail.mockResolvedValue(DETAIL());
  mockUpdate.mockResolvedValue(DETAIL());
});

describe("[allow] đủ cặp manage:salary-profile", () => {
  it("thân thẻ đã mở có Sửa + Xoá", async () => {
    renderTab();
    await expandVersion();
    expect(screen.getByRole("button", { name: "Sửa phiên bản" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Xoá phiên bản" })).toBeTruthy();
  });

  it("🔴 [tiền] chỉ đổi ghi chú ⇒ PATCH CHỈ mang note — không kèm baseSalary/items người dùng không đụng", async () => {
    renderTab();
    await expandVersion();
    fireEvent.click(screen.getByRole("button", { name: "Sửa phiên bản" }));

    const note = (await waitFor(() => {
      const el = document.querySelector("textarea");
      if (!el) throw new Error("chưa mở hộp sửa");
      return el;
    })) as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "điều chỉnh quý 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [id, body] = mockUpdate.mock.calls[0];
    expect(id).toBe(PROFILE_ID);
    expect(body).toEqual({ note: "điều chỉnh quý 1" });
    // Vắng `items` là hợp đồng: BE không chạm salary_profile_items VÀ không chạm cột allowances.
    expect("items" in body).toBe(false);
  });

  it("chưa đổi gì ⇒ bấm Lưu KHÔNG gọi API, hiện «chưa thay đổi gì»", async () => {
    renderTab();
    await expandVersion();
    fireEvent.click(screen.getByRole("button", { name: "Sửa phiên bản" }));
    fireEvent.click(await screen.findByRole("button", { name: "Lưu thay đổi" }));

    expect(await screen.findByText("Bạn chưa thay đổi gì.")).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("409 effective-date-exists ⇒ hiện chữ riêng, hộp KHÔNG đóng (không mất cái vừa gõ)", async () => {
    mockUpdate.mockRejectedValue({
      status: 409,
      code: "PAYROLL-ERR-014",
      message: "conflict",
      details: [{ field: "kind", message: "effective-date-exists", rule: "payroll" }],
    });
    renderTab();
    await expandVersion();
    fireEvent.click(screen.getByRole("button", { name: "Sửa phiên bản" }));

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-03-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lưu thay đổi" })).toBeTruthy();
  });

  it("xoá ⇒ hộp xác nhận rồi PATCH {delete:true} ĐƠN ĐỘC", async () => {
    renderTab();
    await expandVersion();
    fireEvent.click(screen.getByRole("button", { name: "Xoá phiên bản" }));

    // Hộp xác nhận nói ngày hiệu lực, KHÔNG in mức lương (BẤT BIẾN #3 — hộp xác nhận không chở tiền).
    await screen.findByRole("heading", { name: "Xoá phiên bản hồ sơ lương?" });
    const panel = screen.getByRole("dialog");
    // Hộp nói ĐÚNG phiên bản nào qua ngày hiệu lực…
    expect(panel.textContent).toContain("Phiên bản hiệu lực từ 2026-01-01");
    // …và KHÔNG mang mức lương (thẻ phía sau có 20.000.000 ₫, hộp thì không).
    expect(panel.textContent).not.toContain("20.000.000");

    const confirmButtons = screen.getAllByRole("button", { name: "Xoá phiên bản" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0]).toEqual([PROFILE_ID, { delete: true }]);
  });

  it("🔴 [mask] baseSalary VẮNG KHOÁ ⇒ KHÔNG mọc nút Sửa (Xoá vẫn có — payload không mang giá trị)", async () => {
    mockDetail.mockResolvedValue(DETAIL({ baseSalary: undefined }));
    renderTab();
    await expandVersion();
    expect(screen.queryByRole("button", { name: "Sửa phiên bản" })).toBeNull();
    expect(screen.getByRole("button", { name: "Xoá phiên bản" })).toBeTruthy();
  });
});

describe("[hồi quy] đường hỏng của hai lượt ghi", () => {
  it("🔴 xoá THẤT BẠI ⇒ hộp xác nhận KHÔNG đóng, hiện lỗi, bấm lại được (không giả vờ đã xoá)", async () => {
    mockUpdate.mockRejectedValue({
      status: 404,
      code: "PAYROLL-ERR-NOT-FOUND",
      message: "not found",
      details: [{ field: "kind", message: "not-found", rule: "payroll" }],
    });
    renderTab();
    await expandVersion();
    fireEvent.click(screen.getByRole("button", { name: "Xoá phiên bản" }));
    await screen.findByRole("heading", { name: "Xoá phiên bản hồ sơ lương?" });

    const confirm = () => {
      const bs = screen.getAllByRole("button", { name: "Xoá phiên bản" });
      fireEvent.click(bs[bs.length - 1]!);
    };
    confirm();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));

    // Hộp còn đó + nói ra lỗi: thất bại KHÔNG được trông giống thành công.
    const panel = await screen.findByRole("dialog");
    expect(panel.textContent).toContain("Xoá phiên bản hồ sơ lương?");
    expect(await screen.findByRole("alert")).toBeTruthy();
    // …và bấm lại được (nút không kẹt ở trạng thái «đang xoá»).
    confirm();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
  });

  it("🔴 [mất dữ liệu câm] đang gửi thì Esc / click ra ngoài KHÔNG đóng được hộp sửa", async () => {
    // Giữ PATCH treo: `isPending` đứng yên để đo đúng cửa sổ nguy hiểm.
    mockUpdate.mockReturnValue(new Promise(() => {}));
    renderTab();
    await expandVersion();
    fireEvent.click(screen.getByRole("button", { name: "Sửa phiên bản" }));

    const note = (await waitFor(() => {
      const el = document.querySelector("textarea");
      if (!el) throw new Error("chưa mở hộp sửa");
      return el;
    })) as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "đang gõ dở" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(document, { key: "Escape" });
    const overlay = document.querySelector('[role="dialog"]')?.parentElement;
    if (overlay) fireEvent.click(overlay);

    // Hộp vẫn mở với đúng nội dung đang gõ — không có cửa sổ để lượt sau bị `onSuccess` của lượt
    // trước đóng sập (xem docblock `onClose` của Dialog).
    expect(screen.getByRole("heading", { name: "Sửa phiên bản hồ sơ lương" })).toBeTruthy();
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("đang gõ dở");
  });
});

describe("[deny] thiếu cặp manage:salary-profile", () => {
  it("thân thẻ vẫn mở được (view còn) nhưng 0 nút Sửa/Xoá và 0 lượt gọi 022", async () => {
    mockUseCanExact.mockReturnValue(false);
    renderTab();
    await expandVersion();

    // Ca KHÔNG rỗng: thân thẻ có dữ liệu thật — cây DOM đã render tới chỗ đáng lẽ có nút.
    expect(screen.getByText("Phụ cấp / khấu trừ có định mức")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sửa phiên bản" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Xoá phiên bản" })).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 Hồ sơ DI SẢN (`allowances` có, `items` rỗng) — nhánh mà luật DIFF một mình KHÔNG cứu được.
 *
 * Bảng phụ cấp prefill từ `items` ⇒ hiện RỖNG, phụ cấp cũ không lộ ra để diff. Nếu vẫn cho sửa bảng,
 * người dùng thêm một dòng là BE dựng lại `allowances` CHỈ từ mảng vừa gửi ⇒ khoản cũ bốc hơi cùng mã
 * 200. Ca dưới đây neo phần WIRING (hộp thật sự khoá bảng + thật sự truyền cờ xuống payload) — ca
 * thuần ở `salary-profile-form.spec.ts` không bắt được lỗi quên nối dây.
 */
describe("[tiền] hồ sơ di sản ⇒ khoá bảng phụ cấp trong hộp sửa", () => {
  const LEGACY = () => DETAIL({ allowances: [{ name: "Ăn trưa", amount: 500_000 }], items: [] });

  it("mở hộp sửa ⇒ KHÔNG có bảng phụ cấp, có lời giải thích", async () => {
    mockDetail.mockResolvedValue(LEGACY());
    renderTab();
    await expandVersion();
    fireEvent.click(screen.getByRole("button", { name: "Sửa phiên bản" }));

    await screen.findByRole("heading", { name: "Sửa phiên bản hồ sơ lương" });
    expect(screen.queryByTestId("salary-profile-items-editor")).toBeNull();
    // Neo TRONG hộp: thẻ phía sau cũng có băng «di sản» của riêng nó, tìm toàn trang sẽ khớp cả hai.
    expect(within(screen.getByRole("dialog")).getByText(/phụ cấp di sản/)).toBeTruthy();
  });

  it("vẫn sửa được ghi chú, và PATCH KHÔNG mang items", async () => {
    mockDetail.mockResolvedValue(LEGACY());
    renderTab();
    await expandVersion();
    fireEvent.click(screen.getByRole("button", { name: "Sửa phiên bản" }));

    const note = (await waitFor(() => {
      const el = document.querySelector("textarea");
      if (!el) throw new Error("chưa mở hộp sửa");
      return el;
    })) as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "ghi chú mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdate.mock.calls[0];
    expect(body).toEqual({ note: "ghi chú mới" });
    expect("items" in body).toBe(false);
  });
});
