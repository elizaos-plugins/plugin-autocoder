import { type Plugin } from '@elizaos/core';
import { TEST_ACTION } from './test-action';
import { testProvider } from './test-provider';

export const testPlugin: Plugin = {
  name: 'test-plugin',
  description: 'Test plugin for dynamic loading',
  actions: [TEST_ACTION],
  providers: [testProvider],
  evaluators: [],
  services: [],
};

export default testPlugin;
