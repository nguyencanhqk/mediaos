import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TeamDto } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { orgApi } from "@/lib/org-api";

type TeamType = TeamDto["type"];

const TEAM_TYPE_VALUES: TeamType[] = [
  "production_team",
  "script_team",
  "editor_team",
  "thumbnail_team",
  "seo_team",
  "qa_team",
  "project_team",
  "office_team",
];

export function TeamsPage() {
  const { t } = useTranslation("org");
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [memberUserId, setMemberUserId] = useState("");

  const {
    data: teams = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["org", "teams"],
    queryFn: orgApi.listTeams,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["org", "user-picker"],
    queryFn: orgApi.listEmployees,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["org", "teams", selectedTeamId, "members"],
    queryFn: () => orgApi.listTeamMembers(selectedTeamId as string),
    enabled: selectedTeamId !== null,
  });

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;

  const filteredTeams = teams.filter(
    (t) => (!statusFilter || t.status === statusFilter) && (!typeFilter || t.type === typeFilter),
  );

  const createTeam = useMutation({
    mutationFn: () => orgApi.createTeam({ name, type: "production_team" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["org", "teams"] });
      setName("");
    },
  });

  const assignLeader = useMutation({
    mutationFn: (vars: { teamId: string; leaderId: string }) =>
      orgApi.assignTeamLeader(vars.teamId, vars.leaderId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["org", "teams"] }),
  });

  const addMember = useMutation({
    mutationFn: () => {
      if (!selectedTeamId) throw new Error("No team selected");
      return orgApi.addTeamMember(selectedTeamId, { userId: memberUserId, roleName: "member" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["org", "teams", selectedTeamId, "members"] });
      setMemberUserId("");
    },
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => {
      if (!selectedTeamId) throw new Error("No team selected");
      return orgApi.removeTeamMember(selectedTeamId, userId);
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["org", "teams", selectedTeamId, "members"] }),
  });

  const closeDrawer = () => {
    setSelectedTeamId(null);
    setMemberUserId("");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">{t("teams.title")}</h1>

      <div className="flex gap-2">
        <Input
          placeholder={t("teams.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs"
        />
        <Button onClick={() => createTeam.mutate()} disabled={!name.trim() || createTeam.isPending}>
          {t("teams.addButton")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={t("teams.filterStatusLabel")}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 max-w-[160px] text-sm"
        >
          <option value="">{t("common:anyStatus")}</option>
          <option value="active">{t("teams.statusActive")}</option>
          <option value="inactive">{t("teams.statusInactive")}</option>
        </Select>
        <Select
          aria-label={t("teams.filterTypeLabel")}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-9 max-w-[180px] text-sm"
        >
          <option value="">{t("teams.anyType")}</option>
          {TEAM_TYPE_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`teams.types.${value}`, { defaultValue: value })}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("common:errors.loadFailed")}</p>}
      {filteredTeams.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">{t("teams.empty")}</p>
      )}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {filteredTeams.map((team) => (
          <li key={team.id}>
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50"
              onClick={() => setSelectedTeamId(team.id)}
            >
              <span className="min-w-0">
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
                    Leader: {team.leaderUserName}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {team.capacity != null && <span>cap: {team.capacity}</span>}
                <span
                  className={team.status === "active" ? "text-green-600" : "text-muted-foreground"}
                >
                  {team.status}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog
        open={selectedTeam !== null}
        onClose={closeDrawer}
        title={selectedTeam?.name ?? t("teams.title")}
        description={
          selectedTeam ? t(`teams.types.${selectedTeam.type}`, { defaultValue: selectedTeam.type }) : undefined
        }
      >
        {selectedTeam && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">{t("teams.detail.statusLabel")}</p>
                <p>{selectedTeam.status}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("teams.detail.capacityLabel")}</p>
                <p>{selectedTeam.capacity ?? "—"}</p>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm" htmlFor="team-leader">
                {t("teams.detail.leaderLabel")}
              </label>
              <Select
                id="team-leader"
                value={selectedTeam.leaderUserId ?? ""}
                onChange={(e) => {
                  if (e.target.value) {
                    assignLeader.mutate({ teamId: selectedTeam.id, leaderId: e.target.value });
                  }
                }}
                disabled={assignLeader.isPending}
              >
                <option value="" disabled>
                  {t("teams.detail.leaderPlaceholder")}
                </option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName ?? u.email}
                  </option>
                ))}
              </Select>
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">{t("teams.detail.membersSection")}</h3>
              <div className="flex gap-2">
                <Select
                  aria-label={t("teams.detail.chooseMemberLabel")}
                  value={memberUserId}
                  onChange={(e) => setMemberUserId(e.target.value)}
                  className="text-xs"
                >
                  <option value="">{t("teams.detail.chooseMemberPlaceholder")}</option>
                  {users.map((u) => (
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

              <ul className="divide-y divide-border">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{m.userFullName ?? m.userEmail ?? m.userId}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{m.roleName}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeMember.mutate(m.userId)}
                      >
                        {t("teams.deleteButton")}
                      </Button>
                    </div>
                  </li>
                ))}
                {members.length === 0 && (
                  <li className="py-2 text-sm text-muted-foreground">{t("teams.detail.noMembers")}</li>
                )}
              </ul>
            </section>
          </div>
        )}
      </Dialog>
    </div>
  );
}
