import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PositionDto } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { orgApi } from "@/lib/org-api";
import { positionsApi } from "@/lib/positions-api";

interface PositionForm {
  name: string;
  code: string;
  level: string;
  orgUnitId: string;
  defaultRoleId: string;
  description: string;
}

const EMPTY_FORM: PositionForm = {
  name: "",
  code: "",
  level: "",
  orgUnitId: "",
  defaultRoleId: "",
  description: "",
};

function toForm(p: PositionDto): PositionForm {
  return {
    name: p.name,
    code: p.code ?? "",
    level: p.level != null ? String(p.level) : "",
    orgUnitId: p.orgUnitId ?? "",
    defaultRoleId: p.defaultRoleId ?? "",
    description: p.description ?? "",
  };
}

export function PositionsPage() {
  const qc = useQueryClient();
  const [orgUnitFilter, setOrgUnitFilter] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<PositionDto | null>(null);
  const [form, setForm] = useState<PositionForm>(EMPTY_FORM);

  const {
    data: positions = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["org", "positions", orgUnitFilter],
    queryFn: () => positionsApi.listPositions(orgUnitFilter || undefined),
  });

  const { data: orgUnits = [] } = useQuery({
    queryKey: ["org", "departments"],
    queryFn: orgApi.listDepartments,
  });

  // Roles catalog có thể chưa sẵn sàng phía BE → suy biến mềm (dropdown rỗng).
  const { data: roles = [] } = useQuery({
    queryKey: ["org", "roles"],
    queryFn: positionsApi.listRoles,
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["org", "positions"] });

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDrawerOpen(true);
  };

  const openEdit = (p: PositionDto) => {
    setEditing(p);
    setForm(toForm(p));
    setDrawerOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      // Chỉ gửi level khi là số nguyên hợp lệ; tránh để NaN/thập phân lọt tới Zod.
      const parsedLevel = Number(form.level);
      const level = form.level.trim() && Number.isInteger(parsedLevel) ? parsedLevel : undefined;
      if (editing) {
        return positionsApi.updatePosition(editing.id, {
          name: form.name.trim(),
          code: form.code.trim() || null,
          level: level ?? null,
          orgUnitId: form.orgUnitId || null,
          defaultRoleId: form.defaultRoleId || null,
          description: form.description.trim() || null,
        });
      }
      return positionsApi.createPosition({
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        level,
        orgUnitId: form.orgUnitId || undefined,
        defaultRoleId: form.defaultRoleId || undefined,
        description: form.description.trim() || undefined,
      });
    },
    onSuccess: () => {
      void invalidate();
      closeDrawer();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => positionsApi.deletePosition(id),
    onSuccess: () => void invalidate(),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Chức vụ</h1>
        <Button onClick={openCreate}>Thêm chức vụ</Button>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground" htmlFor="org-unit-filter">
          Lọc theo phòng ban
        </label>
        <Select
          id="org-unit-filter"
          value={orgUnitFilter}
          onChange={(e) => setOrgUnitFilter(e.target.value)}
          className="max-w-xs"
        >
          <option value="">Tất cả phòng ban</option>
          {orgUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được dữ liệu.</p>}
      {positions.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">Chưa có chức vụ nào.</p>
      )}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {positions.map((p) => (
          <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <span className="font-medium">{p.name}</span>
              {p.code && (
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {p.code}
                </span>
              )}
              {p.orgUnitName && (
                <span className="ml-2 text-xs text-muted-foreground">· {p.orgUnitName}</span>
              )}
              {p.defaultRoleName && (
                <span className="ml-2 text-xs text-muted-foreground">
                  Role: {p.defaultRoleName}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`text-xs ${
                  p.status === "active" ? "text-green-600" : "text-muted-foreground"
                }`}
              >
                {p.status}
              </span>
              <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                Sửa
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => remove.mutate(p.id)}
                disabled={remove.isPending}
              >
                Xoá
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog
        open={drawerOpen}
        onClose={closeDrawer}
        title={editing ? "Sửa chức vụ" : "Thêm chức vụ"}
        footer={
          <>
            <Button variant="outline" onClick={closeDrawer} disabled={save.isPending}>
              Huỷ
            </Button>
            <Button onClick={() => save.mutate()} disabled={!form.name.trim() || save.isPending}>
              {editing ? "Lưu" : "Tạo"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="pos-name">
              Tên chức vụ
            </label>
            <Input
              id="pos-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="VD: Trưởng nhóm sản xuất"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-sm" htmlFor="pos-code">
                Mã (tuỳ chọn)
              </label>
              <Input
                id="pos-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </div>
            <div className="w-28 space-y-1">
              <label className="text-sm" htmlFor="pos-level">
                Cấp (1–99)
              </label>
              <Input
                id="pos-level"
                type="number"
                min={1}
                max={99}
                value={form.level}
                onChange={(e) => setForm({ ...form, level: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm" htmlFor="pos-org-unit">
              Phòng ban
            </label>
            <Select
              id="pos-org-unit"
              value={form.orgUnitId}
              onChange={(e) => setForm({ ...form, orgUnitId: e.target.value })}
            >
              <option value="">— Không gán —</option>
              {orgUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-sm" htmlFor="pos-role">
              Vai trò mặc định
            </label>
            <Select
              id="pos-role"
              value={form.defaultRoleId}
              onChange={(e) => setForm({ ...form, defaultRoleId: e.target.value })}
              disabled={roles.length === 0}
            >
              <option value="">— Không gán —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            {roles.length === 0 && (
              <p className="text-xs text-muted-foreground">Danh mục vai trò chưa sẵn sàng.</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-sm" htmlFor="pos-desc">
              Mô tả (tuỳ chọn)
            </label>
            <Input
              id="pos-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          {save.isError && (
            <p className="text-sm text-destructive">Lưu thất bại, vui lòng thử lại.</p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
