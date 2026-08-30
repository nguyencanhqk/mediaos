import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { assetApi, assetKeys, useCan } from "@mediaos/web-core";
import {
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@mediaos/ui";
import { ASSET_ENGINE_PAIRS } from "./constants";
import { availableAssetActions, type AssetAction } from "./asset-actions";
import { AssetStatusBadge, AssetAssignmentStatusBadge } from "./components/AssetStatusBadge";
import { AssetQrCode } from "./components/AssetQrCode";
import { AssetAssignDialog } from "./components/AssetAssignDialog";
import { AssetRevokeDialog } from "./components/AssetRevokeDialog";
import { AssetDisposeDialog, type AssetDisposeMode } from "./components/AssetDisposeDialog";
import { AssetMaintenanceDialog } from "./components/AssetMaintenanceDialog";

interface AssetDetailPageProps {
  assetId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

type OpenDialog =
  | { kind: "none" }
  | { kind: "assign" }
  | { kind: "revoke" }
  | { kind: "dispose"; mode: AssetDisposeMode }
  | { kind: "maintenance"; openMaintenanceId: string | null };

/**
 * ASSET-SCREEN-002 (S11-ASSET-FE-1) — chi tiết tài sản: QR + 3 tab (Thông tin ‖ Lịch sử cấp phát ‖
 * Bảo trì) + thanh hành động theo **FSM ∩ quyền**.
 *
 * Thanh hành động KHÔNG tự dựng ở đây — nó gọi `availableAssetActions()` (thuần, có spec 47 ca). Đó là
 * cách giữ đúng SPEC-13 §14 "nút không hiện thay vì hiện rồi 409": logic ẩn/hiện phải test được mà
 * không cần dựng DOM, nếu không nó sẽ trôi mỗi lần ai đó sửa giao diện. Hàm lọc 9 phần tử nên gọi
 * thẳng mỗi render — rẻ hơn nhiều so với chi phí giữ một `useMemo` có danh sách phụ thuộc dễ sai.
 *
 * Trường tài chính (`purchasePrice`/`supplier`) VẮNG KHOÁ khi scope hiệu dụng < Company — render có
 * điều kiện trên `=== undefined`, KHÔNG hiện hàng với dấu "—": hiện hàng trống là nói với người dùng
 * "có dữ liệu ở đây mà bạn không được xem", tức vẫn rò rỉ sự tồn tại. `null` thì NGƯỢC LẠI: server
 * cho xem và giá trị thật là rỗng ⇒ hiện "—".
 */
export function AssetDetailPage({ assetId, onBack, onEdit }: AssetDetailPageProps) {
  const { t } = useTranslation("assets");
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<OpenDialog>({ kind: "none" });
  const [tab, setTab] = useState("info");

  const canUpdate = useCan(
    ASSET_ENGINE_PAIRS.UPDATE.action,
    ASSET_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const canDelete = useCan(
    ASSET_ENGINE_PAIRS.DELETE.action,
    ASSET_ENGINE_PAIRS.DELETE.resourceType,
  );
  const canAssign = useCan(
    ASSET_ENGINE_PAIRS.ASSIGN.action,
    ASSET_ENGINE_PAIRS.ASSIGN.resourceType,
  );
  const canRevoke = useCan(
    ASSET_ENGINE_PAIRS.REVOKE.action,
    ASSET_ENGINE_PAIRS.REVOKE.resourceType,
  );
  const canDispose = useCan(
    ASSET_ENGINE_PAIRS.DISPOSE.action,
    ASSET_ENGINE_PAIRS.DISPOSE.resourceType,
  );
  const canManageMaintenance = useCan(
    ASSET_ENGINE_PAIRS.MANAGE_MAINTENANCE.action,
    ASSET_ENGINE_PAIRS.MANAGE_MAINTENANCE.resourceType,
  );
  const canCreate = useCan(
    ASSET_ENGINE_PAIRS.CREATE.action,
    ASSET_ENGINE_PAIRS.CREATE.resourceType,
  );

  const detailQuery = useQuery({
    queryKey: assetKeys.detail(assetId),
    queryFn: () => assetApi.getAsset(assetId),
  });
  const asset = detailQuery.data;

  const assignmentsQuery = useQuery({
    queryKey: assetKeys.assignments(assetId, { page: 1 }),
    queryFn: () => assetApi.listAssignments(assetId, { page: 1 }),
    enabled: Boolean(asset),
  });

  const maintenancesQuery = useQuery({
    queryKey: assetKeys.maintenances(assetId, { page: 1 }),
    queryFn: () => assetApi.listMaintenances(assetId, { page: 1 }),
    enabled: Boolean(asset),
  });

  const actions: readonly AssetAction[] = asset
    ? availableAssetActions(asset, {
        canCreate,
        canUpdate,
        canDelete,
        canAssign,
        canRevoke,
        canDispose,
        canManageMaintenance,
      })
    : [];

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: assetKeys.detail(assetId) });
    void queryClient.invalidateQueries({ queryKey: assetKeys.assignmentsOf(assetId) });
    void queryClient.invalidateQueries({ queryKey: assetKeys.maintenancesOf(assetId) });
  };

  const runAction = (action: AssetAction) => {
    switch (action) {
      case "assign":
        return setDialog({ kind: "assign" });
      case "revoke":
        return setDialog({ kind: "revoke" });
      case "openMaintenance":
        return setDialog({ kind: "maintenance", openMaintenanceId: null });
      case "closeMaintenance":
        return setDialog({
          kind: "maintenance",
          openMaintenanceId: asset?.openMaintenance?.id ?? null,
        });
      case "dispose":
        return setDialog({ kind: "dispose", mode: "dispose" });
      case "markLost":
        return setDialog({ kind: "dispose", mode: "markLost" });
      case "recover":
        return setDialog({ kind: "dispose", mode: "recover" });
      case "edit":
        return onEdit(assetId);
      case "delete":
        return; // Xoá mềm đi qua màn danh sách — không có đường xoá trực tiếp ở chi tiết.
    }
  };

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (detailQuery.isError || !asset) {
    return (
      <EmptyState
        title={t("detail.notFound")}
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
        title={asset.name}
        description={asset.category.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="mr-2 size-4" />
              {t("detail.back")}
            </Button>
            <Button variant="outline" size="sm" onClick={refreshAll}>
              <RefreshCw className="mr-2 size-4" />
              {t("states.retry")}
            </Button>
            {/* Chỉ hành động ĐƯỢC PHÉP mới render — không disable, không tooltip "bạn không thể":
                nút xám vẫn là một lời mời bấm, và §14 yêu cầu KHÔNG hiện. */}
            {actions
              .filter((a) => a !== "delete")
              .map((a) => (
                <Button
                  key={a}
                  size="sm"
                  variant={a === "dispose" || a === "markLost" ? "destructive" : "outline"}
                  onClick={() => runAction(a)}
                >
                  {t(`actions.${a}`)}
                </Button>
              ))}
          </div>
        }
      />

      <div className="flex flex-wrap items-start gap-6">
        <AssetQrCode assetCode={asset.assetCode} />
        <div className="flex items-center gap-3">
          <AssetStatusBadge status={asset.status} />
          {asset.currentHolder && (
            <span className="text-sm text-muted-foreground">
              {t("detail.fields.currentHolder")}: {asset.currentHolder.fullName ?? "—"}
            </span>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="info">{t("detail.tabInfo")}</TabsTrigger>
          <TabsTrigger value="assignments">{t("detail.tabAssignments")}</TabsTrigger>
          <TabsTrigger value="maintenances">{t("detail.tabMaintenances")}</TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Field label={t("detail.fields.assetCode")} value={asset.assetCode} mono />
            <Field label={t("detail.fields.serialNumber")} value={asset.serialNumber} />
            <Field label={t("detail.fields.brand")} value={asset.brand} />
            <Field label={t("detail.fields.model")} value={asset.model} />
            <Field label={t("detail.fields.location")} value={asset.location} />
            <Field label={t("detail.fields.purchaseDate")} value={asset.purchaseDate} />
            {/* MASKED: vắng khoá ⇒ KHÔNG render hàng (xem ghi chú đầu file). */}
            {asset.purchasePrice !== undefined && (
              <Field
                label={t("detail.fields.purchasePrice")}
                value={asset.purchasePrice === null ? null : String(asset.purchasePrice)}
              />
            )}
            {asset.supplier !== undefined && (
              <Field label={t("detail.fields.supplier")} value={asset.supplier} />
            )}
            <Field label={t("detail.fields.warrantyEndDate")} value={asset.warrantyEndDate} />
            <Field
              label={t("detail.fields.nextMaintenanceDue")}
              value={asset.nextMaintenanceDue}
            />
            <Field label={t("detail.fields.conditionNote")} value={asset.conditionNote} />
            <Field label={t("detail.fields.statusReason")} value={asset.statusReason} />
            <Field label={t("detail.fields.description")} value={asset.description} />
          </dl>
        </TabsContent>

        <TabsContent value="assignments">
          <HistoryList
            isLoading={assignmentsQuery.isLoading}
            emptyLabel={t("detail.emptyAssignments")}
            items={(assignmentsQuery.data?.data ?? []).map((a) => ({
              id: a.id,
              primary: a.employeeFullName ?? "—",
              secondary: `${a.assignedAt}${a.returnedAt ? ` → ${a.returnedAt}` : ""}`,
              badge: <AssetAssignmentStatusBadge status={a.status} />,
            }))}
          />
        </TabsContent>

        <TabsContent value="maintenances">
          <HistoryList
            isLoading={maintenancesQuery.isLoading}
            emptyLabel={t("detail.emptyMaintenances")}
            items={(maintenancesQuery.data?.data ?? []).map((m) => ({
              id: m.id,
              primary: m.reason,
              secondary: `${m.openedAt}${m.closedAt ? ` → ${m.closedAt}` : ""}${
                m.vendor ? ` · ${m.vendor}` : ""
              }`,
              badge: null,
            }))}
          />
        </TabsContent>
      </Tabs>

      <AssetAssignDialog
        open={dialog.kind === "assign"}
        onClose={() => setDialog({ kind: "none" })}
        assetId={assetId}
        onAssigned={refreshAll}
      />
      <AssetRevokeDialog
        open={dialog.kind === "revoke"}
        onClose={() => setDialog({ kind: "none" })}
        assetId={assetId}
        onRevoked={refreshAll}
      />
      <AssetDisposeDialog
        open={dialog.kind === "dispose"}
        onClose={() => setDialog({ kind: "none" })}
        assetId={assetId}
        mode={dialog.kind === "dispose" ? dialog.mode : "dispose"}
        onDone={refreshAll}
      />
      <AssetMaintenanceDialog
        open={dialog.kind === "maintenance"}
        onClose={() => setDialog({ kind: "none" })}
        assetId={assetId}
        openMaintenanceId={dialog.kind === "maintenance" ? dialog.openMaintenanceId : null}
        onDone={refreshAll}
      />
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-sm" : "text-sm"}>{value ?? "—"}</dd>
    </div>
  );
}

function HistoryList({
  isLoading,
  emptyLabel,
  items,
}: {
  isLoading: boolean;
  emptyLabel: string;
  items: { id: string; primary: string; secondary: string; badge: React.ReactNode }[];
}) {
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((it) => (
        <li key={it.id} className="flex items-center gap-3 py-2 text-sm">
          <span className="font-medium">{it.primary}</span>
          <span className="text-muted-foreground">{it.secondary}</span>
          <span className="ml-auto">{it.badge}</span>
        </li>
      ))}
    </ul>
  );
}
