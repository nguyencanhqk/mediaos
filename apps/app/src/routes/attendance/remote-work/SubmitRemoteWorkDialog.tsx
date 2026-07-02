/**
 * SubmitRemoteWorkDialog — Draft→Pending (S3-FE-ATT-4). Người tạo chọn approver + watchers
 * (server validate cùng company — cross-tenant deny). Nếu caller có `manage:user` (đọc danh bạ user),
 * hiển thị select/checkbox từ usersApi.listUsers(); ngược lại fallback nhập UUID thủ công (đơn vẫn
 * hoạt động đúng — server là cổng thật, đây chỉ là UX chọn nhanh).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { usersApi, useCan } from "@mediaos/web-core";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { useSubmitRemoteWorkRequest } from "../hooks/useRemoteWorkRequests";

const MANAGE_USER_PAIR = { action: "manage", resourceType: "user" } as const;
const MAX_WATCHERS = 20;

export function SubmitRemoteWorkDialog({
  requestId,
  onClose,
}: {
  requestId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("attendance");
  const canBrowseUsers = useCan(MANAGE_USER_PAIR.action, MANAGE_USER_PAIR.resourceType);
  const submitMutation = useSubmitRemoteWorkRequest();

  const usersQuery = useQuery({
    queryKey: ["users", "admin", "picker"],
    queryFn: () => usersApi.listUsers({ status: "active", limit: 100 }),
    enabled: canBrowseUsers,
    staleTime: 60_000,
  });
  const users = usersQuery.data?.users ?? [];

  const [approverId, setApproverId] = useState("");
  const [watcherIds, setWatcherIds] = useState<string[]>([]);
  const [manualWatchers, setManualWatchers] = useState("");

  function toggleWatcher(id: string) {
    setWatcherIds((prev) =>
      prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id].slice(0, MAX_WATCHERS),
    );
  }

  function parsedManualWatchers(): string[] {
    return manualWatchers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_WATCHERS);
  }

  const busy = submitMutation.isPending;
  const noop = () => {};
  const approverValid = approverId.trim().length > 0;

  function handleSubmit() {
    const watchers = canBrowseUsers ? watcherIds : parsedManualWatchers();
    submitMutation.mutate(
      {
        id: requestId,
        body: { currentApproverUserId: approverId.trim(), watcherUserIds: watchers },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog
      open
      onClose={busy ? noop : onClose}
      title={t("remoteWork.submitDialog.title")}
      description={t("remoteWork.submitDialog.description")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("remoteWork.submitDialog.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={busy || !approverValid}
            data-testid="submit-remote-work-confirm"
          >
            {busy ? t("remoteWork.submitDialog.submitting") : t("remoteWork.submitDialog.submit")}
          </Button>
        </>
      }
    >
      {submitMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("remoteWork.submitDialog.error")}
        </p>
      )}

      {canBrowseUsers ? (
        <>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              {t("remoteWork.submitDialog.approver")}
            </label>
            <Select value={approverId} onChange={(e) => setApproverId(e.target.value)}>
              <option value="">{t("remoteWork.submitDialog.approverPlaceholder")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName ?? u.email}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              {t("remoteWork.submitDialog.watchers")}
            </label>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={watcherIds.includes(u.id)}
                    onChange={() => toggleWatcher(u.id)}
                    className="h-4 w-4 rounded border-border"
                  />
                  {u.fullName ?? u.email}
                </label>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              {t("remoteWork.submitDialog.approverManualLabel")}
            </label>
            <Input
              value={approverId}
              onChange={(e) => setApproverId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              {t("remoteWork.submitDialog.watchers")}
            </label>
            <Input
              value={manualWatchers}
              onChange={(e) => setManualWatchers(e.target.value)}
              placeholder="uuid-1, uuid-2…"
              autoComplete="off"
            />
          </div>
        </>
      )}
      {!approverValid && (
        <p className="text-xs text-muted-foreground">
          {t("remoteWork.submitDialog.approverRequired")}
        </p>
      )}
    </Dialog>
  );
}
