#!/usr/bin/env bun

import { SWEBenchRunner } from './src/swe-bench/swe-bench-runner';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function runSWEBenchReal() {
  console.log('🚀 Starting SWE-bench evaluation with REAL AI patch generation...\n');
  
  // Create mock runtime with API key from env
  const mockRuntime = {
    getSetting: (key: string) => {
      if (key === 'ANTHROPIC_API_KEY') {
        return process.env.ANTHROPIC_API_KEY;
      }
      return undefined;
    },
    agentId: 'swe-bench-real',
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

  // Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY not found in .env file');
    console.log('\nPlease add your Anthropic API key to .env file:');
    console.log('ANTHROPIC_API_KEY="your-key-here"');
    process.exit(1);
  }

  console.log('✅ Anthropic API key loaded from .env\n');

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
    
    // Run on a small set of instances
    const maxInstances = parseInt(process.env.SWE_BENCH_MAX || '2');
    console.log(`\n🔧 Running REAL evaluation on ${maxInstances} instances...\n`);
    console.log('⚠️  This will use your Anthropic API credits!\n');
    
    const report = await runner.runBenchmark({
      max_instances: maxInstances,
      language_filter: ['TypeScript', 'JavaScript'],
      save_artifacts: true,
      skip_evaluation: false, // Run full evaluation
      complexity_filter: ['low'], // Start with easier instances
      verbose: true
    });
    
    // Save report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reviewDir = path.join(process.cwd(), 'swe-bench-human-review', `real-run-${timestamp}`);
    await fs.mkdir(reviewDir, { recursive: true });
    
    // Save main report
    await fs.writeFile(
      path.join(reviewDir, 'report.json'),
      JSON.stringify(report, null, 2)
    );
    
    // Save summary
    const summary = {
      mode: 'REAL',
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
    let markdown = `# SWE-bench Real Evaluation Report

**Mode**: REAL (With AI patch generation)
**Date**: ${new Date().toISOString()}
**Duration**: ${summary.duration_minutes} minutes

## Summary

- **Total Instances**: ${summary.total_instances}
- **Resolved**: ${summary.resolved} (${summary.resolution_rate})
- **Compilation Success**: ${summary.compilation_success_rate}
- **Test Pass Rate**: ${summary.test_pass_rate}
- **Average Time**: ${summary.avg_execution_time_seconds}s per instance
- **Total Cost**: ${summary.total_cost}

## Instance Results

| Instance | Resolved | Compilation | Tests | Time (s) | Error |
|----------|----------|-------------|-------|----------|-------|
`;

    for (const inst of summary.instances) {
      markdown += `| ${inst.id} | ${inst.resolved ? '✅' : '❌'} | ${inst.compilation ? '✅' : '❌'} | ${inst.tests_passed ? '✅' : '❌'} | ${inst.time_seconds} | ${inst.error || '-'} |\n`;
    }

    // Note: Patch details are saved in the artifacts directory

    markdown += `## Artifacts

Patches and logs saved in: ${report.artifacts_dir || 'Not available'}
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
    
    console.log('\n✅ Evaluation complete!');
    console.log(`\n📁 Results saved to: ${reviewDir}`);
    console.log('\nSummary:');
    console.log(`- Resolution Rate: ${summary.resolution_rate}`);
    console.log(`- Compilation Success: ${summary.compilation_success_rate}`);
    console.log(`- Total Cost: ${summary.total_cost}`);
    
  } catch (error) {
    console.error('\n❌ Error running SWE-bench:', error);
    
    // Save error report
    const errorReport = {
      timestamp: new Date().toISOString(),
      mode: 'REAL',
      error: error.message,
      stack: error.stack
    };
    
    await fs.writeFile(
      path.join(process.cwd(), 'swe-bench-human-review', 'real-error-report.json'),
      JSON.stringify(errorReport, null, 2)
    );
  }
}

// Run the test
runSWEBenchReal().catch(console.error); 