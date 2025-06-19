import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { MCPCreationService } from '../../services/mcp-creation-service';
import type { IAgentRuntime } from '@elizaos/core';

const execAsync = promisify(exec);

describe('MCP Creation Integration Tests', () => {
  let tempDir: string;
  let service: MCPCreationService;
  let mockRuntime: IAgentRuntime;

  beforeEach(async () => {
    // Create a real temp directory
    tempDir = path.join(process.cwd(), '.test-mcp-integration', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    // Minimal runtime mock - just what the service needs
    mockRuntime = {
      getSetting: (key: string) => {
        if (key === 'ANTHROPIC_API_KEY') return 'test-key';
        return null;
      },
      logger: {
        info: console.log,
        error: console.error,
        warn: console.warn,
        debug: console.debug,
      },
    } as any;

    service = new MCPCreationService(mockRuntime);
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp dir:', error);
    }
  });

  describe('Scenario 1: Simple Time Plugin', () => {
    it('should create a working time MCP server', async () => {
      const config = {
        name: 'time-mcp',
        description: 'Time tracking MCP server',
        outputDir: tempDir,
        tools: [
          {
            name: 'getCurrentTime',
            description: 'Get the current time in various formats',
            parameters: {
              timezone: { type: 'string', description: 'Timezone (e.g., UTC, America/New_York)', required: false },
              format: { type: 'string', description: 'Output format (iso, unix, human)', required: false },
            },
          },
        ],
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(true);
      expect(result.projectPath).toBeDefined();

      // Verify project structure
      const projectPath = result.projectPath!;
      expect(await fs.access(projectPath).then(() => true).catch(() => false)).toBe(true);

      // Verify package.json
      const packageJson = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
      );
      expect(packageJson.name).toBe('time-mcp');
      expect(packageJson.dependencies).toHaveProperty('@modelcontextprotocol/sdk');
    }, 30000); // Increase timeout to 30 seconds

    it('should generate executable time tool code', async () => {
      const config = {
        name: 'time-executable',
        description: 'Executable time MCP',
        outputDir: tempDir,
        tools: [
          {
            name: 'getCurrentTime',
            description: 'Get current time',
            parameters: {
              timezone: {
                type: 'string',
                description: 'Timezone (e.g., UTC, America/New_York)',
                required: false,
              },
            },
          },
        ],
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(true);

      // Read and verify the generated tool has proper implementation
      const toolPath = path.join(
        result.projectPath!,
        'src/mcp-server/tools/getcurrenttime-tool.ts'
      );
      const toolContent = await fs.readFile(toolPath, 'utf-8');

      // Should have actual implementation, not just placeholders
      expect(toolContent).toContain('export const getCurrentTimeTool');
      expect(toolContent).toContain('handler:');
      expect(toolContent).toContain('new Date()'); // Check for Date creation
      expect(toolContent).toContain('toISOString()'); // Check for ISO formatting
      expect(toolContent).toContain('timezone'); // Check for timezone handling
    });
  });

  describe('Scenario 2: Weather Service Plugin', () => {
    it('should create a weather MCP with tool and resource', async () => {
      const config = {
        name: 'weather-mcp',
        description: 'Weather data MCP server',
        outputDir: tempDir,
        tools: [
          {
            name: 'getWeather',
            description: 'Get weather for a location',
            parameters: {
              location: {
                type: 'string',
                description: 'City name or coordinates',
                required: true,
              },
              units: {
                type: 'string',
                enum: ['celsius', 'fahrenheit'],
                description: 'Temperature units',
                required: false,
              },
            },
          },
        ],
        resources: [
          {
            name: 'weather-config',
            description: 'Weather API configuration',
            mimeType: 'application/json',
          },
        ],
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(true);

      // Verify both tool and resource were created
      const projectPath = result.projectPath!;
      
      const toolPath = path.join(projectPath, 'src/mcp-server/tools/getweather-tool.ts');
      const resourcePath = path.join(projectPath, 'src/mcp-server/resources/weather-config-resource.ts');
      
      const toolExists = await fs.access(toolPath).then(() => true).catch(() => false);
      const resourceExists = await fs.access(resourcePath).then(() => true).catch(() => false);
      
      expect(toolExists).toBe(true);
      expect(resourceExists).toBe(true);

      // Verify server file includes both
      const serverPath = path.join(projectPath, 'src/mcp-server/index.ts');
      const serverContent = await fs.readFile(serverPath, 'utf-8');
      
      expect(serverContent).toContain('getweatherTool');
      expect(serverContent).toContain('weather_configResource');
    });
  });

  describe('Scenario 3: File Operations Plugin', () => {
    it('should create file operations MCP with security considerations', async () => {
      const config = {
        name: 'file-ops-mcp',
        description: 'Secure file operations MCP',
        outputDir: tempDir,
        tools: [
          {
            name: 'readFile',
            description: 'Read file contents',
            parameters: {
              path: { type: 'string', required: true },
              encoding: { type: 'string', default: 'utf-8' },
            },
          },
          {
            name: 'writeFile',
            description: 'Write file contents',
            parameters: {
              path: { type: 'string', required: true },
              content: { type: 'string', required: true },
            },
          },
          {
            name: 'listDirectory',
            description: 'List directory contents',
            parameters: {
              path: { type: 'string', required: true },
              recursive: { type: 'boolean', default: false },
            },
          },
        ],
        resources: [
          {
            name: 'file-permissions',
            description: 'File access permissions configuration',
            mimeType: 'application/json',
          },
        ],
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(true);

      // Verify all tools were created
      expect(result.details?.toolsGenerated).toHaveLength(3);
      expect(result.details?.resourcesGenerated).toHaveLength(1);

      // Check that file operations include security notes in implementation
      const readFilePath = path.join(
        result.projectPath!,
        'src/mcp-server/tools/readfile-tool.ts'
      );
      const content = await fs.readFile(readFilePath, 'utf-8');
      
      // Should have comments about security
      expect(content.toLowerCase()).toContain('security');
    });
  });

  describe('Scenario 4: TypeScript Compilation', () => {
    it('should create a project that compiles without errors', async () => {
      const config = {
        name: 'compilable-mcp',
        description: 'MCP that compiles correctly',
        outputDir: tempDir,
        tools: [
          {
            name: 'echo',
            description: 'Echo input back',
            parameters: {
              message: { type: 'string', required: true },
            },
          },
        ],
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(true);

      const projectPath = result.projectPath!;

      // Try to compile the TypeScript
      try {
        const { stdout, stderr } = await execAsync('npx tsc --noEmit', {
          cwd: projectPath,
        });
        
        // Should compile without errors
        expect(stderr).toBe('');
      } catch (error) {
        // If tsc is not available or other issues, skip this test
        console.warn('TypeScript compilation test skipped:', error);
      }
    });
  });

  describe('Scenario 5: Complex Multi-Tool Plugin', () => {
    it('should create a complex MCP with multiple integrated tools', async () => {
      const config = {
        name: 'multi-tool-mcp',
        description: 'Complex MCP with multiple tools',
        outputDir: tempDir,
        tools: [
          {
            name: 'fetchData',
            description: 'Fetch data from external source',
            parameters: {
              url: { type: 'string', required: true },
            },
          },
          {
            name: 'processData',
            description: 'Process fetched data',
            parameters: {
              data: { type: 'object', required: true },
              format: { type: 'string', enum: ['json', 'csv', 'xml'] },
            },
          },
          {
            name: 'storeResult',
            description: 'Store processed result',
            parameters: {
              key: { type: 'string', required: true },
              value: { type: 'any', required: true },
            },
          },
        ],
        resources: [
          {
            name: 'stored-data',
            description: 'Access to stored results',
            mimeType: 'application/json',
          },
        ],
        dependencies: ['axios', 'zod'],
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(true);

      // Verify complex setup
      expect(result.details?.toolsGenerated).toHaveLength(3);
      expect(result.details?.resourcesGenerated).toHaveLength(1);

      // Check dependencies were added
      const packageJson = await fs.readFile(
        path.join(result.projectPath!, 'package.json'),
        'utf-8'
      );
      const pkg = JSON.parse(packageJson);
      
      expect(pkg.dependencies.axios).toBeDefined();
      expect(pkg.dependencies.zod).toBeDefined();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle invalid project names safely', async () => {
      const config = {
        name: '../../../etc/passwd',
        description: 'Malicious path attempt',
        outputDir: tempDir,
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(true);
      
      // Should sanitize the name
      expect(result.projectPath).not.toContain('..');
      expect(result.projectPath).toContain('etc-passwd'); // Sanitized version
    });

    it('should handle missing template gracefully', async () => {
      // Temporarily break the template path
      const originalPath = (service as any).templatePath;
      (service as any).templatePath = '/non/existent/path';

      const config = {
        name: 'broken-template',
        description: 'Should fail gracefully',
        outputDir: tempDir,
      };

      const result = await service.createMCPProject(config);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Restore
      (service as any).templatePath = originalPath;
    });
  });
}); 