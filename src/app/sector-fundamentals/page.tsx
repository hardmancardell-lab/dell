import { SectorFundamentalsTab } from "@/components/SectorFundamentalsTab";

export default function SectorFundamentalsPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
          Layer 2 &middot; Sector Fundamentals
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mt-1 mb-6">
          Sector Balance Sheet Medians
        </h1>
        <SectorFundamentalsTab />
      </main>
    </div>
  );
}
