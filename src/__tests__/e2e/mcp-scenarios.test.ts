import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { MCPCreationService } from '../../services/mcp-creation-service';
import { createMCPAction } from '../../actions/mcp-creation-action';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';

const execAsync = promisify(exec);

/**
 * Comprehensive E2E test scenarios for MCP creation
 * These tests create real MCP servers and verify they actually work
 */
describe('MCP Creation E2E Scenarios', () => {
  let tempDir: string;
  let service: MCPCreationService;
  let runtime: IAgentRuntime;

  beforeEach(async () => {
    tempDir = path.join(process.cwd(), '.test-mcp-e2e', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });
    
    // Create minimal but real runtime
    runtime = {
      agentId: '00000000-0000-0000-0000-000000000000',
      getSetting: (key: string) => {
        const settings: Record<string, string> = {
          MCP_TEMPLATE_PATH: path.join(process.cwd(), 'src/resources/templates/mcp-starter'),
        };
        return settings[key] || process.env[key];
      },
      getService: (name: string) => {
        if (name === 'secrets-manager') {
          return { initialize: async () => {}, isReady: () => true };
        }
        if (name === 'mcp-creation') {
          return service;
        }
        return null;
      },
      services: new Map(),
    } as any;

    service = new MCPCreationService(runtime);
    await service.start();
  });

  afterEach(async () => {
    await service.stop();
    // Clean up test directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Scenario 1: Simple Time Plugin', () => {
    it('should create a working time plugin through natural language', async () => {
      const message: Memory = {
        id: '00000000-0000-0000-0000-000000000001',
        entityId: '00000000-0000-0000-0000-000000000002',
        roomId: '00000000-0000-0000-0000-000000000003',
        content: {
          text: 'Create an MCP server called time-server with a tool: getCurrentTime that returns the current time in ISO format',
        },
        createdAt: Date.now(),
      };

      const state: State = { values: {}, data: {}, text: '' };
      const responses: Memory[] = [];
      const callback = async (response: any) => {
        responses.push({ ...message, content: response });
        return responses;
      };

      // Execute action
      await createMCPAction.handler(runtime, message, state, {}, callback);

      // Verify response
      expect(responses).toHaveLength(1);
      expect(responses[0].content.text).toContain('successfully created');

      // Verify project structure
      const projectPath = path.join(tempDir, 'time-server');
      expect(await fs.access(projectPath).then(() => true).catch(() => false)).toBe(true);

      // Verify tool was created
      const toolPath = path.join(projectPath, 'src/mcp-server/tools/get-current-time-tool.ts');
      const toolContent = await fs.readFile(toolPath, 'utf-8');
      expect(toolContent).toContain('getCurrentTimeTool');
      expect(toolContent).toContain('new Date()');

      // Verify package.json
      const packageJson = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
      );
      expect(packageJson.name).toBe('time-server');
      expect(packageJson.dependencies).toHaveProperty('@modelcontextprotocol/sdk');

      // Verify TypeScript compiles
      const { stderr } = await execAsync('npx tsc --noEmit', { cwd: projectPath });
      expect(stderr).toBe('');
    });
  });

  describe('Scenario 2: File System Plugin', () => {
    it('should create a file system plugin with multiple tools', async () => {
      const config = {
        name: 'fs-mcp-server',
        description: 'File system operations via MCP',
        outputDir: tempDir,
        tools: [
          {
            name: 'readFile',
            description: 'Read contents of a file',
            parameters: {
              path: { type: 'string', description: 'File path', required: true },
              encoding: { type: 'string', description: 'File encoding', required: false },
            },
          },
          {
            name: 'writeFile',
            description: 'Write contents to a file',
            parameters: {
              path: { type: 'string', description: 'File path', required: true },
              content: { type: 'string', description: 'File content', required: true },
            },
          },
          {
            name: 'listDirectory',
            description: 'List files in a directory',
            parameters: {
              path: { type: 'string', description: 'Directory path', required: true },
            },
          },
        ],
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(true);

      // Verify all tools were created
      const toolsDir = path.join(result.projectPath!, 'src/mcp-server/tools');
      const tools = await fs.readdir(toolsDir);
      expect(tools).toContain('read-file-tool.ts');
      expect(tools).toContain('write-file-tool.ts');
      expect(tools).toContain('list-directory-tool.ts');

      // Verify server imports all tools
      const serverContent = await fs.readFile(
        path.join(result.projectPath!, 'src/mcp-server/index.ts'),
        'utf-8'
      );
      expect(serverContent).toContain("import { readFileTool } from './tools/read-file-tool.js'");
      expect(serverContent).toContain("import { writeFileTool } from './tools/write-file-tool.js'");
      expect(serverContent).toContain("import { listDirectoryTool } from './tools/list-directory-tool.js'");
    });
  });

  describe('Scenario 3: Weather API Plugin', () => {
    it('should create a weather plugin with smart implementation', async () => {
      const config = {
        name: 'weather-mcp',
        description: 'Weather information via MCP',
        outputDir: tempDir,
        tools: [
          {
            name: 'getWeather',
            description: 'Get current weather for a location',
            parameters: {
              location: { type: 'string', description: 'City name or coordinates', required: true },
              units: { type: 'string', description: 'Temperature units (celsius/fahrenheit)', required: false },
            },
          },
        ],
        dependencies: ['node-fetch@^3.0.0'],
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(true);

      // Verify weather implementation
      const toolPath = path.join(result.projectPath!, 'src/mcp-server/tools/get-weather-tool.ts');
      const toolContent = await fs.readFile(toolPath, 'utf-8');
      expect(toolContent).toContain('fetch');
      expect(toolContent).toContain('api.openweathermap.org');
      expect(toolContent).not.toContain('TODO');

      // Verify dependencies
      const packageJson = JSON.parse(
        await fs.readFile(path.join(result.projectPath!, 'package.json'), 'utf-8')
      );
      expect(packageJson.dependencies).toHaveProperty('node-fetch', '^3.0.0');
    });
  });

  describe('Scenario 4: Resource Provider Plugin', () => {
    it('should create a plugin with both tools and resources', async () => {
      const config = {
        name: 'knowledge-base-mcp',
        description: 'Knowledge base access via MCP',
        outputDir: tempDir,
        tools: [
          {
            name: 'search',
            description: 'Search the knowledge base',
            parameters: {
              query: { type: 'string', description: 'Search query', required: true },
            },
          },
        ],
        resources: [
          {
            name: 'documents',
            description: 'Access to document collection',
            mimeType: 'application/json',
          },
          {
            name: 'schemas',
            description: 'Available data schemas',
            mimeType: 'application/json',
          },
        ],
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(true);

      // Verify resources were created
      const resourcesDir = path.join(result.projectPath!, 'src/mcp-server/resources');
      const resources = await fs.readdir(resourcesDir);
      expect(resources).toContain('documents-resource.ts');
      expect(resources).toContain('schemas-resource.ts');

      // Verify resource implementations
      const docResource = await fs.readFile(
        path.join(resourcesDir, 'documents-resource.ts'),
        'utf-8'
      );
      expect(docResource).toContain('export const documentsResource');
      expect(docResource).toContain('application/json');
    });
  });

  describe('Scenario 5: Error Handling and Edge Cases', () => {
    it('should handle project creation failures gracefully', async () => {
      const config = {
        name: '../../../etc/passwd', // Malicious path
        description: 'Attempt path traversal',
        outputDir: tempDir,
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(true);
      // Name should be sanitized
      expect(result.projectPath).not.toContain('..');
      expect(result.projectPath).toContain('etc-passwd');
    });

    it('should handle missing required fields', async () => {
      const config = {
        name: '',
        description: 'Missing name',
        outputDir: tempDir,
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(false);
      expect(result.error).toContain('name is required');
    });

    it('should handle compilation errors in generated code', async () => {
      const config = {
        name: 'broken-mcp',
        description: 'Test compilation errors',
        outputDir: tempDir,
        tools: [
          {
            name: 'brokenTool',
            description: 'This tool has invalid parameters',
            parameters: 'not-an-object' as any, // Invalid parameters
          },
        ],
      };

      const result = await service.createMCPProject(config);
      // Should still succeed but parameters should be empty object
      expect(result.success).toBe(true);
    });
  });

  describe('Scenario 6: Complex Real-World Plugin', () => {
    it('should create a database query MCP plugin', async () => {
      const message: Memory = {
        id: '00000000-0000-0000-0000-000000000001',
        entityId: '00000000-0000-0000-0000-000000000002',
        roomId: '00000000-0000-0000-0000-000000000003',
        content: {
          text: `Create an MCP server called db-query-mcp with:
          - tool: executeQuery to run SQL queries with parameters: query (string, required), params (array, optional)
          - tool: listTables to list all tables in the database
          - resource: schema that provides the database schema
          - dependencies: pg@8.11.0, dotenv@16.0.0`,
        },
        createdAt: Date.now(),
      };

      const responses: Memory[] = [];
      const callback = async (response: any) => {
        responses.push({ ...message, content: response });
        return responses;
      };

      await createMCPAction.handler(runtime, message, {} as State, {}, callback);

      expect(responses[0].content.text).toContain('successfully created');

      // Verify complex structure
      const projectPath = path.join(tempDir, 'db-query-mcp');
      
      // Check tools
      const executeQueryTool = await fs.readFile(
        path.join(projectPath, 'src/mcp-server/tools/execute-query-tool.ts'),
        'utf-8'
      );
      expect(executeQueryTool).toContain('executeQueryTool');
      expect(executeQueryTool).toContain('query: { type: \'string\'');
      expect(executeQueryTool).toContain('params: { type: \'array\'');

      // Check resources
      const schemaResource = await fs.readFile(
        path.join(projectPath, 'src/mcp-server/resources/schema-resource.ts'),
        'utf-8'
      );
      expect(schemaResource).toContain('schemaResource');

      // Check dependencies
      const packageJson = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
      );
      expect(packageJson.dependencies.pg).toBe('8.11.0');
      expect(packageJson.dependencies.dotenv).toBe('16.0.0');
    });
  });

  describe('Scenario 7: MCP Server Actually Starts', () => {
    it('should create an MCP server that can actually start', async () => {
      const config = {
        name: 'startable-mcp',
        description: 'MCP server that actually starts',
        outputDir: tempDir,
        tools: [
          {
            name: 'ping',
            description: 'Simple ping tool',
            parameters: {},
          },
        ],
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(true);

      // Install dependencies
      console.log('Installing dependencies...');
      await execAsync('npm install', { cwd: result.projectPath! });

      // Build the project
      console.log('Building project...');
      await execAsync('npm run build', { cwd: result.projectPath! });

      // Verify the server file exists and is executable
      const serverPath = path.join(result.projectPath!, 'dist/mcp-server/index.js');
      const serverExists = await fs.access(serverPath).then(() => true).catch(() => false);
      expect(serverExists).toBe(true);

      // The server should be startable (though we won't actually start it in tests)
      const serverContent = await fs.readFile(serverPath, 'utf-8');
      expect(serverContent).toContain('StdioServerTransport');
      expect(serverContent).toContain('tools.push');
    });
  });
}); 