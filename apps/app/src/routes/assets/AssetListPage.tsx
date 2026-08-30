import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw, Settings2, Wrench } from "lucide-react";
import { assetApi, assetKeys, useCan } from "@mediaos/web-core";
import type { AssetListItemResponseDto, AssetLifecycleStatusDto } from "@mediaos/contracts";
import { Button, DataTable, EmptyState, Input, PageHeader, Select } from "@mediaos/ui";
import { ASSET_ENGINE_PAIRS, ASSET_PAGE_SIZE, ASSET_STATUS_OPTIONS } from "./constants";
import { AssetStatusBadge } from "./components/AssetStatusBadge";
import { AssetCategoryDialog } from "./components/AssetCategoryDialog";

interface AssetFilters {
  q: string;
  categoryId: string;
  status: AssetLifecycleStatusDto | "";
}

const EMPTY_FILTERS: AssetFilters = { q: "", categoryId: "", status: "" };

/**
 * ASSET-SCREEN-001 (S11-ASSET-FE-1) — danh sách tài sản.
 *
 * Gate route = `access:asset` + `view:asset` (ProtectedRoute); trang tự gate lại từng nút:
 * `create:asset` cho «Thêm tài sản», `manage:asset-category` cho «Quản trị loại» (ASSET-SCREEN-007 là
 * hộp thoại TRONG màn này, không phải route riêng — SPEC-13 §9).
 *
 * Bộ lọc đi SERVER hết (`categoryId`/`status`/`q`) — data_scope ép ở service layer, nên lọc client
 * trên tập đã tải sẽ cho kết quả khác với phân trang của server.
 *
 * Dòng «sắp đến hạn bảo trì» đọc từ `GET /assets/summary` — CÙNG cửa sổ (`due ≤ hôm nay + 7`) với job
 * `ASSET_MAINTENANCE_DUE`, nên con số ở đây khớp số thông báo người dùng nhận.
 */
export function AssetListPage() {
  const { t } = useTranslation("assets");
  const navigate = useNavigate();

  const canView = useCan(ASSET_ENGINE_PAIRS.VIEW.action, ASSET_ENGINE_PAIRS.VIEW.resourceType);
  const canCreate = useCan(
    ASSET_ENGINE_PAIRS.CREATE.action,
    ASSET_ENGINE_PAIRS.CREATE.resourceType,
  );
  const canManageCategory = useCan(
    ASSET_ENGINE_PAIRS.MANAGE_CATEGORY.action,
    ASSET_ENGINE_PAIRS.MANAGE_CATEGORY.resourceType,
  );

  const [filters, setFilters] = useState<AssetFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);

  const setFilter = <K extends keyof AssetFilters>(key: K, value: AssetFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    // Đổi bộ lọc phải về trang 1: giữ nguyên `page` sẽ hỏi server một trang không còn tồn tại và
    // người dùng thấy bảng rỗng dù có kết quả.
    setPage(1);
  };

  const hasFilters = filters.q !== "" || filters.categoryId !== "" || filters.status !== "";

  // Danh mục loại cho dropdown lọc — đi theo `view:asset` (SPEC-13 §11: `manage:asset-category` chỉ
  // gate GHI). fail-soft: lỗi ⇒ không có option, bộ lọc vẫn dùng được ở mức "tất cả".
  const { data: categories } = useQuery({
    queryKey: assetKeys.categories.list(),
    queryFn: () => assetApi.listCategories(),
    enabled: canView,
    staleTime: 300_000,
  });

  const listParams = useMemo(
    () => ({
      ...(filters.q ? { q: filters.q } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.status ? { status: [filters.status] } : {}),
      page,
      per_page: ASSET_PAGE_SIZE,
    }),
    [filters, page],
  );

  const listQuery = useQuery({
    queryKey: assetKeys.list(listParams),
    queryFn: () => assetApi.listAssets(listParams),
    enabled: canView,
  });

  const summaryQuery = useQuery({
    queryKey: assetKeys.summary(),
    queryFn: () => assetApi.getSummary(),
    enabled: canView,
    staleTime: 60_000,
  });

  const rows = listQuery.data?.data ?? [];
  const pagination = listQuery.data?.pagination;
  const total = pagination?.total ?? rows.length;
  const lastPage = Math.max(1, Math.ceil(total / ASSET_PAGE_SIZE));

  const columns = useMemo<ColumnDef<AssetListItemResponseDto>[]>(
    () => [
      {
        accessorKey: "assetCode",
        header: t("list.columns.assetCode"),
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.assetCode}</span>,
      },
      { accessorKey: "name", header: t("list.columns.name") },
      {
        id: "category",
        header: t("list.columns.category"),
        accessorFn: (r) => r.category.name,
      },
      {
        accessorKey: "status",
        header: t("list.columns.status"),
        cell: ({ row }) => <AssetStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "serialNumber",
        header: t("list.columns.serialNumber"),
        cell: ({ row }) => row.original.serialNumber ?? "—",
      },
      {
        id: "holder",
        header: t("list.columns.holder"),
        // `currentHolder` VẮNG KHOÁ khi người giữ ngoài scope danh tính của người xem (contracts khai
        // `.optional()`, không `null`) — hiển thị "—" cho cả hai ca, KHÔNG lộ rằng "có người giữ nhưng
        // bạn không được biết là ai": đó là một oracle rò rỉ nhân sự.
        accessorFn: (r) => r.currentHolder?.fullName ?? "—",
      },
      {
        accessorKey: "nextMaintenanceDue",
        header: t("list.columns.nextMaintenanceDue"),
        cell: ({ row }) => row.original.nextMaintenanceDue ?? "—",
      },
    ],
    [t],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("list.title")}
        description={t("description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void listQuery.refetch()}
              disabled={listQuery.isFetching}
            >
              <RefreshCw className="mr-2 size-4" />
              {t("states.retry")}
            </Button>
            {canManageCategory && (
              <Button variant="outline" size="sm" onClick={() => setCategoryDialogOpen(true)}>
                <Settings2 className="mr-2 size-4" />
                {t("list.manageCategories")}
              </Button>
            )}
            {canCreate && (
              <Button size="sm" onClick={() => void navigate({ to: "/assets/new" as "/" })}>
                <Plus className="mr-2 size-4" />
                {t("list.create")}
              </Button>
            )}
          </div>
        }
      />

      {summaryQuery.data && summaryQuery.data.maintenanceDueSoon > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-muted px-4 py-3 text-sm text-warning">
          <Wrench className="size-4 shrink-0" />
          {t("list.maintenanceDueSoon", { count: summaryQuery.data.maintenanceDueSoon })}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Input
            placeholder={t("list.searchPlaceholder")}
            value={filters.q}
            onChange={(e) => setFilter("q", e.target.value)}
          />
        </div>
        <Select
          className="w-48"
          value={filters.categoryId}
          onChange={(e) => setFilter("categoryId", e.target.value)}
          aria-label={t("list.filterCategory")}
        >
          <option value="">{t("list.filterAll")}</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-48"
          value={filters.status}
          onChange={(e) => setFilter("status", e.target.value as AssetLifecycleStatusDto | "")}
          aria-label={t("list.filterStatus")}
        >
          <option value="">{t("list.filterAll")}</option>
          {ASSET_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setPage(1);
            }}
          >
            {t("list.clearFilters")}
          </Button>
        )}
      </div>

      {listQuery.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void listQuery.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={rows}
            isLoading={listQuery.isLoading}
            pageSize={ASSET_PAGE_SIZE}
            onRowClick={(row) =>
              void navigate({ to: "/assets/$assetId" as "/", params: { assetId: row.id } as never })
            }
            emptyState={
              <EmptyState
                title={hasFilters ? t("list.emptyFiltered") : t("list.empty")}
                action={
                  canCreate && !hasFilters ? (
                    <Button onClick={() => void navigate({ to: "/assets/new" as "/" })}>
                      <Plus className="mr-2 size-4" />
                      {t("list.create")}
                    </Button>
                  ) : undefined
                }
              />
            }
          />

          {lastPage > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">
                {page} / {lastPage}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || listQuery.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= lastPage || listQuery.isFetching}
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
              >
                ›
              </Button>
            </div>
          )}
        </>
      )}

      {canManageCategory && (
        <AssetCategoryDialog open={categoryDialogOpen} onClose={() => setCategoryDialogOpen(false)} />
      )}
    </div>
  );
}
