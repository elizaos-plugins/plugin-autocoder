#!/usr/bin/env bun

import { elizaLogger } from '@elizaos/core';
import type { IAgentRuntime, UUID } from '@elizaos/core';
import { autocoderPlugin } from '../src';
import { BenchmarkRunner } from '../src/benchmarks/benchmark-runner';
import { benchmarkScenarios } from '../src/benchmarks/scenarios';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: path.join(process.cwd(), '.env') });

/**
 * Create a mock runtime for benchmarking
 */
function createMockRuntime(): IAgentRuntime {
  const agentId = uuidv4() as UUID;
  
  // Create runtime object first so we can reference it
  const runtime: IAgentRuntime = {
    agentId,
    character: {
      name: 'BenchmarkAgent',
      bio: ['A benchmark testing agent'],
      system: 'You are a benchmark testing agent.',
      messageExamples: [],
      postExamples: [],
      topics: [],
      adjectives: [],
      knowledge: [],
      plugins: [autocoderPlugin.name],
    },
    
    // Settings
    getSetting: (key: string) => {
      const settings: Record<string, string> = {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
        CLAUDE_API_KEY: process.env.CLAUDE_API_KEY || '',
        PLUGIN_DATA_DIR: path.join(process.cwd(), 'benchmarks', 'data'),
      };
      // Return the setting value (not the entire settings object)
      return settings[key] || process.env[key] || null;
    },
    
    // Services
    getService: (name: string) => {
      // Return services as needed by the benchmark
      if (name === 'orchestration') {
        // The benchmark runner will create its own orchestration manager
        return {
          start: async () => {},
          stop: async () => {},
        };
      }
      if (name === 'research') {
        // Mock research service
        return {
          createResearchProject: async (title: string, description: string) => ({
            id: `research-${Date.now()}`,
            title,
            description,
            status: 'completed',
            report: 'Mock research report: Best practices suggest creating modular, testable code.',
            findings: [
              'Use TypeScript for type safety',
              'Follow ElizaOS plugin conventions',
              'Include comprehensive tests'
            ],
          }),
          getProject: async (id: string) => ({
            id,
            status: 'completed',
            report: 'Mock research report',
            findings: [],
          }),
        };
      }
      if (name === 'knowledge') {
        // Mock knowledge service
        return {
          storeDocument: async (doc: any) => ({ id: `doc-${Date.now()}` }),
          getKnowledge: async () => [],
          searchKnowledge: async () => [],
        };
      }
      if (name === 'env-manager') {
        // Mock environment manager
        return {
          getEnvVar: (key: string) => process.env[key] || null,
          setEnvVar: async () => {},
        };
      }
      if (name === 'plugin-manager') {
        // Mock plugin manager
        return {
          clonePlugin: async () => ({ path: '/tmp/mock-plugin' }),
          listPlugins: async () => [],
          loadPlugin: async () => {},
        };
      }
      if (name === 'secrets-manager') {
        // Mock secrets manager  
        return {
          getSecret: async (key: string) => runtime.getSetting(key),
          setSecret: async () => {},
          hasSecret: async (key: string) => !!runtime.getSetting(key),
        };
      }
      return null;
    },
    
    // Logging
    logger: {
      info: (msg: string, ...args: any[]) => elizaLogger.info(`[Runtime] ${msg}`, ...args),
      warn: (msg: string, ...args: any[]) => elizaLogger.warn(`[Runtime] ${msg}`, ...args),
      error: (msg: string, ...args: any[]) => elizaLogger.error(`[Runtime] ${msg}`, ...args),
      debug: (msg: string, ...args: any[]) => elizaLogger.debug(`[Runtime] ${msg}`, ...args),
    },
    
    // Empty collections for benchmark
    actions: [],
    providers: [],
    evaluators: [],
    plugins: [autocoderPlugin],
    services: new Map(),
    events: new Map(),
    routes: [],
    
    // Stub methods that shouldn't be called during benchmarks
    initialize: async () => {
      elizaLogger.info('Mock runtime initialized');
    },
    registerPlugin: async () => {},
    registerAction: function(action: any) {
      // Register actions in the runtime
      runtime.actions.push(action);
    },
    registerProvider: function(provider: any) {
      // Register providers in the runtime
      runtime.providers.push(provider);
    },
    registerEvaluator: function(evaluator: any) {
      // Register evaluators in the runtime
      runtime.evaluators.push(evaluator);
    },
    registerService: function(service: any) {
      // Register services in the runtime
      const serviceName = service.constructor?.serviceName || service.name;
      runtime.services.set(serviceName, service);
    },
    useModel: async () => ({ text: 'mock response' }),
    processActions: async () => {},
    evaluate: async () => null,
    composeState: async () => ({ values: {}, data: {}, text: '' }),
    
    // Database stubs (not used in benchmarks)
    db: {
      query: async () => [],
      execute: async () => ({ changes: 0 }),
    } as any,
    
    // Memory stubs (not used in benchmarks)
    messageManager: {
      createMemory: async () => {},
      getMemories: async () => [],
      updateMemory: async () => {},
      deleteMemory: async () => {},
      searchMemories: async () => [],
      getLastMessages: async () => [],
    } as any,
  } as unknown as IAgentRuntime;
  
  return runtime;
}

/**
 * Script to run AutoCoder benchmarks
 */
async function runBenchmarks() {
  elizaLogger.info('🚀 Starting AutoCoder Benchmarks');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const scenarioId = args.find((arg) => !arg.startsWith('--'));
  const verbose = args.includes('--verbose');
  const parallel = args.includes('--parallel');
  const compareBaseline = args.find((arg) => arg.startsWith('--baseline='))?.split('=')[1];

  try {
    // Create a mock runtime for benchmarking
    const runtime = createMockRuntime();
    
    // Debug API key loading
    const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
    elizaLogger.info(`API Key loaded: ${anthropicKey ? 'Yes (' + anthropicKey.substring(0, 10) + '...)' : 'No'}`);
    elizaLogger.info(`Process env ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'Yes' : 'No'}`);
    
    // Check for API key
    if (!anthropicKey && !runtime.getSetting('CLAUDE_API_KEY')) {
      elizaLogger.error('❌ Missing API key: Please set ANTHROPIC_API_KEY or CLAUDE_API_KEY environment variable');
      process.exit(1);
    }

    // Initialize the autocoder plugin
    if (autocoderPlugin.init) {
      await autocoderPlugin.init({}, runtime);
    }

    // Filter scenarios if specific one requested
    let selectedScenarios = benchmarkScenarios;
    if (scenarioId) {
      selectedScenarios = benchmarkScenarios.filter((s) => s.id === scenarioId);
      if (selectedScenarios.length === 0) {
        elizaLogger.error(`Scenario '${scenarioId}' not found`);
        elizaLogger.info('Available scenarios:');
        benchmarkScenarios.forEach((s) => {
          elizaLogger.info(`  - ${s.id}: ${s.name}`);
        });
        process.exit(1);
      }
    }

    // Configure benchmark
    const outputDir = path.join(
      process.cwd(),
      'benchmarks',
      'results',
      new Date().toISOString().split('T')[0]
    );

    const config = {
      outputDir,
      scenarios: selectedScenarios,
      parallel,
      verbose,
      saveArtifacts: true,
      compareBaseline,
    };

    elizaLogger.info('Benchmark Configuration:');
    elizaLogger.info(`  Output: ${outputDir}`);
    elizaLogger.info(`  Scenarios: ${selectedScenarios.length}`);
    elizaLogger.info(`  Parallel: ${parallel}`);
    elizaLogger.info(`  Verbose: ${verbose}`);
    if (compareBaseline) {
      elizaLogger.info(`  Baseline: ${compareBaseline}`);
    }

    // Create and initialize benchmark runner
    const runner = new BenchmarkRunner(runtime, config);
    await runner.initialize();
    
    // Run benchmarks
    const results = await runner.runAll();

    // Summary
    const passed = results.filter((r) => r.success).length;
    const total = results.length;
    const successRate = ((passed / total) * 100).toFixed(1);

    elizaLogger.info('\n📊 Benchmark Summary:');
    elizaLogger.info(`  Success Rate: ${passed}/${total} (${successRate}%)`);
    elizaLogger.info(`  Reports saved to: ${outputDir}`);

    // Exit with appropriate code
    process.exit(passed === total ? 0 : 1);
  } catch (error) {
    elizaLogger.error('Benchmark failed:', error);
    elizaLogger.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    elizaLogger.error('Full error:', JSON.stringify(error, null, 2));
    process.exit(1);
  }
}

// Show usage if --help
if (process.argv.includes('--help')) {
  console.log(`
AutoCoder Benchmark Runner

Usage: bun run benchmarks [scenario-id] [options]

Options:
  --verbose          Show detailed output
  --parallel         Run scenarios in parallel
  --baseline=<file>  Compare results with baseline file
  --help            Show this help message

Scenarios:
  simple-action      Basic plugin with single action
  api-integration    Plugin with external API integration
  stateful-service   Plugin with stateful service and persistence
  multi-component    Complex plugin with all component types
  plugin-update      Update existing plugin with new features

Examples:
  bun run benchmarks                    # Run all scenarios
  bun run benchmarks simple-action      # Run specific scenario
  bun run benchmarks --parallel         # Run all scenarios in parallel
  bun run benchmarks --baseline=baseline.json  # Compare with baseline
`);
  process.exit(0);
}

// Run benchmarks
runBenchmarks().catch((error) => {
  elizaLogger.error('Fatal error:', error);
  process.exit(1);
});
