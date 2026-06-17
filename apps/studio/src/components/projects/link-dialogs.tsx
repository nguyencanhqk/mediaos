import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
import { Dialog } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
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
  const { t } = useTranslation("projects");
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
      title={t("linkDialogs.channel.title")}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("linkDialogs.cancel")}
          </Button>
          <Button size="sm" onClick={() => add.mutate()} disabled={!channelId || add.isPending}>
            {add.isPending ? t("linkDialogs.channel.adding") : t("linkDialogs.channel.submit")}
          </Button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("linkDialogs.channel.fieldChannel")}</span>
        <Select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
          <option value="">{t("linkDialogs.channel.selectChannel")}</option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {PLATFORM_LABELS[c.platform]}
            </option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("linkDialogs.channel.fieldRole")}</span>
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder={t("linkDialogs.channel.rolePlaceholder")} />
      </label>
      {add.isError && <p className="text-sm text-destructive">{t("linkDialogs.channel.addFailed")}</p>}
    </Dialog>
  );
}

// ── Team ──────────────────────────────────────────────────────────────────────

export function AddProjectTeamDialog({ projectId, open, onClose, excludeIds }: LinkDialogProps) {
  const { t } = useTranslation("projects");
  const invalidate = useInvalidateProject(projectId);
  const teams = useTeamOptions();
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState("");
  const available = teams.filter((team) => !excludeIds.includes(team.id));

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
      title={t("linkDialogs.team.title")}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("linkDialogs.cancel")}
          </Button>
          <Button size="sm" onClick={() => add.mutate()} disabled={!teamId || add.isPending}>
            {add.isPending ? t("linkDialogs.team.adding") : t("linkDialogs.team.submit")}
          </Button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("linkDialogs.team.fieldTeam")}</span>
        <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">{t("linkDialogs.team.selectTeam")}</option>
          {available.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("linkDialogs.team.fieldRole")}</span>
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder={t("linkDialogs.team.rolePlaceholder")} />
      </label>
      {add.isError && <p className="text-sm text-destructive">{t("linkDialogs.team.addFailed")}</p>}
    </Dialog>
  );
}

// ── Member ──────────────────────────────────────────────────────────────────────

export function AddProjectMemberDialog({ projectId, open, onClose, excludeIds }: LinkDialogProps) {
  const { t } = useTranslation("projects");
  const invalidate = useInvalidateProject(projectId);
  const employees = useEmployeeOptions();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [workload, setWorkload] = useState("");
  const available = employees.filter((emp) => !excludeIds.includes(emp.userId));

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
      title={t("linkDialogs.member.title")}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("linkDialogs.cancel")}
          </Button>
          <Button size="sm" onClick={() => add.mutate()} disabled={!userId || add.isPending}>
            {add.isPending ? t("linkDialogs.member.adding") : t("linkDialogs.member.submit")}
          </Button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("linkDialogs.member.fieldMember")}</span>
        <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">{t("linkDialogs.member.selectMember")}</option>
          {available.map((emp) => (
            <option key={emp.userId} value={emp.userId}>
              {emp.userFullName ?? emp.userEmail ?? emp.userId}
            </option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("linkDialogs.member.fieldRole")}</span>
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder={t("linkDialogs.member.rolePlaceholder")} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("linkDialogs.member.fieldWorkload")}</span>
        <Input
          type="number"
          min={0}
          max={100}
          value={workload}
          onChange={(e) => setWorkload(e.target.value)}
          placeholder="0–100"
        />
      </label>
      {add.isError && <p className="text-sm text-destructive">{t("linkDialogs.member.addFailed")}</p>}
    </Dialog>
  );
}
