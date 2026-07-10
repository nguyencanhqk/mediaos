import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import { myNotificationApi, notificationInvalidation, useCan } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import { NOTI_ENGINE_PAIRS, NOTI_STATUS } from "@/routes/notifications/constants";

interface MarkReadButtonProps {
  notificationId: string;
  status: string;
  size?: "sm" | "default";
}

/**
 * MarkReadButton — S4-FE-NOTI-1. Gate = mark_read:notification (Own, non-sensitive — mig 0481 block 4b).
 * Ẩn hoàn toàn khi thiếu quyền (KHÔNG disabled-nhìn-thấy) VÀ khi thông báo đã Read — idempotent ở server
 * nhưng UI không cho bấm lại vô nghĩa. `notificationInvalidation.markRead` làm mới list/dropdown/unread-count.
 */
export function MarkReadButton({ notificationId, status, size = "sm" }: MarkReadButtonProps) {
  const { t } = useTranslation("notifications");
  const canMarkRead = useCan(
    NOTI_ENGINE_PAIRS.MARK_READ.action,
    NOTI_ENGINE_PAIRS.MARK_READ.resourceType,
  );
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => myNotificationApi.markRead(notificationId),
    onSuccess: () => {
      for (const key of notificationInvalidation.markRead(notificationId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  if (!canMarkRead || status !== NOTI_STATUS.UNREAD) return null;

  return (
    <Button
      variant="ghost"
      size={size}
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      aria-label={t("actions.markRead")}
    >
      <CheckCheck className="mr-1.5 h-4 w-4" />
      {t("actions.markRead")}
    </Button>
  );
}
