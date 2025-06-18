"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testPlugin = void 0;
const test_action_1 = require("/Users/shawwalters/eliza-upgrading/packages/plugin-autocoder/src/__tests__/test-components/test-action");
const test_provider_1 = require("/Users/shawwalters/eliza-upgrading/packages/plugin-autocoder/src/__tests__/test-components/test-provider");
exports.testPlugin = {
    name: 'test-plugin',
    description: 'Test plugin for dynamic loading',
    actions: [test_action_1.TEST_ACTION],
    providers: [test_provider_1.testProvider],
    evaluators: [],
    services: [],
};
exports.default = exports.testPlugin;
