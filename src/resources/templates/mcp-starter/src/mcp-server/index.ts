#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';

// Tool imports
// {{TOOL_IMPORTS}}

// Resource imports
// {{RESOURCE_IMPORTS}}

const logger = createLogger('mcp-server');

// Store tools and resources
const tools: any[] = [];
const resources: any[] = [];

/**
 * Setup the MCP server
 */
export async function setupServer(server: Server) {
  logger.info('Setting up MCP server...');

  // Collect tools
  // {{REGISTER_TOOLS}}

  // Collect resources
  // {{REGISTER_RESOURCES}}

  // Setup handlers
  if (tools.length > 0) {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      const tool = tools.find(t => t.name === name);
      if (!tool) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
      }

      try {
        const result = await tool.handler(args);
        
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  if (resources.length > 0) {
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: resources.map(resource => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      })),
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      
      const resource = resources.find(r => r.uri === uri);
      if (!resource) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown resource: ${uri}`
        );
      }

      const content = await resource.handler();
      
      return {
        contents: [
          {
            uri,
            mimeType: resource.mimeType,
            text: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
          },
        ],
      };
    });
  }

  logger.info('MCP server setup complete');
}

/**
 * Main entry point
 */
async function main() {
  try {
    logger.info('Starting MCP server...');

    // Load configuration
    const config = await loadConfig();

    // Create server
    const server = new Server(
      {
        name: config.name,
        version: config.version,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    // Setup server
    await setupServer(server);

    // Create transport
    const transport = new StdioServerTransport();

    // Connect server to transport
    await server.connect(transport);

    logger.info('MCP server started successfully');

    // Handle shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down MCP server...');
      await server.close();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} 