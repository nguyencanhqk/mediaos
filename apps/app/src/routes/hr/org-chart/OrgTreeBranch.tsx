/**
 * OrgTreeBranch — 1 nhánh đệ quy của sơ đồ tổ chức (S2-FE-HR-6). Tách khỏi OrgChartPage để giữ file
 * <400 dòng + tái dùng độc lập (test riêng). Đọc-only: không action sửa/xoá (đó là /hr/departments).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { OrgTreeNode } from "@mediaos/web-core";
import { Badge } from "@mediaos/ui";

const ORG_UNIT_STATUS_VARIANT: Record<string, "success" | "muted" | "warning"> = {
  active: "success",
  Active: "success",
  inactive: "muted",
  Inactive: "muted",
};

interface OrgTreeBranchProps {
  node: OrgTreeNode;
  depth: number;
}

export function OrgTreeBranch({ node, depth }: OrgTreeBranchProps) {
  const { t } = useTranslation("hr");
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(true);

  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 20}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? t("orgChart.collapse") : t("orgChart.expand")}
            onClick={() => setExpanded((prev) => !prev)}
            className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}

        <span className="text-sm font-medium text-foreground">{node.name}</span>
        {node.code && (
          <span className="font-mono text-xs text-muted-foreground">({node.code})</span>
        )}
        <span className="text-xs text-muted-foreground">{node.type}</span>
        {node.headUserName && (
          <span className="text-xs text-muted-foreground">
            — {t("orgChart.headLabel")}: {node.headUserName}
          </span>
        )}
        <Badge variant={ORG_UNIT_STATUS_VARIANT[node.status] ?? "muted"} className="ml-auto">
          {node.status}
        </Badge>
      </div>

      {hasChildren && expanded && (
        <ul className="space-y-1" role="group">
          {node.children.map((child) => (
            <OrgTreeBranch key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
