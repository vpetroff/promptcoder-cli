import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { Message } from './llm/types';

const CONVERSATIONS_DIR = path.join(os.homedir(), '.promptcoder', 'conversations');

export interface SavedConversation {
  id: string;
  name: string;
  messages: Message[];
  workingDirectory: string;
  createdAt: Date;
  updatedAt: Date;
  description?: string;
}

export interface ConversationMetadata {
  id: string;
  name: string;
  workingDirectory: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  description?: string;
}

export class ConversationManager {
  
  constructor() {
    this.ensureConversationsDir();
  }

  private async ensureConversationsDir(): Promise<void> {
    await fs.ensureDir(CONVERSATIONS_DIR);
  }

  private getConversationPath(id: string): string {
    return path.join(CONVERSATIONS_DIR, `${id}.json`);
  }

  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async saveConversation(
    messages: Message[], 
    workingDirectory: string, 
    name?: string, 
    description?: string,
    id?: string
  ): Promise<string> {
    const conversationId = id || this.generateId();
    const now = new Date();
    
    const conversation: SavedConversation = {
      id: conversationId,
      name: name || `Conversation ${new Date().toLocaleDateString()}`,
      messages,
      workingDirectory,
      createdAt: id ? (await this.loadConversation(id))?.createdAt || now : now,
      updatedAt: now,
      description
    };

    const filePath = this.getConversationPath(conversationId);
    await fs.writeJson(filePath, conversation, { spaces: 2 });
    
    return conversationId;
  }

  async loadConversation(id: string): Promise<SavedConversation | null> {
    try {
      const filePath = this.getConversationPath(id);
      if (!(await fs.pathExists(filePath))) {
        return null;
      }
      
      const conversation = await fs.readJson(filePath);
      
      // Convert date strings back to Date objects
      conversation.createdAt = new Date(conversation.createdAt);
      conversation.updatedAt = new Date(conversation.updatedAt);
      
      return conversation;
    } catch (error) {
      console.error(`Error loading conversation ${id}:`, error);
      return null;
    }
  }

  async listConversations(): Promise<ConversationMetadata[]> {
    try {
      const files = await fs.readdir(CONVERSATIONS_DIR);
      const conversationFiles = files.filter(file => file.endsWith('.json'));
      
      const conversations: ConversationMetadata[] = [];
      
      for (const file of conversationFiles) {
        try {
          const filePath = path.join(CONVERSATIONS_DIR, file);
          const conversation = await fs.readJson(filePath);
          
          conversations.push({
            id: conversation.id,
            name: conversation.name,
            workingDirectory: conversation.workingDirectory,
            createdAt: new Date(conversation.createdAt),
            updatedAt: new Date(conversation.updatedAt),
            messageCount: conversation.messages.length,
            description: conversation.description
          });
        } catch (error) {
          // Skip corrupted files
          continue;
        }
      }
      
      // Sort by last updated, newest first
      return conversations.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    } catch (error) {
      console.error('Error listing conversations:', error);
      return [];
    }
  }

  async deleteConversation(id: string): Promise<boolean> {
    try {
      const filePath = this.getConversationPath(id);
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error deleting conversation ${id}:`, error);
      return false;
    }
  }

  async renameConversation(id: string, newName: string): Promise<boolean> {
    try {
      const conversation = await this.loadConversation(id);
      if (!conversation) {
        return false;
      }
      
      conversation.name = newName;
      conversation.updatedAt = new Date();
      
      await this.saveConversation(
        conversation.messages,
        conversation.workingDirectory,
        conversation.name,
        conversation.description,
        conversation.id
      );
      
      return true;
    } catch (error) {
      console.error(`Error renaming conversation ${id}:`, error);
      return false;
    }
  }

  async searchConversations(query: string): Promise<ConversationMetadata[]> {
    const allConversations = await this.listConversations();
    const lowerQuery = query.toLowerCase();
    
    return allConversations.filter(conv => 
      conv.name.toLowerCase().includes(lowerQuery) ||
      (conv.description && conv.description.toLowerCase().includes(lowerQuery)) ||
      conv.workingDirectory.toLowerCase().includes(lowerQuery)
    );
  }

  async exportConversation(id: string, format: 'json' | 'markdown' = 'json'): Promise<string | null> {
    const conversation = await this.loadConversation(id);
    if (!conversation) {
      return null;
    }

    if (format === 'json') {
      return JSON.stringify(conversation, null, 2);
    }

    // Markdown format
    let markdown = `# ${conversation.name}\n\n`;
    markdown += `**Created:** ${conversation.createdAt.toISOString()}\n`;
    markdown += `**Updated:** ${conversation.updatedAt.toISOString()}\n`;
    markdown += `**Working Directory:** ${conversation.workingDirectory}\n`;
    if (conversation.description) {
      markdown += `**Description:** ${conversation.description}\n`;
    }
    markdown += `\n---\n\n`;

    for (const message of conversation.messages) {
      if (message.role === 'user') {
        markdown += `## User\n\n${message.content}\n\n`;
      } else if (message.role === 'assistant') {
        markdown += `## Assistant\n\n${message.content}\n\n`;
        if (message.toolCalls && message.toolCalls.length > 0) {
          markdown += `**Tool Calls:**\n`;
          for (const call of message.toolCalls) {
            markdown += `- ${call.name}(${JSON.stringify(call.parameters)})\n`;
          }
          markdown += `\n`;
        }
      } else if (message.role === 'tool') {
        markdown += `**Tool Result:**\n\n\`\`\`\n${message.content}\n\`\`\`\n\n`;
      }
    }

    return markdown;
  }

  async getConversationStats(): Promise<{
    total: number;
    totalMessages: number;
    oldestDate: Date | null;
    newestDate: Date | null;
    averageMessagesPerConversation: number;
  }> {
    const conversations = await this.listConversations();
    
    if (conversations.length === 0) {
      return {
        total: 0,
        totalMessages: 0,
        oldestDate: null,
        newestDate: null,
        averageMessagesPerConversation: 0
      };
    }

    const totalMessages = conversations.reduce((sum, conv) => sum + conv.messageCount, 0);
    const oldestDate = conversations.reduce((oldest, conv) => 
      !oldest || conv.createdAt < oldest ? conv.createdAt : oldest, null as Date | null);
    const newestDate = conversations.reduce((newest, conv) => 
      !newest || conv.updatedAt > newest ? conv.updatedAt : newest, null as Date | null);

    return {
      total: conversations.length,
      totalMessages,
      oldestDate,
      newestDate,
      averageMessagesPerConversation: Math.round(totalMessages / conversations.length)
    };
  }
}