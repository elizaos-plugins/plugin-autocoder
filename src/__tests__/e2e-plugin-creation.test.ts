import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginCreationService, type PluginSpecification, ClaudeModel } from '../services/plugin-creation-service';
import type { IAgentRuntime } from '@elizaos/core';
import fs from 'fs-extra';
import path from 'path';

export const TIME_PLUGIN_SPEC: PluginSpecification = {
  name: '@elizaos/plugin-time',
  description: 'A time and timezone management plugin for Eliza',
  version: '1.0.0',
  actions: [
    {
      name: 'getCurrentTime',
      description: 'Get the current time in a specified timezone',
      parameters: {
        timezone: {
          type: 'string',
          description: 'IANA timezone (e.g., America/New_York)',
          required: false,
        },
      },
    },
    {
      name: 'convertTime',
      description: 'Convert time between timezones',
      parameters: {
        time: {
          type: 'string',
          description: 'Time to convert (ISO format or human-readable)',
          required: true,
        },
        fromTimezone: {
          type: 'string',
          description: 'Source timezone',
          required: true,
        },
        toTimezone: {
          type: 'string',
          description: 'Target timezone',
          required: true,
        },
      },
    },
  ],
  providers: [
    {
      name: 'timeProvider',
      description: 'Provides current time context to the agent',
      dataStructure: {
        currentTime: 'string',
        timezone: 'string',
        offset: 'string',
      },
    },
  ],
};

describe('E2E Plugin Creation Tests', () => {
  let service: PluginCreationService;
  let runtime: IAgentRuntime;
  let testOutputDir: string;

  beforeEach(async () => {
    testOutputDir = path.join(process.cwd(), 'test-output', 'plugins', Date.now().toString());
    
    runtime = {
      getSetting: vi.fn().mockImplementation((key: string) => {
        if (key === 'PLUGIN_DATA_DIR') return testOutputDir;
        if (key === 'ANTHROPIC_API_KEY') return process.env.ANTHROPIC_API_KEY || 'test-api-key';
        if (key === 'CLAUDE_MODEL') return ClaudeModel.SONNET_3_5;
        return null;
      }),
      getService: vi.fn().mockReturnValue(null),
      services: new Map(),
    } as any;

    service = new PluginCreationService(runtime);
    await service.initialize(runtime);
  });

  it('should create a simple plugin with template', async () => {
    const spec: PluginSpecification = {
      name: '@test/simple-plugin',
      description: 'A simple test plugin',
      actions: [
        {
          name: 'hello',
          description: 'Say hello',
        },
      ],
    };

    const jobId = await service.createPlugin(spec);
    expect(jobId).toBeDefined();

    // Wait for job to start
    await new Promise(resolve => setTimeout(resolve, 100));

    const job = service.getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.status).toBe('running');
  });

  it('should handle TIME_PLUGIN_SPEC', async () => {
    const jobId = await service.createPlugin(TIME_PLUGIN_SPEC);
    expect(jobId).toBeDefined();

    const job = service.getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.specification.name).toBe('@elizaos/plugin-time');
    expect(job?.specification.actions).toHaveLength(2);
    expect(job?.specification.providers).toHaveLength(1);
  });
}); 