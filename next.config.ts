import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bibliotecas de leitura de documentos rodam apenas no servidor (Node), sem bundling.
  serverExternalPackages: ["pdf-parse", "mammoth", "xlsx"],
  async headers() {
    return [
      {
        source: "/wasm/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
