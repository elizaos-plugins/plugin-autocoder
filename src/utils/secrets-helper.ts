import { type IAgentRuntime } from '@elizaos/core';

/**
 * Helper function to get API key from secrets manager for scripts
 * Since scripts run outside of the runtime context, we fallback to environment variables
 */
export async function getApiKeyFromSecretsManager(): Promise<string> {
  // For scripts, we simply use environment variables since we don't have a full runtime context
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not found in environment variables');
  }
  return apiKey;
}

/**
 * Create a mock runtime for scripts that need IAgentRuntime interface
 */
export async function createMockRuntimeWithSecrets(agentId: string = 'script-agent'): Promise<IAgentRuntime> {
  const apiKey = await getApiKeyFromSecretsManager();

  return {
    getSetting: (key: string) => {
      if (key === 'ANTHROPIC_API_KEY') {
        return apiKey;
      }
      return process.env[key];
    },
    getService: (serviceName: string) => {
      return null; // Graceful fallback for other services
    },
    agentId,
    character: {
      name: 'ScriptAgent',
      bio: ['Agent for script execution'],
      knowledge: [],
      messageExamples: [],
      postExamples: [],
      topics: [],
      adjectives: [],
      clients: [],
      plugins: []
    }
  } as any; // Type assertion since we're only implementing a subset
}