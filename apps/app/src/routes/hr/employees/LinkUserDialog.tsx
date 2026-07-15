/**
 * LinkUserDialog — S5-HR-LINKUI-1 (HR-FUNC-011). Tìm + chọn 1 tài khoản CÓ SẴN cùng công ty (CHƯA gắn
 * hồ sơ nhân sự nào) rồi POST /hr/employees/:id/link-user. Search qua GET /auth/users SẴN CÓ (server
 * filter `linkedProfile=false`) — KHÔNG thêm endpoint mới. Chỉ mount khi caller đã có view:user (gate ở
 * AccountLinkSection) — component KHÔNG tự kiểm tra lại quyền (permission là việc 1 nơi, tránh trôi).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authUsersApi, authUsersKeys, hrApi, hrKeys } from "@mediaos/web-core";
import { Button, Dialog, Input } from "@mediaos/ui";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { linkUserErrorKey } from "./account-link-errors";

const SEARCH_DEBOUNCE_MS = 300;
const CANDIDATE_LIMIT = 20;

export function LinkUserDialog({
  employeeId,
  onClose,
}: {
  employeeId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("hr");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const candidateParams = {
    q: debouncedSearch.trim() || undefined,
    linkedProfile: false,
    limit: CANDIDATE_LIMIT,
  };
  const candidatesQuery = useQuery({
    queryKey: authUsersKeys.list(candidateParams),
    queryFn: () => authUsersApi.listUsers(candidateParams),
    staleTime: 10_000,
  });
  const candidates = candidatesQuery.data?.users ?? [];

  const mutation = useMutation({
    mutationFn: () => hrApi.linkUser(employeeId, { userId: selectedUserId as string }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: hrKeys.employees.all }),
        queryClient.invalidateQueries({ queryKey: authUsersKeys.all }),
      ]);
      onClose();
    },
  });

  const busy = mutation.isPending;
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={busy ? noop : onClose}
      title={t("accountLink.linkDialog.title")}
      description={t("accountLink.linkDialog.description")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("accountLink.linkDialog.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={busy || !selectedUserId}
            data-testid="account-link-submit"
          >
            {busy ? t("accountLink.linkDialog.submitting") : t("accountLink.linkDialog.submit")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(linkUserErrorKey(mutation.error))}
        </p>
      )}
      <Input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setSelectedUserId(null);
        }}
        placeholder={t("accountLink.linkDialog.searchPlaceholder")}
        aria-label={t("accountLink.linkDialog.searchPlaceholder")}
        autoComplete="off"
        autoFocus
      />
      <div
        role="listbox"
        aria-label={t("accountLink.linkDialog.title")}
        className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1"
      >
        {candidatesQuery.isLoading && (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            {t("accountLink.linkDialog.loading")}
          </p>
        )}
        {candidatesQuery.isError && (
          <p className="px-2 py-3 text-sm text-destructive">{t("accountLink.linkDialog.error")}</p>
        )}
        {!candidatesQuery.isLoading && !candidatesQuery.isError && candidates.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            {t("accountLink.linkDialog.empty")}
          </p>
        )}
        {candidates.map((u) => (
          <button
            key={u.id}
            type="button"
            role="option"
            aria-selected={selectedUserId === u.id}
            onClick={() => setSelectedUserId(u.id)}
            className={`w-full rounded-md px-2 py-2 text-left text-sm transition-colors ${
              selectedUserId === u.id
                ? "bg-primary/10 text-primary"
                : "text-foreground hover:bg-muted"
            }`}
          >
            <span className="block font-medium">{u.email}</span>
            {u.fullName && (
              <span className="block text-xs text-muted-foreground">{u.fullName}</span>
            )}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
