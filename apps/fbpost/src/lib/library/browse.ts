import fs from "node:fs";
import path from "node:path";
import { kindFromMime, mimeFromExtension } from "../media-service";
import type { MediaKind } from "../types";
import { LibraryPathError, libraryRoots, resolveFromRoot } from "./roots";

/** Duyet cay thu muc trong kho video (chi doc, khong sao chep gi). */

export interface LibraryEntry {
  name: string;
  /** Duong dan tuong doi so voi goc — thu client gui lai khi chon file. */
  relativePath: string;
}

export interface LibraryFileEntry extends LibraryEntry {
  size: number;
  /** Giay Unix. */
  modifiedAt: number;
  kind: MediaKind;
}

export interface LibraryListing {
  roots: { key: string; label: string }[];
  rootKey: string;
  relativePath: string;
  /** Cac chang duong dan de dung lam breadcrumb; phan tu dau la goc (relativePath rong). */
  breadcrumbs: LibraryEntry[];
  directories: LibraryEntry[];
  files: LibraryFileEntry[];
}

function breadcrumbsFor(relativePath: string, rootLabel: string): LibraryEntry[] {
  const crumbs: LibraryEntry[] = [{ name: rootLabel, relativePath: "" }];
  if (relativePath === "") return crumbs;

  let accumulated = "";
  for (const segment of relativePath.split(path.sep)) {
    if (segment === "") continue;
    accumulated = accumulated === "" ? segment : path.join(accumulated, segment);
    crumbs.push({ name: segment, relativePath: accumulated });
  }
  return crumbs;
}

/**
 * Liet ke mot thu muc trong kho.
 *
 * `withFileTypes` de khong phai stat rieng tung muc chi de biet no la thu muc hay file — thu muc
 * kho co the co hang nghin muc, moi lan stat la mot vong ra tan may LAN.
 *
 * File hong/khong stat duoc thi BO QUA thay vi lam hong ca danh sach: mot file dang duoc ghi do
 * tren may nguon khong nen lam nguoi dung khong duyet duoc thu muc.
 */
export function listLibrary(rootKey: string, relativePath: string): LibraryListing {
  const roots = libraryRoots();
  if (roots.length === 0) {
    throw new LibraryPathError(
      "Chưa khai báo kho video nào. Vào trang Kho video để thêm thư mục.",
    );
  }

  const resolved = resolveFromRoot(rootKey, relativePath);

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(resolved.absolutePath, { withFileTypes: true });
  } catch (error) {
    // Phan biet "khong co quyen" voi "khong ton tai": tren share LAN, EPERM/EACCES gan nhu luon
    // co nghia la tai khoan chay dich vu khong duoc cap quyen — mot viec vận hành, khong phai loi
    // nhap lieu. Gop hai cai lam mot se khien nguoi dung di sua duong dan trong khi loi o quyen.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      throw new LibraryPathError(
        "Không có quyền đọc thư mục này. Tài khoản đang chạy dịch vụ chưa được cấp quyền trên thư mục/ổ chia sẻ.",
      );
    }
    throw new LibraryPathError(`Không đọc được thư mục: ${relativePath || "(thư mục gốc)"}`);
  }

  const directories: LibraryEntry[] = [];
  const files: LibraryFileEntry[] = [];

  for (const dirent of dirents) {
    const childRelative = path.join(resolved.relativePath, dirent.name);

    if (dirent.isDirectory()) {
      directories.push({ name: dirent.name, relativePath: childRelative });
      continue;
    }
    // Symlink tro toi dau chua biet — de resolveFromRoot phan xu luc nguoi dung thuc su chon no.
    if (!dirent.isFile() && !dirent.isSymbolicLink()) continue;

    const kind = kindFromMime(mimeFromExtension(dirent.name));
    if (!kind) continue;

    try {
      const stat = fs.statSync(path.join(resolved.absolutePath, dirent.name));
      if (!stat.isFile()) continue;
      files.push({
        name: dirent.name,
        relativePath: childRelative,
        size: stat.size,
        modifiedAt: Math.floor(stat.mtimeMs / 1000),
        kind,
      });
    } catch {
      continue;
    }
  }

  const collator = new Intl.Collator("vi");
  directories.sort((a, b) => collator.compare(a.name, b.name));
  // File moi nhat len dau: video vua render xong la thu hay duoc dang nhat.
  files.sort((a, b) => b.modifiedAt - a.modifiedAt);

  return {
    roots: roots.map((r) => ({ key: r.key, label: r.label })),
    rootKey: resolved.root.key,
    relativePath: resolved.relativePath,
    breadcrumbs: breadcrumbsFor(resolved.relativePath, resolved.root.label),
    directories,
    files,
  };
}
