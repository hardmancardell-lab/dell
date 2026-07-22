import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NavBar } from "@/components/NavBar";
import { PrivacyFooter } from "@/components/PrivacyFooter";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
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
  title: "Graham Research Agent",
  description: "A Benjamin Graham-style long-term investing research agent.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Graham Agent",
  },
  icons: {
    apple: "/api/pwa-icon?size=180",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
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
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        <NavBar />
        <div className="flex-1">{children}</div>
        <PrivacyFooter />
      </body>
    </html>
  );
}
