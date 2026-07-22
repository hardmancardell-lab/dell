import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Graham Research Agent",
    short_name: "Graham Agent",
    description:
      "Top-down macro research, trading signals, and portfolio tracking built on real market data — no order execution, no faked data.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/api/pwa-icon?size=192", sizes: "192x192", type: "image/png" },
      { src: "/api/pwa-icon?size=512", sizes: "512x512", type: "image/png" },
    ],
  };
}
