import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { TaskDto } from "@mediaos/contracts";
import { TASK_STATUS_COLORS, TASK_TYPE_LABELS } from "./task-status-constants";

/**
 * Calendar view (G9-3) — lưới task theo dueDate.
 *
 * TZ (ADR-0008): dueDate là datetime UTC-at-rest. date-fns chưa nằm trong deps web; codebase hiện
 * dùng Intl/`toLocaleDateString("vi-VN")` nhất quán. Để KHÔNG thêm dependency mới (tránh churn
 * lockfile xuyên lane), nhóm theo NGÀY LỊCH local bằng key ổn định `getFullYear-getMonth-getDate`
 * (cùng cách card hiển thị ngày) — tránh lệch ngày do parse chuỗi thô.
 */
interface TaskCalendarProps {
  tasks: TaskDto[];
}

interface DayBucket {
  key: string;
  label: string;
  tasks: TaskDto[];
}

const NO_DUE = "__no_due__";

/** Key ngày lịch local ổn định (year-month-day) — KHÔNG so sánh chuỗi ISO thô. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function groupByDueDate(tasks: TaskDto[], t: TFunction<"tasks">): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  for (const task of tasks) {
    if (!task.dueDate) {
      const existing = buckets.get(NO_DUE);
      if (existing) existing.tasks.push(task);
      else buckets.set(NO_DUE, { key: NO_DUE, label: t("calendar.noDue"), tasks: [task] });
      continue;
    }
    const d = new Date(task.dueDate);
    const key = dayKey(d);
    const existing = buckets.get(key);
    if (existing) existing.tasks.push(task);
    else
      buckets.set(key, {
        key,
        label: d.toLocaleDateString("vi-VN", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
        }),
        tasks: [task],
      });
  }

  // Ngày có hạn sort tăng dần; "Chưa có hạn" xuống cuối.
  return [...buckets.values()].sort((a, b) => {
    if (a.key === NO_DUE) return 1;
    if (b.key === NO_DUE) return -1;
    return a.tasks[0].dueDate!.localeCompare(b.tasks[0].dueDate!);
  });
}

export function TaskCalendar({ tasks }: TaskCalendarProps) {
  const { t } = useTranslation("tasks");
  const days = useMemo(() => groupByDueDate(tasks, t), [tasks, t]);

  if (tasks.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{t("calendar.empty")}</p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {days.map((day) => (
        <div key={day.key} className="rounded-xl border border-border p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {day.label} · {day.tasks.length}
          </h3>
          <ul className="space-y-1.5">
            {day.tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${TASK_STATUS_COLORS[task.status]}`}
                >
                  {TASK_TYPE_LABELS[task.taskType]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
