import { SWEBenchRunner } from './src/swe-bench/swe-bench-runner';
import { SWEBenchDataLoader } from './src/swe-bench/data-loader';
import { elizaLogger } from '@elizaos/core';
import * as path from 'path';
import * as fs from 'fs/promises';

const mockRuntime: any = {
  getSetting: (key: string) => {
    if (key === 'ANTHROPIC_API_KEY') return process.env.ANTHROPIC_API_KEY;
    return null;
  },
  getService: () => null,
  agentId: 'test-agent',
  character: { name: 'TestAgent' },
  logger: elizaLogger
};

async function testSWEBenchRefined() {
  console.log('🔬 Testing refined SWE-bench implementation...\n');
  
  try {
    // Load dataset to find a good test instance
    const dataLoader = new SWEBenchDataLoader(path.join(process.cwd(), '.swe-bench-cache'));
    await dataLoader.initialize();
    const allInstances = await dataLoader.loadDataset();
    
    // Filter for simpler JavaScript instances (avoid complex test setups)
    const jsInstances = allInstances.filter(inst => 
      inst.language === 'JavaScript' && 
      !inst.repo.includes('axios') // Skip axios for now due to test issues
    );
    
    console.log(`📋 Found ${jsInstances.length} non-axios JavaScript instances`);
    
    if (jsInstances.length === 0) {
      console.log('❌ No suitable instances found');
      return;
    }
    
    // Pick a simpler instance
    const targetInstance = jsInstances.find(inst => 
      inst.repo.includes('express') || 
      inst.repo.includes('lodash') ||
      inst.repo.includes('underscore')
    ) || jsInstances[0];
    
    console.log(`\n🎯 Selected instance: ${targetInstance.instance_id}`);
    console.log(`  Repository: ${targetInstance.repo}`);
    console.log(`  Issue: ${targetInstance.issue_title}`);
    console.log(`  Created: ${targetInstance.created_at}`);
    
    // Initialize runner
    const runner = new SWEBenchRunner(mockRuntime, {
      useClaudeCode: true,
      max_parallel_instances: 1
    });
    await runner.initialize();
    
    console.log('\n🚀 Running benchmark...');
    const startTime = Date.now();
    
    const report = await runner.runBenchmark({
      instance_ids: [targetInstance.instance_id],
      max_instances: 1,
      save_artifacts: true,
      skip_evaluation: false
    });
    
    const duration = Date.now() - startTime;
    
    console.log('\n📈 Results:');
    console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`Total instances: ${report.results.total_instances}`);
    console.log(`Resolved: ${report.results.resolved_instances}`);
    console.log(`Resolution rate: ${(report.results.resolution_rate * 100).toFixed(1)}%`);
    console.log(`Total cost: $${report.results.summary.total_cost.toFixed(4)}`);
    
    // Check specific result
    const result = report.results.per_instance_results[0];
    if (result) {
      console.log(`\n🎯 Instance Result:`);
      console.log(`Resolved: ${result.resolved ? '✅ YES' : '❌ NO'}`);
      console.log(`Compilation: ${result.compilation_success ? '✅ PASSED' : '❌ FAILED'}`);
      console.log(`Tests: ${result.tests_passed ? '✅ PASSED' : '❌ FAILED'}`);
      
      if (result.error) {
        console.log(`\n⚠️ Error: ${result.error}`);
      }
    }
    
    // Check for generated patch
    const resultsFile = await fs.readFile(
      `.swe-bench-cache/results/results-${new Date().toISOString().split('T')[0]}*.json`,
      'utf-8'
    ).catch(() => null);
    
    if (resultsFile) {
      const results = JSON.parse(resultsFile);
      const patch = results[0]?.patch;
      if (patch) {
        console.log(`\n📝 Generated Patch (first 50 lines):`);
        console.log(patch.split('\n').slice(0, 50).join('\n'));
      }
    }
    
    console.log(`\n✅ Test completed! Report saved to: ${report.logs_dir}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  }
}

// Run the test
testSWEBenchRefined().catch(console.error); 