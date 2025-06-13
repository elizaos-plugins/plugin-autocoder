import { Plugin } from '@elizaos/core';
import { PluginCreationService } from './services/plugin-creation-service.ts';
import {
  createPluginAction,
  checkPluginCreationStatusAction,
  cancelPluginCreationAction,
  createPluginFromDescriptionAction,
} from './actions/plugin-creation-actions.ts';
import {
  pluginCreationStatusProvider,
  pluginCreationCapabilitiesProvider,
  pluginRegistryProvider,
  pluginExistsProvider,
} from './providers/plugin-creation-providers.ts';
import pluginDynamicTestSuite from './e2e/basic.ts';
import timePluginE2ETestSuite from './e2e/plugin-creation-time.ts';
import astralPluginE2ETestSuite from './e2e/plugin-creation-astral.ts';
import shellPluginE2ETestSuite from './e2e/plugin-creation-shell.ts';

// Export the plugin
export const pluginDynamic: Plugin = {
  name: '@elizaos/plugin-autocoder',
  description: 'Dynamic plugin creation system with AI-powered code generation',
  actions: [
    createPluginAction,
    checkPluginCreationStatusAction,
    cancelPluginCreationAction,
    createPluginFromDescriptionAction,
  ],
  providers: [
    pluginCreationStatusProvider,
    pluginCreationCapabilitiesProvider,
    pluginRegistryProvider,
    pluginExistsProvider,
  ],
  services: [PluginCreationService],
  evaluators: [],
  tests: [
    pluginDynamicTestSuite,
    timePluginE2ETestSuite,
    astralPluginE2ETestSuite,
    shellPluginE2ETestSuite,
  ],
};

// Export individual components
export {
  PluginCreationService,
  createPluginAction,
  checkPluginCreationStatusAction,
  cancelPluginCreationAction,
  createPluginFromDescriptionAction,
  pluginCreationStatusProvider,
  pluginCreationCapabilitiesProvider,
};

// Default export
export default pluginDynamic;

// Re-export types and utilities
export {
  type PluginSpecification,
  type PluginCreationJob,
  ClaudeModel,
} from './services/plugin-creation-service.ts';
export * from './utils/plugin-templates.ts';
export { pluginRegistryProvider, pluginExistsProvider };
