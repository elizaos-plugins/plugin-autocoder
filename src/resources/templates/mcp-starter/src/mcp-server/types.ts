import { z } from 'zod';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  handler: (args: any, config: any) => Promise<any>;
}

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: (config: any) => Promise<any>;
}

export interface McpConfig {
  // Add your configuration fields here
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  [key: string]: any;
} 