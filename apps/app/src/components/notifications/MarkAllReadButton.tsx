import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import { myNotificationApi, notificationInvalidation, useCan } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import { NOTI_ENGINE_PAIRS } from "@/routes/notifications/constants";

interface MarkAllReadButtonProps {
  /** Vô hiệu hoá thêm khi caller biết KHÔNG có gì để đánh dấu (vd unread_count === 0). */
  disabled?: boolean;
  size?: "sm" | "default";
}

/**
 * MarkAllReadButton — S4-FE-NOTI-1. Gate = mark_all_read:notification (Own, non-sensitive — mig 0481
 * block 4b). Ẩn hoàn toàn khi thiếu quyền. Invalidate list/dropdown/unread-count sau khi thành công
 * (KHÔNG cần biết id — server có thể đổi nhiều dòng cùng lúc).
 */
export function MarkAllReadButton({ disabled, size = "sm" }: MarkAllReadButtonProps) {
  const { t } = useTranslation("notifications");
  const canMarkAllRead = useCan(
    NOTI_ENGINE_PAIRS.MARK_ALL_READ.action,
    NOTI_ENGINE_PAIRS.MARK_ALL_READ.resourceType,
  );
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => myNotificationApi.markAllRead(),
    onSuccess: () => {
      for (const key of notificationInvalidation.markAllRead()) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  if (!canMarkAllRead) return null;

  return (
    <Button
      variant="outline"
      size={size}
      onClick={() => mutation.mutate()}
      disabled={disabled || mutation.isPending}
    >
      <CheckCheck className="mr-1.5 h-4 w-4" />
      {mutation.isPending ? t("actions.markingAllRead") : t("actions.markAllRead")}
    </Button>
  );
}
