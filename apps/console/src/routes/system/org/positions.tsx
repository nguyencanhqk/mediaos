import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PositionDto } from "@mediaos/contracts";
import { useCan } from "@mediaos/web-core";
import { Button, Input, Select, Dialog, EmptyState } from "@mediaos/ui";
import { Briefcase } from "lucide-react";
import { orgApi } from "@/lib/org-api";
import { positionsApi } from "@/lib/positions-api";

/**
 * CS-3 — Vị trí công việc (console, tenant self, /system/positions).
 *
 * Bảng MISA "Cơ cấu tổ chức / Vị trí công việc":
 * Tên vị trí | Mã | Đơn vị | Cấp bậc | Vai trò mặc định | Trạng thái | Hành động
 *
 * Gate quyền create/update/delete:position xử lý trong component.
 */

interface PositionForm {
  name: string;
  code: string;
  level: string;
  orgUnitId: string;
  defaultRoleId: string;
  description: string;
}

const EMPTY_FORM: PositionForm = {
  name: "",
  code: "",
  level: "",
  orgUnitId: "",
  defaultRoleId: "",
  description: "",
};

function toForm(p: PositionDto): PositionForm {
  return {
    name: p.name,
    code: p.code ?? "",
    level: p.level != null ? String(p.level) : "",
    orgUnitId: p.orgUnitId ?? "",
    defaultRoleId: p.defaultRoleId ?? "",
    description: p.description ?? "",
  };
}

export function PositionsPage() {
  const { t } = useTranslation("org");
  const qc = useQueryClient();
  const canCreate = useCan("create", "position");
  const canUpdate = useCan("update", "position");
  const canDelete = useCan("delete", "position");

  const [orgUnitFilter, setOrgUnitFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PositionDto | null>(null);
  const [form, setForm] = useState<PositionForm>(EMPTY_FORM);

  const {
    data: positions = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["console:positions", orgUnitFilter],
    queryFn: () => positionsApi.listPositions(orgUnitFilter || undefined),
  });

  const { data: orgUnits = [] } = useQuery({
    queryKey: ["console:org", "units"],
    queryFn: orgApi.listOrgUnits,
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["console:org", "roles"],
    queryFn: positionsApi.listRoles,
    retry: false,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["console:positions"] });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (p: PositionDto) => {
    setEditing(p);
    setForm(toForm(p));
    setDialogOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const parsedLevel = Number(form.level);
      const level = form.level.trim() && Number.isInteger(parsedLevel) ? parsedLevel : undefined;
      if (editing) {
        return positionsApi.updatePosition(editing.id, {
          name: form.name.trim(),
          code: form.code.trim() || null,
          level: level ?? null,
          orgUnitId: form.orgUnitId || null,
          defaultRoleId: form.defaultRoleId || null,
          description: form.description.trim() || null,
        });
      }
      return positionsApi.createPosition({
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        level,
        orgUnitId: form.orgUnitId || undefined,
        defaultRoleId: form.defaultRoleId || undefined,
        description: form.description.trim() || undefined,
      });
    },
    onSuccess: () => {
      invalidate();
      closeDialog();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => positionsApi.deletePosition(id),
    onSuccess: invalidate,
  });

  const isEmpty = !isLoading && !isError && positions.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("positions.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("positions.subtitle")}</p>
        </div>
        {canCreate && <Button onClick={openCreate}>{t("positions.addButton")}</Button>}
      </header>

      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground" htmlFor="pos-unit-filter">
          {t("positions.filterLabel")}
        </label>
        <Select
          id="pos-unit-filter"
          value={orgUnitFilter}
          onChange={(e) => setOrgUnitFilter(e.target.value)}
          className="max-w-xs"
        >
          <option value="">{t("positions.allDepartments")}</option>
          {orgUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("common:errors.loadFailed")}
        </p>
      )}

      {isEmpty ? (
        <EmptyState
          icon={Briefcase}
          title={t("positions.emptyTitle")}
          description={t("positions.emptyDesc")}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">{t("positions.col.name")}</th>
                <th className="px-4 py-2 text-left">{t("positions.col.code")}</th>
                <th className="px-4 py-2 text-left">{t("positions.col.orgUnit")}</th>
                <th className="px-4 py-2 text-left">{t("positions.col.level")}</th>
                <th className="px-4 py-2 text-left">{t("positions.col.defaultRole")}</th>
                <th className="px-4 py-2 text-left">{t("positions.col.status")}</th>
                {(canUpdate || canDelete) && (
                  <th className="px-4 py-2 text-left">{t("positions.col.actions")}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {positions.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3">
                    {p.code ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{p.code}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.orgUnitName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.level != null ? p.level : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.defaultRoleName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.status === "active"
                          ? "bg-success-muted text-success"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {p.status === "active" ? t("status.active") : t("status.inactive")}
                    </span>
                  </td>
                  {(canUpdate || canDelete) && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {canUpdate && (
                          <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                            {t("common:actions.edit")}
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => remove.mutate(p.id)}
                            disabled={remove.isPending}
                          >
                            {t("common:actions.delete")}
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editing ? t("positions.dialog.editTitle") : t("positions.dialog.createTitle")}
        footer={
          <>
            <Button variant="outline" onClick={closeDialog} disabled={save.isPending}>
              {t("common:actions.cancel")}
            </Button>
            <Button onClick={() => save.mutate()} disabled={!form.name.trim() || save.isPending}>
              {editing ? t("common:actions.save") : t("common:actions.create")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="pos-name">
              {t("positions.dialog.nameLabel")}
            </label>
            <Input
              id="pos-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t("positions.dialog.namePlaceholder")}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-sm" htmlFor="pos-code">
                {t("positions.dialog.codeLabel")}
              </label>
              <Input
                id="pos-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </div>
            <div className="w-28 space-y-1">
              <label className="text-sm" htmlFor="pos-level">
                {t("positions.dialog.levelLabel")}
              </label>
              <Input
                id="pos-level"
                type="number"
                min={1}
                max={99}
                value={form.level}
                onChange={(e) => setForm({ ...form, level: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm" htmlFor="pos-org-unit">
              {t("positions.dialog.orgUnitLabel")}
            </label>
            <Select
              id="pos-org-unit"
              value={form.orgUnitId}
              onChange={(e) => setForm({ ...form, orgUnitId: e.target.value })}
            >
              <option value="">{t("common:notAssigned")}</option>
              {orgUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-sm" htmlFor="pos-role">
              {t("positions.dialog.roleLabel")}
            </label>
            <Select
              id="pos-role"
              value={form.defaultRoleId}
              onChange={(e) => setForm({ ...form, defaultRoleId: e.target.value })}
              disabled={roles.length === 0}
            >
              <option value="">{t("common:notAssigned")}</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            {roles.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("positions.rolesNotReady")}</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-sm" htmlFor="pos-desc">
              {t("positions.dialog.descLabel")}
            </label>
            <Input
              id="pos-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          {save.isError && (
            <p className="text-sm text-destructive">{t("positions.dialog.saveError")}</p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
