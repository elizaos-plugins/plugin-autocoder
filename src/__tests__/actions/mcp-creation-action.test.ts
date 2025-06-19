import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMCPAction } from '../../actions/mcp-creation-action';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';

// Mock the MCP creation service
const mockCreateMCPProject = vi.fn();
vi.mock('../../services/mcp-creation-service', () => ({
  MCPCreationService: vi.fn().mockImplementation(() => ({
    createMCPProject: mockCreateMCPProject,
  })),
}));

describe('createMCPAction', () => {
  let mockRuntime: IAgentRuntime;
  let mockMessage: Memory;
  let mockState: State;
  let mockCallback: any;
  let mockOrchestrationService: any;
  let mockSecretsManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the mock
    mockCreateMCPProject.mockReset();
    mockCreateMCPProject.mockResolvedValue({
      success: true,
      projectPath: '/test/path/test-mcp',
      details: {
        filesCreated: ['package.json', 'README.md'],
        toolsGenerated: ['weather-tool.ts', 'file-tool.ts'],
        resourcesGenerated: ['config-resource.ts'],
      },
    });

    // Create mock services
    mockOrchestrationService = { name: 'orchestration' };
    mockSecretsManager = { name: 'secrets-manager' };

    // Create mock runtime
    mockRuntime = {
      agentId: 'test-agent',
      character: { name: 'Test Agent' },
      getService: vi.fn().mockImplementation((name) => {
        if (name === 'orchestration') return mockOrchestrationService;
        if (name === 'secrets-manager') return mockSecretsManager;
        return null;
      }),
      composeState: vi.fn().mockResolvedValue({
        values: {},
        data: {},
        text: 'test state',
      }),
    } as unknown as IAgentRuntime;

    // Create mock message
    mockMessage = {
      id: '12345678-1234-1234-1234-123456789012' as any,
      entityId: '12345678-1234-1234-1234-123456789013' as any,
      roomId: '12345678-1234-1234-1234-123456789014' as any,
      agentId: '12345678-1234-1234-1234-123456789015' as any,
      content: {
        text: 'Create an MCP server called weather-service',
        source: 'test',
      },
      createdAt: Date.now(),
    } as Memory;

    // Create mock state
    mockState = {
      values: {},
      data: {},
      text: 'test state',
    } as State;

    // Create mock callback
    mockCallback = vi.fn();
  });

  describe('validate', () => {
    it('should return true when services are available and MCP keyword is present', async () => {
      const isValid = await createMCPAction.validate(mockRuntime, mockMessage, mockState);
      expect(isValid).toBe(true);
    });

    it('should return false when orchestration service is not available', async () => {
      mockRuntime.getService = vi.fn().mockImplementation((name) => {
        if (name === 'secrets-manager') return mockSecretsManager;
        return null;
      });
      
      const isValid = await createMCPAction.validate(mockRuntime, mockMessage, mockState);
      expect(isValid).toBe(false);
    });

    it('should return false when secrets manager is not available', async () => {
      mockRuntime.getService = vi.fn().mockImplementation((name) => {
        if (name === 'orchestration') return mockOrchestrationService;
        return null;
      });
      
      const isValid = await createMCPAction.validate(mockRuntime, mockMessage, mockState);
      expect(isValid).toBe(false);
    });

    it('should return false when MCP keyword is not present', async () => {
      mockMessage.content.text = 'Create a regular server';
      
      const isValid = await createMCPAction.validate(mockRuntime, mockMessage, mockState);
      expect(isValid).toBe(false);
    });
  });

  describe('handler', () => {
    it('should create a basic MCP project successfully', async () => {
      mockMessage.content.text = 'Create an MCP server called weather-service';
      const mockCallback = vi.fn();

      await createMCPAction.handler(mockRuntime, mockMessage, mockState, {}, mockCallback);

      expect(mockCreateMCPProject).toHaveBeenCalledWith({
        name: 'weather-service',
        description: 'Create an MCP server called weather-service',
        outputDir: expect.stringContaining('mcp-projects'),
        tools: [
          {
            name: 'getWeather',
            description: 'Get weather information',
          },
        ], // Natural language processing detects weather-related tool
        resources: [],
        dependencies: [],
      });

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Creating MCP server "weather-service"'),
          actions: ['CREATE_MCP'],
        })
      );
    });

    it('should extract tools from message', async () => {
      mockMessage.content.text = 'Create an MCP server for weather and file operations';
      const mockCallback = vi.fn();

      await createMCPAction.handler(mockRuntime, mockMessage, mockState, {}, mockCallback);

      expect(mockCreateMCPProject).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({ name: 'getWeather' }),
            expect.objectContaining({ name: 'readFile' }),
            expect.objectContaining({ name: 'writeFile' }),
          ]),
        })
      );
    });

    it('should extract resources from message', async () => {
      mockMessage.content.text = `Create an MCP server with config and data resources`;

      await createMCPAction.handler(mockRuntime, mockMessage, mockState, {}, mockCallback);

      expect(mockCreateMCPProject).toHaveBeenCalledWith(
        expect.objectContaining({
          resources: expect.arrayContaining([
            { name: 'config', description: 'config resource' },
            { name: 'data', description: 'data resource' }
          ]),
        })
      );
    });

    it('should handle complex requirements', async () => {
      mockMessage.content.text = `Create an MCP server called api-service with weather, web scraping, and database query tools`;

      await createMCPAction.handler(mockRuntime, mockMessage, mockState, {}, mockCallback);

      expect(mockCreateMCPProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'api-service',
          tools: expect.arrayContaining([
            expect.objectContaining({ name: expect.stringMatching(/weather|getWeather/i) }),
            expect.objectContaining({ name: expect.stringMatching(/request|makeRequest/i) }),
            expect.objectContaining({ name: expect.stringMatching(/query|executeQuery/i) }),
          ]),
        })
      );
    });

    it('should handle creation errors gracefully', async () => {
      mockCreateMCPProject.mockResolvedValue({
        success: false,
        error: 'Permission denied',
      });

      await createMCPAction.handler(mockRuntime, mockMessage, mockState, {}, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('MCP creation failed') && expect.stringContaining('Permission denied'),
          actions: ['CREATE_MCP'],
        })
      );
    });

    it('should handle missing services', async () => {
      mockRuntime.getService = vi.fn().mockReturnValue(null);

      await createMCPAction.handler(mockRuntime, mockMessage, mockState, {}, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Required services not available'),
          actions: ['CREATE_MCP'],
        })
      );
    });

    it('should use default name when not specified', async () => {
      mockMessage.content.text = 'Create an MCP server';

      await createMCPAction.handler(mockRuntime, mockMessage, mockState, {}, mockCallback);

      expect(mockCreateMCPProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my-mcp-server',
        })
      );
    });

    it('should sanitize project name', async () => {
      mockMessage.content.text = 'Create an MCP server named "My-Awesome-Server"';

      await createMCPAction.handler(mockRuntime, mockMessage, mockState, {}, mockCallback);

      expect(mockCreateMCPProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My-Awesome-Server',
        })
      );
    });

    it('should recognize multiple MCP keywords', async () => {
      const testCases = [
        'Create a model context protocol server',
        'Build a context protocol service',
        'Generate an MCP for data processing',
      ];

      for (const text of testCases) {
        mockMessage.content.text = text;
        const isValid = await createMCPAction.validate(mockRuntime, mockMessage, mockState);
        expect(isValid).toBe(true);
      }
    });

    it('should include usage instructions in response', async () => {
      await createMCPAction.handler(mockRuntime, mockMessage, mockState, {}, mockCallback);

      const lastCall = mockCallback.mock.calls[mockCallback.mock.calls.length - 1][0];
      expect(lastCall.text).toContain('npm install');
      expect(lastCall.text).toContain('npm test');
      expect(lastCall.text).toContain('npm run mcp:server');
      expect(lastCall.text).toContain('plugin-mcp');
    });
  });

  describe('action metadata', () => {
    it('should have correct name and similes', () => {
      expect(createMCPAction.name).toBe('CREATE_MCP');
      expect(createMCPAction.similes).toContain('create mcp');
      expect(createMCPAction.similes).toContain('build mcp server');
      expect(createMCPAction.similes).toContain('make model context protocol');
    });

    it('should have proper description', () => {
      expect(createMCPAction.description).toContain('Model Context Protocol');
    });

    it('should have examples', () => {
      expect(createMCPAction.examples).toBeDefined();
      expect(Array.isArray(createMCPAction.examples)).toBe(true);
      expect(createMCPAction.examples.length).toBeGreaterThan(0);
    });
  });
}); 