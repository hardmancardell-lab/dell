import { ImageResponse } from "next/og";

/**
 * Generated placeholder PWA icon — no design assets exist yet, easy to swap
 * for a real logo later. Renders at any requested size so manifest.ts can
 * reference the same route for both the 192 and 512 slots.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const size = Math.min(1024, Math.max(16, Number(searchParams.get("size")) || 512));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#18181b",
          color: "#fafafa",
          fontSize: size * 0.52,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        G
      </div>
    ),
    { width: size, height: size }
  );
}
