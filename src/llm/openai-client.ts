import OpenAI from 'openai';
import { LLMClient, LLMResponse, Tool, ToolCall, Message } from './types';

export class OpenAIClient implements LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-4') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateResponse(prompt: string, tools: Tool[]): Promise<LLMResponse> {
    const messages = [
      {
        role: 'system' as const,
        content: `You are a helpful coding assistant. You have access to tools for file operations. 
        When asked to create or modify code, use the appropriate tools to read existing files, 
        understand the project structure, and write or modify files as needed.`
      },
      {
        role: 'user' as const,
        content: prompt
      }
    ];

    return this.callAPI(messages, tools);
  }

  async generateResponseWithHistory(messages: Message[], tools: Tool[]): Promise<LLMResponse> {
    const systemMessage = {
      role: 'system' as const,
      content: `You are a helpful coding assistant. You have access to tools for file operations. 
      When asked to create or modify code, use the appropriate tools to read existing files, 
      understand the project structure, and write or modify files as needed.`
    };

    const formattedMessages = [systemMessage, ...this.formatMessagesForOpenAI(messages)];
    return this.callAPI(formattedMessages, tools);
  }

  private formatMessagesForOpenAI(messages: Message[]): any[] {
    const formatted: any[] = [];
    
    for (const message of messages) {
      if (message.role === 'user') {
        formatted.push({
          role: 'user',
          content: message.content
        });
      } else if (message.role === 'assistant') {
        const assistantMessage: any = {
          role: 'assistant',
          content: message.content
        };
        
        if (message.toolCalls && message.toolCalls.length > 0) {
          assistantMessage.tool_calls = message.toolCalls.map((call, index) => ({
            id: `call_${index}`,
            type: 'function',
            function: {
              name: call.name,
              arguments: JSON.stringify(call.parameters)
            }
          }));
        }
        
        formatted.push(assistantMessage);
      } else if (message.role === 'tool') {
        formatted.push({
          role: 'tool',
          tool_call_id: message.toolCallId || 'call_0',
          content: message.content
        });
      }
    }
    
    return formatted;
  }

  private async callAPI(messages: any[], tools: Tool[]): Promise<LLMResponse> {
    const openaiTools = tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));

    const response = await this.retryWithBackoff(async () => {
      return await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        tool_choice: openaiTools.length > 0 ? 'auto' : undefined
      });
    });

    const message = response.choices[0].message;
    const content = message.content || '';
    
    const toolCalls: ToolCall[] = message.tool_calls?.map(call => ({
      name: call.function.name,
      parameters: JSON.parse(call.function.arguments)
    })) || [];

    return { content, toolCalls };
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a retryable error
        if (this.isRetryableError(error)) {
          if (attempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
            console.log(`⏳ API rate limited, retrying in ${Math.round(delay/1000)}s (attempt ${attempt + 1}/${maxRetries + 1})...`);
            await this.sleep(delay);
            continue;
          }
        }
        
        // If not retryable or out of retries, throw immediately
        throw this.enhanceError(error);
      }
    }
    
    throw this.enhanceError(lastError!);
  }

  private isRetryableError(error: any): boolean {
    // Check for rate limiting or temporary server errors
    const status = error.status || error.response?.status;
    const code = error.code;
    
    return (
      status === 429 || // Rate limited
      status === 502 || // Bad gateway
      status === 503 || // Service unavailable
      status === 504 || // Gateway timeout
      code === 'rate_limit_exceeded' ||
      code === 'server_error'
    );
  }

  private enhanceError(error: any): Error {
    const status = error.status || error.response?.status;
    const code = error.code;
    const message = error.message;
    
    if (status === 429 || code === 'rate_limit_exceeded') {
      return new Error('🚫 OpenAI rate limit exceeded. Please wait a moment and try again.');
    }
    
    if (status === 401) {
      return new Error('🔑 Invalid OpenAI API key. Please check your API key configuration.');
    }
    
    if (status === 403) {
      return new Error('🚫 Access forbidden. Please check your OpenAI API key permissions.');
    }
    
    if (status >= 500) {
      return new Error('🔧 OpenAI service is experiencing issues. Please try again later.');
    }
    
    return new Error(`OpenAI API Error: ${message || 'Unknown error occurred'}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}