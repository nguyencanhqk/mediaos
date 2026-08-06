"use client";

import { useCallback, useEffect, useState } from "react";
import { LibraryPicker } from "@/components/library-picker";
import { Alert, Section, Spinner } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/client-api";
import type { MediaFile } from "@/lib/types";

/**
 * Kho video — cau hinh thu muc va duyet noi dung trong do.
 *
 * Day la duong nap file NANG: file di thang tu o dia (cuc bo hoac chia se trong LAN) vao dia may
 * chu, khong qua HTTP, nen khong dinh tran 96MB cua middleware Next lan tran 100MB cua Cloudflare.
 *
 * CAU HINH va DUYET tach quyen khac nhau — co chu y:
 *   - duyet/nap: moi phien deu lam duoc (ai vao duoc app deu de dang bai)
 *   - them/xoa thu muc goc: chi email trong SOCIAL_ADMIN_EMAILS. Them mot goc la tu mo rong pham
 *     vi file may chu duoc doc; neu ai cung lam duoc thi ca lop whitelist thanh vo nghia.
 */

interface RootView {
  key: string;
  label: string;
  path: string | null;
  source: "env" | "config";
  username: string | null;
  status: "ok" | "denied" | "missing";
  fileCount: number | null;
  connectError: string | null;
}

interface RootsResponse {
  roots: RootView[];
  canManage: boolean;
  /** Email dang dung — chi tra ve khi KHONG duoc phep cau hinh, de nguoi dung biet vi sao. */
  signedInAs: string | null;
}

const STATUS_VIEW: Record<RootView["status"], { label: string; tone: string; hint: string }> = {
  ok: { label: "Đọc được", tone: "#1a7f42", hint: "" },
  denied: {
    label: "Không có quyền",
    tone: "#b4242a",
    hint: "Đọc được đường dẫn nhưng không được phép vào. Nếu đây là ổ chia sẻ trong mạng, hãy thêm lại kho này kèm tài khoản đăng nhập của ổ đó.",
  },
  missing: {
    label: "Không mở được",
    tone: "#8a5a05",
    hint: "Không thấy thư mục: sai đường dẫn, máy chưa bật, hoặc thư mục chưa được chia sẻ. Đường dẫn mạng hãy ghi dạng //MÁY/share/thư-mục.",
  },
};

export default function LibraryPage() {
  const [data, setData] = useState<RootsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [dirPath, setDirPath] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [creating, setCreating] = useState(false);

  // Chi o dia chia se moi can dang nhap. Nhan dang ngay khi go de o tai khoan hien ra dung luc
  // nguoi dung can, thay vi bat ho them xong roi moi biet la thieu.
  const isNetworkPath = /^(\/\/|\\\\)/.test(dirPath.trim());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiGet<RootsResponse>("/api/library/roots"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addRoot = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiSend("/api/library/roots", "POST", { label, path: dirPath, username, password });
      setLabel("");
      setDirPath("");
      setUsername("");
      setPassword("");
      setNotice("Đã thêm kho.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const removeRoot = async (root: RootView) => {
    if (
      !confirm(`Bỏ kho "${root.label}" khỏi danh sách?\n\nFile đã nạp vào thư viện vẫn giữ nguyên.`)
    )
      return;
    setError(null);
    setNotice(null);
    try {
      await apiSend(`/api/library/roots?key=${encodeURIComponent(root.key)}`, "DELETE");
      setNotice(`Đã bỏ kho "${root.label}".`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /**
   * File da nap xong moi chi nam trong kho media — chua hien o dau ca. Tao luon mot muc trong Thu
   * vien noi dung cho tung file de nguoi dung sang thang buoc Len lich duoc, khoi phai go tay lai.
   */
  const createContents = async (media: MediaFile[]) => {
    setCreating(true);
    setError(null);
    let done = 0;
    try {
      for (const m of media) {
        await apiSend("/api/contents", "POST", {
          label: m.originalName,
          type: m.kind === "image" ? "photo" : "video",
          message: "",
          mediaIds: [m.id],
        });
        done += 1;
      }
      setNotice(`Đã nạp ${done} file và tạo ${done} mục trong Thư viện nội dung.`);
    } catch (e) {
      setError(`Nạp được ${done}/${media.length} file rồi dừng: ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pb-16">
      <div>
        <h1 className="text-xl font-bold">Kho video</h1>
        <p className="hint mt-1">
          Nạp video nặng từ thư mục trên máy chủ hoặc ổ chia sẻ trong mạng — không giới hạn dung
          lượng. Tải qua trình duyệt bị chặn ở 96&nbsp;MB.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Section
        title="Thư mục kho"
        description="Chỉ những thư mục ở đây mới được đọc. Ngoài danh sách này máy chủ từ chối, kể cả khi ghi đường dẫn đầy đủ trong file CSV."
      >
        {loading && <Spinner label="Đang kiểm tra…" />}

        {!loading && data && data.roots.length === 0 && <p className="hint">Chưa có kho nào.</p>}

        {!loading && data && data.roots.length > 0 && (
          <ul className="space-y-2">
            {data.roots.map((root) => {
              const view = STATUS_VIEW[root.status];
              return (
                <li
                  key={root.key}
                  className="rounded-lg border p-3"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{root.label}</span>
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: `${view.tone}1a`, color: view.tone }}
                    >
                      {view.label}
                      {root.fileCount !== null ? ` · ${root.fileCount} mục` : ""}
                    </span>
                    {root.source === "env" && (
                      <span className="hint text-xs">(đặt trong cấu hình máy chủ)</span>
                    )}
                    {data.canManage && root.source === "config" && (
                      <button
                        type="button"
                        className="ml-auto text-xs font-semibold"
                        style={{ color: "#d9484d" }}
                        onClick={() => void removeRoot(root)}
                      >
                        Bỏ khỏi danh sách
                      </button>
                    )}
                  </div>
                  {root.path && (
                    <p className="hint mt-1 font-mono text-xs break-all">{root.path}</p>
                  )}
                  {root.username && (
                    <p className="hint mt-1 text-xs">
                      Đăng nhập bằng tài khoản <strong>{root.username}</strong>
                    </p>
                  )}
                  {/* Loi dang nhap CU THE hon chan doan chung — uu tien hien no. */}
                  {root.connectError ? (
                    <p className="mt-2 text-sm" style={{ color: "#b4242a" }}>
                      {root.connectError} Thêm lại kho này với tài khoản đúng để sửa.
                    </p>
                  ) : (
                    view.hint && (
                      <p className="mt-2 text-sm" style={{ color: view.tone }}>
                        {view.hint}
                      </p>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {data?.canManage && (
          <div className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <h3 className="text-sm font-bold">Thêm thư mục</h3>
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <label className="block">
                <span className="hint">Tên hiển thị</span>
                <input
                  className="field mt-1"
                  value={label}
                  placeholder="Bánh xe"
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="hint">Đường dẫn</span>
                <input
                  className="field mt-1"
                  value={dirPath}
                  placeholder="//DESKTOP-KTNA4B6/Banh xe/BÁNH XE"
                  onChange={(e) => setDirPath(e.target.value)}
                />
              </label>
            </div>
            <p className="hint">
              Ổ chia sẻ trong mạng hãy ghi bằng <strong>gạch xuôi</strong>:{" "}
              <code>//TÊN-MÁY/tên-share/thư-mục</code>. Dấu gạch ngược rất dễ bị mất một cái khi
              gõ/dán, và khi đó đường dẫn âm thầm trỏ sang ổ C: của máy chủ.
            </p>

            {isNetworkPath && (
              <div
                className="space-y-3 rounded-lg border p-3"
                style={{ borderColor: "var(--border)" }}
              >
                <p className="text-sm font-semibold">Tài khoản đăng nhập ổ chia sẻ</p>
                <p className="hint">
                  Đây là ổ trong mạng nên máy chủ phải đăng nhập mới đọc được — nhập tài khoản anh
                  vẫn dùng để mở thư mục đó. Mật khẩu được mã hoá trước khi lưu và không bao giờ
                  hiển thị lại.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="hint">Tài khoản</span>
                    <input
                      className="field mt-1"
                      value={username}
                      placeholder="ADMIN"
                      autoComplete="off"
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    <span className="hint">Mật khẩu</span>
                    <input
                      className="field mt-1"
                      type="password"
                      value={password}
                      autoComplete="new-password"
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                </div>
                <p className="hint">
                  Tài khoản <strong>của máy chứa thư mục</strong>, không phải tài khoản máy chủ. Ghi
                  kèm tên máy cho chắc: <code>DESKTOP-KTNA4B6\ADMIN</code>. Ghi tên trần (
                  <code>ADMIN</code>) cũng được — máy chủ sẽ tự thử lại với tên đầy đủ nếu lần đầu
                  bị từ chối.
                </p>
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || dirPath.trim() === ""}
              onClick={() => void addRoot()}
            >
              {saving ? "Đang kiểm tra…" : "Thêm kho"}
            </button>
            <p className="hint">
              Thư mục sẽ được thử đọc ngay khi thêm. Không đọc được thì không lưu — để danh sách
              không chứa mục hỏng.
            </p>
          </div>
        )}

        {data && !data.canManage && (
          <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <p className="hint">Bạn xem và nạp file được, nhưng không thêm/bớt được thư mục kho.</p>
            {data.signedInAs && (
              <p className="hint mt-1">
                Đang đăng nhập bằng <strong>{data.signedInAs}</strong> — email này chưa nằm trong
                danh sách được cấu hình kho (<code>SOCIAL_ADMIN_EMAILS</code>).
              </p>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Duyệt kho"
        description="Chọn file rồi nạp — mỗi file sẽ thành một mục trong Thư viện nội dung để đem đi lên lịch."
      >
        {!browsing ? (
          <button type="button" className="btn btn-primary" onClick={() => setBrowsing(true)}>
            Mở kho video
          </button>
        ) : (
          <LibraryPicker
            onPicked={(media) => void createContents(media)}
            onClose={() => setBrowsing(false)}
          />
        )}
        {creating && (
          <div className="mt-3">
            <Spinner label="Đang tạo mục trong Thư viện nội dung…" />
          </div>
        )}
      </Section>
    </main>
  );
}
