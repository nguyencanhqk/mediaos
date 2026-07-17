/**
 * MeSecurityActivityPage — ME-SCREEN-008 "Hoạt động bảo mật" (SPEC-09 §8.1/§10.6, route
 * "/me/security/activity", S5-ME-FE-2).
 *
 * Đọc DUY NHẤT `GET /me/security/activity` (meApi.getSecurityActivity, S5-ME-BE-3 — hợp nhất login_logs +
 * user_security_events CỦA CHÍNH user, owner resolve 100% từ token). Bảng READ-ONLY (KHÔNG nút sửa/xoá) —
 * cột thời gian · loại sự kiện · thiết bị · IP (đã mask), phân trang server-side page/per_page (full-page
 * heuristic — total KHÔNG khả dụng ở client, mirror NotificationDeliveryLogsPage/FileAccessLogsPage).
 *
 * BẤT BIẾN #3 (masking là việc của SERVER) + SPEC-09 §17.1: component CHỈ render field server trả
 * (`ipMasked`/`device` đã rút gọn/mask sẵn) — TUYỆT ĐỐI KHÔNG unmask/tái dựng raw IP hay User-Agent,
 * KHÔNG hiển thị metadata/payload/email (những field đó KHÔNG có trong meSecurityActivityItemSchema nên
 * component không thể vô tình render chúng).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { meApi, meKeys, useCan } from "@mediaos/web-core";
import {
  ME_SECURITY_ACTIVITY_PAGE_SIZE_DEFAULT,
  type MeSecurityActivityItem,
} from "@mediaos/contracts";
import { Button, DataTable, EmptyState, PageHeader } from "@mediaos/ui";
import { AuthLogPagination } from "@/routes/system/auth-logs/AuthLogControls";
import { ME_ACCESS_PAIR } from "./constants";

function useColumns(
  t: ReturnType<typeof useTranslation<"me">>["t"],
): ColumnDef<MeSecurityActivityItem>[] {
  return [
    {
      accessorKey: "createdAt",
      header: t("securityActivity.columns.time"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {new Date(row.original.createdAt).toLocaleString("vi-VN")}
        </span>
      ),
    },
    {
      accessorKey: "eventType",
      header: t("securityActivity.columns.eventType"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-foreground">{row.original.eventType}</span>
      ),
    },
    {
      accessorKey: "device",
      header: t("securityActivity.columns.device"),
      // `device` = nhãn rút gọn server đã map (vd "Chrome trên Windows") — KHÔNG raw User-Agent.
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.device ?? "—"}</span>
      ),
    },
    {
      accessorKey: "ipMasked",
      header: t("securityActivity.columns.ip"),
      // `ipMasked` = IP ĐÃ mask server-side (§10.6) — component KHÔNG unmask/tái dựng raw IP.
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.ipMasked ?? "—"}
        </span>
      ),
    },
  ];
}

function MeSecurityActivityPageInner() {
  const { t } = useTranslation("me");
  const { t: tc } = useTranslation("common");
  const [page, setPage] = useState(1);
  const pageSize = ME_SECURITY_ACTIVITY_PAGE_SIZE_DEFAULT;

  const queryParams = { page, per_page: pageSize };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: meKeys.securityActivity(queryParams),
    queryFn: () => meApi.getSecurityActivity(queryParams),
    staleTime: 30_000,
  });

  const columns = useColumns(t);

  // ── Error (transport/parse) ─────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("securityActivity.title")}
          description={t("securityActivity.description")}
          icon={ShieldAlert}
        />
        <div className="mt-8">
          <EmptyState
            title={t("securityActivity.error.title")}
            description={t("securityActivity.error.description")}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const items = data ?? [];

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("securityActivity.title")}
        description={t("securityActivity.description")}
        icon={ShieldAlert}
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("securityActivity.empty.title")}
            description={t("securityActivity.empty.description")}
          />
        }
        pageSize={pageSize}
      />

      <AuthLogPagination
        page={page}
        currentCount={items.length}
        pageSize={pageSize}
        onPageChange={setPage}
      />
    </div>
  );
}

export function MeSecurityActivityPage() {
  const { t } = useTranslation("me");
  const canAccess = useCan(ME_ACCESS_PAIR.action, ME_ACCESS_PAIR.resourceType);

  if (!canAccess) {
    return (
      <div className="p-6">
        <EmptyState title={t("forbidden.title")} description={t("forbidden.description")} />
      </div>
    );
  }

  return <MeSecurityActivityPageInner />;
}
