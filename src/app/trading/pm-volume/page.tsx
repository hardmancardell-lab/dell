import { PmVolumeTab } from "@/components/PmVolumeTab";

export default function PmVolumePage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
          Trading Agent &middot; PM-Volume Tracker
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mt-1 mb-6">
          Pre-Market Volume Anomaly
        </h1>
        <PmVolumeTab />
      </main>
    </div>
  );
}
