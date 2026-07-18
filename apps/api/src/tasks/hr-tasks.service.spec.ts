/**
 * S5-TASK-HRCODE-1 (lane hrcode-tasks) — HrTasksService: cấp + GHI task_code cho task HR (đơn nghỉ + đơn
 * điều chỉnh công). Unit thuần (KHÔNG DB) — db/sequence/tx đều mock.
 *
 * RED trước wire:
 *   • createApprovalTaskTx CHƯA nhận/ghi task_code ⇒ insert().values() KHÔNG có taskCode.
 *   • allocateTaskCodeBeforeTx CHƯA tồn tại ⇒ TypeError.
 * GREEN: createApprovalTaskTx ghi task_code (khi truyền); allocateTaskCodeBeforeTx delegate util
 *   (nextCode tx RIÊNG, ensure-on-miss retry-once, Inactive→409 TASK-ERR-CODE-COUNTER-INACTIVE).
 */

import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { HrTasksService } from "./hr-tasks.service";
import {
  SequenceInactiveError,
  SequenceNotFoundError,
} from "../foundation/sequences/sequence.types";

const COMPANY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const NEW_TASK_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const FAKE_TX = { __tx: true };

/** Mock chuỗi drizzle insert(...).values(...).returning(...) → bắt lại object values đã ghi. */
function makeInsertTx() {
  const returning = vi.fn().mockResolvedValue([{ id: NEW_TASK_ID }]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  return { tx: { insert } as never, insert, values, returning };
}

function makeSequence(
  overrides: {
    nextCode?: ReturnType<typeof vi.fn>;
    ensureCounterTx?: ReturnType<typeof vi.fn>;
  } = {},
) {
  return {
    nextCode:
      overrides.nextCode ??
      vi.fn().mockResolvedValue({ sequenceKey: "task", value: 1, code: "TASK-0001" }),
    ensureCounterTx: overrides.ensureCounterTx ?? vi.fn().mockResolvedValue(undefined),
  };
}

function makeDb() {
  return {
    withTenant: vi.fn((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX)),
  };
}

function makeService(
  opts: {
    sequence?: ReturnType<typeof makeSequence> | null;
    db?: ReturnType<typeof makeDb>;
  } = {},
) {
  // sequence === null ⇒ chưa wire SequenceModule (fail-loud path). undefined-mặc-định ⇒ mock chuẩn.
  const sequence = opts.sequence === null ? undefined : (opts.sequence ?? makeSequence());
  const db = opts.db ?? makeDb();
  const svc = new HrTasksService(db as never, sequence as never);
  return { svc, sequence, db };
}

describe("HrTasksService.createApprovalTaskTx — GHI task_code (S5-TASK-HRCODE-1)", () => {
  it("ghi task_code (non-null) vào row tasks khi được truyền", async () => {
    const { svc } = makeService();
    const { tx, values } = makeInsertTx();

    const res = await svc.createApprovalTaskTx(tx, COMPANY, {
      title: "Duyệt đơn nghỉ",
      assigneeUserId: null,
      taskCode: "TASK-0042",
    });

    expect(res).toEqual({ id: NEW_TASK_ID });
    expect(values).toHaveBeenCalledOnce();
    const written = values.mock.calls[0][0] as { taskCode?: string | null; taskType?: string };
    expect(written.taskCode).toBe("TASK-0042");
    expect(written.taskType).toBe("hr");
  });

  it("KHÔNG truyền taskCode ⇒ ghi null (backward-compat cho caller chưa cut-over)", async () => {
    const { svc } = makeService();
    const { tx, values } = makeInsertTx();

    await svc.createApprovalTaskTx(tx, COMPANY, { title: "X", assigneeUserId: null });

    const written = values.mock.calls[0][0] as { taskCode?: string | null };
    expect(written.taskCode ?? null).toBeNull();
  });
});

describe("HrTasksService.allocateTaskCodeBeforeTx — cấp mã tx RIÊNG (S5-TASK-HRCODE-1)", () => {
  it("cấp mã qua sequence.nextCode({sequenceKey:'task'}) — tx RIÊNG, KHÔNG cần business tx", async () => {
    const sequence = makeSequence();
    const { svc } = makeService({ sequence });

    const code = await svc.allocateTaskCodeBeforeTx(COMPANY);

    expect(code).toBe("TASK-0001");
    expect(sequence.nextCode).toHaveBeenCalledOnce();
    const [companyId, input] = sequence.nextCode.mock.calls[0];
    expect(companyId).toBe(COMPANY);
    expect(input).toMatchObject({ sequenceKey: "task" });
  });

  it("ensure-on-miss: counter chưa seed (NotFound) → ensureCounterTx (canonical) → retry ĐÚNG 1 lần", async () => {
    const nextCode = vi
      .fn()
      .mockRejectedValueOnce(new SequenceNotFoundError("task"))
      .mockResolvedValueOnce({ sequenceKey: "task", value: 7, code: "TASK-0007" });
    const ensureCounterTx = vi.fn().mockResolvedValue(undefined);
    const { svc } = makeService({ sequence: makeSequence({ nextCode, ensureCounterTx }) });

    const code = await svc.allocateTaskCodeBeforeTx(COMPANY);

    expect(code).toBe("TASK-0007");
    expect(ensureCounterTx).toHaveBeenCalledOnce();
    const [, companyId, key, defaults] = ensureCounterTx.mock.calls[0];
    expect(companyId).toBe(COMPANY);
    expect(key).toMatchObject({ sequenceKey: "task" });
    expect(defaults).toMatchObject({
      moduleCode: "TASK",
      prefix: "TASK-",
      paddingLength: 4,
      resetPolicy: "Never",
      status: "Active",
    });
    expect(nextCode).toHaveBeenCalledTimes(2);
  });

  it("KHÔNG loop: nextCode vẫn NotFound sau ensure → ném (retry ĐÚNG 1 lần)", async () => {
    const nextCode = vi.fn().mockRejectedValue(new SequenceNotFoundError("task"));
    const { svc } = makeService({ sequence: makeSequence({ nextCode }) });

    await expect(svc.allocateTaskCodeBeforeTx(COMPANY)).rejects.toThrow();
    expect(nextCode).toHaveBeenCalledTimes(2); // gốc + đúng 1 retry, KHÔNG loop
  });

  it("counter 'task' Inactive → ConflictException (409) mã TASK-ERR-CODE-COUNTER-INACTIVE — KHÔNG 500 raw", async () => {
    const nextCode = vi.fn().mockRejectedValue(new SequenceInactiveError("task"));
    const { svc } = makeService({ sequence: makeSequence({ nextCode }) });

    await expect(svc.allocateTaskCodeBeforeTx(COMPANY)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.allocateTaskCodeBeforeTx(COMPANY)).rejects.toThrow(
      /TASK-ERR-CODE-COUNTER-INACTIVE/,
    );
    // Inactive KHÔNG phải NotFound ⇒ KHÔNG ensure-on-miss, KHÔNG retry (nextCode chỉ gọi 1 lần/lượt).
    expect(nextCode).toHaveBeenCalledTimes(2); // 2 lượt gọi allocate ở trên, mỗi lượt đúng 1 nextCode
  });

  it("SequenceModule chưa wire (sequence undefined) → FAIL-LOUD ném, KHÔNG cấp mã câm", async () => {
    const { svc } = makeService({ sequence: null });
    await expect(svc.allocateTaskCodeBeforeTx(COMPANY)).rejects.toThrow(
      /TASK-ERR-CODE-SEQ-UNWIRED/,
    );
  });
});
