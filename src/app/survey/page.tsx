import { SurveyForm } from "@/components/SurveyForm";

export default async function SurveyPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="mx-auto max-w-lg px-6 py-12">
        <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">Beta Feedback</div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-2">Quick Survey</h1>
        <p className="text-sm text-zinc-500 mb-6">
          Two quick questions, no login. Takes under a minute — your answers help decide what gets built next.
        </p>
        <SurveyForm referral={ref ?? null} />
      </main>
    </div>
  );
}
