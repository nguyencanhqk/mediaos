import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OrgTreeNode, OrgUnitDto, TeamDto } from "@mediaos/contracts";
import { useCan } from "@mediaos/web-core";
import { Button, Input, Select, Dialog, EmptyState } from "@mediaos/ui";
import { Building2 } from "lucide-react";
import { orgApi } from "@/lib/org-api";

/**
 * CS-3 — Cơ cấu tổ chức (console, tenant self, /system/org-structure).
 *
 * Gồm 2 tab: Đơn vị tổ chức (org units tree + CRUD) và Nhóm/Team (teams CRUD + thành viên).
 * Gate quyền create/update/delete:org_unit & :team xử lý trong component.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderTree(nodes: OrgTreeNode[], level = 0): React.ReactNode {
  return nodes.map((n) => (
    <li key={n.id}>
      <div
        className={`flex items-center gap-2 py-1.5 text-sm ${level > 0 ? "pl-" + level * 4 : ""}`}
        style={{ paddingLeft: level * 16 }}
      >
        <span
          className={n.status === "inactive" ? "text-muted-foreground line-through" : "font-medium"}
        >
          {n.name}
        </span>
        {n.code && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {n.code}
          </span>
        )}
        <span className="text-xs text-muted-foreground capitalize">{n.type}</span>
        {n.headUserName && (
          <span className="text-xs text-muted-foreground">({n.headUserName})</span>
        )}
      </div>
      {n.children.length > 0 && (
        <ul className="border-l border-border ml-4">{renderTree(n.children, level + 1)}</ul>
      )}
    </li>
  ));
}

// ── OrgUnitsTab ───────────────────────────────────────────────────────────────

interface OrgUnitForm {
  name: string;
  code: string;
  type: string;
  parentId: string;
  description: string;
}

const EMPTY_ORG_FORM: OrgUnitForm = {
  name: "",
  code: "",
  type: "department",
  parentId: "",
  description: "",
};

const ORG_UNIT_TYPES = ["department", "division", "unit", "office", "branch"] as const;

function OrgUnitsTab() {
  const { t } = useTranslation("org");
  const qc = useQueryClient();
  const canCreate = useCan("create", "org_unit");
  const canUpdate = useCan("update", "org_unit");
  const canDelete = useCan("delete", "org_unit");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OrgUnitDto | null>(null);
  const [form, setForm] = useState<OrgUnitForm>(EMPTY_ORG_FORM);

  const {
    data: tree = [],
    isLoading: treeLoading,
    isError: treeError,
  } = useQuery({
    queryKey: ["console:org", "tree"],
    queryFn: orgApi.getOrgTree,
  });

  const { data: units = [] } = useQuery({
    queryKey: ["console:org", "units"],
    queryFn: orgApi.listOrgUnits,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["console:org", "employees"],
    queryFn: orgApi.listEmployees,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["console:org", "tree"] });
    void qc.invalidateQueries({ queryKey: ["console:org", "units"] });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        type: form.type as OrgUnitDto["type"],
        code: form.code.trim() || undefined,
        parentId: form.parentId || undefined,
        description: form.description.trim() || undefined,
      };
      if (editing) {
        return orgApi.updateOrgUnit(editing.id, payload);
      }
      return orgApi.createOrgUnit(payload);
    },
    onSuccess: () => {
      invalidate();
      closeDialog();
    },
  });

  const toggleStatus = useMutation({
    mutationFn: (unit: OrgUnitDto) =>
      orgApi.updateOrgUnit(unit.id, {
        status: unit.status === "active" ? "inactive" : "active",
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => orgApi.deleteOrgUnit(id),
    onSuccess: invalidate,
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_ORG_FORM);
    setDialogOpen(true);
  };

  const openEdit = (u: OrgUnitDto) => {
    setEditing(u);
    setForm({
      name: u.name,
      code: u.code ?? "",
      type: u.type,
      parentId: u.parentId ?? "",
      description: u.description ?? "",
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm(EMPTY_ORG_FORM);
  };

  const isEmpty = !treeLoading && !treeError && tree.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("orgUnits.title")}</h2>
        {canCreate && (
          <Button size="sm" onClick={openCreate}>
            {t("orgUnits.addButton")}
          </Button>
        )}
      </div>

      {treeLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {treeError && (
        <p role="alert" className="text-sm text-destructive">
          {t("common:errors.loadFailed")}
        </p>
      )}

      {isEmpty ? (
        <EmptyState
          icon={Building2}
          title={t("orgUnits.emptyTitle")}
          description={t("orgUnits.emptyDesc")}
        />
      ) : (
        <section>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            {t("orgUnits.treeSection")}
          </h3>
          <ul className="rounded-xl border border-border p-3">{renderTree(tree)}</ul>
        </section>
      )}

      {units.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-sm font-medium text-muted-foreground">{t("orgUnits.listSection")}</h3>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {units.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{u.name}</span>
                  {u.code && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {u.code}
                    </span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground capitalize">{u.type}</span>
                </div>
                <div className="flex items-center gap-2">
                  {canUpdate && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleStatus.mutate(u)}
                        disabled={toggleStatus.isPending}
                        className={u.status === "active" ? "text-success" : "text-muted-foreground"}
                      >
                        {u.status === "active" ? t("status.active") : t("status.inactive")}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEdit(u)}>
                        {t("common:actions.edit")}
                      </Button>
                    </>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove.mutate(u.id)}
                      disabled={remove.isPending}
                    >
                      {t("common:actions.delete")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editing ? t("orgUnits.dialog.editTitle") : t("orgUnits.dialog.createTitle")}
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
            <label className="text-sm" htmlFor="ou-name">
              {t("orgUnits.dialog.nameLabel")}
            </label>
            <Input
              id="ou-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t("orgUnits.dialog.namePlaceholder")}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-sm" htmlFor="ou-code">
                {t("orgUnits.dialog.codeLabel")}
              </label>
              <Input
                id="ou-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-sm" htmlFor="ou-type">
                {t("orgUnits.dialog.typeLabel")}
              </label>
              <Select
                id="ou-type"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {ORG_UNIT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`orgUnits.types.${type}`, { defaultValue: type })}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="ou-parent">
              {t("orgUnits.dialog.parentLabel")}
            </label>
            <Select
              id="ou-parent"
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
            >
              <option value="">{t("common:notAssigned")}</option>
              {units
                .filter((u) => !editing || u.id !== editing.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="ou-desc">
              {t("orgUnits.dialog.descLabel")}
            </label>
            <Input
              id="ou-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          {save.isError && (
            <p className="text-sm text-destructive">{t("orgUnits.dialog.saveError")}</p>
          )}
        </div>
      </Dialog>

      {/* Suppress unused variable warning — employees used in teams tab */}
      <span data-employees={employees.length} className="hidden" />
    </div>
  );
}

// ── TeamsTab ──────────────────────────────────────────────────────────────────

const TEAM_TYPES = [
  "production_team",
  "script_team",
  "editor_team",
  "thumbnail_team",
  "seo_team",
  "qa_team",
  "project_team",
  "office_team",
] as const;

interface TeamForm {
  name: string;
  code: string;
  type: string;
  description: string;
}

const EMPTY_TEAM_FORM: TeamForm = {
  name: "",
  code: "",
  type: "production_team",
  description: "",
};

function TeamsTab() {
  const { t } = useTranslation("org");
  const qc = useQueryClient();
  const canCreate = useCan("create", "team");
  const canUpdate = useCan("update", "team");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TeamDto | null>(null);
  const [form, setForm] = useState<TeamForm>(EMPTY_TEAM_FORM);
  const [detailTeamId, setDetailTeamId] = useState<string | null>(null);
  const [memberUserId, setMemberUserId] = useState("");

  const {
    data: teams = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["console:org", "teams"],
    queryFn: orgApi.listTeams,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["console:org", "employees"],
    queryFn: orgApi.listEmployees,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["console:org", "teams", detailTeamId, "members"],
    queryFn: () => orgApi.listTeamMembers(detailTeamId as string),
    enabled: detailTeamId !== null,
  });

  const detailTeam = teams.find((t) => t.id === detailTeamId) ?? null;

  const invalidateTeams = () => void qc.invalidateQueries({ queryKey: ["console:org", "teams"] });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        type: form.type as TeamDto["type"],
        code: form.code.trim() || undefined,
        description: form.description.trim() || undefined,
      };
      if (editing) {
        return orgApi.updateTeam(editing.id, payload);
      }
      return orgApi.createTeam(payload);
    },
    onSuccess: () => {
      invalidateTeams();
      closeDialog();
    },
  });

  const assignLeader = useMutation({
    mutationFn: (vars: { teamId: string; leaderId: string }) =>
      orgApi.assignTeamLeader(vars.teamId, vars.leaderId),
    onSuccess: invalidateTeams,
  });

  const addMember = useMutation({
    mutationFn: () => {
      if (!detailTeamId) throw new Error("No team selected");
      return orgApi.addTeamMember(detailTeamId, { userId: memberUserId, roleName: "member" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["console:org", "teams", detailTeamId, "members"] });
      setMemberUserId("");
    },
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => {
      if (!detailTeamId) throw new Error("No team selected");
      return orgApi.removeTeamMember(detailTeamId, userId);
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["console:org", "teams", detailTeamId, "members"] }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_TEAM_FORM);
    setDialogOpen(true);
  };

  const openEdit = (team: TeamDto) => {
    setEditing(team);
    setForm({
      name: team.name,
      code: team.code ?? "",
      type: team.type,
      description: team.description ?? "",
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm(EMPTY_TEAM_FORM);
  };

  const closeDetail = () => {
    setDetailTeamId(null);
    setMemberUserId("");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("teams.title")}</h2>
        {canCreate && (
          <Button size="sm" onClick={openCreate}>
            {t("teams.addButton")}
          </Button>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("common:errors.loadFailed")}
        </p>
      )}
      {teams.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">{t("teams.empty")}</p>
      )}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {teams.map((team) => (
          <li key={team.id}>
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50"
              onClick={() => setDetailTeamId(team.id)}
            >
              <span>
                <span className="font-medium">{team.name}</span>
                {team.code && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {team.code}
                  </span>
                )}
                <span className="ml-2 text-xs text-muted-foreground">
                  {t(`teams.types.${team.type}`, { defaultValue: team.type })}
                </span>
                {team.leaderUserName && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t("teams.leaderLabel")}: {team.leaderUserName}
                  </span>
                )}
              </span>
              <span
                className={`text-xs ${team.status === "active" ? "text-success" : "text-muted-foreground"}`}
              >
                {team.status === "active" ? t("status.active") : t("status.inactive")}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* Dialog: Create/Edit team */}
      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editing ? t("teams.dialog.editTitle") : t("teams.dialog.createTitle")}
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
            <label className="text-sm" htmlFor="team-name">
              {t("teams.dialog.nameLabel")}
            </label>
            <Input
              id="team-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t("teams.dialog.namePlaceholder")}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-sm" htmlFor="team-code">
                {t("teams.dialog.codeLabel")}
              </label>
              <Input
                id="team-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-sm" htmlFor="team-type">
                {t("teams.dialog.typeLabel")}
              </label>
              <Select
                id="team-type"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {TEAM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`teams.types.${type}`, { defaultValue: type })}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="team-desc">
              {t("teams.dialog.descLabel")}
            </label>
            <Input
              id="team-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          {save.isError && (
            <p className="text-sm text-destructive">{t("teams.dialog.saveError")}</p>
          )}
        </div>
      </Dialog>

      {/* Dialog: Team detail + members */}
      <Dialog
        open={detailTeam !== null}
        onClose={closeDetail}
        title={detailTeam?.name ?? t("teams.title")}
      >
        {detailTeam && (
          <div className="space-y-4">
            <div className="flex gap-2">
              {canUpdate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    closeDetail();
                    openEdit(detailTeam);
                  }}
                >
                  {t("common:actions.edit")}
                </Button>
              )}
            </div>

            {canUpdate && (
              <div className="space-y-1">
                <label className="text-sm" htmlFor="detail-leader">
                  {t("teams.detail.leaderLabel")}
                </label>
                <Select
                  id="detail-leader"
                  value={detailTeam.leaderUserId ?? ""}
                  onChange={(e) => {
                    if (e.target.value) {
                      assignLeader.mutate({ teamId: detailTeam.id, leaderId: e.target.value });
                    }
                  }}
                  disabled={assignLeader.isPending}
                >
                  <option value="" disabled>
                    {t("teams.detail.leaderPlaceholder")}
                  </option>
                  {employees.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName ?? u.email}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-medium">{t("teams.detail.membersSection")}</h3>
              {canCreate && (
                <div className="flex gap-2">
                  <Select
                    aria-label={t("teams.detail.chooseMemberLabel")}
                    value={memberUserId}
                    onChange={(e) => setMemberUserId(e.target.value)}
                    className="text-xs"
                  >
                    <option value="">{t("teams.detail.chooseMemberPlaceholder")}</option>
                    {employees.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName ?? u.email}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    onClick={() => addMember.mutate()}
                    disabled={!memberUserId || addMember.isPending}
                  >
                    {t("common:actions.add")}
                  </Button>
                </div>
              )}

              <ul className="divide-y divide-border">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{m.userFullName ?? m.userEmail ?? m.userId}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{m.roleName}</span>
                      {canUpdate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => removeMember.mutate(m.userId)}
                        >
                          {t("common:actions.delete")}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
                {members.length === 0 && (
                  <li className="py-2 text-sm text-muted-foreground">
                    {t("teams.detail.noMembers")}
                  </li>
                )}
              </ul>
            </section>
          </div>
        )}
      </Dialog>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "units" | "teams";

export function OrgStructurePage() {
  const { t } = useTranslation("org");
  const [tab, setTab] = useState<Tab>("units");

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("orgStructure.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("orgStructure.subtitle")}</p>
      </header>

      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === "units"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setTab("units")}
        >
          {t("orgStructure.tabUnits")}
        </button>
        <button
          type="button"
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === "teams"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setTab("teams")}
        >
          {t("orgStructure.tabTeams")}
        </button>
      </div>

      {tab === "units" ? <OrgUnitsTab /> : <TeamsTab />}
    </div>
  );
}
