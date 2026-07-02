/**
 * hr-master-data-api — boundary tests (S2-FE-HR-5, lane HR5-WC).
 *
 * Mock apiFetch tại ranh giới `./api-client` → mỗi method gọi ĐÚNG path controller
 * (/hr/departments · /org/positions · /hr/master-data/{job-levels,contract-types}), đúng HTTP method,
 * truyền schema Zod làm validator (arg 2) và KHÔNG tự forward company_id trong body.
 * (Contract/Zod validation + 422 mapping → hr-master-data-contract.spec.ts, dùng real apiFetch.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hrMasterDataApi } from "./hr-master-data-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

function lastCall(): [string, { parse?: unknown }, { method?: string; body?: string } | undefined] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

describe("hrMasterDataApi — boundary URL/method/validator", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
  });

  // Departments → /hr/departments (read/create/update/delete:department)
  it("listDepartments → GET /hr/departments + Zod validator", async () => {
    await hrMasterDataApi.listDepartments();
    const [url, schema] = lastCall();
    expect(url).toBe("/hr/departments");
    expect(typeof schema.parse).toBe("function");
  });

  it("listDepartments(status) → query string status", async () => {
    await hrMasterDataApi.listDepartments("active");
    const [url] = lastCall();
    expect(url.startsWith("/hr/departments")).toBe(true);
    expect(new URLSearchParams(url.split("?")[1]).get("status")).toBe("active");
  });

  it("getDepartment(id) → GET /hr/departments/:id", async () => {
    await hrMasterDataApi.getDepartment("d1");
    const [url] = lastCall();
    expect(url).toBe("/hr/departments/d1");
  });

  it("createDepartment → POST /hr/departments, body KHÔNG có company_id", async () => {
    await hrMasterDataApi.createDepartment({ name: "Kỹ thuật" });
    const [url, , opts] = lastCall();
    expect(url).toBe("/hr/departments");
    expect(opts?.method).toBe("POST");
    expect(opts?.body ?? "").not.toContain("company");
  });

  it("updateDepartment → PATCH /hr/departments/:id", async () => {
    await hrMasterDataApi.updateDepartment("d1", { name: "Kỹ thuật 2" });
    const [url, , opts] = lastCall();
    expect(url).toBe("/hr/departments/d1");
    expect(opts?.method).toBe("PATCH");
  });

  it("deleteDepartment → DELETE /hr/departments/:id (soft-delete server-side)", async () => {
    await hrMasterDataApi.deleteDepartment("d1");
    const [url, , opts] = lastCall();
    expect(url).toBe("/hr/departments/d1");
    expect(opts?.method).toBe("DELETE");
  });

  // Positions → /org/positions (read/create/update/delete:position)
  it("listPositions → GET /org/positions", async () => {
    await hrMasterDataApi.listPositions();
    const [url] = lastCall();
    expect(url.startsWith("/org/positions")).toBe(true);
  });

  it("createPosition → POST /org/positions", async () => {
    await hrMasterDataApi.createPosition({ name: "Trưởng phòng" });
    const [url, , opts] = lastCall();
    expect(url).toBe("/org/positions");
    expect(opts?.method).toBe("POST");
  });

  it("updatePosition → PATCH /org/positions/:id", async () => {
    await hrMasterDataApi.updatePosition("p1", { name: "Phó phòng" });
    const [url, , opts] = lastCall();
    expect(url).toBe("/org/positions/p1");
    expect(opts?.method).toBe("PATCH");
  });

  it("deletePosition → DELETE /org/positions/:id", async () => {
    await hrMasterDataApi.deletePosition("p1");
    const [url, , opts] = lastCall();
    expect(url).toBe("/org/positions/p1");
    expect(opts?.method).toBe("DELETE");
  });

  // Job levels → /hr/master-data/job-levels (manage:master-data)
  it("listJobLevels → GET /hr/master-data/job-levels", async () => {
    await hrMasterDataApi.listJobLevels();
    const [url] = lastCall();
    expect(url.startsWith("/hr/master-data/job-levels")).toBe(true);
  });

  it("createJobLevel → POST /hr/master-data/job-levels", async () => {
    await hrMasterDataApi.createJobLevel({ code: "L1", name: "Junior" });
    const [url, , opts] = lastCall();
    expect(url).toBe("/hr/master-data/job-levels");
    expect(opts?.method).toBe("POST");
  });

  it("updateJobLevel → PATCH /hr/master-data/job-levels/:id", async () => {
    await hrMasterDataApi.updateJobLevel("j1", { name: "Senior" });
    const [url, , opts] = lastCall();
    expect(url).toBe("/hr/master-data/job-levels/j1");
    expect(opts?.method).toBe("PATCH");
  });

  it("deleteJobLevel → DELETE /hr/master-data/job-levels/:id", async () => {
    await hrMasterDataApi.deleteJobLevel("j1");
    const [url, , opts] = lastCall();
    expect(url).toBe("/hr/master-data/job-levels/j1");
    expect(opts?.method).toBe("DELETE");
  });

  // Contract types → /hr/master-data/contract-types (manage:master-data)
  it("listContractTypes → GET /hr/master-data/contract-types", async () => {
    await hrMasterDataApi.listContractTypes();
    const [url] = lastCall();
    expect(url.startsWith("/hr/master-data/contract-types")).toBe(true);
  });

  it("createContractType → POST /hr/master-data/contract-types", async () => {
    await hrMasterDataApi.createContractType({
      code: "FT",
      name: "Toàn thời gian",
      requiresEndDate: false,
    });
    const [url, , opts] = lastCall();
    expect(url).toBe("/hr/master-data/contract-types");
    expect(opts?.method).toBe("POST");
  });

  it("updateContractType → PATCH /hr/master-data/contract-types/:id", async () => {
    await hrMasterDataApi.updateContractType("c1", { name: "Bán thời gian" });
    const [url, , opts] = lastCall();
    expect(url).toBe("/hr/master-data/contract-types/c1");
    expect(opts?.method).toBe("PATCH");
  });

  it("deleteContractType → DELETE /hr/master-data/contract-types/:id", async () => {
    await hrMasterDataApi.deleteContractType("c1");
    const [url, , opts] = lastCall();
    expect(url).toBe("/hr/master-data/contract-types/c1");
    expect(opts?.method).toBe("DELETE");
  });
});
