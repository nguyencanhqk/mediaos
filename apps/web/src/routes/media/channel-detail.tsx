import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { ChannelDto, ChannelRole } from "@mediaos/contracts";
import { channelsApi } from "@/lib/channels-api";
import { PermissionGate } from "@/components/permission-gate";
import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";
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
  PLATFORM_LABELS,
} from "@/components/channels/constants";

type Tab = "overview" | "members";

export function ChannelDetailPage() {
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
        ← Danh sách kênh
      </Link>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được kênh.</p>}

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
              Tổng quan
            </TabButton>
            <TabButton active={tab === "members"} onClick={() => setTab("members")}>
              Thành viên
            </TabButton>
          </div>

          {tab === "overview" && <OverviewTab channel={channel} />}
          {tab === "members" && <MembersTab channelId={channelId} />}
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
            Sửa kênh
          </Button>
        </PermissionGate>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border p-5 text-sm">
        <Detail label="Mã kênh" value={channel.code ?? "—"} />
        <Detail label="Nền tảng" value={PLATFORM_LABELS[channel.platform]} />
        <Detail
          label="URL"
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
        <Detail label="Niche" value={channel.niche ?? "—"} />
        <Detail label="Ngôn ngữ" value={channel.language ?? "—"} />
        <Detail label="Quốc gia mục tiêu" value={channel.targetCountry ?? "—"} />
        <Detail label="Channel Manager" value={managerName} />
        <Detail label="Team phụ trách" value={teamName} />
        <Detail label="Trạng thái" value={CHANNEL_STATUS_LABELS[channel.status]} />
        <Detail
          label="Health"
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
        <h2 className="text-sm font-medium">Thành viên kênh ({members.length})</h2>
        <PermissionGate action="update" resourceType="channel">
          <Button size="sm" onClick={() => setAdding(true)}>
            + Thêm thành viên
          </Button>
        </PermissionGate>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được thành viên.</p>}
      {!isLoading && !isError && members.length === 0 && (
        <p className="text-sm text-muted-foreground">Chưa có thành viên nào.</p>
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
                      — Vai trò —
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
                    Xoá
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
