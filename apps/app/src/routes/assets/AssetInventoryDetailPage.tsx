import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { assetApi, assetKeys, useCan } from "@mediaos/web-core";
import type { AssetInventoryItemResultDto } from "@mediaos/contracts";
import { Badge, Button, EmptyState, PageHeader, Select, Skeleton } from "@mediaos/ui";
import { ASSET_BULK_MARK_LIMIT, ASSET_ENGINE_PAIRS, ASSET_PAGE_SIZE } from "./constants";
import { AssetInventoryResultBadge } from "./components/AssetStatusBadge";
import { assetErrorI18nKey, parseAssetError } from "./asset-errors";

interface AssetInventoryDetailPageProps {
  inventoryId: string;
  onBack: () => void;
  onOpenAsset: (assetId: string) => void;
}

/**
 * ASSET-SCREEN-005b (S11-ASSET-FE-1) — chi tiết đợt kiểm kê + đánh dấu dòng.
 *
 * Ba ràng buộc nghiệp vụ dựng thẳng vào UI:
 *
 *  1. **Đợt `Closed` ⇒ mọi thao tác đánh dấu biến mất** (ASSET-ERR-007). Không disable — ẩn.
 *  2. **Dòng `Missing` KHÔNG tự đổi trạng thái tài sản** (ASSET-FUNC-010). Gợi ý «Ghi nhận mất» chỉ
 *     ĐIỀU HƯỚNG sang màn chi tiết tài sản (ASSET-SCREEN-002) — quyết định vòng đời phải do người có
 *     `dispose:asset` bấm ở đó, không phải hệ quả phụ của một lần kiểm kê.
 *  3. **Đóng đợt không tự đánh dấu nốt**: dòng chưa kiểm giữ nguyên `Not Checked`, nên hộp xác nhận
 *     phải nói rõ điều đó trước khi người dùng bấm.
 *
 * `bulk-mark` bị chặn trần `ASSET_BULK_MARK_MAX` — cắt danh sách chọn ở client cho khớp, nếu không
 * người dùng chọn "tất cả" trên đợt lớn sẽ ăn 400 mà không hiểu vì sao.
 */
export function AssetInventoryDetailPage({
  inventoryId,
  onBack,
  onOpenAsset,
}: AssetInventoryDetailPageProps) {
  const { t } = useTranslation("assets");
  const queryClient = useQueryClient();

  const canManage = useCan(
    ASSET_ENGINE_PAIRS.MANAGE_INVENTORY.action,
    ASSET_ENGINE_PAIRS.MANAGE_INVENTORY.resourceType,
  );

  const [resultFilter, setResultFilter] = useState<AssetInventoryItemResultDto | "">("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const invQuery = useQuery({
    queryKey: assetKeys.inventories.detail(inventoryId),
    queryFn: () => assetApi.getInventory(inventoryId),
  });

  const itemParams = {
    ...(resultFilter ? { result: resultFilter } : {}),
    page,
    per_page: ASSET_PAGE_SIZE,
  };
  const itemsQuery = useQuery({
    queryKey: assetKeys.inventories.items(inventoryId, itemParams),
    queryFn: () => assetApi.listInventoryItems(inventoryId, itemParams),
    enabled: Boolean(invQuery.data),
  });

  const inventory = invQuery.data;
  const items = itemsQuery.data?.data ?? [];
  const isOpen = inventory?.status === "Open";
  const canMark = canManage && isOpen;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: assetKeys.inventories.detail(inventoryId) });
    void queryClient.invalidateQueries({ queryKey: assetKeys.inventories.itemsOf(inventoryId) });
  };

  const onMutationError = (err: unknown) => {
    const info = parseAssetError(err);
    setError(t(assetErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
  };

  const bulkMarkMutation = useMutation({
    mutationFn: (result: "Found" | "Missing") =>
      assetApi.bulkMarkInventoryItems(inventoryId, {
        itemIds: [...selected].slice(0, ASSET_BULK_MARK_LIMIT),
        result,
        note: null,
      }),
    onSuccess: () => {
      setSelected(new Set());
      setError(null);
      refresh();
    },
    onError: onMutationError,
  });

  const markOneMutation = useMutation({
    mutationFn: ({ itemId, result }: { itemId: string; result: "Found" | "Missing" }) =>
      assetApi.markInventoryItem(inventoryId, itemId, { result, note: null }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: onMutationError,
  });

  const closeMutation = useMutation({
    mutationFn: () => assetApi.closeInventory(inventoryId, { note: null }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: onMutationError,
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (invQuery.isLoading) return <Skeleton className="h-64 w-full" />;
  if (invQuery.isError || !inventory) {
    return (
      <EmptyState
        title={t("states.error")}
        action={
          <Button variant="outline" onClick={onBack}>
            {t("detail.back")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={inventory.name}
        description={t("inventory.detailTitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="mr-2 size-4" />
              {t("inventory.listTitle")}
            </Button>
            {canMark && (
              <Button
                variant="outline"
                size="sm"
                disabled={closeMutation.isPending}
                onClick={() => {
                  if (window.confirm(t("inventory.closeConfirm"))) closeMutation.mutate();
                }}
              >
                {t("inventory.close")}
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-3 text-sm">
        <Badge variant={isOpen ? "brand" : "muted"}>
          {t(`inventoryStatus.${inventory.status}`)}
        </Badge>
        <span>
          {t("inventory.summary.total")}: {inventory.totalItems ?? "—"}
        </span>
        <span>
          {t("inventory.summary.found")}: {inventory.foundCount ?? "—"}
        </span>
        <span>
          {t("inventory.summary.missing")}: {inventory.missingCount ?? "—"}
        </span>
        <span>
          {t("inventory.summary.notChecked")}: {inventory.notCheckedCount ?? "—"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          className="w-48"
          value={resultFilter}
          onChange={(e) => {
            setResultFilter(e.target.value as AssetInventoryItemResultDto | "");
            setPage(1);
          }}
          aria-label={t("inventory.columns.result")}
        >
          <option value="">{t("list.filterAll")}</option>
          <option value="Found">{t("inventoryResult.Found")}</option>
          <option value="Missing">{t("inventoryResult.Missing")}</option>
          <option value="Not Checked">{t("inventoryResult.Not Checked")}</option>
        </Select>

        {canMark && selected.size > 0 && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkMarkMutation.isPending}
              onClick={() => bulkMarkMutation.mutate("Found")}
            >
              {t("inventory.markFound")} ({selected.size})
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkMarkMutation.isPending}
              onClick={() => bulkMarkMutation.mutate("Missing")}
            >
              {t("inventory.markMissing")} ({selected.size})
            </Button>
          </>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      {itemsQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <EmptyState title={t("inventory.emptyItems")} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
              {canMark && (
                <input
                  type="checkbox"
                  checked={selected.has(it.id)}
                  onChange={() => toggle(it.id)}
                  aria-label={it.assetCode}
                />
              )}
              <span className="font-mono text-xs">{it.assetCode}</span>
              <span className="font-medium">{it.assetName}</span>
              <AssetInventoryResultBadge result={it.result} />
              <span className="ml-auto flex items-center gap-2">
                {canMark && it.result !== "Found" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={markOneMutation.isPending}
                    onClick={() => markOneMutation.mutate({ itemId: it.id, result: "Found" })}
                  >
                    {t("inventoryResult.Found")}
                  </Button>
                )}
                {canMark && it.result !== "Missing" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={markOneMutation.isPending}
                    onClick={() => markOneMutation.mutate({ itemId: it.id, result: "Missing" })}
                  >
                    {t("inventoryResult.Missing")}
                  </Button>
                )}
                {/* Dòng Missing chỉ ĐIỀU HƯỚNG sang chi tiết tài sản — kiểm kê KHÔNG tự đổi trạng
                    thái (ASSET-FUNC-010); ghi nhận mất là quyết định của người có dispose:asset. */}
                {it.result === "Missing" && (
                  <Button size="sm" variant="outline" onClick={() => onOpenAsset(it.assetId)}>
                    {t("actions.markLost")}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <p className="text-xs text-muted-foreground">{t("inventory.missingHint")}</p>
      )}
    </div>
  );
}
