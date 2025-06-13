#!/usr/bin/env node
import { AgentRuntime, IAgentRuntime } from '@elizaos/core';
import { PluginCreationService } from '../services/plugin-creation-service.ts';
import path from 'path';
import fs from 'fs-extra';
import dotenv from 'dotenv';

// Import test suites
import basicTestSuite from './basic.ts';
import timePluginTestSuite from './plugin-creation-time.ts';
import astralPluginTestSuite from './plugin-creation-astral.ts';
import shellPluginTestSuite from './plugin-creation-shell.ts';

// Load environment variables
dotenv.config();

interface TestResult {
  name: string;
  success: boolean;
  error?: Error;
}

async function createTestRuntime(): Promise<IAgentRuntime> {
  console.log('Creating test runtime...');
  
  // Create a mock runtime with the necessary services
  const runtime = {
    getSetting: (key: string) => {
      if (key === 'ANTHROPIC_API_KEY') return process.env.ANTHROPIC_API_KEY;
      if (key === 'CLAUDE_MODEL') return process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
      if (key === 'PLUGIN_DATA_DIR') return path.join(process.cwd(), 'test-plugins');
      return null;
    },
    services: new Map(),
  } as unknown as IAgentRuntime;

  // Initialize the plugin creation service
  const service = await PluginCreationService.start(runtime);
  runtime.services.set('plugin_creation' as any, service);

  return runtime;
}

async function runTestSuite(runtime: IAgentRuntime, suite: any): Promise<TestResult[]> {
  console.log(`\n=== Running test suite: ${suite.name} ===`);
  console.log(`Description: ${suite.description}`);
  
  const results: TestResult[] = [];
  
  for (const test of suite.tests) {
    console.log(`\nRunning test: ${test.name}`);
    try {
      await test.fn(runtime);
      console.log(`✅ Test passed: ${test.name}`);
      results.push({ name: test.name, success: true });
    } catch (error) {
      console.error(`❌ Test failed: ${test.name}`);
      console.error(error);
      results.push({ 
        name: test.name, 
        success: false, 
        error: error as Error 
      });
    }
  }
  
  return results;
}

async function main() {
  console.log('Starting E2E tests...\n');
  
  // Check for required environment variables
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  WARNING: ANTHROPIC_API_KEY not found in environment');
    console.warn('⚠️  Plugin creation tests will fail without API access');
    console.warn('⚠️  Add ANTHROPIC_API_KEY to .env file to run full tests\n');
  }
  
  let runtime: IAgentRuntime | null = null;
  const allResults: { suite: string; results: TestResult[] }[] = [];
  
  try {
    // Create runtime
    runtime = await createTestRuntime();
    console.log('✅ Runtime created successfully\n');
    
    // Run test suites
    const testSuites = [
      basicTestSuite,
      timePluginTestSuite,
      astralPluginTestSuite,
      shellPluginTestSuite,
    ];
    
    for (const suite of testSuites) {
      const results = await runTestSuite(runtime, suite);
      allResults.push({ suite: suite.name, results });
    }
    
    // Print summary
    console.log('\n\n=== TEST SUMMARY ===');
    let totalTests = 0;
    let totalPassed = 0;
    
    for (const { suite, results } of allResults) {
      const passed = results.filter(r => r.success).length;
      const total = results.length;
      totalTests += total;
      totalPassed += passed;
      
      console.log(`\n${suite}: ${passed}/${total} tests passed`);
      if (passed < total) {
        results.filter(r => !r.success).forEach(r => {
          console.log(`  ❌ ${r.name}: ${r.error?.message}`);
        });
      }
    }
    
    console.log(`\nTotal: ${totalPassed}/${totalTests} tests passed`);
    
    // Exit with appropriate code
    process.exit(totalPassed === totalTests ? 0 : 1);
    
  } catch (error) {
    console.error('Fatal error running tests:', error);
    process.exit(1);
  } finally {
    // Cleanup (if needed in the future)
  }
}

// Run tests
main().catch(console.error); 