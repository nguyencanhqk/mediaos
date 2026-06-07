import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type {
  ContentAssetDto,
  ContentChannelDto,
  ContentItemDto,
  ContentPriority,
  ContentStatus,
  ProductionStatus,
  UpdateContentItemRequest,
} from "@mediaos/contracts";
import { contentApi } from "@/lib/content-api";
import { channelsApi } from "@/lib/channels-api";
import { PermissionGate } from "@/components/permission-gate";
import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PLATFORM_LABELS } from "@/components/channels/constants";
import {
  ASSET_TYPE_LABELS,
  ASSET_TYPE_OPTIONS,
  CONTENT_PRIORITY_LABELS,
  CONTENT_PRIORITY_OPTIONS,
  CONTENT_STATUS_LABELS,
  CONTENT_STATUS_OPTIONS,
  PRODUCTION_STATUS_LABELS,
  PRODUCTION_STATUS_OPTIONS,
  PUBLISH_STATUS_LABELS,
  PUBLISH_STATUS_OPTIONS,
} from "@/components/content/constants";

type Tab = "overview" | "channels" | "assets";

export function ContentDetailPage() {
  const { contentId } = useParams({ from: "/content/$contentId" });
  const [tab, setTab] = useState<Tab>("overview");

  const {
    data: content,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["content", contentId],
    queryFn: () => contentApi.getContent(contentId),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <Link to="/content" className="text-sm text-muted-foreground hover:underline">
        ← Danh sách nội dung
      </Link>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được nội dung.</p>}

      {content && (
        <>
          <div>
            <h1 className="text-2xl font-semibold">{content.title}</h1>
            <p className="text-sm text-muted-foreground">
              {content.contentType?.name ? `${content.contentType.name} · ` : ""}
              {content.productionStatus
                ? PRODUCTION_STATUS_LABELS[content.productionStatus]
                : CONTENT_STATUS_LABELS[content.status]}
            </p>
          </div>

          <div className="flex gap-1 border-b border-border">
            <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
              Tổng quan
            </TabButton>
            <TabButton active={tab === "channels"} onClick={() => setTab("channels")}>
              Kênh đăng ({content.channels?.length ?? 0})
            </TabButton>
            <TabButton active={tab === "assets"} onClick={() => setTab("assets")}>
              Asset ({content.assets?.length ?? 0})
            </TabButton>
          </div>

          {tab === "overview" && <OverviewTab content={content} />}
          {tab === "channels" && <PublishTargetsTab content={content} />}
          {tab === "assets" && <AssetsTab content={content} />}
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

// ── Overview ──────────────────────────────────────────────────────────────────

function OverviewTab({ content }: { content: ContentItemDto }) {
  const qc = useQueryClient();
  const canUpdate = useCan("update", "content");
  const [form, setForm] = useState<{
    status: ContentStatus;
    productionStatus: ProductionStatus | "";
    priority: ContentPriority | "";
    finalUrl: string;
    thumbnailUrl: string;
    scriptUrl: string;
    videoFileUrl: string;
  }>({
    status: content.status,
    productionStatus: content.productionStatus ?? "",
    priority: content.priority ?? "",
    finalUrl: content.finalUrl ?? "",
    thumbnailUrl: content.thumbnailUrl ?? "",
    scriptUrl: content.scriptUrl ?? "",
    videoFileUrl: content.videoFileUrl ?? "",
  });

  const save = useMutation({
    mutationFn: () => {
      const req: UpdateContentItemRequest = {
        status: form.status,
        productionStatus: form.productionStatus ? form.productionStatus : null,
        priority: form.priority ? form.priority : null,
        finalUrl: form.finalUrl.trim() || null,
        thumbnailUrl: form.thumbnailUrl.trim() || null,
        scriptUrl: form.scriptUrl.trim() || null,
        videoFileUrl: form.videoFileUrl.trim() || null,
      };
      return contentApi.updateContent(content.id, req);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["content", content.id] }),
  });

  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Mã" value={content.code ?? "—"} />
        <Field label="Ngôn ngữ" value={content.language ?? "—"} />
        <Field
          label="Lịch đăng dự kiến"
          value={content.plannedPublishAt ? new Date(content.plannedPublishAt).toLocaleString("vi") : "—"}
        />
        <Field
          label="Đã đăng"
          value={content.publishedAt ? new Date(content.publishedAt).toLocaleString("vi") : "—"}
        />
      </dl>

      {!canUpdate ? (
        <p className="text-sm text-muted-foreground">Bạn không có quyền sửa nội dung.</p>
      ) : (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="grid grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Production status</span>
              <Select
                value={form.productionStatus}
                onChange={(e) => set({ productionStatus: e.target.value as ProductionStatus | "" })}
              >
                <option value="">—</option>
                {PRODUCTION_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {PRODUCTION_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Trạng thái</span>
              <Select value={form.status} onChange={(e) => set({ status: e.target.value as typeof form.status })}>
                {CONTENT_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {CONTENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Ưu tiên</span>
              <Select
                value={form.priority}
                onChange={(e) => set({ priority: e.target.value as ContentPriority | "" })}
              >
                <option value="">—</option>
                {CONTENT_PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {CONTENT_PRIORITY_LABELS[p]}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <UrlInput label="Link cuối (final)" value={form.finalUrl} onChange={(v) => set({ finalUrl: v })} />
          <UrlInput label="Thumbnail" value={form.thumbnailUrl} onChange={(v) => set({ thumbnailUrl: v })} />
          <UrlInput label="Kịch bản" value={form.scriptUrl} onChange={(v) => set({ scriptUrl: v })} />
          <UrlInput label="File video" value={form.videoFileUrl} onChange={(v) => set({ videoFileUrl: v })} />
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Đang lưu…" : "Lưu"}
            </Button>
            {save.isError && <span className="text-sm text-destructive">Lưu thất bại.</span>}
            {save.isSuccess && <span className="text-sm text-green-600">Đã lưu.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function UrlInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…" />
    </label>
  );
}

// ── Publish targets (CNT-002) ─────────────────────────────────────────────────

function PublishTargetsTab({ content }: { content: ContentItemDto }) {
  const qc = useQueryClient();
  const canUpdate = useCan("update", "content");
  const targets = useMemo(() => content.channels ?? [], [content.channels]);
  const [channelId, setChannelId] = useState("");

  const { data: channels = [] } = useQuery({
    queryKey: ["channels", {}],
    queryFn: () => channelsApi.listChannels(),
  });
  const available = useMemo(() => {
    const linked = new Set(targets.map((t) => t.channelId));
    return channels.filter((c) => !linked.has(c.id));
  }, [channels, targets]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["content", content.id] });

  const add = useMutation({
    mutationFn: () => contentApi.addContentChannel(content.id, { channelId }),
    onSuccess: () => {
      setChannelId("");
      invalidate();
    },
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, publishStatus }: { id: string; publishStatus: ContentChannelDto["publishStatus"] }) =>
      contentApi.updateContentChannel(content.id, id, { publishStatus: publishStatus ?? undefined }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => contentApi.removeContentChannel(content.id, id),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <PermissionGate action="update" resourceType="content">
        <div className="flex items-end gap-2">
          <label className="flex-1 space-y-1">
            <span className="text-xs text-muted-foreground">Thêm kênh đăng</span>
            <Select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">— Chọn kênh —</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({PLATFORM_LABELS[c.platform]})
                </option>
              ))}
            </Select>
          </label>
          <Button size="sm" onClick={() => add.mutate()} disabled={!channelId || add.isPending}>
            Thêm
          </Button>
        </div>
      </PermissionGate>
      {add.isError && <p className="text-sm text-destructive">Thêm kênh thất bại.</p>}

      {targets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa gắn kênh đăng nào.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {targets.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {t.channelName} <span className="text-muted-foreground">({PLATFORM_LABELS[t.platform]})</span>
                </p>
                {t.publishUrl && (
                  <a
                    href={t.publishUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-xs text-primary hover:underline"
                  >
                    {t.publishUrl}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                {canUpdate ? (
                  <Select
                    value={t.publishStatus ?? "not_scheduled"}
                    onChange={(e) =>
                      updateStatus.mutate({
                        id: t.id,
                        publishStatus: e.target.value as ContentChannelDto["publishStatus"],
                      })
                    }
                    className="h-8 w-36"
                  >
                    {PUBLISH_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {PUBLISH_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t.publishStatus ? PUBLISH_STATUS_LABELS[t.publishStatus] : "—"}
                  </span>
                )}
                <PermissionGate action="update" resourceType="content">
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(t.id)}>
                    Gỡ
                  </Button>
                </PermissionGate>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Assets (version chain, CNT-003) ───────────────────────────────────────────

function AssetsTab({ content }: { content: ContentItemDto }) {
  const qc = useQueryClient();

  /** Nhóm theo versionGroupId; mỗi nhóm sắp theo version giảm dần (mới nhất trước). */
  const groups = useMemo(() => {
    const byGroup = new Map<string, ContentAssetDto[]>();
    for (const a of content.assets ?? []) {
      const list = byGroup.get(a.versionGroupId) ?? [];
      list.push(a);
      byGroup.set(a.versionGroupId, list);
    }
    return [...byGroup.values()].map((list) => [...list].sort((a, b) => b.version - a.version));
  }, [content.assets]);

  return (
    <div className="space-y-4">
      <PermissionGate action="update" resourceType="content">
        <NewAssetForm contentId={content.id} qc={qc} />
      </PermissionGate>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có asset nào.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((versions) => (
            <AssetGroup key={versions[0].versionGroupId} contentId={content.id} versions={versions} qc={qc} />
          ))}
        </div>
      )}
    </div>
  );
}

interface QcProp {
  qc: ReturnType<typeof useQueryClient>;
}

function NewAssetForm({ contentId, qc }: { contentId: string } & QcProp) {
  const [assetType, setAssetType] = useState("");
  const [name, setName] = useState("");
  const [externalUrl, setExternalUrl] = useState("");

  const create = useMutation({
    mutationFn: () =>
      contentApi.createAsset(contentId, {
        assetType: assetType ? (assetType as ContentAssetDto["assetType"]) ?? undefined : undefined,
        name: name.trim() || undefined,
        externalUrl: externalUrl.trim(),
      }),
    onSuccess: () => {
      setAssetType("");
      setName("");
      setExternalUrl("");
      void qc.invalidateQueries({ queryKey: ["content", contentId] });
    },
  });

  return (
    <div className="space-y-2 rounded-xl border border-border p-4">
      <p className="text-sm font-medium">Thêm asset mới</p>
      <div className="grid grid-cols-2 gap-2">
        <Select value={assetType} onChange={(e) => setAssetType(e.target.value)}>
          <option value="">— Loại asset —</option>
          {ASSET_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {ASSET_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên asset…" />
      </div>
      <Input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://… (link asset)" />
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => create.mutate()} disabled={!externalUrl.trim() || create.isPending}>
          {create.isPending ? "Đang thêm…" : "Thêm asset"}
        </Button>
        {create.isError && <span className="text-sm text-destructive">Thêm thất bại.</span>}
      </div>
    </div>
  );
}

function AssetGroup({
  contentId,
  versions,
  qc,
}: { contentId: string; versions: ContentAssetDto[] } & QcProp) {
  const canUpdate = useCan("update", "content");
  const current = versions.find((v) => v.isCurrent) ?? versions[0];
  const [adding, setAdding] = useState(false);
  const [externalUrl, setExternalUrl] = useState("");

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["content", contentId] });

  const addVersion = useMutation({
    mutationFn: () =>
      contentApi.createAssetVersion(contentId, current.id, { externalUrl: externalUrl.trim() }),
    onSuccess: () => {
      setExternalUrl("");
      setAdding(false);
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (assetId: string) => contentApi.deleteAsset(contentId, assetId),
    onSuccess: invalidate,
  });

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {current.name ?? (current.assetType ? ASSET_TYPE_LABELS[current.assetType] : "Asset")}
          <span className="ml-2 text-xs text-muted-foreground">
            {current.assetType ? ASSET_TYPE_LABELS[current.assetType] : ""}
          </span>
        </p>
        {canUpdate && (
          <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
            {adding ? "Huỷ" : "+ Version"}
          </Button>
        )}
      </div>

      {adding && (
        <div className="mt-2 flex items-end gap-2">
          <Input
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            placeholder="https://… (link version mới)"
          />
          <Button
            size="sm"
            onClick={() => addVersion.mutate()}
            disabled={!externalUrl.trim() || addVersion.isPending}
          >
            Lưu version
          </Button>
        </div>
      )}

      <ul className="mt-3 space-y-1">
        {versions.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">v{v.version}</span>
              {v.isCurrent && (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  Hiện hành
                </span>
              )}
              {(v.externalUrl ?? v.fileUrl) && (
                <a
                  href={v.externalUrl ?? v.fileUrl ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-xs text-primary hover:underline"
                >
                  {v.externalUrl ?? v.fileUrl}
                </a>
              )}
            </div>
            {canUpdate && (
              <Button variant="ghost" size="sm" onClick={() => remove.mutate(v.id)}>
                Xoá
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
