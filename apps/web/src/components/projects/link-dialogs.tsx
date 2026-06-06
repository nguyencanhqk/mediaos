import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { channelsApi } from "@/lib/channels-api";
import { projectsApi } from "@/lib/projects-api";
import { useEmployeeOptions, useTeamOptions } from "@/components/channels/use-channel-options";
import { PLATFORM_LABELS } from "@/components/channels/constants";

interface LinkDialogProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  /** id đã gán → loại khỏi dropdown. */
  excludeIds: string[];
}

function useInvalidateProject(projectId: string) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["projects", projectId] });
}

// ── Channel ───────────────────────────────────────────────────────────────────

export function AddProjectChannelDialog({ projectId, open, onClose, excludeIds }: LinkDialogProps) {
  const invalidate = useInvalidateProject(projectId);
  const [channelId, setChannelId] = useState("");
  const [role, setRole] = useState("");

  const { data: channels = [] } = useQuery({
    queryKey: ["channels", "all"],
    queryFn: () => channelsApi.listChannels(),
    enabled: open,
  });
  const available = channels.filter((c) => !excludeIds.includes(c.id));

  const add = useMutation({
    mutationFn: () =>
      projectsApi.addProjectChannel(projectId, {
        channelId,
        roleInProject: role.trim() || undefined,
      }),
    onSuccess: () => {
      invalidate();
      setChannelId("");
      setRole("");
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Gắn kênh vào dự án"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Huỷ
          </Button>
          <Button size="sm" onClick={() => add.mutate()} disabled={!channelId || add.isPending}>
            {add.isPending ? "Đang gắn…" : "Gắn kênh"}
          </Button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Kênh *</span>
        <Select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
          <option value="">— Chọn kênh —</option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {PLATFORM_LABELS[c.platform]}
            </option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Vai trò trong dự án</span>
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="VD: kênh chính" />
      </label>
      {add.isError && <p className="text-sm text-destructive">Gắn kênh thất bại.</p>}
    </Dialog>
  );
}

// ── Team ──────────────────────────────────────────────────────────────────────

export function AddProjectTeamDialog({ projectId, open, onClose, excludeIds }: LinkDialogProps) {
  const invalidate = useInvalidateProject(projectId);
  const teams = useTeamOptions();
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState("");
  const available = teams.filter((t) => !excludeIds.includes(t.id));

  const add = useMutation({
    mutationFn: () =>
      projectsApi.addProjectTeam(projectId, { teamId, roleInProject: role.trim() || undefined }),
    onSuccess: () => {
      invalidate();
      setTeamId("");
      setRole("");
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Gắn team vào dự án"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Huỷ
          </Button>
          <Button size="sm" onClick={() => add.mutate()} disabled={!teamId || add.isPending}>
            {add.isPending ? "Đang gắn…" : "Gắn team"}
          </Button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Team *</span>
        <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">— Chọn team —</option>
          {available.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Vai trò trong dự án</span>
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="VD: sản xuất" />
      </label>
      {add.isError && <p className="text-sm text-destructive">Gắn team thất bại.</p>}
    </Dialog>
  );
}

// ── Member ──────────────────────────────────────────────────────────────────────

export function AddProjectMemberDialog({ projectId, open, onClose, excludeIds }: LinkDialogProps) {
  const invalidate = useInvalidateProject(projectId);
  const employees = useEmployeeOptions();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [workload, setWorkload] = useState("");
  const available = employees.filter((e) => !excludeIds.includes(e.userId));

  const add = useMutation({
    mutationFn: () =>
      projectsApi.addProjectMember(projectId, {
        userId,
        roleInProject: role.trim() || undefined,
        workloadPercent: workload.trim() ? Number(workload) : undefined,
      }),
    onSuccess: () => {
      invalidate();
      setUserId("");
      setRole("");
      setWorkload("");
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Thêm thành viên dự án"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Huỷ
          </Button>
          <Button size="sm" onClick={() => add.mutate()} disabled={!userId || add.isPending}>
            {add.isPending ? "Đang thêm…" : "Thêm thành viên"}
          </Button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Nhân sự *</span>
        <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">— Chọn nhân sự —</option>
          {available.map((e) => (
            <option key={e.userId} value={e.userId}>
              {e.userFullName ?? e.userEmail ?? e.userId}
            </option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Vai trò trong dự án</span>
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="VD: biên tập" />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Khối lượng (%)</span>
        <Input
          type="number"
          min={0}
          max={100}
          value={workload}
          onChange={(e) => setWorkload(e.target.value)}
          placeholder="0–100"
        />
      </label>
      {add.isError && <p className="text-sm text-destructive">Thêm thành viên thất bại.</p>}
    </Dialog>
  );
}
