export type AssistantRole = "user" | "assistant";

export interface AssistantMessage {
  role: AssistantRole;
  content: string;
}

export interface AssistantChatRequest {
  messages: AssistantMessage[];
}

export interface AssistantChatResponse {
  reply: string;
  toolsUsed: string[];
  dataLimitations: string[];
}
