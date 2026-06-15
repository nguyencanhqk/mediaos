import { describe, it, expect, vi, beforeEach } from "vitest";
import { AlertsService, CHANNEL_RISK_OVERDUE_THRESHOLD, CHANNEL_RISK_MIN_TASKS, SEVERE_DEFECT_TYPES } from "./alerts.service";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockExecute = vi.fn();

// withTenant calls fn with a mock tx that supports both .select() chain and .execute()
function buildSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return { select: vi.fn().mockReturnValue(chain) };
}

const mockWithTenant = vi.fn();
const mockDb = { withTenant: mockWithTenant };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AlertsService", () => {
  let service: AlertsService;
  const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AlertsService(mockDb as unknown as ConstructorParameters<typeof AlertsService>[0]);
  });

  // ─── returns [] when empty ────────────────────────────────────────────────

  it("getOverdueTasks returns [] when no tasks exist", async () => {
    mockWithTenant.mockImplementation((_: string, fn: (tx: unknown) => Promise<unknown>) => {
      const chain = buildSelectChain([]);
      return fn({ ...chain, execute: mockExecute });
    });
    const result = await service.getOverdueTasks(COMPANY_A);
    expect(result).toEqual([]);
  });

  it("getChannelRiskAlerts returns [] when no channels have enough tasks", async () => {
    mockWithTenant.mockImplementation((_: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ execute: vi.fn().mockResolvedValue({ rows: [] }) }),
    );
    const result = await service.getChannelRiskAlerts(COMPANY_A);
    expect(result).toEqual([]);
  });

  // ─── overdue formula: dueDate < NOW AND status NOT IN (completed, approved) ─

  it("getOverdueTasks always calls withTenant with companyId", async () => {
    mockWithTenant.mockImplementation((_: string, fn: (tx: unknown) => Promise<unknown>) => {
      const chain = buildSelectChain([]);
      return fn({ ...chain, execute: mockExecute });
    });
    await service.getOverdueTasks(COMPANY_A);
    expect(mockWithTenant).toHaveBeenCalledWith(COMPANY_A, expect.any(Function));
  });

  it("getOverdueTasks maps alert type correctly", async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 86400000); // yesterday
    mockWithTenant.mockImplementation((_: string, fn: (tx: unknown) => Promise<unknown>) => {
      const chain = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: "t1",
                  title: "Late task",
                  dueDate: past,
                  status: "in_progress",
                  assigneeUserId: "u1",
                },
              ]),
            }),
          }),
        }),
      };
      return fn(chain);
    });
    const result = await service.getOverdueTasks(COMPANY_A);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("overdue_task");
    expect(result[0].taskId).toBe("t1");
  });

  // ─── channel risk threshold constant ────────────────────────────────────────

  it("CHANNEL_RISK_OVERDUE_THRESHOLD is a named constant > 0 and < 1", () => {
    expect(CHANNEL_RISK_OVERDUE_THRESHOLD).toBeGreaterThan(0);
    expect(CHANNEL_RISK_OVERDUE_THRESHOLD).toBeLessThan(1);
  });

  it("CHANNEL_RISK_MIN_TASKS is a named constant >= 1", () => {
    expect(CHANNEL_RISK_MIN_TASKS).toBeGreaterThanOrEqual(1);
  });

  it("getChannelRiskAlerts filters out channels below threshold", async () => {
    // overdueRate = 1/10 = 0.1 < 0.3 threshold → no alert
    mockWithTenant.mockImplementation((_: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: vi.fn().mockResolvedValue({
          rows: [{ channel_id: "ch1", total_count: 10, overdue_count: 1 }],
        }),
      }),
    );
    const result = await service.getChannelRiskAlerts(COMPANY_A);
    expect(result).toEqual([]);
  });

  it("getChannelRiskAlerts returns alert when overdue rate exceeds threshold", async () => {
    // overdueRate = 4/5 = 0.8 > 0.3 threshold → alert
    mockWithTenant.mockImplementation((_: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: vi.fn().mockResolvedValue({
          rows: [{ channel_id: "ch2", total_count: 5, overdue_count: 4 }],
        }),
      }),
    );
    const result = await service.getChannelRiskAlerts(COMPANY_A);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("channel_risk");
    expect((result[0] as { overdueRate: number }).overdueRate).toBeCloseTo(0.8);
  });

  // ─── defect severity alerts ──────────────────────────────────────────────

  it("SEVERE_DEFECT_TYPES is a non-empty array of strings", () => {
    expect(Array.isArray(SEVERE_DEFECT_TYPES)).toBe(true);
    expect(SEVERE_DEFECT_TYPES.length).toBeGreaterThan(0);
  });

  it("getDefectSeverityAlerts returns [] when no defects exist", async () => {
    mockWithTenant.mockImplementation((_: string, fn: (tx: unknown) => Promise<unknown>) => {
      const chain = buildSelectChain([]);
      return fn(chain);
    });
    const result = await service.getDefectSeverityAlerts(COMPANY_A);
    expect(result).toEqual([]);
  });

  it("getDefectSeverityAlerts always calls withTenant with companyId", async () => {
    mockWithTenant.mockImplementation((_: string, fn: (tx: unknown) => Promise<unknown>) => {
      const chain = buildSelectChain([]);
      return fn(chain);
    });
    await service.getDefectSeverityAlerts(COMPANY_A);
    expect(mockWithTenant).toHaveBeenCalledWith(COMPANY_A, expect.any(Function));
  });

  it("getDefectSeverityAlerts maps rows to defect_severity alert type", async () => {
    const createdAt = new Date("2026-06-01T10:00:00Z");
    mockWithTenant.mockImplementation((_: string, fn: (tx: unknown) => Promise<unknown>) => {
      const chain = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: "d1",
                  description: "Policy violated",
                  workflowStepId: "ws1",
                  responsibleUserId: "u1",
                  createdAt,
                },
              ]),
            }),
          }),
        }),
      };
      return fn(chain);
    });
    const result = await service.getDefectSeverityAlerts(COMPANY_A);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("defect_severity");
    expect(result[0].defectId).toBe("d1");
    expect(result[0].description).toBe("Policy violated");
    expect(result[0].workflowStepId).toBe("ws1");
    expect(result[0].responsibleUserId).toBe("u1");
    expect(result[0].createdAt).toBe(createdAt.toISOString());
  });

  it("getAlerts includes defect_severity alerts alongside overdue and channel_risk", async () => {
    const createdAt = new Date();
    // Each call to withTenant returns appropriate mock data
    let callCount = 0;
    mockWithTenant.mockImplementation((_: string, fn: (tx: unknown) => Promise<unknown>) => {
      callCount++;
      if (callCount === 1) {
        // getOverdueTasks — select chain returning empty
        return fn(buildSelectChain([]));
      } else if (callCount === 2) {
        // getDefectSeverityAlerts — select chain returning 1 defect
        const chain = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  { id: "d2", description: "Quality issue", workflowStepId: "ws2", responsibleUserId: null, createdAt },
                ]),
              }),
            }),
          }),
        };
        return fn(chain);
      } else {
        // getChannelRiskAlerts — execute returning empty
        return fn({ execute: vi.fn().mockResolvedValue({ rows: [] }) });
      }
    });
    const alerts = await service.getAlerts(COMPANY_A);
    expect(alerts.some((a) => a.type === "defect_severity")).toBe(true);
  });

  // ─── tenant isolation: companyId always present ───────────────────────────

  it("getAlerts calls withTenant with correct companyId (no cross-tenant leak)", async () => {
    mockWithTenant.mockImplementation((id: string, fn: (tx: unknown) => Promise<unknown>) => {
      // return empty results
      const chain = buildSelectChain([]);
      return fn({ ...chain, execute: vi.fn().mockResolvedValue({ rows: [] }) });
    });
    await service.getAlerts(COMPANY_B);
    // All internal calls should use COMPANY_B, not COMPANY_A
    for (const call of mockWithTenant.mock.calls) {
      expect(call[0]).toBe(COMPANY_B);
    }
  });
});
