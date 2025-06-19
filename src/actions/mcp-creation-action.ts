import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  ActionExample,
} from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';
import { MCPCreationService } from '../services/mcp-creation-service';

/**
 * Action to create MCP (Model Context Protocol) servers
 */
export const createMCPAction: Action = {
  name: 'CREATE_MCP',
  similes: ['create mcp', 'build mcp server', 'make model context protocol', 'generate mcp'],
  description: 'Create a new Model Context Protocol (MCP) server with tools and resources',

  examples: [
    [
      {
        name: '{{user1}}',
        content: { text: 'Create an MCP server that can fetch weather data' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: "I'll create an MCP server with weather data capabilities for you.",
          actions: ['CREATE_MCP'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: { text: 'Build an MCP with tools for file operations and web scraping' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: "I'll create an MCP server with file operation and web scraping tools.",
          actions: ['CREATE_MCP'],
        },
      },
    ],
  ] as ActionExample[][],

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    // Check if we have access to orchestration service
    const orchestrationService = runtime.getService('orchestration');
    if (!orchestrationService) {
      elizaLogger.debug('[CREATE_MCP] Orchestration service not available');
      return false;
    }

    // Check if we have access to secrets manager
    const secretsManager = runtime.getService('secrets-manager');
    if (!secretsManager) {
      elizaLogger.debug('[CREATE_MCP] Secrets manager not available');
      return false;
    }

    // Check if message contains MCP-related keywords
    const messageText = message.content.text?.toLowerCase() || '';
    const mcpKeywords = ['mcp', 'model context protocol', 'context protocol'];
    const hasKeyword = mcpKeywords.some(keyword => messageText.includes(keyword));

    return hasKeyword;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ) => {
    try {
      elizaLogger.info('[CREATE_MCP] Starting MCP creation');

      // Get services
      const orchestrationService = runtime.getService('orchestration');
      const secretsManager = runtime.getService('secrets-manager');

      if (!orchestrationService || !secretsManager) {
        throw new Error('Required services not available');
      }

      // Parse requirements from message
      const messageText = message.content.text || '';

      // Extract MCP-specific details
      const mcpName = extractMCPName(messageText) || 'my-mcp-server';
      const tools = extractTools(messageText);
      const resources = extractResources(messageText);
      const dependencies = extractDependencies(messageText);

      // Notify start
      if (callback) {
        await callback({
          text: `🚀 Creating MCP server "${mcpName}"...\n\nPlanned components:\n` +
                `- Tools: ${tools.length > 0 ? tools.map(t => t.name).join(', ') : 'None specified'}\n` +
                `- Resources: ${resources.length > 0 ? resources.map(r => r.name).join(', ') : 'None specified'}\n` +
                `- Dependencies: ${dependencies.length > 0 ? dependencies.join(', ') : 'None specified'}\n\n` +
                `This will take a few minutes...`,
          actions: ['CREATE_MCP'],
        });
      }

      // Create MCP using service
      const mcpService = new MCPCreationService(runtime);
      const result = await mcpService.createMCPProject({
        name: mcpName,
        description: messageText,
        outputDir: process.cwd() + '/mcp-projects',
        tools: tools.map(t => ({ name: t.name, description: t.description })),
        resources: resources.map(r => ({ name: r.name, description: r.description })),
        dependencies: dependencies,
      });

      // Check if creation was successful
      if (!result.success) {
        throw new Error(result.error || 'Failed to create MCP project');
      }

      // Prepare summary
      let summary = `## MCP Server Created Successfully! 🎉\n\n`;
      summary += `**Name**: ${mcpName}\n`;
      summary += `**Path**: ${result.projectPath}\n\n`;

      summary += `### Components Created:\n`;
      summary += `- ✅ MCP Server with ${result.details?.toolsGenerated?.length || 0} tools\n`;
      summary += `- ✅ ${result.details?.resourcesGenerated?.length || 0} resources configured\n`;
      summary += `- ✅ Full test suite\n`;
      summary += `- ✅ Configuration and utilities\n\n`;

      summary += `### Next Steps:\n`;
      summary += `1. Navigate to the project: \`cd ${result.projectPath}\`\n`;
      summary += `2. Install dependencies: \`npm install\`\n`;
      summary += `3. Run tests: \`npm test\`\n`;
      summary += `4. Start the server: \`npm run mcp:server\`\n\n`;

      summary += `### Testing with plugin-mcp:\n`;
      summary += `Configure your Eliza agent with plugin-mcp to connect to this MCP server.\n`;

      elizaLogger.info('[CREATE_MCP] MCP creation completed', {
        name: mcpName,
        projectPath: result.projectPath,
      });

      if (callback) {
        await callback({
          text: summary,
          actions: ['CREATE_MCP'],
        });
      }

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      elizaLogger.error('[CREATE_MCP] MCP creation failed:', error);

      if (callback) {
        await callback({
          text: `❌ MCP creation failed: ${error.message || error}`,
          actions: ['CREATE_MCP'],
        });
      }

      return {
        success: false,
        error: error.message || error,
      };
    }
  },
};

/**
 * Extract MCP server name from message
 */
function extractMCPName(text: string): string | null {
  // First check for quoted names
  const quotedPattern = /(?:called|named)\s+["']([a-zA-Z0-9-_]+)["']/i;
  const quotedMatch = text.match(quotedPattern);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1];
  }
  
  // Then check for explicit name patterns
  // Pattern 1: "called X", "named X"
  const namedPattern = /(?:called|named)\s+([a-zA-Z0-9-_]+)/i;
  const namedMatch = text.match(namedPattern);
  if (namedMatch && namedMatch[1]) {
    return namedMatch[1];
  }
  
  // Pattern 2: "MCP X" or "MCP server X"
  const mcpPattern = /MCP\s+(?:server\s+)?([a-zA-Z0-9-_]+)/i;
  const mcpMatch = text.match(mcpPattern);
  if (mcpMatch && mcpMatch[1] && 
      !['server', 'that', 'which', 'for', 'with', 'to'].includes(mcpMatch[1].toLowerCase())) {
    return mcpMatch[1];
  }
  
  return null;
}

/**
 * Get parameters for file operations
 */
function getFileOperationParams(operation: string): Record<string, any> {
  switch (operation) {
    case 'readFile':
      return {
        path: { type: 'string', description: 'File path', required: true },
        encoding: { type: 'string', description: 'File encoding', required: false },
      };
    case 'writeFile':
      return {
        path: { type: 'string', description: 'File path', required: true },
        content: { type: 'string', description: 'Content to write', required: true },
        encoding: { type: 'string', description: 'File encoding', required: false },
      };
    case 'deleteFile':
      return {
        path: { type: 'string', description: 'File path', required: true },
      };
    default:
      return {};
  }
}

/**
 * Extract tools from message with improved parsing
 */
function extractTools(text: string): Array<{ name: string; description: string; parameters?: any }> {
  const tools = [];
  const processedNames = new Set<string>();
  
  // Pattern 1: Explicit tool definitions "tool: name" or "- tool: name"
  const explicitToolPattern = /(?:^|\n|,)\s*-?\s*tools?:\s*([a-zA-Z0-9_]+)(?:\s*[,\n]|$)/gim;
  const explicitMatches = text.matchAll(explicitToolPattern);
  
  for (const match of explicitMatches) {
    if (match[1] && !processedNames.has(match[1].toLowerCase())) {
      processedNames.add(match[1].toLowerCase());
      tools.push({
        name: match[1],
        description: `Tool ${match[1]}`,
      });
    }
  }
  
  // Pattern 2: List format "with tools: X, Y, Z"
  const listPattern = /(?:with\s+)?tools?:\s*([a-zA-Z0-9_,\s]+)(?:\.|,|$)/i;
  const listMatch = text.match(listPattern);
  if (listMatch && listMatch[1]) {
    const toolList = listMatch[1].split(/[,\s]+/).filter(t => t.length > 0);
    for (const toolName of toolList) {
      if (!processedNames.has(toolName.toLowerCase()) && toolName.length > 2) {
        processedNames.add(toolName.toLowerCase());
        tools.push({
          name: toolName,
          description: `Tool ${toolName}`,
        });
      }
    }
  }
  
  // If no explicit tools found, use context-based extraction
  if (tools.length === 0) {
    const lowerText = text.toLowerCase();
    
    // Time-related
    if (lowerText.includes('time') || lowerText.includes('clock') || lowerText.includes('date')) {
      if (!processedNames.has('getcurrenttime')) {
        tools.push({
          name: 'getCurrentTime',
          description: 'Get the current time',
          parameters: {
            timezone: { type: 'string', description: 'Timezone (e.g., UTC, America/New_York)', required: false },
            format: { type: 'string', description: 'Output format (iso, unix, human)', required: false },
          },
        });
      }
    }
    
    // Calculator/math
    if (lowerText.includes('calculat') || lowerText.includes('math') || lowerText.includes('comput')) {
      if (!processedNames.has('calculate')) {
        tools.push({
          name: 'calculate',
          description: 'Perform mathematical calculations',
          parameters: {
            expression: { type: 'string', description: 'Mathematical expression to evaluate', required: true },
          },
        });
      }
    }
    
    // File operations
    if (lowerText.includes('file') && (lowerText.includes('tool') || lowerText.includes('operation'))) {
      const fileOps = [];
      if (lowerText.includes('operations') || lowerText.includes('ops')) {
        // "file operations" implies read and write
        fileOps.push('readFile', 'writeFile');
      } else if (lowerText.includes('read')) {
        fileOps.push('readFile');
      } else if (lowerText.includes('write')) {
        fileOps.push('writeFile');
      } else if (lowerText.includes('manage') || lowerText.includes('handle')) {
        fileOps.push('readFile', 'writeFile', 'deleteFile');
      } else {
        // Generic file mention defaults to read/write
        fileOps.push('readFile', 'writeFile');
      }
      
      for (const op of fileOps) {
        if (!processedNames.has(op.toLowerCase())) {
          tools.push({
            name: op,
            description: `${op.replace(/([A-Z])/g, ' $1').trim()} operations`,
            parameters: getFileOperationParams(op),
          });
          processedNames.add(op.toLowerCase());
        }
      }
    }
    
    // Database operations
    if (lowerText.includes('database') || lowerText.includes('query') || lowerText.includes('sql')) {
      if (!processedNames.has('executequery')) {
        tools.push({
          name: 'executeQuery',
          description: 'Execute database query',
          parameters: {
            query: { type: 'string', description: 'SQL query to execute', required: true },
            params: { type: 'object', description: 'Query parameters', required: false },
          },
        });
      }
    }
    
    // Weather
    if (lowerText.includes('weather') || lowerText.includes('climate') || lowerText.includes('temperature')) {
      if (!processedNames.has('getweather')) {
        tools.push({
          name: 'getWeather',
          description: 'Get weather information',
          parameters: {
            location: { type: 'string', description: 'Location for weather', required: true },
            unit: { type: 'string', description: 'Temperature unit (celsius, fahrenheit)', required: false },
          },
        });
      }
    }
    
    // API/HTTP requests
    if (lowerText.includes('api') || lowerText.includes('http') || lowerText.includes('request')) {
      if (!processedNames.has('makerequest')) {
        tools.push({
          name: 'makeRequest',
          description: 'Make HTTP request',
          parameters: {
            url: { type: 'string', description: 'URL to request', required: true },
            method: { type: 'string', description: 'HTTP method', required: false },
            headers: { type: 'object', description: 'Request headers', required: false },
            body: { type: 'string', description: 'Request body', required: false },
          },
        });
      }
    }
  }
  
  return tools;
}

/**
 * Extract resources from message with improved parsing
 */
function extractResources(text: string): Array<{ name: string; description: string; mimeType?: string }> {
  const resources = [];
  const processedNames = new Set<string>();
  
  // Pattern 1: Explicit resource definitions "resource: name" or "- resource: name"
  const explicitResourcePattern = /(?:^|\n|,)\s*-?\s*resources?:\s*([a-zA-Z0-9_]+)(?:\s*[,\n]|$)/gim;
  const explicitMatches = text.matchAll(explicitResourcePattern);
  
  for (const match of explicitMatches) {
    if (match[1] && !processedNames.has(match[1].toLowerCase())) {
      processedNames.add(match[1].toLowerCase());
      resources.push({
        name: match[1],
        description: `Resource ${match[1]}`,
        mimeType: 'application/json',
      });
    }
  }
  
  // Pattern 2: List format "with resources: X, Y, Z"
  const listPattern = /(?:with\s+)?resources?:\s*([a-zA-Z0-9_,\s]+)(?:\.|,|$)/i;
  const listMatch = text.match(listPattern);
  if (listMatch && listMatch[1]) {
    const resourceList = listMatch[1].split(/[,\s]+/).filter(r => r.length > 0);
    for (const resourceName of resourceList) {
      if (!processedNames.has(resourceName.toLowerCase()) && resourceName.length > 2) {
        processedNames.add(resourceName.toLowerCase());
        resources.push({
          name: resourceName,
          description: `Resource ${resourceName}`,
          mimeType: 'application/json',
        });
      }
    }
  }
  
  // If no explicit resources found, use context-based extraction
  if (resources.length === 0) {
    const resourceKeywords = {
      'config': ['config', 'configuration', 'settings'],
      'data': ['data', 'dataset', 'information'],
      'docs': ['docs', 'documentation', 'guide'],
      'status': ['status', 'health', 'state'],
      'schema': ['schema', 'structure', 'model'],
      'logs': ['logs', 'history', 'events'],
    };
    
    const lowerText = text.toLowerCase();
    for (const [name, keywords] of Object.entries(resourceKeywords)) {
      if (keywords.some(keyword => lowerText.includes(keyword)) && !processedNames.has(name)) {
        processedNames.add(name);
        resources.push({
          name,
          description: `${name} resource`,
          mimeType: name === 'docs' ? 'text/markdown' : 'application/json',
        });
      }
    }
  }
  
  return resources;
}

/**
 * Extract dependencies from message with improved parsing
 */
function extractDependencies(text: string): string[] {
  const dependencies: string[] = [];
  const processedDeps = new Set<string>();
  
  // Pattern 1: Explicit dependencies "dependencies: X, Y, Z"
  const explicitDepPattern = /(?:dependencies|deps):\s*([^\n.]+?)(?:\.|$|\n)/i;
  const explicitMatch = text.match(explicitDepPattern);
  
  if (explicitMatch && explicitMatch[1]) {
    // Extract package@version patterns
    const packagePattern = /([a-zA-Z0-9@\-\/._]+@[\d.^~*]+|[a-zA-Z0-9@\-\/._]+)/g;
    const packages = explicitMatch[1].match(packagePattern);
    
    if (packages) {
      for (const pkg of packages) {
        const cleaned = pkg.trim().replace(/[,\s]+$/, '');
        if (cleaned && !processedDeps.has(cleaned.toLowerCase())) {
          processedDeps.add(cleaned.toLowerCase());
          dependencies.push(cleaned);
        }
      }
    }
  }
  
  // Pattern 2: Inline mentions "using axios@1.6.0"
  const inlinePattern = /(?:using|with|requires?)\s+([a-zA-Z0-9@\-\/._]+@[\d.^~*]+)/gi;
  const inlineMatches = text.matchAll(inlinePattern);
  
  for (const match of inlineMatches) {
    if (match[1] && !processedDeps.has(match[1].toLowerCase())) {
      processedDeps.add(match[1].toLowerCase());
      dependencies.push(match[1]);
    }
  }
  
  // Common package detection without version
  const commonPackages = {
    'axios': { keywords: ['axios', 'http client', 'api calls'], defaultVersion: '1.6.0' },
    'dotenv': { keywords: ['dotenv', 'environment', 'env variables'], defaultVersion: '16.0.0' },
    'express': { keywords: ['express', 'web server', 'http server'], defaultVersion: '4.18.0' },
    'pg': { keywords: ['postgres', 'postgresql', 'database', 'sql'], defaultVersion: '8.11.0' },
    'mysql2': { keywords: ['mysql', 'database'], defaultVersion: '3.6.0' },
    'sqlite3': { keywords: ['sqlite', 'database'], defaultVersion: '5.1.0' },
    'zod': { keywords: ['zod', 'validation', 'schema validation'], defaultVersion: '3.22.0' },
    'joi': { keywords: ['joi', 'validation'], defaultVersion: '17.11.0' },
    'lodash': { keywords: ['lodash', 'utility functions'], defaultVersion: '4.17.21' },
    'node-fetch': { keywords: ['fetch', 'http requests'], defaultVersion: '3.3.0' },
  };
  
  // Handle partial versions like 'pg@8' -> 'pg@8.11.0'
  const finalDependencies = dependencies.map(dep => {
    if (dep.includes('@')) {
      const [pkg, version] = dep.split('@');
      // If version is just a major version (e.g., '8'), expand it
      if (/^\d+$/.test(version)) {
        const packageInfo = commonPackages[pkg as keyof typeof commonPackages];
        if (packageInfo && packageInfo.defaultVersion.startsWith(version)) {
          return `${pkg}@${packageInfo.defaultVersion}`;
        }
      }
    }
    return dep;
  });
  
  const lowerText = text.toLowerCase();
  for (const [pkg, info] of Object.entries(commonPackages)) {
    if (info.keywords.some(keyword => lowerText.includes(keyword)) && 
        !processedDeps.has(pkg) && 
        !finalDependencies.some(d => d.startsWith(pkg))) {
      finalDependencies.push(`${pkg}@${info.defaultVersion}`);
    }
  }
  
  return finalDependencies;
} 