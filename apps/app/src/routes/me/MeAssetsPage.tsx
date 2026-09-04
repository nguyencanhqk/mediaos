import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { assetApi, meKeys, useCan } from "@mediaos/web-core";
import { Badge, Button, EmptyState, PageHeader, PaginationFooter, Skeleton } from "@mediaos/ui";
import { ASSET_ENGINE_PAIRS, ASSET_PAGE_SIZE } from "@/routes/assets/constants";
import { AssetStatusBadge } from "@/routes/assets/components/AssetStatusBadge";

/**
 * ASSET-SCREEN-006 (S11-ASSET-FE-1) — «Tài sản của tôi», gắn khu vực ME (`/me/assets`).
 *
 * Endpoint `GET /me/assets` **không nhận tham số nhân viên** — chủ thể resolve từ token (chống IDOR),
 * nên trang này KHÔNG có bộ chọn người và cũng không được thêm.
 *
 * Người dùng **không có employee profile** ⇒ server trả danh sách RỖNG, KHÔNG lỗi (SPEC-13 §12). Vì
 * thế trạng thái rỗng ở đây là một câu trả lời hợp lệ, không phải dấu hiệu hỏng — không hiện nút
 * "thử lại" như lỗi mạng.
 *
 * **Không có trường tài chính** ở màn này, bất kể data_scope của người xem: `meAssetItemResponseSchema`
 * không khai chúng, kể cả company-admin gọi cũng không thấy giá (SPEC-13 §18). Đó là quyết định của
 * hợp đồng, không phải masking theo scope — nên ở đây không có nhánh `=== undefined` nào cả.
 */
export function MeAssetsPage() {
  const { t } = useTranslation("assets");
  const canView = useCan(ASSET_ENGINE_PAIRS.VIEW.action, ASSET_ENGINE_PAIRS.VIEW.resourceType);

  const [includeReturned, setIncludeReturned] = useState(false);
  const [page, setPage] = useState(1);

  const params = { includeReturned, page, per_page: ASSET_PAGE_SIZE };
  const query = useQuery({
    queryKey: meKeys.assets(params),
    queryFn: () => assetApi.listMyAssets(params),
    enabled: canView,
  });

  const rows = query.data?.data ?? [];
  const total = query.data?.pagination?.total ?? rows.length;
  const lastPage = Math.max(1, Math.ceil(total / ASSET_PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader title={t("me.title")} />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeReturned}
          onChange={(e) => {
            setIncludeReturned(e.target.checked);
            setPage(1);
          }}
        />
        {t("me.showReturned")}
      </label>

      {query.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : query.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        // Rỗng = câu trả lời hợp lệ (chưa được cấp gì, hoặc chưa có hồ sơ nhân viên) — KHÔNG phải lỗi.
        <EmptyState title={includeReturned ? t("me.emptyReturned") : t("me.empty")} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((a) => (
            <li
              key={a.assignmentId}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
            >
              <span className="font-mono text-xs text-muted-foreground">{a.assetCode}</span>
              <span className="font-medium">{a.assetName}</span>
              <span className="text-muted-foreground">{a.category.name}</span>
              <AssetStatusBadge status={a.assetStatus} />
              <Badge variant={a.assignmentStatus === "Active" ? "brand" : "muted"}>
                {a.assignmentStatus === "Active" ? t("me.holding") : t("me.returned")}
              </Badge>
              <span className="ml-auto text-xs text-muted-foreground">
                {a.assignedAt}
                {a.returnedAt ? ` → ${a.returnedAt}` : ""}
                {a.expectedReturnDate && a.assignmentStatus === "Active"
                  ? ` · ${t("assign.expectedReturnDate")}: ${a.expectedReturnDate}`
                  : ""}
              </span>
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
    </div>
  );
}
