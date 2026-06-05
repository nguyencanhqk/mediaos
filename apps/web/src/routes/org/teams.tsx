import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { orgApi } from "@/lib/org-api";

export function TeamsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [memberUserId, setMemberUserId] = useState("");

  const { data: teams = [], isLoading, isError } = useQuery({
    queryKey: ["org", "teams"],
    queryFn: orgApi.listTeams,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["org", "teams", selectedTeamId, "members"],
    queryFn: () => orgApi.listTeamMembers(selectedTeamId as string),
    enabled: selectedTeamId !== null,
  });

  const createTeam = useMutation({
    mutationFn: () => orgApi.createTeam({ name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["org", "teams"] });
      setName("");
    },
  });

  const addMember = useMutation({
    mutationFn: () =>
      orgApi.addTeamMember(selectedTeamId!, { userId: memberUserId, roleName: "member" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["org", "teams", selectedTeamId, "members"] });
      setMemberUserId("");
    },
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => orgApi.removeTeamMember(selectedTeamId!, userId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["org", "teams", selectedTeamId, "members"] }),
  });

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

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được dữ liệu.</p>}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {teams.map((t) => (
          <li
            key={t.id}
            className={`cursor-pointer px-4 py-3 text-sm transition-colors hover:bg-muted/50 ${
              selectedTeamId === t.id ? "bg-muted/60" : ""
            }`}
            onClick={() => setSelectedTeamId(selectedTeamId === t.id ? null : t.id)}
          >
            <span className="font-medium">{t.name}</span>
          </li>
        ))}
      </ul>

      {selectedTeamId && (
        <section className="space-y-3 rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium">Thành viên</h2>

          <div className="flex gap-2">
            <Input
              placeholder="User ID…"
              value={memberUserId}
              onChange={(e) => setMemberUserId(e.target.value)}
              className="max-w-xs text-xs"
            />
            <Button
              size="sm"
              onClick={() => addMember.mutate()}
              disabled={!memberUserId.trim() || addMember.isPending}
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
      )}
    </div>
  );
}
