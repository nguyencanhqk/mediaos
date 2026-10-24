import "reflect-metadata";
/**
 * S20-SEC-TASKPATCHGATE-1 — unit cho cổng trường của `PATCH /tasks/:taskId` (plan §3.1–§3.3, §4 Unit, §5).
 *
 * Ghim phần thuần của cổng mà int-spec không nhìn thấy được:
 *   - bảng trường ↔ cặp ở MỘT nơi (M8: đảo cặp);
 *   - `computeChanged` so theo bản ghi hiện tại — `dueAt` theo epoch ms, `null` là đổi (I-3; M2, M3, M7);
 *   - `buildGatedPatch` KHÔNG ghi khoá của trường không đổi (I-3 vế «không ghi»: bản ghi đọc không khoá
 *     hàng, ghi lại giá trị cũ sẽ đè thay đổi hợp lệ commit chen giữa — M9);
 *   - `prepare` chỉ hỏi cặp của trường có mặt, ánh xạ kết quả theo chỉ số của `requests` đã lọc (M13);
 *   - `assertTx` đòi cặp + phạm vi việc của CHÍNH cặp cho từng trường đổi, không đòi gì cho trường không đổi.
 */
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TASK_PATCH_GATED_FIELDS,
  TaskPatchFieldGate,
  auditedPatchFields,
  buildGatedPatch,
  computeChanged,
} from "./task-patch-field-gate";

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
} as never;
const TASK_ID = "33333333-3333-3333-3333-333333333333";
const TX = {} as never;

const DUE = "2026-11-20T03:00:00.000Z";
const CURRENT = {
  dueAt: new Date(DUE),
  taskPriority: "Medium",
  mainAssigneeEmployeeId: "emp-1",
};

describe("TASK_PATCH_GATED_FIELDS — bảng trường ↔ cặp chuyên trách", () => {
  it("ba trường, mỗi trường đúng cặp của route chuyên trách tương ứng", () => {
    const map = Object.fromEntries(TASK_PATCH_GATED_FIELDS.map((f) => [f.field, f.action]));
    expect(map).toEqual({
      dueAt: "update-deadline",
      priority: "update-priority",
      assigneeEmployeeId: "assign",
    });
  });
});

describe("computeChanged — I-3 so với bản ghi hiện tại", () => {
  const changed = (dto: Record<string, unknown>, current: Record<string, unknown> = CURRENT) =>
    [...computeChanged(current as never, dto as never)].sort();

  it("hạn cùng thời điểm, khác offset ⇒ không đổi", () => {
    expect(changed({ dueAt: "2026-11-20T10:00:00+07:00" })).toEqual([]);
  });

  it("hạn hiện tại lưu dạng chuỗi ISO, body cùng thời điểm ⇒ không đổi", () => {
    expect(changed({ dueAt: DUE }, { ...CURRENT, dueAt: DUE as never })).toEqual([]);
  });

  it("hạn lệch 1 ms ⇒ đổi", () => {
    expect(changed({ dueAt: "2026-11-20T03:00:00.001Z" })).toEqual(["dueAt"]);
  });

  it("null so với giá trị ⇒ đổi (xoá hạn · bỏ ưu tiên · gỡ người phụ trách)", () => {
    expect(changed({ dueAt: null, priority: null, assigneeEmployeeId: null })).toEqual([
      "assigneeEmployeeId",
      "dueAt",
      "priority",
    ]);
  });

  it("null so với null ⇒ không đổi", () => {
    const empty = { dueAt: null, taskPriority: null, mainAssigneeEmployeeId: null };
    expect(changed({ dueAt: null, priority: null, assigneeEmployeeId: null }, empty)).toEqual([]);
  });

  it("giá trị so với null đang lưu ⇒ đổi", () => {
    const empty = { dueAt: null, taskPriority: null, mainAssigneeEmployeeId: null };
    expect(changed({ dueAt: DUE, priority: "High", assigneeEmployeeId: "emp-2" }, empty)).toEqual([
      "assigneeEmployeeId",
      "dueAt",
      "priority",
    ]);
  });

  it("trường vắng khỏi body ⇒ không xét; trường ngoài bảng không bao giờ vào tập đổi", () => {
    expect(changed({ title: "x", description: null })).toEqual([]);
  });

  it("ưu tiên / người phụ trách bằng giá trị đang lưu ⇒ không đổi; khác ⇒ đổi", () => {
    expect(changed({ priority: "Medium", assigneeEmployeeId: "emp-1" })).toEqual([]);
    expect(changed({ priority: "High", assigneeEmployeeId: "emp-2" })).toEqual([
      "assigneeEmployeeId",
      "priority",
    ]);
  });
});

describe("buildGatedPatch — I-3 vế «không ghi»", () => {
  const PATCH_KEYS = ["dueAt", "taskPriority", "mainAssigneeEmployeeId", "assigneeUserId"];

  it.each([
    ["dueAt", { dueAt: "2026-11-20T10:00:00+07:00" }, CURRENT],
    ["priority", { priority: "Medium" }, CURRENT],
    ["assigneeEmployeeId", { assigneeEmployeeId: "emp-1" }, CURRENT],
    ["dueAt null≡null", { dueAt: null }, { ...CURRENT, dueAt: null }],
    ["priority null≡null", { priority: null }, { ...CURRENT, taskPriority: null }],
    [
      "assigneeEmployeeId null≡null",
      { assigneeEmployeeId: null },
      { ...CURRENT, mainAssigneeEmployeeId: null },
    ],
  ])(
    "%s có trong body nhưng bằng giá trị đang lưu ⇒ patch không có khoá nào của cổng",
    (_n, dto, cur) => {
      const set = computeChanged(cur as never, dto as never);
      const patch = buildGatedPatch(dto as never, set, null);
      for (const k of PATCH_KEYS) expect(patch).not.toHaveProperty(k);
    },
  );

  it("trường đổi ⇒ có khoá, trường không đổi đi kèm ⇒ không có khoá", () => {
    const dto = { dueAt: "2026-12-05T09:30:00.000Z", priority: "Medium" };
    const patch = buildGatedPatch(
      dto as never,
      computeChanged(CURRENT as never, dto as never),
      null,
    );
    expect(patch).toEqual({ dueAt: "2026-12-05T09:30:00.000Z" });
  });

  it("đổi người phụ trách ⇒ ghi cả hai cột từ người đã resolve", () => {
    const dto = { assigneeEmployeeId: "emp-2" };
    const patch = buildGatedPatch(dto as never, computeChanged(CURRENT as never, dto as never), {
      employeeId: "emp-2",
      userId: "user-2",
    });
    expect(patch).toEqual({ mainAssigneeEmployeeId: "emp-2", assigneeUserId: "user-2" });
  });

  it("gỡ người phụ trách ⇒ cả hai cột null; xoá hạn / bỏ ưu tiên ⇒ null", () => {
    const dto = { assigneeEmployeeId: null, dueAt: null, priority: null };
    const patch = buildGatedPatch(
      dto as never,
      computeChanged(CURRENT as never, dto as never),
      null,
    );
    expect(patch).toEqual({
      mainAssigneeEmployeeId: null,
      assigneeUserId: null,
      dueAt: null,
      taskPriority: null,
    });
  });
});

describe("TaskPatchFieldGate — prepare (trước tx) + assertTx (trong tx)", () => {
  let grants: Record<string, string | null>;
  let dataScope: {
    resolveManyOrNull: ReturnType<typeof vi.fn>;
    assertGranted: ReturnType<typeof vi.fn>;
  };
  let projectAccess: { assertTaskInScopeTx: ReturnType<typeof vi.fn> };
  let gate: TaskPatchFieldGate;

  beforeEach(() => {
    grants = {};
    dataScope = {
      resolveManyOrNull: vi.fn(
        async (_u: string, _c: string, reqs: ReadonlyArray<{ action: string }>) =>
          reqs.map((r) => grants[r.action] ?? null),
      ),
      // Hợp đồng của `DataScopeService.assertGranted` (ghim riêng ở data-scope.service.spec.ts).
      assertGranted: vi.fn((scope: unknown) => {
        if (scope == null)
          throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope");
        return scope;
      }),
    };
    projectAccess = { assertTaskInScopeTx: vi.fn().mockResolvedValue(undefined) };
    gate = new TaskPatchFieldGate(dataScope as never, projectAccess as never);
  });

  it("body không có trường nào của cổng ⇒ 0 lượt đọc grant", async () => {
    await expect(gate.prepare(USER, { title: "x" } as never)).resolves.toEqual([]);
    expect(dataScope.resolveManyOrNull).not.toHaveBeenCalled();
  });

  it("chỉ hỏi đúng cặp của trường có mặt, MỘT lượt đọc", async () => {
    grants["update-priority"] = "Company";
    await gate.prepare(USER, { title: "x", priority: "High" } as never);
    expect(dataScope.resolveManyOrNull).toHaveBeenCalledTimes(1);
    const reqs = dataScope.resolveManyOrNull.mock.calls[0][2] as Array<Record<string, unknown>>;
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ action: "update-priority", resourceType: "task" });
  });

  it("ánh xạ theo chỉ số của requests đã lọc: chỉ priority, actor chỉ có update-priority ⇒ qua", async () => {
    grants["update-priority"] = "Company";
    const prepared = await gate.prepare(USER, { priority: "High" } as never);
    expect(prepared).toEqual([{ field: "priority", scope: "Company" }]);
    // Không ném = qua (ném ⇒ ca đỏ với đúng lỗi).
    await gate.assertTx(TX, USER, TASK_ID, new Set(["priority"]) as never, prepared);
  });

  it("{dueAt, priority} với actor chỉ có update-priority ⇒ 403 (thiếu update-deadline)", async () => {
    grants["update-priority"] = "Company";
    const prepared = await gate.prepare(USER, { dueAt: DUE, priority: "High" } as never);
    expect(prepared).toEqual([
      { field: "dueAt", scope: null },
      { field: "priority", scope: "Company" },
    ]);
    await expect(
      gate.assertTx(TX, USER, TASK_ID, new Set(["dueAt", "priority"]) as never, prepared),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("trường có mặt nhưng KHÔNG đổi ⇒ không đòi cặp (thiếu cặp vẫn qua)", async () => {
    const prepared = await gate.prepare(USER, { dueAt: DUE } as never);
    await gate.assertTx(TX, USER, TASK_ID, new Set() as never, prepared);
    expect(projectAccess.assertTaskInScopeTx).not.toHaveBeenCalled();
  });

  it("trường đổi ⇒ buộc việc theo phạm vi của CHÍNH cặp, mode write", async () => {
    grants["update-deadline"] = "Own";
    const prepared = await gate.prepare(USER, { dueAt: DUE } as never);
    await gate.assertTx(TX, USER, TASK_ID, new Set(["dueAt"]) as never, prepared);
    expect(projectAccess.assertTaskInScopeTx).toHaveBeenCalledWith(
      TX,
      USER,
      TASK_ID,
      "Own",
      "write",
    );
  });

  it("việc ngoài phạm vi của cặp ⇒ lỗi của assertTaskInScopeTx đi thẳng ra (404)", async () => {
    grants["update-deadline"] = "Own";
    projectAccess.assertTaskInScopeTx.mockRejectedValue(
      new NotFoundException("TASK-ERR-TASK-NOT-FOUND"),
    );
    const prepared = await gate.prepare(USER, { dueAt: DUE } as never);
    await expect(
      gate.assertTx(TX, USER, TASK_ID, new Set(["dueAt"]) as never, prepared),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("id người phụ trách — so không phân biệt hoa/thường (UUID cùng giá trị)", () => {
  it("cùng id đang lưu nhưng viết hoa ⇒ không đổi; id khác viết hoa ⇒ đổi", () => {
    expect([...computeChanged(CURRENT as never, { assigneeEmployeeId: "EMP-1" } as never)]).toEqual(
      [],
    );
    expect([...computeChanged(CURRENT as never, { assigneeEmployeeId: "EMP-2" } as never)]).toEqual(
      ["assigneeEmployeeId"],
    );
  });

  it("body viết hoa, người đã resolve viết thường ⇒ ghi id đã resolve, không nổ", () => {
    const dto = { assigneeEmployeeId: "EMP-2" };
    const patch = buildGatedPatch(dto as never, computeChanged(CURRENT as never, dto as never), {
      employeeId: "emp-2",
      userId: "user-2",
    });
    expect(patch).toEqual({ mainAssigneeEmployeeId: "emp-2", assigneeUserId: "user-2" });
  });

  it("người đã resolve là người KHÁC ⇒ vẫn nổ (không ghi người chưa kiểm)", () => {
    const dto = { assigneeEmployeeId: "EMP-2" };
    expect(() =>
      buildGatedPatch(dto as never, computeChanged(CURRENT as never, dto as never), {
        employeeId: "emp-3",
        userId: "user-3",
      }),
    ).toThrow(/TASK-ERR-PATCH-GATE/);
  });
});

describe("auditedPatchFields — nhật ký TASK_UPDATED chỉ khai trường thực sự ghi", () => {
  it("trường cổng không đổi ⇒ không khai; trường cổng đổi + trường thường ⇒ khai; stateId ⇒ không khai", () => {
    const dto = {
      title: "x",
      description: null,
      stateId: "state-1",
      dueAt: "2026-11-20T10:00:00+07:00",
      priority: "High",
      assigneeEmployeeId: "EMP-1",
    };
    const out = auditedPatchFields(dto as never, computeChanged(CURRENT as never, dto as never));
    expect(out).toEqual({ title: "x", description: null, priority: "High" });
  });

  it("body chỉ có trường cổng không đổi ⇒ rỗng (không ghi nhật ký)", () => {
    const dto = { dueAt: DUE, priority: "Medium", assigneeEmployeeId: "emp-1" };
    expect(
      auditedPatchFields(dto as never, computeChanged(CURRENT as never, dto as never)),
    ).toEqual({});
  });

  it("trường vắng (undefined) ⇒ không khai", () => {
    expect(auditedPatchFields({ title: undefined } as never, new Set())).toEqual({});
  });
});
