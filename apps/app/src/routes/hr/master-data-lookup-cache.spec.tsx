// @vitest-environment jsdom
/**
 * S18-FE-DEPTQUERYKEY-1 — HAI nguồn dữ liệu khác endpoint/khác cổng quyền KHÔNG được dùng chung
 * một `queryKey`.
 *
 * Mỗi họ danh mục HR có ĐÚNG HAI đường đọc:
 *
 * | họ           | màn master-data (`hrMasterDataApi`) | cổng                | picker (`hrApi`)              | cổng |
 * | ------------ | ----------------------------------- | ------------------- | ----------------------------- | ---- |
 * | department   | GET /hr/departments                 | read:department     | GET /hr/lookups/departments   | mở   |
 * | position     | GET /org/positions                  | read:position       | GET /hr/lookups/positions     | mở   |
 * | job-level    | GET /hr/master-data/job-levels      | manage:master-data  | GET /hr/lookups/job-levels    | mở   |
 * | contract-type| GET /hr/master-data/contract-types  | manage:master-data  | GET /hr/lookups/contract-types| mở   |
 *
 * DTO master-data là SUPERSET (companyId · status · createdAt · updatedAt…); DTO lookup HẸP hơn.
 * Trước WO này cả hai phía dùng `hrKeys.<họ>.list()` ⇒ màn nào mount TRƯỚC đầu độc cache của màn kia:
 *
 * - master-data trước ⇒ picker ăn hàng rộng: hiển thị cả bản ghi `inactive` mà endpoint lookup lọc bỏ.
 * - picker trước ⇒ màn quản trị đọc `.status`/`.createdAt` = `undefined` — IM LẶNG, không Zod-đỏ
 *   (memory `server-masking-needs-optional-fe-schema`).
 *
 * `staleTime` của picker là 5 phút ⇒ cache bẩn được coi là TƯƠI, KHÔNG refetch. Đó là lý do ca này đo
 * bằng "hàm lookup CÓ được gọi không", không phải bằng "cuối cùng dữ liệu có đúng không sau khi chờ".
 *
 * KHÔNG được "vá" bằng cách đổi một bên sang gọi API bên kia: hai endpoint có hai cổng khác nhau, đổi
 * là ẩn picker với actor hợp lệ (memory `capability-allowlist-hides-admin-screens`).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, waitFor, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, type HrDepartment } from "@mediaos/web-core";
import type { PositionDto, JobLevelDto, ContractTypeDto } from "@mediaos/contracts";
import { hrApi, hrMasterDataApi, hrMasterDataInvalidation, hrKeys } from "@mediaos/web-core";
import { DepartmentsPage } from "./departments/DepartmentsPage";
import { PositionsPage } from "./positions/PositionsPage";
import { JobLevelsPage } from "./job-levels/JobLevelsPage";
import { ContractTypesPage } from "./contract-types/ContractTypesPage";
import { useEmployeeLookups } from "./employees/use-employee-lookups";

// Giữ web-core THẬT (useCan/store/PermissionGate/i18n/query-keys) — chỉ stub hai bề mặt API.
// Spread `actual.*` để mọi hàm KHÔNG liên quan giữ nguyên bản thật (đụng phải sẽ nổ rõ, không im lặng).
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrMasterDataApi: {
      ...actual.hrMasterDataApi,
      listDepartments: vi.fn(),
      listPositions: vi.fn(),
      listJobLevels: vi.fn(),
      listContractTypes: vi.fn(),
    },
    hrApi: {
      ...actual.hrApi,
      listDepartments: vi.fn(),
      listPositions: vi.fn(),
      listJobLevels: vi.fn(),
      listContractTypes: vi.fn(),
    },
  };
});

// Dirty-form guard kéo router state (không có RouterProvider trong unit test) → no-op.
vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => {} }));

const CO = "00000000-0000-4000-8000-000000000001";
const ISO = "2026-01-01T00:00:00.000Z";
const AT = new Date(ISO);

// ── Fixture: tên mang NHÃN NGUỒN để assert đọc được nguồn nào, không phải đọc được gì ──────────
const MD_DEPT: HrDepartment = {
  id: "10000000-0000-4000-8000-000000000001",
  companyId: CO,
  parentId: null,
  name: "MD-DEPT",
  code: "MD",
  description: null,
  headUserId: null,
  status: "active",
  createdAt: AT,
  updatedAt: AT,
};
const MD_POSITION: PositionDto = {
  id: "20000000-0000-4000-8000-000000000001",
  companyId: CO,
  name: "MD-POSITION",
  code: "MDP",
  status: "active",
  createdAt: ISO,
  updatedAt: ISO,
};
const MD_JOB_LEVEL: JobLevelDto = {
  id: "30000000-0000-4000-8000-000000000001",
  companyId: CO,
  code: "MDJ",
  name: "MD-JOB-LEVEL",
  rankOrder: 1,
  status: "active",
  createdAt: AT,
  updatedAt: AT,
};
const MD_CONTRACT_TYPE: ContractTypeDto = {
  id: "40000000-0000-4000-8000-000000000001",
  companyId: CO,
  code: "MDC",
  name: "MD-CONTRACT-TYPE",
  requiresEndDate: false,
  status: "active",
  createdAt: AT,
  updatedAt: AT,
};

const LK_DEPT = { id: MD_DEPT.id, name: "LK-DEPT", code: "LK", parentId: null };
const LK_POSITION = { id: MD_POSITION.id, name: "LK-POSITION", code: "LKP" };
const LK_JOB_LEVEL = { id: MD_JOB_LEVEL.id, name: "LK-JOB-LEVEL", code: "LKJ", rankOrder: 1 };
const LK_CONTRACT_TYPE = {
  id: MD_CONTRACT_TYPE.id,
  name: "LK-CONTRACT-TYPE",
  code: "LKC",
  requiresEndDate: false,
};

/** Mọi cặp cần cho 4 màn master-data. `view:goal` CỐ Ý vắng → DepartmentGoalCell không fetch. */
function setCaps() {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: {
      "read:department": true,
      "read:position": true,
      "manage:master-data": true,
    },
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: CO },
  });
}

describe("HR master-data ↔ lookup — cache không được dùng chung queryKey", () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    setCaps();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    vi.mocked(hrMasterDataApi.listDepartments).mockResolvedValue([MD_DEPT]);
    vi.mocked(hrMasterDataApi.listPositions).mockResolvedValue([MD_POSITION]);
    vi.mocked(hrMasterDataApi.listJobLevels).mockResolvedValue([MD_JOB_LEVEL]);
    vi.mocked(hrMasterDataApi.listContractTypes).mockResolvedValue([MD_CONTRACT_TYPE]);

    vi.mocked(hrApi.listDepartments).mockResolvedValue([LK_DEPT]);
    vi.mocked(hrApi.listPositions).mockResolvedValue([LK_POSITION]);
    vi.mocked(hrApi.listJobLevels).mockResolvedValue([LK_JOB_LEVEL]);
    vi.mocked(hrApi.listContractTypes).mockResolvedValue([LK_CONTRACT_TYPE]);
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  /** Mount màn master-data TRƯỚC và chờ hàng của nó nằm trong cache CHUNG. */
  async function mountMasterDataScreen(ui: React.ReactElement, expectedLabel: string) {
    render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
    await waitFor(() => expect(screen.getByText(expectedLabel)).toBeInTheDocument());
  }

  /** Mount picker SAU, trong CÙNG QueryClient. */
  async function mountLookupConsumer() {
    const hook = renderHook(() => useEmployeeLookups(), { wrapper });
    await waitFor(() => expect(hook.result.current.departments.length).toBeGreaterThan(0));
    return hook;
  }

  it("department: màn Phòng ban mount trước KHÔNG đầu độc picker", async () => {
    await mountMasterDataScreen(<DepartmentsPage />, "MD-DEPT");
    const { result } = await mountLookupConsumer();

    expect(hrApi.listDepartments).toHaveBeenCalled();
    expect(result.current.departments.map((d) => d.name)).toEqual(["LK-DEPT"]);
  });

  it("position: màn Chức vụ mount trước KHÔNG đầu độc picker", async () => {
    await mountMasterDataScreen(<PositionsPage />, "MD-POSITION");
    const { result } = await mountLookupConsumer();

    expect(hrApi.listPositions).toHaveBeenCalled();
    expect(result.current.positions.map((p) => p.name)).toEqual(["LK-POSITION"]);
  });

  it("job-level: màn Cấp bậc mount trước KHÔNG đầu độc picker", async () => {
    await mountMasterDataScreen(<JobLevelsPage />, "MD-JOB-LEVEL");
    const { result } = await mountLookupConsumer();

    expect(hrApi.listJobLevels).toHaveBeenCalled();
    expect(result.current.jobLevels.map((j) => j.name)).toEqual(["LK-JOB-LEVEL"]);
  });

  it("contract-type: màn Loại hợp đồng mount trước KHÔNG đầu độc picker", async () => {
    await mountMasterDataScreen(<ContractTypesPage />, "MD-CONTRACT-TYPE");
    const { result } = await mountLookupConsumer();

    expect(hrApi.listContractTypes).toHaveBeenCalled();
    expect(result.current.contractTypes.map((c) => c.name)).toEqual(["LK-CONTRACT-TYPE"]);
  });

  // ── Chiều NGƯỢC LẠI: picker mount trước không được làm màn quản trị đọc `undefined` ──────────
  it("picker mount TRƯỚC ⇒ màn Phòng ban vẫn đọc hàng master-data (không mất cột Trạng thái)", async () => {
    await mountLookupConsumer();
    await mountMasterDataScreen(<DepartmentsPage />, "MD-DEPT");

    expect(hrMasterDataApi.listDepartments).toHaveBeenCalled();
    // `LK-DEPT` không có `status`/`createdAt` ⇒ nếu màn ăn cache picker, hàng này không render nổi.
    expect(screen.queryByText("LK-DEPT")).not.toBeInTheDocument();
  });

  // ── done_when #2: CRUD phòng ban phải làm tươi CẢ HAI khoá ───────────────────────────────────
  it("invalidation của màn Phòng ban vô hiệu CẢ khoá master-data LẪN khoá lookup", async () => {
    await mountMasterDataScreen(<DepartmentsPage />, "MD-DEPT");
    const hook = await mountLookupConsumer();

    const mdCallsBefore = vi.mocked(hrMasterDataApi.listDepartments).mock.calls.length;
    const lkCallsBefore = vi.mocked(hrApi.listDepartments).mock.calls.length;
    expect(mdCallsBefore).toBeGreaterThan(0);
    expect(lkCallsBefore).toBeGreaterThan(0);

    // Đúng cách MasterDataCrudScreen làm sau mutation (MasterDataCrudScreen.tsx:150, :230).
    await Promise.all(
      hrMasterDataInvalidation
        .departments()
        .map((queryKey) => client.invalidateQueries({ queryKey })),
    );

    await waitFor(() => {
      expect(vi.mocked(hrMasterDataApi.listDepartments).mock.calls.length).toBeGreaterThan(
        mdCallsBefore,
      );
      expect(vi.mocked(hrApi.listDepartments).mock.calls.length).toBeGreaterThan(lkCallsBefore);
    });
    hook.unmount();
  });

  // ── Neo cấu trúc: hai khoá phải KHÁC NHAU, và `all` vẫn phủ cả hai ───────────────────────────
  it("hrKeys: mỗi họ có khoá lookup riêng, `all` vẫn là tiền tố chung của cả hai", () => {
    const families = [
      hrKeys.departments,
      hrKeys.positions,
      hrKeys.jobLevels,
      hrKeys.contractTypes,
    ] as const;

    for (const family of families) {
      const list = family.list();
      const lookup = family.lookup();
      expect(lookup).not.toEqual(list);
      // `all` là tiền tố ⇒ một lệnh invalidate ở cấp họ vẫn quét được cả hai đường đọc.
      expect(list.slice(0, family.all.length)).toEqual([...family.all]);
      expect(lookup.slice(0, family.all.length)).toEqual([...family.all]);
    }
  });
});
