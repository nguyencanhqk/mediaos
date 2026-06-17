import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type {
  ContentAssetDto,
  ContentChannelDto,
  ContentItemDto,
  ContentPriority,
  ContentStatus,
  ProductionStatus,
  UpdateContentItemRequest,
  WorkflowStepDto,
} from "@mediaos/contracts";
import { contentApi } from "@/lib/content-api";
import { channelsApi } from "@/lib/channels-api";
import { workflowApi } from "@/lib/workflow-api";
import { employeesApi } from "@/lib/employees-api";
import { PermissionGate } from "@mediaos/web-core";
import { useCan } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
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

type Tab = "overview" | "workflow" | "channels" | "assets";

export function ContentDetailPage() {
  const { t } = useTranslation("channels");
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
        {t("contentDetail.backLink")}
      </Link>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("contentDetail.loadError")}</p>}

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
              {t("contentDetail.tabOverview")}
            </TabButton>
            <TabButton active={tab === "workflow"} onClick={() => setTab("workflow")}>
              {t("contentDetail.tabWorkflow")}
            </TabButton>
            <TabButton active={tab === "channels"} onClick={() => setTab("channels")}>
              {t("contentDetail.tabChannels", { count: content.channels?.length ?? 0 })}
            </TabButton>
            <TabButton active={tab === "assets"} onClick={() => setTab("assets")}>
              {t("contentDetail.tabAssets", { count: content.assets?.length ?? 0 })}
            </TabButton>
          </div>

          {tab === "overview" && <OverviewTab content={content} />}
          {tab === "workflow" && <WorkflowTab content={content} />}
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
  const { t } = useTranslation("channels");
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
        <Field label={t("contentDetail.overview.fieldCode")} value={content.code ?? "—"} />
        <Field label={t("contentDetail.overview.fieldLanguage")} value={content.language ?? "—"} />
        <Field
          label={t("contentDetail.overview.fieldPlannedPublish")}
          value={content.plannedPublishAt ? new Date(content.plannedPublishAt).toLocaleString("vi") : "—"}
        />
        <Field
          label={t("contentDetail.overview.fieldPublishedAt")}
          value={content.publishedAt ? new Date(content.publishedAt).toLocaleString("vi") : "—"}
        />
      </dl>

      {!canUpdate ? (
        <p className="text-sm text-muted-foreground">{t("contentDetail.overview.noPermission")}</p>
      ) : (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="grid grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("contentDetail.overview.productionStatusLabel")}</span>
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
              <span className="text-xs text-muted-foreground">{t("contentDetail.overview.statusLabel")}</span>
              <Select value={form.status} onChange={(e) => set({ status: e.target.value as typeof form.status })}>
                {CONTENT_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {CONTENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("contentDetail.overview.priorityLabel")}</span>
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
          <UrlInput label={t("contentDetail.overview.linkFinal")} value={form.finalUrl} onChange={(v) => set({ finalUrl: v })} />
          <UrlInput label={t("contentDetail.overview.linkThumbnail")} value={form.thumbnailUrl} onChange={(v) => set({ thumbnailUrl: v })} />
          <UrlInput label={t("contentDetail.overview.linkScript")} value={form.scriptUrl} onChange={(v) => set({ scriptUrl: v })} />
          <UrlInput label={t("contentDetail.overview.linkVideo")} value={form.videoFileUrl} onChange={(v) => set({ videoFileUrl: v })} />
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? t("contentDetail.overview.saving") : t("common:actions.save")}
            </Button>
            {save.isError && <span className="text-sm text-destructive">{t("contentDetail.overview.saveFailed")}</span>}
            {save.isSuccess && <span className="text-sm text-green-600">{t("contentDetail.overview.saveSuccess")}</span>}
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

// ── Workflow / Sản xuất (G4-3 board + start + assign) ─────────────────────────

const STEP_STATUS_LABELS: Record<WorkflowStepDto["status"], string> = {
  not_started: "Chưa bắt đầu",
  in_progress: "Đang làm",
  waiting_review: "Chờ duyệt",
  approved: "Đã duyệt",
  revision: "Đang sửa",
  blocked: "Bị chặn",
};

const STEP_STATUS_COLORS: Record<WorkflowStepDto["status"], string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-700",
  waiting_review: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  revision: "bg-orange-100 text-orange-700",
  blocked: "bg-red-100 text-red-700",
};

function WorkflowTab({ content }: { content: ContentItemDto }) {
  const { t } = useTranslation("channels");
  const qc = useQueryClient();
  const canUpdate = useCan("update", "content");

  const { data: workflow, isLoading, isError } = useQuery({
    queryKey: ["workflow", content.id],
    queryFn: () => workflowApi.getByContent(content.id),
  });

  const start = useMutation({
    mutationFn: () => workflowApi.start(content.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workflow", content.id] }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common:loading")}</p>;
  if (isError) return <p className="text-sm text-destructive">{t("contentDetail.workflow.loadError")}</p>;

  if (!workflow) {
    return (
      <div className="space-y-3 rounded-xl border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t("contentDetail.workflow.notStartedDesc")}
        </p>
        <PermissionGate
          action="update"
          resourceType="content"
          fallback={<p className="text-xs text-muted-foreground">{t("contentDetail.workflow.noPermissionStart")}</p>}
        >
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending ? t("contentDetail.workflow.starting") : t("contentDetail.workflow.startButton")}
          </Button>
        </PermissionGate>
        {start.isError && (
          <p className="text-xs text-destructive">
            {start.error instanceof Error ? start.error.message : t("contentDetail.workflow.startError")}
          </p>
        )}
      </div>
    );
  }

  const steps = [...workflow.steps].sort((a, b) => a.stepOrder - b.stepOrder);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
        <span>
          {t("contentDetail.workflow.statusLabel")}{" "}
          <span className="font-medium">
            {workflow.instance.status === "completed"
              ? t("contentDetail.workflow.statusCompleted")
              : workflow.instance.status === "cancelled"
                ? t("contentDetail.workflow.statusCancelled")
                : t("contentDetail.workflow.statusAtStep", { current: workflow.instance.currentStepOrder, total: steps.length })}
          </span>
        </span>
        <Link to="/tasks" className="text-primary hover:underline">
          {t("contentDetail.workflow.myTasksLink")}
        </Link>
      </div>

      <ol className="space-y-2">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} contentId={content.id} canUpdate={canUpdate} qc={qc} />
        ))}
      </ol>
    </div>
  );
}

function StepRow({
  step,
  contentId,
  canUpdate,
  qc,
}: { step: WorkflowStepDto; contentId: string; canUpdate: boolean } & QcProp) {
  const { t } = useTranslation("channels");
  const [editing, setEditing] = useState(false);
  const [assigneeUserId, setAssigneeUserId] = useState(step.assigneeUserId ?? "");
  const [reviewerUserId, setReviewerUserId] = useState(step.reviewerUserId ?? "");

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeesApi.listEmployees({ status: "active" }),
    enabled: canUpdate && editing,
  });

  const nameById = (userId: string | null) =>
    userId ? (employees.find((e) => e.userId === userId)?.userFullName ?? "Đã giao") : "—";

  const assign = useMutation({
    mutationFn: () =>
      workflowApi.assignStep(step.id, {
        assigneeUserId: assigneeUserId || null,
        reviewerUserId: reviewerUserId || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workflow", contentId] });
      setEditing(false);
    },
  });

  return (
    <li className="rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            <span className="mr-2 text-muted-foreground">{step.stepOrder}.</span>
            {step.stepName}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("contentDetail.workflow.assigneeMeta", { assignee: nameById(step.assigneeUserId), reviewer: nameById(step.reviewerUserId) })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STEP_STATUS_COLORS[step.status]}`}
          >
            {STEP_STATUS_LABELS[step.status]}
          </span>
          {canUpdate && (
            <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
              {editing ? t("contentDetail.workflow.closeAssign") : t("contentDetail.workflow.assign")}
            </Button>
          )}
        </div>
      </div>

      {editing && canUpdate && (
        <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2 border-t border-border pt-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">{t("contentDetail.workflow.assignee")}</span>
            <Select value={assigneeUserId} onChange={(e) => setAssigneeUserId(e.target.value)}>
              <option value="">{t("contentDetail.workflow.assigneePlaceholder")}</option>
              {employees.map((e) => (
                <option key={e.userId} value={e.userId}>
                  {e.userFullName ?? e.userEmail ?? e.userId}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">{t("contentDetail.workflow.reviewer")}</span>
            <Select value={reviewerUserId} onChange={(e) => setReviewerUserId(e.target.value)}>
              <option value="">{t("contentDetail.workflow.reviewerPlaceholder")}</option>
              {employees.map((e) => (
                <option key={e.userId} value={e.userId}>
                  {e.userFullName ?? e.userEmail ?? e.userId}
                </option>
              ))}
            </Select>
          </label>
          <Button size="sm" onClick={() => assign.mutate()} disabled={assign.isPending}>
            {assign.isPending ? t("contentDetail.workflow.savingAssign") : t("common:actions.save")}
          </Button>
          {assign.isError && (
            <p className="col-span-3 text-xs text-destructive">
              {assign.error instanceof Error ? assign.error.message : t("contentDetail.workflow.assignFailed")}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

// ── Publish targets (CNT-002) ─────────────────────────────────────────────────

function PublishTargetsTab({ content }: { content: ContentItemDto }) {
  const { t } = useTranslation("channels");
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
            <span className="text-xs text-muted-foreground">{t("contentDetail.publishTargets.addChannelLabel")}</span>
            <Select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">{t("contentDetail.publishTargets.channelPlaceholder")}</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({PLATFORM_LABELS[c.platform]})
                </option>
              ))}
            </Select>
          </label>
          <Button size="sm" onClick={() => add.mutate()} disabled={!channelId || add.isPending}>
            {t("common:actions.add")}
          </Button>
        </div>
      </PermissionGate>
      {add.isError && <p className="text-sm text-destructive">{t("contentDetail.publishTargets.addFailed")}</p>}

      {targets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("contentDetail.publishTargets.empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {targets.map((tgt) => (
            <li key={tgt.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {tgt.channelName} <span className="text-muted-foreground">({PLATFORM_LABELS[tgt.platform]})</span>
                </p>
                {tgt.publishUrl && (
                  <a
                    href={tgt.publishUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-xs text-primary hover:underline"
                  >
                    {tgt.publishUrl}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                {canUpdate ? (
                  <Select
                    value={tgt.publishStatus ?? "not_scheduled"}
                    onChange={(e) =>
                      updateStatus.mutate({
                        id: tgt.id,
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
                    {tgt.publishStatus ? PUBLISH_STATUS_LABELS[tgt.publishStatus] : "—"}
                  </span>
                )}
                <PermissionGate action="update" resourceType="content">
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(tgt.id)}>
                    {t("contentDetail.publishTargets.removeButton")}
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
  const { t } = useTranslation("channels");
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
        <p className="text-sm text-muted-foreground">{t("contentDetail.assets.empty")}</p>
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
  const { t } = useTranslation("channels");
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
      <p className="text-sm font-medium">{t("contentDetail.assets.newAssetTitle")}</p>
      <div className="grid grid-cols-2 gap-2">
        <Select value={assetType} onChange={(e) => setAssetType(e.target.value)}>
          <option value="">{t("contentDetail.assets.assetTypePlaceholder")}</option>
          {ASSET_TYPE_OPTIONS.map((at) => (
            <option key={at} value={at}>
              {ASSET_TYPE_LABELS[at]}
            </option>
          ))}
        </Select>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("contentDetail.assets.assetNamePlaceholder")} />
      </div>
      <Input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder={t("contentDetail.assets.assetUrlPlaceholder")} />
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => create.mutate()} disabled={!externalUrl.trim() || create.isPending}>
          {create.isPending ? t("contentDetail.assets.addingAsset") : t("contentDetail.assets.addAssetButton")}
        </Button>
        {create.isError && <span className="text-sm text-destructive">{t("contentDetail.assets.addFailed")}</span>}
      </div>
    </div>
  );
}

function AssetGroup({
  contentId,
  versions,
  qc,
}: { contentId: string; versions: ContentAssetDto[] } & QcProp) {
  const { t } = useTranslation("channels");
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
            {adding ? t("contentDetail.assets.cancelVersion") : t("contentDetail.assets.addVersion")}
          </Button>
        )}
      </div>

      {adding && (
        <div className="mt-2 flex items-end gap-2">
          <Input
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            placeholder={t("contentDetail.assets.versionUrlPlaceholder")}
          />
          <Button
            size="sm"
            onClick={() => addVersion.mutate()}
            disabled={!externalUrl.trim() || addVersion.isPending}
          >
            {t("contentDetail.assets.saveVersion")}
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
                  {t("contentDetail.assets.current")}
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
                {t("contentDetail.assets.deleteVersion")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
