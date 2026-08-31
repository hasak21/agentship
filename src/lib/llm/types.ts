// Universal LLM Provider and Request/Response Types for AgentShip

export type LLMProvider =
  | "openai-compatible"
  | "deepseek"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "custom";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequestOptions {
  model?: string;
  provider?: LLMProvider;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
  webSearch?: boolean;
}

export interface LLMTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMSource {
  title: string;
  uri: string;
}

export interface LLMResponse {
  text: string;
  usage: LLMTokenUsage;
  model: string;
  provider: LLMProvider;
  sources?: LLMSource[];
}

export interface ModelPreset {
  id: string;
  name: string;
  provider: LLMProvider;
  defaultModel: string;
  description: string;
  badge?: string;
  recommended?: boolean;
}
