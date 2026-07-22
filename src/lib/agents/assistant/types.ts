export type AssistantRole = "user" | "assistant";

export interface AssistantMessage {
  role: AssistantRole;
  content: string;
}

export interface AssistantChatRequest {
  messages: AssistantMessage[];
  // Anonymous, client-generated id (same one analytics uses) — threaded
  // through to submit_feedback so a stored suggestion can be correlated
  // with that session's other activity without collecting any identity.
  sessionId?: string;
}

export interface AssistantChatResponse {
  reply: string;
  toolsUsed: string[];
  dataLimitations: string[];
}
