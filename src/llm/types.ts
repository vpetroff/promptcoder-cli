export interface LLMConfig {
  provider: 'openai' | 'anthropic';
  apiKey: string;
  model?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface ToolCall {
  name: string;
  parameters: Record<string, any>;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
}

export interface LLMClient {
  generateResponse(prompt: string, tools: Tool[]): Promise<LLMResponse>;
  generateResponseWithHistory(messages: Message[], tools: Tool[]): Promise<LLMResponse>;
}