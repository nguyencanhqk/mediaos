import { describe, it, expect, vi, beforeEach } from "vitest";
import { MvDashboardService } from "./mv-dashboard.service";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockTx = { execute: mockExecute };
const mockWithTenant = vi.fn((companyId: string, fn: (tx: typeof mockTx) => Promise<unknown>) =>
  fn(mockTx),
);
const mockDb = { withTenant: mockWithTenant };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MvDashboardService", () => {
  let service: MvDashboardService;
  const COMPANY_ID = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MvDashboardService(mockDb as unknown as ConstructorParameters<typeof MvDashboardService>[0]);
  });

  // ─── (a) empty MV → returns [] ──────────────────────────────────────────────

  it("getTaskStatusStats returns [] when MV has no data (loading/empty state)", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const result = await service.getTaskStatusStats(COMPANY_ID);
    expect(result).toEqual([]);
  });

  it("getOutputStats returns [] when MV has no data (loading/empty state)", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const result = await service.getOutputStats(COMPANY_ID);
    expect(result).toEqual([]);
  });

  // ─── (b) company_id in every query ──────────────────────────────────────────

  it("getTaskStatusStats always passes companyId to withTenant", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    await service.getTaskStatusStats(COMPANY_ID);
    expect(mockWithTenant).toHaveBeenCalledWith(COMPANY_ID, expect.any(Function));
  });

  it("getOutputStats always passes companyId to withTenant", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    await service.getOutputStats(COMPANY_ID, {});
    expect(mockWithTenant).toHaveBeenCalledWith(COMPANY_ID, expect.any(Function));
  });

  it("getTaskStatusStats SQL contains company_id predicate", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    await service.getTaskStatusStats(COMPANY_ID);
    const sqlArg = mockExecute.mock.calls[0][0];
    const sqlStr = JSON.stringify(sqlArg);
    expect(sqlStr).toContain("company_id");
    expect(sqlStr).toContain(COMPANY_ID);
  });

  it("getOutputStats SQL contains company_id predicate", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    await service.getOutputStats(COMPANY_ID, {});
    const sqlArg = mockExecute.mock.calls[0][0];
    const sqlStr = JSON.stringify(sqlArg);
    expect(sqlStr).toContain("company_id");
    expect(sqlStr).toContain(COMPANY_ID);
  });

  // ─── (c) filter predicates passed correctly ──────────────────────────────────

  it("getOutputStats includes channelId filter when provided", async () => {
    const channelId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    mockExecute.mockResolvedValueOnce({ rows: [] });
    await service.getOutputStats(COMPANY_ID, { channelId });
    const sqlArg = mockExecute.mock.calls[0][0];
    const sqlStr = JSON.stringify(sqlArg);
    expect(sqlStr).toContain("channel_id");
    expect(sqlStr).toContain(channelId);
  });

  it("getOutputStats includes projectId filter when provided", async () => {
    const projectId = "pppppppp-pppp-pppp-pppp-pppppppppppp";
    mockExecute.mockResolvedValueOnce({ rows: [] });
    await service.getOutputStats(COMPANY_ID, { projectId });
    const sqlArg = mockExecute.mock.calls[0][0];
    const sqlStr = JSON.stringify(sqlArg);
    expect(sqlStr).toContain("project_id");
    expect(sqlStr).toContain(projectId);
  });

  it("getOutputStats includes departmentId filter when provided", async () => {
    const departmentId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    mockExecute.mockResolvedValueOnce({ rows: [] });
    await service.getOutputStats(COMPANY_ID, { departmentId });
    const sqlArg = mockExecute.mock.calls[0][0];
    const sqlStr = JSON.stringify(sqlArg);
    expect(sqlStr).toContain("department_id");
    expect(sqlStr).toContain(departmentId);
  });

  it("getOutputStats includes month filter when provided", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    await service.getOutputStats(COMPANY_ID, { month: "2024-06" });
    const sqlArg = mockExecute.mock.calls[0][0];
    const sqlStr = JSON.stringify(sqlArg);
    expect(sqlStr).toContain("month");
    expect(sqlStr).toContain("2024-06-01");
  });

  // ─── data mapping ────────────────────────────────────────────────────────────

  it("getTaskStatusStats maps rows correctly", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        { status: "not_started", task_count: "5" },
        { status: "completed", task_count: "10" },
      ],
    });
    const result = await service.getTaskStatusStats(COMPANY_ID);
    expect(result).toEqual([
      { status: "not_started", taskCount: 5 },
      { status: "completed", taskCount: 10 },
    ]);
  });

  it("getOutputStats maps rows correctly", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          status: "completed",
          project_id: "pppppppp-pppp-pppp-pppp-pppppppppppp",
          department_id: null,
          channel_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
          month: "2024-06-01",
          task_count: "3",
        },
      ],
    });
    const result = await service.getOutputStats(COMPANY_ID);
    expect(result).toHaveLength(1);
    expect(result[0].taskCount).toBe(3);
    expect(result[0].channelId).toBe("cccccccc-cccc-cccc-cccc-cccccccccccc");
    expect(result[0].departmentId).toBeNull();
  });
});
