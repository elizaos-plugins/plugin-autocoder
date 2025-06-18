import { type Action, type IAgentRuntime, type Memory, type ActionResult } from '@elizaos/core';

export const TEST_ACTION: Action = {
  name: 'test-action',
  description: 'A test action for dynamic loading',
  examples: [
    [
      { name: 'user', content: { text: 'test action' } },
      { name: 'assistant', content: { text: 'Executing test action' } },
    ],
  ],
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    return message.content.text?.includes('test') || false;
  },
  handler: async (runtime: IAgentRuntime, message: Memory): Promise<ActionResult> => {
    console.log('Test action executed');
    return {
      text: 'Test action completed successfully',
      values: {
        executed: true,
        actionName: 'test-action',
      },
      data: {
        message: message.content.text,
        timestamp: Date.now(),
      },
    };
  },
};

export default TEST_ACTION;
