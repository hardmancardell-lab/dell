export type HelpVideoKind = "mp4" | "youtube";

export interface HelpVideo {
  id: string;
  agentId: "top-down" | "trading" | "portfolio" | "literacy" | "assistant";
  agentLabel: string;
  title: string;
  kind: HelpVideoKind;
  src: string;
  poster?: string;
  description: string;
}

/**
 * Single source of truth for every agent walkthrough video — previously each
 * one was pinned inline at the top of its agent tab (pushing every tool
 * below it down the page on every visit, not just the first). Now surfaced
 * on demand through HelpMenu instead. Real, distinct video assets, not a
 * one-video default reused everywhere.
 */
export const HELP_VIDEOS: HelpVideo[] = [
  {
    id: "top-down",
    agentId: "top-down",
    agentLabel: "Research Agent",
    title: "The Top-Down Investing Agent",
    kind: "mp4",
    src: "/videos/top-down-investing-agent.mp4",
    poster: "/videos/top-down-investing-agent-poster.svg",
    description: "A ~5-minute walkthrough of the top-down approach and every tab in the Research Agent.",
  },
  {
    id: "trading",
    agentId: "trading",
    agentLabel: "Trading Agent",
    title: "The Illusion of Patterns",
    kind: "youtube",
    src: "https://www.youtube-nocookie.com/embed/v02p4kI9Hyo",
    description: "Why not every backtested pattern is a real edge — and how this app tells the difference.",
  },
  {
    id: "portfolio",
    agentId: "portfolio",
    agentLabel: "Portfolio Tracking Agent",
    title: "Portfolio Tracker Agent",
    kind: "youtube",
    src: "https://www.youtube-nocookie.com/embed/9gM8_K201Dk",
    description: "A ~5-minute walkthrough of every tab in the Portfolio Tracker, with real-world examples.",
  },
  {
    id: "literacy",
    agentId: "literacy",
    agentLabel: "Financial Literacy",
    title: "Shielding Your Finances",
    kind: "youtube",
    src: "https://www.youtube-nocookie.com/embed/EwzFA3qd2hM",
    description: "A short primer before you start the Financial Literacy curriculum.",
  },
];
