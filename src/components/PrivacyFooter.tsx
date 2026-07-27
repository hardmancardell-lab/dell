export function PrivacyFooter() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800 py-4 px-6 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
      This app collects anonymous usage data (which features are used, which tickers are researched, quiz
      question correctness in Financial Literacy, and that a message was sent to the Assistant — never the
      raw quiz content or chat text) to improve the product, plus the referral link/source that first brought
      your browser here. No account info, portfolio holdings, or dollar amounts are ever collected. If you
      subscribe to Alerts, your email/phone is stored only to deliver those alerts and may be linked to your
      anonymous usage for internal analytics.
    </footer>
  );
}
