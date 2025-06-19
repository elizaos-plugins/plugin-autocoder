#!/usr/bin/env bun

import { SWEBenchRunner } from './src/swe-bench/swe-bench-runner';
import * as fs from 'fs/promises';
import * as path from 'path';

async function runSWEBenchMockTest() {
  console.log('🚀 Starting SWE-bench evaluation in MOCK MODE...\n');
  console.log('⚠️  Note: This is a mock run without actual AI patch generation\n');
  
  // Create mock runtime
  const mockRuntime = {
    getSetting: (key: string) => {
      if (key === 'ANTHROPIC_API_KEY') {
        return 'mock-api-key'; // Mock key for testing
      }
      return undefined;
    },
    agentId: 'swe-bench-mock-test',
    character: {
      name: 'SWEBenchAgent',
      bio: ['Agent for SWE-bench evaluation'],
      knowledge: [],
      messageExamples: [],
      postExamples: [],
      topics: [],
      adjectives: [],
      clients: [],
      plugins: []
    }
  } as any;

  // Set mock mode environment variable
  process.env.SWE_BENCH_MOCK_MODE = 'true';

  // Create runner
  const runner = new SWEBenchRunner(mockRuntime, {
    docker_enabled: false,
    max_parallel_instances: 1,
    cleanup_after_run: true
  });

  try {
    // Initialize
    console.log('📦 Initializing SWE-bench runner...');
    await runner.initialize();
    
    // Get dataset stats first
    console.log('\n📊 Loading dataset statistics...');
    const stats = await runner.getDatasetStats();
    console.log(`Total instances: ${stats.total}`);
    console.log(`TypeScript/JavaScript: ${(stats.byLanguage['TypeScript'] || 0) + (stats.byLanguage['JavaScript'] || 0)}`);
    console.log(`By language:`, stats.byLanguage);
    console.log(`By repository:`, Object.entries(stats.byRepo).slice(0, 5).map(([k,v]) => `${k}: ${v}`).join(', '), '...');
    
    // Run on a small set of instances
    const maxInstances = 3;
    console.log(`\n🔧 Running mock evaluation on ${maxInstances} instances...\n`);
    
    const report = await runner.runBenchmark({
      max_instances: maxInstances,
      language_filter: ['TypeScript', 'JavaScript'],
      save_artifacts: true,
      skip_evaluation: true, // Skip Python evaluation
      complexity_filter: ['low'] // Start with easier instances
    });
    
    // Save report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reviewDir = path.join(process.cwd(), 'swe-bench-human-review', `mock-run-${timestamp}`);
    await fs.mkdir(reviewDir, { recursive: true });
    
    // Save main report
    await fs.writeFile(
      path.join(reviewDir, 'report.json'),
      JSON.stringify(report, null, 2)
    );
    
    // Save summary
    const summary = {
      mock_mode: true,
      timestamp: new Date().toISOString(),
      duration_minutes: (report.duration / 1000 / 60).toFixed(2),
      total_instances: report.results.total_instances,
      resolved: report.results.resolved_instances,
      resolution_rate: (report.results.resolution_rate * 100).toFixed(1) + '%',
      compilation_success_rate: (report.results.compilation_success_rate * 100).toFixed(1) + '%',
      test_pass_rate: (report.results.test_pass_rate * 100).toFixed(1) + '%',
      avg_execution_time_seconds: (report.results.summary.avg_execution_time / 1000).toFixed(1),
      total_cost: '$' + report.results.summary.total_cost.toFixed(2),
      instances: report.results.per_instance_results.map(r => ({
        id: r.instance_id,
        resolved: r.resolved,
        compilation: r.compilation_success,
        tests_passed: r.tests_passed,
        time_seconds: (r.execution_time / 1000).toFixed(1),
        error: r.error
      }))
    };
    
    await fs.writeFile(
      path.join(reviewDir, 'summary.json'),
      JSON.stringify(summary, null, 2)
    );
    
    // Create markdown report
    let markdown = `# SWE-bench Mock Evaluation Report

**Mode**: MOCK (No actual AI patch generation)
**Date**: ${new Date().toISOString()}
**Duration**: ${summary.duration_minutes} minutes

## Summary

- **Total Instances**: ${summary.total_instances}
- **Resolved**: ${summary.resolved} (${summary.resolution_rate})
- **Compilation Success**: ${summary.compilation_success_rate}
- **Test Pass Rate**: ${summary.test_pass_rate}
- **Average Time**: ${summary.avg_execution_time_seconds}s per instance
- **Total Cost**: ${summary.total_cost} (mock)

## Instance Results

| Instance | Resolved | Compilation | Tests | Time (s) | Error |
|----------|----------|-------------|-------|----------|-------|
`;

    for (const inst of summary.instances) {
      markdown += `| ${inst.id} | ${inst.resolved ? '✅' : '❌'} | ${inst.compilation ? '✅' : '❌'} | ${inst.tests_passed ? '✅' : '❌'} | ${inst.time_seconds} | ${inst.error || '-'} |\n`;
    }

    // Note: Instance details are limited in InstanceResult type

    markdown += `## Artifacts

Patches and logs saved in: ${report.artifacts_dir || 'Not available'}

## Notes

This was a mock run without actual AI patch generation. To run with real AI:
1. Set your Anthropic API key: \`export ANTHROPIC_API_KEY="your-key"\`
2. Run: \`bun run-swe-bench-test.ts\`
`;

    await fs.writeFile(
      path.join(reviewDir, 'report.md'),
      markdown
    );
    
    // Copy artifacts if available
    if (report.artifacts_dir) {
      const artifactsDir = path.join(reviewDir, 'artifacts');
      await fs.mkdir(artifactsDir, { recursive: true });
      
      try {
        await fs.cp(report.artifacts_dir, artifactsDir, { recursive: true });
      } catch (error) {
        console.log('Note: Could not copy artifacts:', error.message);
      }
    }
    
    console.log('\n✅ Mock evaluation complete!');
    console.log(`\n📁 Results saved to: ${reviewDir}`);
    console.log('\nSummary:');
    console.log(`- Resolution Rate: ${summary.resolution_rate}`);
    console.log(`- Compilation Success: ${summary.compilation_success_rate}`);
    console.log(`- Total Cost: ${summary.total_cost} (mock)`);
    
    console.log('\n⚠️  This was a MOCK run. To run with actual AI patch generation:');
    console.log('1. Set your Anthropic API key: export ANTHROPIC_API_KEY="your-key"');
    console.log('2. Run: bun run-swe-bench-test.ts');
    
  } catch (error) {
    console.error('\n❌ Error running SWE-bench:', error);
    
    // Save error report
    const errorReport = {
      timestamp: new Date().toISOString(),
      mock_mode: true,
      error: error.message,
      stack: error.stack
    };
    
    await fs.writeFile(
      path.join(process.cwd(), 'swe-bench-human-review', 'mock-error-report.json'),
      JSON.stringify(errorReport, null, 2)
    );
  }
  
  // Clean up
  delete process.env.SWE_BENCH_MOCK_MODE;
}

// Run the test
runSWEBenchMockTest().catch(console.error); 