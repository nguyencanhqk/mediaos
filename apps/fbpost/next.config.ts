import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs chua ma khong bundle duoc - de Next nap truc tiep tu node_modules.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
