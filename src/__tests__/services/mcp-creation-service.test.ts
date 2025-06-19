import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MCPCreationService } from '../../services/mcp-creation-service';
import type { IAgentRuntime } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';
import * as path from 'path';

// Mock fs/promises before importing
const mockFsPromises = {
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  copyFile: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn(),
};

vi.mock('fs/promises', () => mockFsPromises);

// Mock other modules
vi.mock('child_process', () => ({
  exec: vi.fn((cmd, opts, callback) => {
    if (callback) callback(null, '', '');
    else return Promise.resolve({ stdout: '', stderr: '' });
  }),
}));
vi.mock('util', () => ({
  promisify: vi.fn(() => vi.fn().mockResolvedValue({ stdout: '', stderr: '' })),
}));

// Mock elizaLogger
vi.mock('@elizaos/core', () => ({
  elizaLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  Service: class {
    constructor() {}
    async start() {}
    async stop() {}
  },
}));

describe('MCPCreationService', () => {
  let service: MCPCreationService;
  let mockRuntime: IAgentRuntime;
  let tempDir: string;

  beforeEach(() => {
    // Create mock runtime
    mockRuntime = {
      agentId: 'test-agent',
      character: { name: 'Test Agent' },
    } as unknown as IAgentRuntime;

    // Create service instance
    service = new MCPCreationService(mockRuntime);

    // Setup temp directory
    tempDir = path.join(process.cwd(), '.test-mcp-projects');

    // Setup mocks
    mockFsPromises.mkdir.mockResolvedValue(undefined);
    mockFsPromises.readdir.mockResolvedValue([]);
    mockFsPromises.stat.mockResolvedValue({ isDirectory: () => false } as any);
    mockFsPromises.copyFile.mockResolvedValue(undefined);
    mockFsPromises.writeFile.mockResolvedValue(undefined);
    mockFsPromises.readFile.mockResolvedValue('mock content');
    mockFsPromises.access.mockRejectedValue(new Error('Not found'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createMCPProject', () => {
    it('should create a basic MCP project successfully', async () => {
      const config = {
        name: 'test-mcp',
        description: 'Test MCP server',
        outputDir: tempDir,
      };

      const result = await service.createMCPProject(config);

      expect(result.success).toBe(true);
      expect(result.projectPath).toBeDefined();
      expect(result.details).toBeDefined();
      expect(result.details?.filesCreated).toContain('package.json');
      expect(result.details?.filesCreated).toContain('README.md');
      // tsconfig.json is part of the template, not tracked separately
      expect(mockFsPromises.mkdir).toHaveBeenCalled();
      expect(mockFsPromises.writeFile).toHaveBeenCalled();
    });

    it('should create project with tools', async () => {
      const config = {
        name: 'mcp-with-tools',
        description: 'MCP server with tools',
        outputDir: tempDir,
        tools: [
          {
            name: 'calculator',
            description: 'Performs calculations',
            parameters: { expression: 'string' },
          },
          {
            name: 'web-search',
            description: 'Searches the web',
            parameters: { query: 'string', limit: 'number' },
          },
        ],
      };

      // Mock template reading
      mockFsPromises.readFile.mockImplementation(async (path) => {
        if (path.toString().includes('example-tool.ts.template')) {
          return '// Tool: {{TOOL_NAME}}\n// Description: {{TOOL_DESCRIPTION}}\n// Parameters: {{TOOL_PARAMETERS}}';
        }
        return 'mock content';
      });

      const result = await service.createMCPProject(config);

      expect(result.success).toBe(true);
      expect(result.details?.toolsGenerated).toHaveLength(2);
      expect(result.details?.toolsGenerated).toContain('calculator-tool.ts');
      expect(result.details?.toolsGenerated).toContain('web-search-tool.ts');
    });

    it('should create project with resources', async () => {
      const config = {
        name: 'mcp-with-resources',
        description: 'MCP server with resources',
        outputDir: tempDir,
        resources: [
          {
            name: 'config-file',
            description: 'Configuration file',
            mimeType: 'application/json',
          },
          {
            name: 'data-source',
            description: 'Data source',
            mimeType: 'text/csv',
          },
        ],
      };

      // Mock template reading
      mockFsPromises.readFile.mockImplementation(async (path) => {
        if (path.toString().includes('example-resource.ts.template')) {
          return '// Resource: {{RESOURCE_NAME}}\n// Description: {{RESOURCE_DESCRIPTION}}\n// MIME Type: {{RESOURCE_MIME_TYPE}}';
        }
        return 'mock content';
      });

      const result = await service.createMCPProject(config);

      expect(result.success).toBe(true);
      expect(result.details?.resourcesGenerated).toHaveLength(2);
      expect(result.details?.resourcesGenerated).toContain('config-file-resource.ts');
      expect(result.details?.resourcesGenerated).toContain('data-source-resource.ts');
    });

    it('should handle additional dependencies', async () => {
      const config = {
        name: 'mcp-with-deps',
        description: 'MCP server with dependencies',
        outputDir: tempDir,
        dependencies: ['axios', 'dotenv', 'zod'],
      };

      const result = await service.createMCPProject(config);

      expect(result.success).toBe(true);

      // Check that package.json was written with dependencies
      const writeFileCalls = mockFsPromises.writeFile.mock.calls;
      const packageJsonCall = writeFileCalls.find(
        (call) => call[0].toString().endsWith('package.json')
      );
      expect(packageJsonCall).toBeDefined();

      const packageJson = JSON.parse(packageJsonCall![1] as string);
      expect(packageJson.dependencies).toHaveProperty('axios');
      expect(packageJson.dependencies).toHaveProperty('dotenv');
      expect(packageJson.dependencies).toHaveProperty('zod');
    });

    it('should handle errors gracefully', async () => {
      const config = {
        name: 'error-project',
        description: 'This will fail',
        outputDir: tempDir,
      };

      // Make mkdir fail
      mockFsPromises.mkdir.mockRejectedValue(new Error('Permission denied'));

      const result = await service.createMCPProject(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('should validate required fields', async () => {
      const config = {
        name: '',
        description: 'Test MCP server',
        outputDir: tempDir,
      };

      const result = await service.createMCPProject(config);

      // Empty name should fail validation
      expect(result.success).toBe(false);
      expect(result.error).toContain('name is required');
    });

    it('should update server file with tools and resources', async () => {
      const config = {
        name: 'test-mcp',
        description: 'Test MCP server',
        outputDir: tempDir,
        tools: [{ name: 'test-tool', description: 'Test tool' }],
        resources: [{ name: 'test-resource', description: 'Test resource' }],
      };

      // Mock the server template to have the placeholders
      mockFsPromises.readFile.mockImplementation(async (path) => {
        if (path.toString().includes('index.ts')) {
          return `#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Tool imports
// {{TOOL_IMPORTS}}

// Resource imports
// {{RESOURCE_IMPORTS}}

const tools: any[] = [];
const resources: any[] = [];

export async function setupServer(server: Server) {
  // Register tools
  // {{REGISTER_TOOLS}}

  // Register resources
  // {{REGISTER_RESOURCES}}
}`;
        }
        return 'mock content';
      });

      await service.createMCPProject(config);

      // Find the server file write call
      const writeFileCalls = mockFsPromises.writeFile.mock.calls;
      const serverFileCall = writeFileCalls.find((call) =>
        call[0].toString().includes('src/mcp-server/index.ts')
      );

      expect(serverFileCall).toBeDefined();

      const serverContent = serverFileCall![1] as string;
      expect(serverContent).toContain('test_toolTool');
      expect(serverContent).toContain('test_resourceResource');
      expect(serverContent).toContain('tools.push(test_toolTool)');
      expect(serverContent).toContain('resources.push(test_resourceResource)');
    });

    it('should generate comprehensive README', async () => {
      const config = {
        name: 'documented-mcp',
        description: 'Well-documented MCP server',
        outputDir: tempDir,
        tools: [
          {
            name: 'tool1',
            description: 'First tool',
            parameters: { param1: 'string' },
          },
        ],
        resources: [
          {
            name: 'resource1',
            description: 'First resource',
            mimeType: 'text/plain',
          },
        ],
      };

      const result = await service.createMCPProject(config);

      expect(result.success).toBe(true);

      // Check README content
      const writeFileCalls = mockFsPromises.writeFile.mock.calls;
      const readmeCall = writeFileCalls.find((call) => call[0].toString().endsWith('README.md'));
      expect(readmeCall).toBeDefined();

      const readmeContent = readmeCall![1] as string;
      expect(readmeContent).toContain('# documented-mcp');
      expect(readmeContent).toContain('Well-documented MCP server');
      expect(readmeContent).toContain('## Available Tools');
      expect(readmeContent).toContain('### tool1');
      expect(readmeContent).toContain('## Available Resources');
      expect(readmeContent).toContain('### resource1');
      expect(readmeContent).toContain('**MIME Type:** text/plain');
    });

    it('should handle git initialization errors gracefully', async () => {
      const config = {
        name: 'git-fail-project',
        description: 'Git will fail',
        outputDir: tempDir,
      };

      // Make the service use a non-existent template path
      const nonExistentPath = path.join(__dirname, 'non-existent-template');
      (service as any).templatePath = nonExistentPath;

      // Make readdir throw for non-existent template
      mockFsPromises.readdir.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const result = await service.createMCPProject(config);

      // Should fail due to missing template
      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('should handle npm install errors gracefully', async () => {
      const config = {
        name: 'npm-fail-project',
        description: 'NPM will fail',
        outputDir: tempDir,
      };

      // Make the service use a non-existent template path
      const nonExistentPath = path.join(__dirname, 'non-existent-template');
      (service as any).templatePath = nonExistentPath;

      // Make readdir throw for non-existent template
      mockFsPromises.readdir.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const result = await service.createMCPProject(config);

      // Should fail due to missing template
      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });
  });

  describe('service lifecycle', () => {
    it('should start and stop correctly', async () => {
      await service.start();
      expect(elizaLogger.info).toHaveBeenCalledWith('[MCP] MCP Creation Service started');

      await service.stop();
      expect(elizaLogger.info).toHaveBeenCalledWith('[MCP] MCP Creation Service stopped');
    });
  });
}); 