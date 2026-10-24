import { useTranslation } from "react-i18next";

/**
 * S20-SEC-TASKPATCHGATE-1 — dòng gợi ý dưới ô bị khoá vì thiếu cặp quyền chuyên trách của trường
 * (xem `task-patch-field-locks.ts`). Gắn vào ô qua `aria-describedby={id}`.
 */
export function TaskFieldLockedHint({ id }: { id: string }) {
  const { t } = useTranslation("tasks");
  return (
    <p id={id} className="text-xs text-muted-foreground">
      {t("fieldGate.locked")}
    </p>
  );
}
