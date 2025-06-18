import { type Provider, type IAgentRuntime, type Memory, type State } from '@elizaos/core';

export const testProvider: Provider = {
  name: 'test-provider',
  description: 'Test provider for dynamic loading',
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    return {
      text: 'Test context information',
      values: {
        testKey: 'testValue',
        timestamp: Date.now(),
      },
      data: {
        message: message.content.text,
        state: state,
      },
    };
  },
};

export default testProvider;
