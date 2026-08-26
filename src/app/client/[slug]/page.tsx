import { ClientDashboardView } from "@/components/ClientDashboardView";

export default async function ClientPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ClientDashboardView slug={slug} />;
}
