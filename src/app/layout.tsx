import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NavBar } from "@/components/NavBar";
import { PrivacyFooter } from "@/components/PrivacyFooter";
import { FeedbackWidget } from "@/components/FeedbackWidget";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { EnsureAdvisorLink } from "@/components/EnsureAdvisorLink";
import { WatchlistProvider } from "@/lib/agents/trading-agent/watchlist-storage";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dellegate — Delegate the research. Own the decision.",
  description: "Delegate the research. Own the decision. Top-down macro research, trading signals, and portfolio tracking built on real market data.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Dellegate",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  // A custom viewport export replaces Next.js's built-in default entirely —
  // width/initialScale aren't merged in for free, so omitting them here was
  // rendering the whole app at desktop width (~980px) and shrinking it to
  // fit on phones instead of laying out at the real device width.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col jv-app-bg">
        <ServiceWorkerRegister />
        <EnsureAdvisorLink />
        <NavBar />
        {/* Every route gets one shared watchlist — not just the main tabbed
            page.tsx SPA. A standalone route (e.g. /security) rendering a
            component that calls useWatchlist()/useResearchWatchlist()
            without this ancestor fails at build time (confirmed live: the
            /security page's static prerender threw
            "useWatchlist() must be used within a WatchlistProvider"),
            so this lives at the true root rather than inside page.tsx. */}
        <WatchlistProvider>
          <div className="flex-1">{children}</div>
        </WatchlistProvider>
        <PrivacyFooter />
        <FeedbackWidget />
      </body>
    </html>
  );
}
