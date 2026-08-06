export function PrivacyFooter() {
  return (
    <footer
      className="jarvis"
      style={{
        background: "rgba(8, 11, 16, 0.55)",
        backgroundImage: "none",
        borderTop: "1px solid var(--line)",
        borderRadius: 0,
        padding: "16px 24px",
        textAlign: "center",
        fontSize: 11,
        color: "var(--text-2)",
      }}
    >
      This app collects anonymous usage data — which features are used, which tickers/pairs you run backtests,
      scans, or calculators on, whether a statistical result cleared this app&apos;s significance bar, quiz
      question correctness and module opens in Financial Literacy, and that a message was sent to the
      Assistant (including whether by voice) — never the raw quiz content, chat text, or the actual numbers
      you enter into a calculator. This helps improve the product and catch broken features, plus the
      referral link/source that first brought your browser here. No account info, portfolio holdings, share
      counts, or dollar amounts are ever collected. If you subscribe to Alerts, your email/phone is stored
      only to deliver those alerts and may be linked to your anonymous usage for internal analytics.
    </footer>
  );
}
