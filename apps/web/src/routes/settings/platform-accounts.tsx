import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SafePlatformAccountDto } from "@mediaos/contracts";
import { channelsApi } from "@/lib/channels-api";
import { platformAccountsApi, type PlatformAccountFilters } from "@/lib/platform-accounts-api";
import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PlatformAccountTable } from "@/components/platform-accounts/platform-account-table";
import { CreateAccountDialog } from "@/components/platform-accounts/create-account-dialog";
import { UpdateSecretDialog } from "@/components/platform-accounts/update-secret-dialog";
import { useRevealController } from "@/components/platform-accounts/use-reveal-controller";
import {
  PLATFORM_ACCOUNT_STATUS_LABELS,
  PLATFORM_ACCOUNT_STATUS_OPTIONS,
} from "@/components/platform-accounts/constants";

export function PlatformAccountsPage() {
  const [filters, setFilters] = useState<PlatformAccountFilters>({});
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SafePlatformAccountDto | null>(null);
  const { requestReveal, modal } = useRevealController();

  const platformsQuery = useQuery({
    queryKey: ["platforms"],
    queryFn: () => channelsApi.listPlatforms(),
  });

  const accountsQuery = useQuery({
    queryKey: ["platform-accounts", filters],
    queryFn: () => platformAccountsApi.list(filters),
  });

  const platformName = useMemo(() => {
    const map = new Map((platformsQuery.data ?? []).map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? id;
  }, [platformsQuery.data]);

  const accounts = accountsQuery.data ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tài khoản nền tảng</h1>
          <p className="text-sm text-muted-foreground">
            Mật khẩu/token kênh được mã hoá đầu-cuối. Xem secret cần xác minh lại danh tính.
          </p>
        </div>
        <PermissionGate action="create" resourceType="platform-account">
          <Button size="sm" onClick={() => setCreating(true)}>
            + Thêm tài khoản
          </Button>
        </PermissionGate>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Nền tảng</span>
          <Select
            className="w-44"
            value={filters.platformId ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, platformId: e.target.value || undefined }))
            }
          >
            <option value="">Tất cả</option>
            {(platformsQuery.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Trạng thái</span>
          <Select
            className="w-40"
            value={filters.status ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined }))}
          >
            <option value="">Tất cả</option>
            {PLATFORM_ACCOUNT_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {PLATFORM_ACCOUNT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex-1 space-y-1">
          <span className="block text-xs text-muted-foreground">Tìm kiếm</span>
          <Input
            value={filters.q ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined }))}
            placeholder="Tên tài khoản, định danh…"
            maxLength={200}
          />
        </label>
      </div>

      {/* States */}
      {accountsQuery.isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {accountsQuery.isError && (
        <p className="text-sm text-destructive">
          Không tải được danh sách tài khoản.{" "}
          {accountsQuery.error instanceof Error ? accountsQuery.error.message : ""}
        </p>
      )}
      {!accountsQuery.isLoading && !accountsQuery.isError && accounts.length === 0 && (
        <p className="text-sm text-muted-foreground">Chưa có tài khoản nền tảng nào.</p>
      )}

      {accounts.length > 0 && (
        <PlatformAccountTable
          accounts={accounts}
          platformName={platformName}
          onRequestReveal={requestReveal}
          onEditSecret={setEditing}
        />
      )}

      <CreateAccountDialog
        open={creating}
        onClose={() => setCreating(false)}
        platforms={platformsQuery.data ?? []}
      />
      <UpdateSecretDialog account={editing} onClose={() => setEditing(null)} />
      {modal}
    </div>
  );
}
