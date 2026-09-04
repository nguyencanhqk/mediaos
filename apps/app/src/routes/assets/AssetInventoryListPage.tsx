import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { assetApi, assetKeys, useCan } from "@mediaos/web-core";
import { Badge, Button, Dialog, EmptyState, Input, PageHeader, PaginationFooter, Select, Skeleton } from "@mediaos/ui";
import { ASSET_ENGINE_PAIRS, ASSET_PAGE_SIZE } from "./constants";
import { assetErrorI18nKey, parseAssetError } from "./asset-errors";

interface AssetInventoryListPageProps {
  onOpenInventory: (id: string) => void;
}

/**
 * ASSET-SCREEN-005a (S11-ASSET-FE-1) — danh sách đợt kiểm kê.
 *
 * Mở đợt bị chặn khi công ty ĐÃ có một đợt `Open` (ASSET-ERR-006, ép bằng partial unique) — nên nút
 * «Mở đợt» ẩn khi trong danh sách đã có đợt Open, thay vì để người dùng bấm rồi ăn 409 (SPEC-13 §14).
 * Đây là suy luận trên trang HIỆN TẠI: nếu đợt Open nằm ở trang sau thì nút vẫn hiện và server chặn —
 * lưới hứng vẫn còn, chỉ mất phần đoán trước.
 *
 * Endpoint danh sách là Company-scope: người ở scope Own/Department nhận mảng RỖNG (không 403), nên
 * trạng thái rỗng ở đây phủ cả hai ca và không được nói "chưa có đợt nào" một cách khẳng định.
 */
export function AssetInventoryListPage({ onOpenInventory }: AssetInventoryListPageProps) {
  const { t } = useTranslation("assets");
  const queryClient = useQueryClient();

  const canView = useCan(ASSET_ENGINE_PAIRS.VIEW.action, ASSET_ENGINE_PAIRS.VIEW.resourceType);
  const canManage = useCan(
    ASSET_ENGINE_PAIRS.MANAGE_INVENTORY.action,
    ASSET_ENGINE_PAIRS.MANAGE_INVENTORY.resourceType,
  );

  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const listParams = { page, per_page: ASSET_PAGE_SIZE };
  const listQuery = useQuery({
    queryKey: assetKeys.inventories.list(listParams),
    queryFn: () => assetApi.listInventories(listParams),
    enabled: canView,
  });

  const categoriesQuery = useQuery({
    queryKey: assetKeys.categories.list(),
    queryFn: () => assetApi.listCategories(),
    enabled: canManage && dialogOpen,
    staleTime: 300_000,
  });

  const rows = listQuery.data?.data ?? [];
  const hasOpen = rows.some((r) => r.status === "Open");
  const total = listQuery.data?.pagination?.total ?? rows.length;
  const lastPage = Math.max(1, Math.ceil(total / ASSET_PAGE_SIZE));

  const openMutation = useMutation({
    mutationFn: () =>
      assetApi.openInventory({
        name: name.trim(),
        categoryId: categoryId === "" ? null : categoryId,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: (inv) => {
      setDialogOpen(false);
      setName("");
      setCategoryId("");
      setNote("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: assetKeys.inventories.all });
      onOpenInventory(inv.id);
    },
    onError: (err) => {
      const info = parseAssetError(err);
      setError(t(assetErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("inventory.listTitle")}
        actions={
          canManage &&
          !hasOpen && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 size-4" />
              {t("inventory.open")}
            </Button>
          )
        }
      />

      {listQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : listQuery.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void listQuery.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState title={t("inventory.emptyList")} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((inv) => (
            <li key={inv.id}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-accent"
                onClick={() => onOpenInventory(inv.id)}
              >
                <span className="font-medium">{inv.name}</span>
                <Badge variant={inv.status === "Open" ? "brand" : "muted"}>
                  {t(`inventoryStatus.${inv.status}`)}
                </Badge>
                <span className="text-muted-foreground">{inv.openedAt}</span>
                {inv.status === "Closed" && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {t("inventory.summary.found")}: {inv.foundCount ?? 0} ·{" "}
                    {t("inventory.summary.missing")}: {inv.missingCount ?? 0} ·{" "}
                    {t("inventory.summary.notChecked")}: {inv.notCheckedCount ?? 0}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <PaginationFooter
          page={page}
          totalPages={lastPage}
          onPageChange={setPage}
        />
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={t("inventory.open")}
        footer={
          <>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("form.cancel")}
            </Button>
            <Button
              disabled={name.trim() === "" || openMutation.isPending}
              onClick={() => openMutation.mutate()}
            >
              {openMutation.isPending ? t("states.saving") : t("inventory.open")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("inventory.name")}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("inventory.scope")}</span>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t("inventory.scopeAll")}</option>
              {(categoriesQuery.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("inventory.note")}</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
