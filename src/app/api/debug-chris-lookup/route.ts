import { NextResponse } from "next/server";
import { getAdvisorClientBySlug } from "@/lib/data/advisor-clients-db";
import { sendAlertEmail } from "@/lib/data/resend";

// TEMP debug route — read-only lookup (GET) + one-off resend (POST) of
// Christopher's existing dashboard link/passcode. Delete after use.
export async function GET() {
  try {
    const client = await getAdvisorClientBySlug("mXvZ8uqqJK4");
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    return NextResponse.json({ name: client.name, slug: client.slug, linkedEmail: client.linkedEmail, cashBalance: client.cashBalance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const DASHBOARD_URL = "https://dell-cardell.vercel.app/client/mXvZ8uqqJK4";
const PASSCODE = "ThegoldenWitcherisShallow1776^love1982^360";

export async function POST() {
  try {
    const client = await getAdvisorClientBySlug("mXvZ8uqqJK4");
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    if (!client.linkedEmail) return NextResponse.json({ error: "No linked email on file." }, { status: 400 });

    await sendAlertEmail(
      client.linkedEmail,
      "Your Dellegate Portfolio Dashboard",
      `<p>Hi ${client.name.split(" ")[0]},</p>
       <p>Here's your portfolio dashboard link again:</p>
       <p><a href="${DASHBOARD_URL}">${DASHBOARD_URL}</a></p>
       <p>Passcode: <strong>${PASSCODE}</strong></p>
       <p>Prices and values on the dashboard reflect real-time market data.</p>`
    );
    return NextResponse.json({ sent: true, to: client.linkedEmail });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
