/**
 * OrgChartNode — 1 node đệ quy của SƠ ĐỒ tổ chức đồ hoạ (S5-HR-ORGCHART-FE-1/FE-2).
 *
 * Mỗi đơn vị = 1 HỘP: tên · mã · loại · trạng thái · TRƯỞNG ĐƠN VỊ (headUserName) + danh sách THÀNH VIÊN
 * mà trưởng đơn vị quản lý (nhân viên thuộc phòng, trừ chính trưởng phòng). org-chart.css vẽ đường nối
 * hộp cha ↔ hộp con.
 *
 * S5-HR-ORGCHART-FE-2: mỗi người (trưởng + thành viên) có nút hành động ĐỔI QUẢN LÝ / CHUYỂN PHÒNG khi
 * actor có quyền update:employee (page truyền callback; thiếu quyền → không render nút).
 *
 * Cấu trúc PHẢI là <li><div box/><ul>…children…</ul></li> để CSS connector khớp.
 */
import { useTranslation } from "react-i18next";
import { ArrowRightLeft, Crown, UserCog, UserPlus } from "lucide-react";
import type { OrgTreeNode } from "@mediaos/web-core";
import { Avatar, Badge } from "@mediaos/ui";
import type { UnitMember } from "./members-by-unit";

const ORG_UNIT_STATUS_VARIANT: Record<string, "success" | "muted" | "warning"> = {
  active: "success",
  Active: "success",
  inactive: "muted",
  Inactive: "muted",
};

export interface PersonEditHandlers {
  onAssignManager: (target: UnitMember) => void;
  onMoveDept: (target: UnitMember) => void;
  /** Thêm 1 nhân viên có sẵn (kể cả người chưa phân phòng) vào phòng ban này. */
  onAddToDept: (dept: { id: string; name: string }) => void;
}

interface OrgChartNodeProps {
  node: OrgTreeNode;
  /** Thành viên theo tên đơn vị (đã gom ở page). Undefined khi actor không có quyền xem nhân sự. */
  membersByUnit?: Map<string, UnitMember[]>;
  /** Callback hành động sửa nhân sự — chỉ có khi actor có quyền update:employee. */
  edit?: PersonEditHandlers;
  /** Đặt/đổi/gỡ TRƯỞNG ĐƠN VỊ — chỉ có khi actor có quyền update:department (gate ở page). */
  onSetHead?: (dept: { id: string; name: string; headUserName: string | null }) => void;
}

/** Cụm 2 nút nhỏ (đổi quản lý / chuyển phòng) cho 1 người. */
function PersonActions({ target, edit }: { target: UnitMember; edit: PersonEditHandlers }) {
  const { t } = useTranslation("hr");
  const btn =
    "flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        className={btn}
        title={t("orgChart.actions.assignManager")}
        aria-label={t("orgChart.actions.assignManager")}
        onClick={() => edit.onAssignManager(target)}
      >
        <UserCog className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={btn}
        title={t("orgChart.actions.moveDept")}
        aria-label={t("orgChart.actions.moveDept")}
        onClick={() => edit.onMoveDept(target)}
      >
        <ArrowRightLeft className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function OrgChartNode({ node, membersByUnit, edit, onSetHead }: OrgChartNodeProps) {
  const { t } = useTranslation("hr");
  const hasChildren = node.children.length > 0;
  const statusVariant = ORG_UNIT_STATUS_VARIANT[node.status] ?? "muted";
  const typeLabel = t(`orgChart.unitType.${node.type}`, { defaultValue: node.type });
  const statusLabel = t(`orgChart.status.${node.status}`, { defaultValue: node.status });

  const allMembers = membersByUnit?.get(node.name) ?? [];
  // Trưởng đơn vị dưới dạng record nhân viên (khớp theo tên) → để hành động sửa cũng áp cho trưởng phòng.
  const headMember = node.headUserName
    ? allMembers.find((m) => m.displayName === node.headUserName)
    : undefined;
  // Thành viên = nhân viên trong phòng, TRỪ trưởng đơn vị (đã hiện ở dòng head).
  const members = node.headUserName
    ? allMembers.filter((m) => m.displayName !== node.headUserName)
    : allMembers;

  return (
    <li role="treeitem">
      <div className="inline-flex min-w-[212px] max-w-[276px] flex-col gap-1.5 rounded-xl border border-border bg-card px-4 py-3 text-left shadow-sm transition-colors hover:border-brand/60">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm leading-tight font-semibold text-foreground">{node.name}</span>
          <Badge variant={statusVariant} className="shrink-0">
            {statusLabel}
          </Badge>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {node.code && <span className="font-mono">{node.code}</span>}
          <span>{typeLabel}</span>
        </div>

        {node.headUserName && (
          <div className="mt-1 flex items-center gap-2 border-t border-border/60 pt-2">
            <Avatar name={node.headUserName} src={headMember?.avatarUrl} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-foreground">
                {node.headUserName}
              </div>
              <div className="text-[11px] text-muted-foreground">{t("orgChart.headLabel")}</div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {onSetHead && (
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  title={t("orgChart.actions.changeHead")}
                  aria-label={t("orgChart.actions.changeHead")}
                  onClick={() =>
                    onSetHead({
                      id: node.id,
                      name: node.name,
                      headUserName: node.headUserName ?? null,
                    })
                  }
                >
                  <Crown className="h-3.5 w-3.5" />
                </button>
              )}
              {edit && headMember && <PersonActions target={headMember} edit={edit} />}
            </div>
          </div>
        )}

        {onSetHead && !node.headUserName && (
          <button
            type="button"
            onClick={() => onSetHead({ id: node.id, name: node.name, headUserName: null })}
            className="mt-1 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-1.5 text-xs font-medium text-muted-foreground hover:border-brand/60 hover:text-foreground"
          >
            <Crown className="h-3.5 w-3.5" />
            {t("orgChart.actions.setHead")}
          </button>
        )}

        {members.length > 0 && (
          <div className="mt-1 border-t border-border/60 pt-2">
            <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {t("orgChart.membersLabel", { count: members.length })}
            </div>
            <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
              {members.map((m) => (
                <li key={m.employeeId} className="flex items-center gap-2">
                  <Avatar name={m.displayName} src={m.avatarUrl} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-foreground">
                      {m.displayName ?? t("orgChart.unnamedMember")}
                    </div>
                    {m.positionName && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {m.positionName}
                      </div>
                    )}
                  </div>
                  {edit && <PersonActions target={m} edit={edit} />}
                </li>
              ))}
            </ul>
          </div>
        )}

        {edit && (
          <button
            type="button"
            onClick={() => edit.onAddToDept({ id: node.id, name: node.name })}
            className="mt-1 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-1.5 text-xs font-medium text-muted-foreground hover:border-brand/60 hover:text-foreground"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {t("orgChart.actions.addToDept")}
          </button>
        )}
      </div>

      {hasChildren && (
        <ul role="group">
          {node.children.map((child) => (
            <OrgChartNode
              key={child.id}
              node={child}
              membersByUnit={membersByUnit}
              edit={edit}
              onSetHead={onSetHead}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
