import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { notifications } from "../db/schema/communication";

/**
 * S20-TASK-DUEREMIND-1 — phần ĐỌC + hàm thuần của `TaskReminderJobHandler` (handler chỉ điều phối).
 *
 * Ứng viên = việc SPEC-06 (task-core): `due_at` + `task_status` (NULL = Todo; Done/Cancelled không nhắc — chép
 * định nghĩa quá hạn của task-core, `task-core.repository.ts` `isOverdue`), `task_type='office'`, chưa xoá,
 * có người phụ trách GIẢI ĐƯỢC ra user. Raw SQL vì `due_at`/`main_assignee_employee_id`/`reporter_employee_id`
 * chưa typed trong Drizzle `tasks` (mirror `task-audience.reader.ts`). Mọi câu chạy trong `withTenant` của
 * caller + `company_id` bind tường minh (BẤT BIẾN #1).
 */

export const TASK_DUE_SOON_EVENT = "TASK_DUE_SOON";
export const TASK_OVERDUE_EVENT = "TASK_OVERDUE";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cửa sổ «sắp đến hạn» (SPEC-06 §14.17 — 24h tới). */
export const DUE_SOON_WINDOW_MS = DAY_MS;
/**
 * Quyết định owner 26/10/2026: `TASK_OVERDUE` chỉ xét việc có hạn trong 7 ngày gần nhất. Việc quá hạn lâu hơn
 * KHÔNG bị nuốt im lặng — số lượng nằm ở `metadata.overdueSkippedByLookback` của lượt job.
 */
export const OVERDUE_LOOKBACK_MS = 7 * DAY_MS;
const TASK_MODULE_TYPE = "office";
/** Số cặp (người nhận, khoá) mỗi câu kiểm «đã nhắc» — giữ số tham số bind xa trần của Postgres. */
const REMINDED_LOOKUP_CHUNK = 500;

export interface ReminderCandidate {
  id: string;
  title: string;
  /** `due_at` đã chuẩn hoá UTC mili-giây (`toUtcIso`). */
  dueAt: string;
  assigneeUserId: string;
  reporterUserId: string | null;
}

export interface ReminderCandidates {
  dueSoon: ReminderCandidate[];
  overdue: ReminderCandidate[];
  /** Việc đủ điều kiện quá hạn nhưng hạn cũ hơn lookback ⇒ không nhắc, chỉ đếm. */
  overdueSkippedByLookback: number;
}

export interface RecipientKey {
  recipientUserId: string;
  key: string;
}

interface CandidateRow {
  id: string;
  title: string;
  dueAt: string | Date;
  assigneeUserId: string;
  reporterUserId: string | null;
}

/**
 * `due_at` → ISO UTC mili-giây. Nhận cả `Date` (driver pg mặc định) lẫn chuỗi (text có offset) ⇒ khoá dedupe
 * không phụ thuộc TimeZone của phiên PG. Giá trị không đọc được ⇒ ném (lỗi đọc = lỗi hệ thống, không đoán).
 */
export function toUtcIso(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`TASK_REMINDER: due_at không đọc được (${String(v)})`);
  }
  return d.toISOString();
}

/** Khoá dedupe theo (việc, mốc hạn): cùng mốc ⇒ cùng khoá; đổi hạn ⇒ khoá mới ⇒ nhắc lại. */
export function reminderDedupeKey(taskId: string, dueAt: string | Date): string {
  return `${taskId}:${toUtcIso(dueAt)}`;
}

/** `TASK_DUE_SOON` → người phụ trách; `TASK_OVERDUE` → người phụ trách ∪ reporter/người tạo (Q6 = B), duy nhất. */
export function reminderRecipients(eventCode: string, c: ReminderCandidate): string[] {
  const ids =
    eventCode === TASK_OVERDUE_EVENT ? [c.assigneeUserId, c.reporterUserId] : [c.assigneeUserId];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

export function recipientKeyId(recipientUserId: string, key: string): string {
  return `${recipientUserId}|${key}`;
}

/** Người phụ trách: chỉ rơi về cột đồng bộ `assignee_user_id` khi việc KHÔNG có `main_assignee_employee_id`. */
const ASSIGNEE_USER = sql`case when tk.main_assignee_employee_id is not null then ea.user_id else tk.assignee_user_id end`;
const REPORTER_USER = sql`case when tk.reporter_employee_id is not null then er.user_id else tk.creator_user_id end`;

/** D-37 (DECISIONS-05): job nhắc hạn KHÔNG áp đếm-lá — cha lẫn con đều là việc phải xử lý. */
function candidateFrom(companyId: string): SQL {
  return sql`
      from tasks tk
      left join employee_profiles ea
        on ea.id = tk.main_assignee_employee_id and ea.company_id = ${companyId}
       and ea.deleted_at is null and ea.status = 'active'
      left join employee_profiles er
        on er.id = tk.reporter_employee_id and er.company_id = ${companyId}
       and er.deleted_at is null and er.status = 'active'
     where tk.company_id = ${companyId}
       and tk.task_type = ${TASK_MODULE_TYPE}
       and tk.deleted_at is null
       and tk.due_at is not null
       and (tk.task_status is null or tk.task_status not in ('Done', 'Cancelled'))
       and ${ASSIGNEE_USER} is not null`;
}

async function selectCandidates(
  tx: TenantTx,
  companyId: string,
  window: SQL,
): Promise<ReminderCandidate[]> {
  const res = await tx.execute(sql`
    select tk.id, tk.title, tk.due_at as "dueAt",
           ${ASSIGNEE_USER} as "assigneeUserId", ${REPORTER_USER} as "reporterUserId"
    ${candidateFrom(companyId)}
       and ${window}
     order by tk.due_at, tk.id
  `);
  return (res.rows as unknown as CandidateRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    dueAt: toUtcIso(r.dueAt),
    assigneeUserId: r.assigneeUserId,
    reporterUserId: r.reporterUserId ?? null,
  }));
}

export async function queryReminderCandidates(
  tx: TenantTx,
  companyId: string,
  now: Date,
): Promise<ReminderCandidates> {
  const nowIso = now.toISOString();
  const soonIso = new Date(now.getTime() + DUE_SOON_WINDOW_MS).toISOString();
  const lookbackIso = new Date(now.getTime() - OVERDUE_LOOKBACK_MS).toISOString();

  const dueSoon = await selectCandidates(
    tx,
    companyId,
    sql`tk.due_at >= ${nowIso}::timestamptz and tk.due_at <= ${soonIso}::timestamptz`,
  );
  const overdue = await selectCandidates(
    tx,
    companyId,
    sql`tk.due_at < ${nowIso}::timestamptz and tk.due_at >= ${lookbackIso}::timestamptz`,
  );
  const skipped = await tx.execute(sql`
    select count(*)::int as n
    ${candidateFrom(companyId)}
       and tk.due_at < ${lookbackIso}::timestamptz
  `);
  const n = (skipped.rows as unknown as Array<{ n: number | string }>)[0]?.n ?? 0;
  return { dueSoon, overdue, overdueSkippedByLookback: Number(n) };
}

/**
 * Vị từ «đã từng nhận» = tầng 1 của engine (`NotificationDedupeService.isDuplicate`: company · người nhận ·
 * event_code · dedupe_key) TRỪ `deleted_at` — người nhận đã xoá mềm thông báo vẫn tính là đã nhắc (tiền lệ
 * `attendance-alert-noti.repository.ts` findExistingDedupeKeysTx). `user_id = any(...)` chỉ để dùng index
 * `user_id` không partial (engine ghi `user_id` = người nhận).
 */
export function remindedPairsWhere(
  companyId: string,
  eventCode: string,
  recipientUserIds: string[],
  keys: string[],
): SQL {
  return and(
    eq(notifications.companyId, companyId),
    eq(notifications.eventCode, eventCode),
    inArray(notifications.recipientUserId, recipientUserIds),
    inArray(notifications.userId, recipientUserIds),
    inArray(notifications.dedupeKey, keys),
  ) as SQL;
}

/** Tập `recipientKeyId(người nhận, khoá)` đã có hàng `notifications` (còn hay đã xoá mềm). */
export async function findRemindedPairs(
  tx: TenantTx,
  companyId: string,
  eventCode: string,
  pairs: RecipientKey[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < pairs.length; i += REMINDED_LOOKUP_CHUNK) {
    const chunk = pairs.slice(i, i + REMINDED_LOOKUP_CHUNK);
    const recipients = [...new Set(chunk.map((p) => p.recipientUserId))];
    const keys = [...new Set(chunk.map((p) => p.key))];
    const rows = await tx
      .select({ recipientUserId: notifications.recipientUserId, key: notifications.dedupeKey })
      .from(notifications)
      .where(remindedPairsWhere(companyId, eventCode, recipients, keys));
    for (const r of rows) {
      if (r.recipientUserId && r.key) found.add(recipientKeyId(r.recipientUserId, r.key));
    }
  }
  return found;
}
