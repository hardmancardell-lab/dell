import { OptionsCalculatorTab } from "@/components/OptionsCalculatorTab";

export default function OptionsCalculatorPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
          Trading Agent &middot; Options Calculator
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mt-1 mb-6">
          Black-Scholes Calculator
        </h1>
        <OptionsCalculatorTab />
      </main>
    </div>
  );
}
