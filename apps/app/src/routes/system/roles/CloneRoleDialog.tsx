/**
 * S2-AUTH-PERMUX-1 (#3) — Nhân bản vai trò: tạo role mới sao chép grants ALLOW từ role nguồn.
 *
 * Flow: nhập tên → POST /auth/roles (create:role) → GET /auth/roles/:src/permissions →
 * gán TUẦN TỰ từng grant ALLOW scope ≤ Company vào role mới (assign:permission per-request —
 * server audit + anti-escalation là cổng cuối). BỎ QUA có báo rõ: grant System-scope (scope
 * ceiling của API write) + grant DENY (UI này chỉ copy ALLOW). Lỗi giữa chừng → role mới giữ
 * subset đã gán, kết quả từng dòng hiển thị để admin gán bổ sung (KHÔNG rollback phức tạp).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { roleAdminApi, ApiError } from "@mediaos/web-core";
import { Button, Dialog, Input } from "@mediaos/ui";
import { labelAction, labelResource } from "./permission-labels";

type TF = ReturnType<typeof useTranslation<"system">>["t"];

interface CloneLine {
  key: string;
  label: string;
  kind: "ok" | "skipped" | "error";
  detail?: string;
}

function cloneErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return t("rolePermissions.errors.badPair");
    if (err.status === 403) return t("rolePermissions.errors.forbidden");
    if (err.status === 409) return t("roleClone.errors.nameConflict");
    if (err.status >= 500) return t("rolePermissions.errors.server");
  }
  return t("rolePermissions.errors.generic");
}

interface CloneRoleDialogProps {
  open: boolean;
  onClose: () => void;
  sourceRoleId: string;
  sourceRoleName: string;
  /** Điều hướng sang role mới sau khi clone xong (id role mới). */
  onCloned: (newRoleId: string) => void;
}

export function CloneRoleDialog({
  open,
  onClose,
  sourceRoleId,
  sourceRoleName,
  onCloned,
}: CloneRoleDialogProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const [name, setName] = useState("");
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<CloneLine[]>([]);
  const [newRoleId, setNewRoleId] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const close = () => {
    setName("");
    setLines([]);
    setNewRoleId(null);
    setFatal(null);
    onClose();
  };

  const run = async () => {
    setRunning(true);
    setFatal(null);
    setLines([]);
    try {
      const created = await roleAdminApi.createRole({
        name: name.trim(),
        description: t("roleClone.copiedFrom", { source: sourceRoleName }),
      });
      setNewRoleId(created.id);

      const { grants } = await roleAdminApi.getRolePermissions(sourceRoleId);
      const out: CloneLine[] = [];
      for (const g of grants) {
        const key = `${g.action}:${g.resourceType}:${g.effect}`;
        const label = `${labelAction(g.action)} · ${labelResource(g.resourceType)}`;
        if (g.effect === "DENY") {
          out.push({ key, label, kind: "skipped", detail: t("roleClone.skipDeny") });
          setLines([...out]);
          continue;
        }
        if (g.dataScope === "System") {
          out.push({ key, label, kind: "skipped", detail: t("roleClone.skipSystemScope") });
          setLines([...out]);
          continue;
        }
        try {
          await roleAdminApi.assignPermission(created.id, {
            action: g.action,
            resourceType: g.resourceType,
            dataScope: g.dataScope as "Own" | "Team" | "Department" | "Company",
          });
          out.push({ key, label, kind: "ok" });
        } catch (err) {
          out.push({ key, label, kind: "error", detail: cloneErrorMessage(err, t) });
        }
        setLines([...out]);
      }
    } catch (err) {
      setFatal(cloneErrorMessage(err, t));
    }
    setRunning(false);
  };

  const done = newRoleId !== null && !running;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("roleClone.title", { source: sourceRoleName })}
      description={t("roleClone.description")}
      footer={
        done ? (
          <>
            <Button variant="outline" size="sm" onClick={close}>
              {tc("actions.close", { defaultValue: "Đóng" })}
            </Button>
            <Button size="sm" onClick={() => onCloned(newRoleId as string)}>
              {t("roleClone.openNewRole")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" disabled={running} onClick={close}>
              {tc("actions.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={running || name.trim().length < 2}
              onClick={() => void run()}
            >
              {running ? t("roleMembers.batch.running") : t("roleClone.submit")}
            </Button>
          </>
        )
      }
    >
      <Input
        placeholder={t("roleClone.namePlaceholder")}
        value={name}
        disabled={running || done}
        onChange={(e) => setName(e.target.value)}
      />
      {fatal && <p className="text-sm text-destructive">{fatal}</p>}
      {lines.length > 0 && (
        <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
          {lines.map((l) => (
            <li
              key={l.key}
              className={
                l.kind === "error"
                  ? "text-destructive"
                  : l.kind === "skipped"
                    ? "text-amber-600"
                    : "text-muted-foreground"
              }
            >
              {l.kind === "ok" && t("roleMembers.batch.ok", { label: l.label })}
              {l.kind === "skipped" &&
                t("roleClone.skippedLine", { label: l.label, detail: l.detail })}
              {l.kind === "error" &&
                t("roleMembers.batch.error", { label: l.label, detail: l.detail })}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
