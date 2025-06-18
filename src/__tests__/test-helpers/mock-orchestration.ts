import { vi } from 'vitest';
import type { IAgentRuntime, UUID } from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';

export function createMockRuntime(): IAgentRuntime {
  return {
    agentId: uuidv4() as UUID,
    getSetting: vi.fn().mockImplementation((key: string) => {
      if (key === 'ANTHROPIC_API_KEY') return 'test-key';
      if (key === 'PLUGIN_DATA_DIR') return '/tmp/test-data';
      return null;
    }),
    getService: vi.fn().mockImplementation((name: string) => {
      if (name === 'research') {
        return {
          createResearchProject: vi.fn().mockResolvedValue({ id: 'research-1' }),
          getProject: vi.fn().mockResolvedValue({
            id: 'research-1',
            status: 'completed',
            report: 'Test research report',
            findings: [],
          }),
        };
      }
      if (name === 'knowledge') {
        return {
          storeDocument: vi.fn().mockResolvedValue({ id: 'doc-1' }),
          getKnowledge: vi.fn().mockResolvedValue([]),
        };
      }
      if (name === 'env-manager') {
        return {
          getEnvVar: vi.fn().mockReturnValue(null),
        };
      }
      if (name === 'plugin-manager') {
        return {
          clonePlugin: vi.fn().mockResolvedValue({ path: '/tmp/test-project' }),
        };
      }
      return null;
    }),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  } as any;
}

export function mockAnthropicClient() {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: `File: src/index.ts
\`\`\`typescript
export const plugin = {
  name: 'test-plugin',
  description: 'A test plugin',
  actions: [],
  providers: []
};
\`\`\`

File: src/__tests__/index.test.ts
\`\`\`typescript
import { describe, it, expect } from 'vitest';
import { plugin } from '../index';

describe('Plugin', () => {
  it('should be defined', () => {
    expect(plugin).toBeDefined();
  });
});
\`\`\``,
          },
        ],
      }),
    },
  };
}
