import { NextRequest } from "next/server";
import { fail, guard, ok } from "@/lib/api";
import { listManagedPages } from "@/lib/fb/auth";
import { getAccount, listAccounts } from "@/lib/repo/account-repo";
import { listPages, toPublic, upsertPages } from "@/lib/repo/page-repo";
import type { AccountWithSecrets } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Danh sach Page cua tat ca tai khoan.
 *
 * GET  - doc tu CSDL, khong goi Facebook.
 * POST - hoi lai Facebook bang User Access Token cua tung tai khoan roi dong bo.
 *        Them `?accountId=` de chi lam moi mot tai khoan.
 *        Tai khoan nao loi thi chi bao rieng tai khoan do, cac tai khoan
 *        con lai van duoc dong bo binh thuong.
 */

export async function GET() {
  return guard(async () => ok(listPages().map(toPublic)));
}

interface SyncOutcome {
  accountId: number;
  accountName: string;
  added: number;
  updated: number;
  error: string | null;
}

async function syncAccount(account: AccountWithSecrets): Promise<SyncOutcome> {
  try {
    const fromFacebook = await listManagedPages(account.userToken);
    const result = upsertPages(
      account.id,
      fromFacebook.map((page) => ({
        pageId: page.id,
        name: page.name,
        accessToken: page.accessToken,
        canPost: page.tasks.includes("CREATE_CONTENT"),
      })),
    );
    return { accountId: account.id, accountName: account.name, ...result, error: null };
  } catch (error) {
    return {
      accountId: account.id,
      accountName: account.name,
      added: 0,
      updated: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const accountParam = request.nextUrl.searchParams.get("accountId");

    let accounts: AccountWithSecrets[];
    if (accountParam) {
      const account = getAccount(Number(accountParam));
      if (!account) return fail("Không tìm thấy tài khoản.", 404);
      accounts = [account];
    } else {
      accounts = listAccounts();
    }

    if (accounts.length === 0) {
      return fail("Chưa kết nối tài khoản Facebook nào. Vào trang Cài đặt để thêm tài khoản.");
    }

    // Tuan tu de khong ban nhieu request cung luc len Facebook.
    const outcomes: SyncOutcome[] = [];
    for (const account of accounts) {
      outcomes.push(await syncAccount(account));
    }

    return ok({
      added: outcomes.reduce((sum, o) => sum + o.added, 0),
      updated: outcomes.reduce((sum, o) => sum + o.updated, 0),
      outcomes,
      pages: listPages().map(toPublic),
    });
  });
}
