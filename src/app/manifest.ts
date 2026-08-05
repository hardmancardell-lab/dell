import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dellegate — Delegate the research. Own the decision.",
    short_name: "Dellegate",
    description:
      "Top-down macro research, trading signals, and portfolio tracking built on real market data — no order execution, no faked data.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icons/dellegate-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/dellegate-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
