/**
 * S16-SOCIAL-FE-3B (L4) — bảng huy hiệu của màn Thiết lập huy hiệu (`SOC-SCREEN-012`, nguồn `SOCIAL-API-056`).
 * `<table>` thuần trong khung cuộn ngang (plan D9) — không kéo `DataTable`.
 *
 * Chỉ TRÌNH BÀY: không state, không lời gọi, không quyền (route đã gác `manage:feed-kudos`, và cả bốn route
 * của màn chung cặp đó — plan M7). Trang sở hữu: trạng thái tải / lỗi / rỗng, phân trang, hộp thoại sửa, xác
 * nhận «Ngừng dùng» và hai lượt ghi 051 / 050.
 *
 *  · `onEdit` / `onDeactivate` / `onReactivate` nhận CHÍNH huy hiệu của hàng.
 *  · `isBusy` — trang đang có một lượt «Ngừng dùng» / «Bật lại» bay ⇒ khoá hai nút đó ở MỌI hàng (050 / 051
 *    không idempotent ở server — plan D20 · B23). «Sửa» vẫn mở: hộp thoại có khoá riêng.
 *  · Hàng mang `data-active` để trang / ca test nhận diện huy hiệu đã tắt mà không phải đọc chữ.
 *
 * Icon vẽ bằng `KudosBadgeIcon` — nó tra tên bằng `Object.hasOwn`, nên một huy hiệu mang icon `constructor`
 * không làm sập bảng (bài học ở docblock của file đó).
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Button, cn } from "@mediaos/ui";
import type { KudosBadgeAdminDto } from "@mediaos/contracts";
import { KudosBadgeIcon } from "../../kudos/components/KudosBadgeIcon";

export interface BadgeTableProps {
  badges: readonly KudosBadgeAdminDto[];
  /** Một lượt «Ngừng dùng» / «Bật lại» đang bay ⇒ khoá hai nút đó ở mọi hàng. Mặc định `false`. */
  isBusy?: boolean;
  onEdit: (badge: KudosBadgeAdminDto) => void;
  onDeactivate: (badge: KudosBadgeAdminDto) => void;
  onReactivate: (badge: KudosBadgeAdminDto) => void;
}

const COLUMNS = ["badge", "code", "description", "position", "status", "actions"] as const;

const CELL = "px-3 py-2 align-top";

interface BadgeRowProps extends Omit<BadgeTableProps, "badges"> {
  badge: KudosBadgeAdminDto;
}

function BadgeRow({
  badge,
  isBusy = false,
  onEdit,
  onDeactivate,
  onReactivate,
}: BadgeRowProps): React.ReactElement {
  const { t } = useTranslation("social");
  const name = badge.name;

  return (
    <tr
      data-testid="badge-row"
      data-active={badge.isActive}
      className={cn("border-t border-border", !badge.isActive && "text-muted-foreground")}
    >
      <th scope="row" className={cn(CELL, "text-left font-medium text-foreground")}>
        <span className="flex items-center gap-2">
          <KudosBadgeIcon icon={badge.icon} className="shrink-0" />
          <span>{name}</span>
        </span>
      </th>
      <td className={cn(CELL, "font-mono text-xs")}>{badge.code}</td>
      <td className={cn(CELL, "whitespace-pre-line")}>
        {badge.description ?? (
          <span className="text-muted-foreground">{t("admin.badges.table.noDescription")}</span>
        )}
      </td>
      <td className={cn(CELL, "text-right tabular-nums")}>{badge.position}</td>
      <td className={CELL}>
        <span
          data-testid="badge-status"
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
            badge.isActive ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
          )}
        >
          {t(`admin.badges.table.status.${badge.isActive ? "active" : "inactive"}`)}
        </span>
      </td>
      <td className={CELL}>
        <span className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("admin.badges.table.editAria", { name })}
            onClick={() => onEdit(badge)}
          >
            {t("admin.badges.table.edit")}
          </Button>
          {badge.isActive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              aria-label={t("admin.badges.table.deactivateAria", { name })}
              onClick={() => onDeactivate(badge)}
            >
              {t("admin.badges.table.deactivate")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              aria-label={t("admin.badges.table.reactivateAria", { name })}
              onClick={() => onReactivate(badge)}
            >
              {t("admin.badges.table.reactivate")}
            </Button>
          )}
        </span>
      </td>
    </tr>
  );
}

export function BadgeTable({ badges, ...rowProps }: BadgeTableProps): React.ReactElement {
  const { t } = useTranslation("social");

  return (
    <div className="overflow-x-auto rounded-lg border border-border" data-testid="badge-table">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">{t("admin.badges.table.caption")}</caption>
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column}
                scope="col"
                className={cn("px-3 py-2 font-medium", column === "position" && "text-right")}
              >
                {t(`admin.badges.table.column.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {badges.map((badge) => (
            <BadgeRow key={badge.id} badge={badge} {...rowProps} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
