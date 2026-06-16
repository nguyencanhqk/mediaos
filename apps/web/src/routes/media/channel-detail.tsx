import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type {
  ChannelDto,
  ChannelHealthStatus,
  ChannelRole,
  UpdateChannelHealthRequest,
} from "@mediaos/contracts";
import { channelsApi } from "@/lib/channels-api";
import { PermissionGate } from "@/components/permission-gate";
import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EditChannelDialog } from "@/components/channels/edit-channel-dialog";
import { AddChannelMemberDialog } from "@/components/channels/add-channel-member-dialog";
import {
  useEmployeeOptions,
  useTeamOptions,
} from "@/components/channels/use-channel-options";
import {
  CHANNEL_ROLE_LABELS,
  CHANNEL_ROLE_OPTIONS,
  CHANNEL_STATUS_LABELS,
  HEALTH_COLORS,
  HEALTH_LABELS,
  HEALTH_OPTIONS,
  PLATFORM_LABELS,
} from "@/components/channels/constants";

type Tab = "overview" | "members" | "health";

export function ChannelDetailPage() {
  const { t } = useTranslation("channels");
  const { channelId } = useParams({ from: "/channels/$channelId" });
  const [tab, setTab] = useState<Tab>("overview");

  const {
    data: channel,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["channels", channelId],
    queryFn: () => channelsApi.getChannel(channelId),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <Link to="/channels" className="text-sm text-muted-foreground hover:underline">
        {t("channelDetail.backLink")}
      </Link>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("channelDetail.loadError")}</p>}

      {channel && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{channel.name}</h1>
              <p className="text-sm text-muted-foreground">
                {PLATFORM_LABELS[channel.platform]} · {CHANNEL_STATUS_LABELS[channel.status]}
              </p>
            </div>
          </div>

          <div className="flex gap-1 border-b border-border">
            <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
              {t("channelDetail.tabOverview")}
            </TabButton>
            <TabButton active={tab === "members"} onClick={() => setTab("members")}>
              {t("channelDetail.tabMembers")}
            </TabButton>
            <TabButton active={tab === "health"} onClick={() => setTab("health")}>
              {t("channelDetail.tabHealth")}
            </TabButton>
          </div>

          {tab === "overview" && <OverviewTab channel={channel} />}
          {tab === "members" && <MembersTab channelId={channelId} />}
          {tab === "health" && <HealthTab channel={channel} />}
        </>
      )}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary"
          : "px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function OverviewTab({ channel }: { channel: ChannelDto }) {
  const { t } = useTranslation("channels");
  const [editing, setEditing] = useState(false);
  const employees = useEmployeeOptions();
  const teams = useTeamOptions();

  const managerName = channel.channelManagerId
    ? employees.find((e) => e.userId === channel.channelManagerId)?.userFullName ??
      employees.find((e) => e.userId === channel.channelManagerId)?.userEmail ??
      channel.channelManagerId
    : "—";
  const teamName = channel.primaryTeamId
    ? teams.find((t) => t.id === channel.primaryTeamId)?.name ?? channel.primaryTeamId
    : "—";

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <PermissionGate action="update" resourceType="channel">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            {t("channelDetail.overview.editButton")}
          </Button>
        </PermissionGate>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border p-5 text-sm">
        <Detail label={t("channelDetail.overview.detailCode")} value={channel.code ?? "—"} />
        <Detail label={t("channelDetail.overview.detailPlatform")} value={PLATFORM_LABELS[channel.platform]} />
        <Detail
          label={t("channelDetail.overview.detailUrl")}
          value={
            channel.url ? (
              <a
                href={channel.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {channel.url}
              </a>
            ) : (
              "—"
            )
          }
        />
        <Detail label={t("channelDetail.overview.detailNiche")} value={channel.niche ?? "—"} />
        <Detail label={t("channelDetail.overview.detailLanguage")} value={channel.language ?? "—"} />
        <Detail label={t("channelDetail.overview.detailTargetCountry")} value={channel.targetCountry ?? "—"} />
        <Detail label={t("channelDetail.overview.detailChannelManager")} value={managerName} />
        <Detail label={t("channelDetail.overview.detailTeam")} value={teamName} />
        <Detail label={t("channelDetail.overview.detailStatus")} value={CHANNEL_STATUS_LABELS[channel.status]} />
        <Detail
          label={t("channelDetail.overview.detailHealth")}
          value={
            channel.healthStatus ? (
              <span className={HEALTH_COLORS[channel.healthStatus]}>
                {HEALTH_LABELS[channel.healthStatus]}
                {channel.healthScore != null ? ` · ${channel.healthScore}` : ""}
              </span>
            ) : (
              "—"
            )
          }
        />
      </dl>

      <EditChannelDialog channel={channel} open={editing} onClose={() => setEditing(false)} />
    </div>
  );
}

interface DetailProps {
  label: string;
  value: React.ReactNode;
}

function Detail({ label, value }: DetailProps) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// ── Members ─────────────────────────────────────────────────────────────────

function MembersTab({ channelId }: { channelId: string }) {
  const { t } = useTranslation("channels");
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const canManage = useCan("update", "channel");
  const employees = useEmployeeOptions();

  const {
    data: members = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["channels", channelId, "members"],
    queryFn: () => channelsApi.listChannelMembers(channelId),
  });

  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) map.set(e.userId, e.userFullName ?? e.userEmail ?? e.userId);
    return map;
  }, [employees]);

  const remove = useMutation({
    mutationFn: (memberId: string) => channelsApi.removeChannelMember(channelId, memberId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["channels", channelId, "members"] }),
  });

  const updateRole = useMutation({
    mutationFn: (vars: { memberId: string; role: ChannelRole }) =>
      channelsApi.updateChannelMember(channelId, vars.memberId, { roleInChannel: vars.role }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["channels", channelId, "members"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t("channelDetail.members.heading", { count: members.length })}</h2>
        <PermissionGate action="update" resourceType="channel">
          <Button size="sm" onClick={() => setAdding(true)}>
            {t("channelDetail.members.addButton")}
          </Button>
        </PermissionGate>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("channelDetail.members.loadError")}</p>}
      {!isLoading && !isError && members.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("channelDetail.members.empty")}</p>
      )}

      {members.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div className="space-y-0.5">
                <span className="font-medium">{memberName.get(m.userId) ?? m.userId}</span>
                {m.permissionLevel && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {m.permissionLevel}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {canManage ? (
                  <Select
                    value={m.roleInChannel ?? ""}
                    className="h-8 w-auto py-1"
                    onChange={(e) =>
                      updateRole.mutate({ memberId: m.id, role: e.target.value as ChannelRole })
                    }
                    disabled={updateRole.isPending}
                  >
                    <option value="" disabled>
                      {t("channelDetail.members.rolePlaceholder")}
                    </option>
                    {CHANNEL_ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {CHANNEL_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {m.roleInChannel ? CHANNEL_ROLE_LABELS[m.roleInChannel] : "—"}
                  </span>
                )}
                <PermissionGate action="update" resourceType="channel">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => remove.mutate(m.id)}
                    disabled={remove.isPending && remove.variables === m.id}
                  >
                    {t("channelDetail.members.deleteButton")}
                  </Button>
                </PermissionGate>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddChannelMemberDialog
        channelId={channelId}
        open={adding}
        onClose={() => setAdding(false)}
        excludeUserIds={members.map((m) => m.userId)}
      />
    </div>
  );
}

// ── Health (G6-5) ─────────────────────────────────────────────────────────────

interface HealthFormState {
  healthStatus: string;
  healthScore: string;
  healthNote: string;
}

function fromChannelHealth(c: ChannelDto): HealthFormState {
  return {
    healthStatus: c.healthStatus ?? "",
    healthScore: c.healthScore ?? "",
    healthNote: c.healthNote ?? "",
  };
}

function toHealthRequest(f: HealthFormState): UpdateChannelHealthRequest {
  const score = f.healthScore.trim();
  const note = f.healthNote.trim();
  return {
    healthStatus: f.healthStatus === "" ? null : (f.healthStatus as ChannelHealthStatus),
    healthScore: score === "" ? null : Number(score),
    healthNote: note === "" ? null : note,
  };
}

function HealthTab({ channel }: { channel: ChannelDto }) {
  const { t } = useTranslation("channels");
  const qc = useQueryClient();
  const canManage = useCan("update", "channel");
  const [form, setForm] = useState<HealthFormState>(() => fromChannelHealth(channel));

  const score = form.healthScore.trim();
  const scoreNum = score === "" ? null : Number(score);
  const scoreInvalid =
    scoreNum !== null && (!Number.isFinite(scoreNum) || scoreNum < 0 || scoreNum > 100);

  const save = useMutation({
    mutationFn: () => channelsApi.updateChannelHealth(channel.id, toHealthRequest(form)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["channels"] });
      void qc.invalidateQueries({ queryKey: ["channels", channel.id] });
    },
  });

  return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-xl border border-border p-5">
        <p className="text-xs text-muted-foreground">{t("channelDetail.health.currentLabel")}</p>
        <p className="mt-1 text-sm">
          {channel.healthStatus ? (
            <span className={HEALTH_COLORS[channel.healthStatus]}>
              {HEALTH_LABELS[channel.healthStatus]}
              {channel.healthScore != null ? ` · ${channel.healthScore}` : ""}
            </span>
          ) : (
            t("channelDetail.health.notRated")
          )}
        </p>
        {channel.healthNote && (
          <p className="mt-2 text-sm text-muted-foreground">{channel.healthNote}</p>
        )}
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("channelDetail.health.statusLabel")}</span>
        <Select
          value={form.healthStatus}
          disabled={!canManage}
          onChange={(e) => setForm((f) => ({ ...f, healthStatus: e.target.value }))}
        >
          <option value="">{t("channelDetail.health.statusPlaceholder")}</option>
          {HEALTH_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {HEALTH_LABELS[h]}
            </option>
          ))}
        </Select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("channelDetail.health.scoreLabel")}</span>
        <Input
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={form.healthScore}
          disabled={!canManage}
          onChange={(e) => setForm((f) => ({ ...f, healthScore: e.target.value }))}
          placeholder={t("channelDetail.health.scorePlaceholder")}
        />
        {scoreInvalid && (
          <span className="text-xs text-destructive">{t("channelDetail.health.scoreInvalid")}</span>
        )}
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("channelDetail.health.noteLabel")}</span>
        <textarea
          value={form.healthNote}
          disabled={!canManage}
          onChange={(e) => setForm((f) => ({ ...f, healthNote: e.target.value }))}
          rows={3}
          maxLength={1000}
          placeholder={t("channelDetail.health.notePlaceholder")}
          className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>

      {save.isError && (
        <p className="text-sm text-destructive">
          {t("channelDetail.health.saveFailed")}{" "}
          {save.error instanceof Error ? save.error.message : t("channelDetail.health.errorUnknown")}
        </p>
      )}
      {save.isSuccess && !save.isPending && (
        <p className="text-sm text-green-600">{t("channelDetail.health.saveSuccess")}</p>
      )}

      <PermissionGate action="update" resourceType="channel">
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending || scoreInvalid}>
            {save.isPending ? t("channelDetail.health.saving") : t("channelDetail.health.saveButton")}
          </Button>
        </div>
      </PermissionGate>
    </div>
  );
}
