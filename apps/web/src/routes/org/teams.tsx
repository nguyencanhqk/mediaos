import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { TeamDto } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { orgApi } from "@/lib/org-api";

type TeamType = TeamDto["type"];

const TEAM_TYPES: { value: TeamType; label: string }[] = [
  { value: "production_team", label: "Sản xuất" },
  { value: "script_team", label: "Kịch bản" },
  { value: "editor_team", label: "Dựng phim" },
  { value: "thumbnail_team", label: "Thumbnail" },
  { value: "seo_team", label: "SEO" },
  { value: "qa_team", label: "QA" },
  { value: "project_team", label: "Dự án" },
  { value: "office_team", label: "Văn phòng" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  TEAM_TYPES.map((t) => [t.value, t.label]),
);

export function TeamsPage() {
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
      <h1 className="text-2xl font-semibold">Teams</h1>

      <div className="flex gap-2">
        <Input
          placeholder="Tên team…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs"
        />
        <Button onClick={() => createTeam.mutate()} disabled={!name.trim() || createTeam.isPending}>
          Thêm team
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Lọc theo trạng thái"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 max-w-[160px] text-sm"
        >
          <option value="">Mọi trạng thái</option>
          <option value="active">Đang hoạt động</option>
          <option value="inactive">Ngừng</option>
        </Select>
        <Select
          aria-label="Lọc theo loại team"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-9 max-w-[180px] text-sm"
        >
          <option value="">Mọi loại team</option>
          {TEAM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được dữ liệu.</p>}
      {filteredTeams.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">Không có team nào khớp bộ lọc.</p>
      )}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {filteredTeams.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50"
              onClick={() => setSelectedTeamId(t.id)}
            >
              <span className="min-w-0">
                <span className="font-medium">{t.name}</span>
                {t.code && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {t.code}
                  </span>
                )}
                <span className="ml-2 text-xs text-muted-foreground">
                  {TYPE_LABEL[t.type] ?? t.type}
                </span>
                {t.leaderUserName && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    Leader: {t.leaderUserName}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {t.capacity != null && <span>cap: {t.capacity}</span>}
                <span
                  className={t.status === "active" ? "text-green-600" : "text-muted-foreground"}
                >
                  {t.status}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog
        open={selectedTeam !== null}
        onClose={closeDrawer}
        title={selectedTeam?.name ?? "Team"}
        description={
          selectedTeam ? (TYPE_LABEL[selectedTeam.type] ?? selectedTeam.type) : undefined
        }
      >
        {selectedTeam && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Trạng thái</p>
                <p>{selectedTeam.status}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sức chứa</p>
                <p>{selectedTeam.capacity ?? "—"}</p>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm" htmlFor="team-leader">
                Team leader
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
                  — Chọn leader —
                </option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName ?? u.email}
                  </option>
                ))}
              </Select>
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">Thành viên</h3>
              <div className="flex gap-2">
                <Select
                  aria-label="Chọn thành viên"
                  value={memberUserId}
                  onChange={(e) => setMemberUserId(e.target.value)}
                  className="text-xs"
                >
                  <option value="">— Chọn người dùng —</option>
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
                  Thêm
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
                        Xoá
                      </Button>
                    </div>
                  </li>
                ))}
                {members.length === 0 && (
                  <li className="py-2 text-sm text-muted-foreground">Chưa có thành viên.</li>
                )}
              </ul>
            </section>
          </div>
        )}
      </Dialog>
    </div>
  );
}
