import { ConflictException } from "@nestjs/common";
import type { DatabaseService } from "../db/db.service";
import type { SequenceService } from "../foundation/sequences/sequence.service";
import {
  SequenceInactiveError,
  SequenceNotFoundError,
} from "../foundation/sequences/sequence.types";

/**
 * S5-TASK-HRCODE-1 (lane hrcode-tasks) — tiện ích DÙNG CHUNG cấp mã task (`tasks.task_code`).
 *
 * Gốc: `TaskCoreService.allocateTaskCode` (S5-NOTI-FIX-2) chỉ cấp mã cho task tạo qua POST /tasks. Task HR
 * (đơn nghỉ + đơn điều chỉnh công → `HrTasksService.createApprovalTaskTx`) CHƯA cut-over ⇒ đẻ task_code=NULL,
 * renderer rớt lại '{task_code}' câm (chỉ được commentPayload coalesce sang title che tạm). WO này rút phần
 * cấp mã ra 1 CHỖ để CẢ 3 caller (POST /tasks · leave.createRequest · attendance-adjustment.createRequest)
 * dùng chung logic + 1 điểm map lỗi duy nhất.
 *
 * Hành vi (mirror allocateEmployeeCode — BẤT BIẾN thiết kế counter):
 *   • `nextCode` chạy ở tx RIÊNG (SequenceService.nextCode tự mở withTenant, FOR UPDATE 0-dup) TRƯỚC business
 *     tx của caller ⇒ KHÔNG giữ lock counter suốt tx đơn dài. Rollback business tx ⇒ mã bị "đốt" (gap OK).
 *   • Ensure-on-miss: company tạo SAU migration 0498 chưa có counter (test/onboarding) ⇒ SequenceNotFoundError
 *     ⇒ tạo counter đúng format canonical (khớp 0498) rồi retry ĐÚNG 1 LẦN — KHÔNG loop. NotFound lần 2 ⇒
 *     propagate (fail-loud).
 *   • SequenceInactiveError (admin PATCH counter 'task' → Inactive) ⇒ map HttpException 4xx (409 Conflict) mã
 *     TASK-ERR-CODE-COUNTER-INACTIVE — KHÔNG để 500 raw lọt ra 3 endpoint. 1 điểm map duy nhất tại đây.
 *
 * BẤT BIẾN #1: mọi chạm DB qua `db.withTenant(companyId)` (RLS+FORCE) — util KHÔNG query trần.
 */

/** Khớp seed migration 0498 (sequence_key='task', scope_type='Company' mặc định repo). */
export const TASK_CODE_SEQUENCE_KEY = "task";

/**
 * Config counter 'task' canonical — PHẢI khớp migration 0498 (prefix 'TASK-' + zero-pad 4 = TASK-0001,
 * reset 'Never'). Dùng cho ensure-on-miss (KHÔNG hard-code mã ở nơi khác — chỉ format hệ thống 1 chỗ).
 */
export const TASK_CODE_COUNTER_DEFAULTS = {
  moduleCode: "TASK",
  prefix: "TASK-",
  paddingLength: 4,
  resetPolicy: "Never" as const,
  status: "Active" as const,
};

/**
 * Mã lỗi TASK (SPEC-01 §9 MODULE-ERR-XXX) khi counter 'task' bị tắt (Inactive) — fail-loud 4xx thay vì 500.
 */
export const TASK_CODE_COUNTER_INACTIVE_ERR =
  "TASK-ERR-CODE-COUNTER-INACTIVE: bộ đếm mã công việc (task) đang bị tắt — không cấp được mã. Liên hệ quản trị bật lại.";

async function nextTaskCode(sequence: SequenceService, companyId: string): Promise<string> {
  const { code } = await sequence.nextCode(companyId, { sequenceKey: TASK_CODE_SEQUENCE_KEY });
  return code;
}

/**
 * Ensure-on-miss: tạo counter 'task' đúng format canonical TRONG withTenant riêng (RLS+FORCE). ensureCounterTx
 * idempotent (race 2 create đầu ⇒ SELECT lại) — row đã tồn tại (kể cả Inactive) trả nguyên vẹn, KHÔNG bật lại.
 */
async function ensureTaskCounter(
  db: DatabaseService,
  sequence: SequenceService,
  companyId: string,
): Promise<void> {
  await db.withTenant(companyId, async (tx) => {
    await sequence.ensureCounterTx(
      tx,
      companyId,
      { sequenceKey: TASK_CODE_SEQUENCE_KEY },
      { sequenceKey: TASK_CODE_SEQUENCE_KEY, ...TASK_CODE_COUNTER_DEFAULTS },
    );
  });
}

/**
 * Cấp mã task kế tiếp (tx RIÊNG, FOR UPDATE 0-dup) với ensure-on-miss retry-once + map Inactive→4xx.
 * @throws ConflictException (TASK-ERR-CODE-COUNTER-INACTIVE) khi counter 'task' Inactive.
 * @throws SequenceNotFoundError khi retry sau ensure VẪN không thấy counter (fail-loud — KHÔNG loop).
 */
export async function allocateTaskCode(
  db: DatabaseService,
  sequence: SequenceService,
  companyId: string,
): Promise<string> {
  try {
    try {
      return await nextTaskCode(sequence, companyId);
    } catch (err) {
      if (err instanceof SequenceNotFoundError) {
        await ensureTaskCounter(db, sequence, companyId);
        return await nextTaskCode(sequence, companyId); // retry ĐÚNG 1 lần; lỗi lần 2 ⇒ propagate
      }
      throw err;
    }
  } catch (err) {
    // 1 điểm map duy nhất cho CẢ 3 caller: Inactive (first-call HOẶC retry) ⇒ 409 fail-loud, KHÔNG 500 raw.
    if (err instanceof SequenceInactiveError) {
      throw new ConflictException(TASK_CODE_COUNTER_INACTIVE_ERR);
    }
    throw err;
  }
}
