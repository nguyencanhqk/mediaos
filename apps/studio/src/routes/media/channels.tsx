import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ChannelDto } from "@mediaos/contracts";
import { channelsApi, type ChannelFilters } from "@/lib/channels-api";
import { PermissionGate } from "@mediaos/web-core";
import { useCan } from "@mediaos/web-core";
import { ChannelFilterBar } from "@/components/channels/channel-filter-bar";
import { ChannelTable } from "@/components/channels/channel-table";
import { CreateChannelDialog } from "@/components/channels/create-channel-dialog";
import { useEmployeeOptions } from "@/components/channels/use-channel-options";

export function ChannelsPage() {
  const { t } = useTranslation("channels");
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ChannelFilters>({});
  const canDelete = useCan("delete", "channel");
  const employees = useEmployeeOptions();

  const {
    data: channels = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["channels", filters],
    queryFn: () => channelsApi.listChannels(filters),
  });

  // Fetch không lọc → suy ra danh sách niche cho dropdown filter.
  const { data: allChannels = [] } = useQuery({
    queryKey: ["channels", "all"],
    queryFn: () => channelsApi.listChannels(),
  });

  const nicheOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of allChannels) if (c.niche) set.add(c.niche);
    return [...set].sort((a, b) => a.localeCompare(b, "vi"));
  }, [allChannels]);

  const remove = useMutation({
    mutationFn: (id: string) => channelsApi.deleteChannel(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["channels"] }),
  });

  const onDelete = (channel: ChannelDto) => {
    if (window.confirm(t("channelsPage.deleteConfirm", { name: channel.name }))) remove.mutate(channel.id);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("channelsPage.heading")}</h1>
        <PermissionGate action="create" resourceType="channel">
          <CreateChannelDialog />
        </PermissionGate>
      </div>

      <ChannelFilterBar
        filters={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        onClear={() => setFilters({})}
        employees={employees}
        nicheOptions={nicheOptions}
      />

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("common:errors.loadFailed")}</p>}
      {!isLoading && !isError && channels.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("channelsPage.noMatch")}</p>
      )}
      {channels.length > 0 && (
        <ChannelTable
          channels={channels}
          employees={employees}
          canDelete={canDelete}
          onDelete={onDelete}
          deletingId={remove.isPending ? remove.variables : null}
        />
      )}
    </div>
  );
}
