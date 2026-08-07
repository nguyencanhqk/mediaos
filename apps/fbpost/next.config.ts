import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs chua ma khong bundle duoc - de Next nap truc tiep tu node_modules.
  serverExternalPackages: ["exceljs"],

  experimental: {
    /**
     * Tran body cho request di qua middleware. Next 15.5 mac dinh 10MB, va vi middleware cua app
     * nay gac TOAN BO duong dan (ke ca /api), moi file upload deu bi cat o 10MB — bieu hien la
     * "Request body exceeded 10MB for /api/media" + ECONNRESET, con nguoi dung thi thay vong quay
     * dung mai.
     *
     * Vi sao 96mb chu khong lon hon: dangfb.funtimemediacorp.com di qua proxy Cloudflare, goi
     * Free/Pro chan cung body o 100MB va KHONG noi duoc bang code. Dat sat duoi tran do de loi
     * hien ra bang thong bao tieng Viet cua app thay vi trang 413 tran trui cua Cloudflare.
     *
     * Video nang KHONG di duong nay — chung di qua kho video doc tu thu muc (/api/library/import),
     * noi khong co tran nao ca.
     */
    middlewareClientMaxBodySize: "96mb",
  },
};

export default nextConfig;
