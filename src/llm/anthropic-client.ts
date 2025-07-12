import Anthropic from '@anthropic-ai/sdk';
import { LLMClient, LLMResponse, Tool, ToolCall, Message } from './types';

export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = 'claude-3-sonnet-20240229') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateResponse(prompt: string, tools: Tool[]): Promise<LLMResponse> {
    const messages = [{ role: 'user' as const, content: prompt }];
    return this.callAPI(messages, tools);
  }

  async generateResponseWithHistory(messages: Message[], tools: Tool[]): Promise<LLMResponse> {
    const formattedMessages = this.formatMessagesForAnthropic(messages);
    return this.callAPI(formattedMessages, tools);
  }

  private formatMessagesForAnthropic(messages: Message[]): any[] {
    const formatted: any[] = [];
    let lastToolCallIds: string[] = [];
    
    for (const message of messages) {
      if (message.role === 'user') {
        formatted.push({
          role: 'user',
          content: message.content
        });
      } else if (message.role === 'assistant') {
        const content: any[] = [];
        
        if (message.content) {
          content.push({ type: 'text', text: message.content });
        }
        
        if (message.toolCalls && message.toolCalls.length > 0) {
          lastToolCallIds = [];
          for (let i = 0; i < message.toolCalls.length; i++) {
            const toolCall = message.toolCalls[i];
            const toolId = `call_${Date.now()}_${i}`;
            lastToolCallIds.push(toolId);
            
            content.push({
              type: 'tool_use',
              id: toolId,
              name: toolCall.name,
              input: toolCall.parameters
            });
          }
        }
        
        formatted.push({
          role: 'assistant',
          content
        });
      } else if (message.role === 'tool') {
        // For tool results, we need to match them with the tool calls
        const toolResults = message.content.split('\n\nTool ').filter(Boolean);
        
        if (toolResults.length === 1 && lastToolCallIds.length === 1) {
          // Single tool result
          formatted.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: lastToolCallIds[0],
                content: message.content
              }
            ]
          });
        } else {
          // Multiple tool results - create individual messages
          for (let i = 0; i < Math.min(toolResults.length, lastToolCallIds.length); i++) {
            const result = i === 0 ? toolResults[0] : `Tool ${toolResults[i]}`;
            formatted.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: lastToolCallIds[i],
                  content: result.replace(/^Tool \d+ result: /, '')
                }
              ]
            });
          }
        }
      }
    }
    
    return formatted;
  }

  private async callAPI(messages: any[], tools: Tool[]): Promise<LLMResponse> {
    const anthropicTools = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));

    const requestParams: any = {
      model: this.model,
      max_tokens: 4096,
      messages: messages,
      system: `You are a helpful coding assistant. You have access to tools for file operations. 
      When asked to create or modify code, use the appropriate tools to read existing files, 
      understand the project structure, and write or modify files as needed.`
    };

    if (anthropicTools.length > 0) {
      requestParams.tools = anthropicTools;
    }

    const response = await this.retryWithBackoff(async () => {
      return await this.client.messages.create(requestParams);
    });

    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if ((block as any).type === 'tool_use') {
        const toolBlock = block as any;
        toolCalls.push({
          name: toolBlock.name,
          parameters: toolBlock.input as Record<string, any>
        });
      }
    }

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
    // Check for rate limiting, overloaded, or temporary server errors
    const status = error.status || error.response?.status;
    const errorType = error.error?.type;
    
    return (
      status === 429 || // Rate limited
      status === 502 || // Bad gateway
      status === 503 || // Service unavailable
      status === 504 || // Gateway timeout
      status === 529 || // Overloaded
      errorType === 'overloaded_error' ||
      errorType === 'rate_limit_error'
    );
  }

  private enhanceError(error: any): Error {
    const status = error.status || error.response?.status;
    const errorType = error.error?.type;
    const message = error.error?.message || error.message;
    
    if (status === 429 || errorType === 'rate_limit_error') {
      return new Error('🚫 Rate limit exceeded. Please wait a moment and try again.');
    }
    
    if (status === 529 || errorType === 'overloaded_error') {
      return new Error('🔄 Anthropic service is currently overloaded. Please try again in a few minutes.');
    }
    
    if (status === 401) {
      return new Error('🔑 Invalid API key. Please check your Anthropic API key configuration.');
    }
    
    if (status === 403) {
      return new Error('🚫 Access forbidden. Please check your API key permissions.');
    }
    
    if (status >= 500) {
      return new Error('🔧 Anthropic service is experiencing issues. Please try again later.');
    }
    
    return new Error(`API Error: ${message || 'Unknown error occurred'}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}