#!/usr/bin/env bun

import { AgentRuntime, elizaLogger } from '@elizaos/core';
import { pluginAutocoderPlugin } from '../src';
import { BenchmarkRunner } from '../src/benchmarks/benchmark-runner';
import { benchmarkScenarios } from '../src/benchmarks/scenarios';
import * as path from 'path';

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
    // Create a minimal runtime for benchmarking
    const runtime = new AgentRuntime({
      character: {
        name: 'BenchmarkAgent',
        bio: ['A benchmark testing agent'],
        system: 'You are a benchmark testing agent.',
        messageExamples: [],
        postExamples: [],
        topics: [],
        adjectives: [],
        knowledge: [],
        plugins: [pluginAutocoderPlugin.name],
      },
      plugins: [pluginAutocoderPlugin],
    });

    // Initialize runtime
    await runtime.initialize();

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

    // Create and run benchmark
    const runner = new BenchmarkRunner(runtime, config);
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
