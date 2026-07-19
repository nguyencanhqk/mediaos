import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import { Card } from "@mediaos/ui";

/**
 * ProjectRoleLegend — S5-TASK-PROJROLE-1 (đợt C, DECISIONS-04 §D-24). Khối chú giải TĨNH mô tả 4
 * vai trò trong dự án (Owner/Manager/Member/Viewer) — nội dung CHỈ để đọc, KHÔNG đọc quyền client
 * (masking/enforcement là việc của SERVER — xem ProjectAccessService). Ghép cứng theo bảng D-24
 * (docs/DECISIONS/DECISIONS-04_Task_Per_Project_Role.md), không nhận prop role thật.
 */
type LegendMark = "yes" | "no" | "assignee";

const LEGEND_ROWS: ReadonlyArray<{
  key: string;
  viewer: LegendMark;
  member: LegendMark;
  manager: LegendMark;
  owner: LegendMark;
}> = [
  { key: "view", viewer: "yes", member: "yes", manager: "yes", owner: "yes" },
  { key: "watch", viewer: "yes", member: "yes", manager: "yes", owner: "yes" },
  { key: "collab", viewer: "no", member: "yes", manager: "yes", owner: "yes" },
  { key: "editOwnTask", viewer: "assignee", member: "yes", manager: "yes", owner: "yes" },
  { key: "editOthersTask", viewer: "no", member: "no", manager: "yes", owner: "yes" },
  { key: "createTask", viewer: "no", member: "no", manager: "yes", owner: "yes" },
  { key: "manageColumns", viewer: "no", member: "no", manager: "yes", owner: "yes" },
  { key: "editProject", viewer: "no", member: "no", manager: "yes", owner: "yes" },
  { key: "governance", viewer: "no", member: "no", manager: "no", owner: "yes" },
];

function LegendMarkIcon({ mark }: { mark: LegendMark }) {
  const { t } = useTranslation("tasks");
  if (mark === "yes") {
    return (
      <Check
        className="mx-auto h-4 w-4 text-brand"
        aria-label={t("projects.members.roleLegend.mark.yes")}
      />
    );
  }
  if (mark === "assignee") {
    return (
      <span className="block text-center text-xs text-muted-foreground">
        {t("projects.members.roleLegend.mark.assignee")}
      </span>
    );
  }
  return (
    <X
      className="mx-auto h-4 w-4 text-muted-foreground/40"
      aria-label={t("projects.members.roleLegend.mark.no")}
    />
  );
}

export function ProjectRoleLegend() {
  const { t } = useTranslation("tasks");
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {t("projects.members.roleLegend.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("projects.members.roleLegend.description")}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-1.5 pr-2 text-left font-medium">
                {t("projects.members.roleLegend.columns.action")}
              </th>
              <th className="px-2 py-1.5 font-medium">
                {t("projects.members.roleLegend.columns.viewer")}
              </th>
              <th className="px-2 py-1.5 font-medium">
                {t("projects.members.roleLegend.columns.member")}
              </th>
              <th className="px-2 py-1.5 font-medium">
                {t("projects.members.roleLegend.columns.manager")}
              </th>
              <th className="px-2 py-1.5 font-medium">
                {t("projects.members.roleLegend.columns.owner")}
              </th>
            </tr>
          </thead>
          <tbody>
            {LEGEND_ROWS.map((row) => (
              <tr key={row.key} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 pr-2 text-foreground">
                  {t(`projects.members.roleLegend.rows.${row.key}`)}
                </td>
                <td className="px-2 py-1.5">
                  <LegendMarkIcon mark={row.viewer} />
                </td>
                <td className="px-2 py-1.5">
                  <LegendMarkIcon mark={row.member} />
                </td>
                <td className="px-2 py-1.5">
                  <LegendMarkIcon mark={row.manager} />
                </td>
                <td className="px-2 py-1.5">
                  <LegendMarkIcon mark={row.owner} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
