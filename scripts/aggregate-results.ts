#!/usr/bin/env bun

/**
 * Comprehensive SWE-bench Results Aggregator
 * Collects and analyzes all benchmark results for detailed review
 */

import * as fs from 'fs/promises';
import * as path from 'path';

interface BenchmarkResult {
  instance_id: string;
  success: boolean;
  patch: string;
  execution_time: number;
  iterations: number;
  token_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total: number;
    cost: number;
  };
  test_results?: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
    failures?: Array<{
      test_name: string;
      error_message: string;
    }>;
  };
  compilation_success?: boolean;
  validation_details?: {
    compilation_success: boolean;
    test_pass_rate: number;
    requirements_met: string[];
    requirements_missed: string[];
    performance_issues: string[];
  };
}

interface ComprehensiveReport {
  metadata: {
    timestamp: string;
    total_instances: number;
    completed_instances: number;
    duration_hours: number;
    average_time_per_instance: number;
  };
  performance: {
    success_rate: number;
    successful_instances: number;
    failed_instances: number;
    compilation_success_rate: number;
    test_pass_rate: number;
    total_cost: number;
    average_cost_per_instance: number;
    total_tokens: number;
    average_iterations: number;
  };
  detailed_results: BenchmarkResult[];
  analysis: {
    success_by_repo: Record<string, { total: number; successful: number; rate: number }>;
    common_failures: Array<{ error: string; count: number; instances: string[] }>;
    performance_metrics: {
      fastest_instance: { id: string; time: number };
      slowest_instance: { id: string; time: number };
      most_expensive: { id: string; cost: number };
      most_iterations: { id: string; iterations: number };
    };
    patch_analysis: {
      average_patch_size: number;
      largest_patch: { id: string; size: number };
      smallest_patch: { id: string; size: number };
    };
  };
  recommendations: string[];
}

async function findLatestResults(): Promise<string | null> {
  const resultsDir = path.join(process.cwd(), '.swe-bench-cache', 'results');
  
  try {
    const files = await fs.readdir(resultsDir);
    const resultFiles = files
      .filter(f => f.startsWith('results-') && f.endsWith('.json'))
      .sort()
      .reverse();
    
    if (resultFiles.length === 0) {
      return null;
    }
    
    return path.join(resultsDir, resultFiles[0]);
  } catch (error) {
    return null;
  }
}

async function loadResults(filePath: string): Promise<BenchmarkResult[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

function analyzeResults(results: BenchmarkResult[]): ComprehensiveReport {
  const startTime = new Date();
  
  // Basic metrics
  const successfulResults = results.filter(r => r.success);
  const totalCost = results.reduce((sum, r) => sum + (r.token_usage?.cost || 0), 0);
  const totalTokens = results.reduce((sum, r) => sum + (r.token_usage?.total || 0), 0);
  const totalTime = results.reduce((sum, r) => sum + r.execution_time, 0);
  const compilationSuccesses = results.filter(r => r.compilation_success).length;
  
  // Success by repository
  const successByRepo: Record<string, { total: number; successful: number; rate: number }> = {};
  for (const result of results) {
    const repo = result.instance_id.split('__')[0];
    if (!successByRepo[repo]) {
      successByRepo[repo] = { total: 0, successful: 0, rate: 0 };
    }
    successByRepo[repo].total++;
    if (result.success) {
      successByRepo[repo].successful++;
    }
  }
  
  // Calculate rates
  for (const repo in successByRepo) {
    successByRepo[repo].rate = successByRepo[repo].successful / successByRepo[repo].total;
  }
  
  // Common failures analysis
  const failureMap: Record<string, { count: number; instances: string[] }> = {};
  for (const result of results) {
    if (!result.success && result.test_results?.failures) {
      for (const failure of result.test_results.failures) {
        const key = failure.error_message.substring(0, 100); // Truncate for grouping
        if (!failureMap[key]) {
          failureMap[key] = { count: 0, instances: [] };
        }
        failureMap[key].count++;
        failureMap[key].instances.push(result.instance_id);
      }
    }
  }
  
  const commonFailures = Object.entries(failureMap)
    .map(([error, data]) => ({ error, count: data.count, instances: data.instances }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  // Performance metrics
  const sortedByTime = [...results].sort((a, b) => a.execution_time - b.execution_time);
  const sortedByCost = [...results].sort((a, b) => (b.token_usage?.cost || 0) - (a.token_usage?.cost || 0));
  const sortedByIterations = [...results].sort((a, b) => b.iterations - a.iterations);
  
  // Patch analysis
  const patchSizes = results.map(r => r.patch.length).filter(size => size > 0);
  const averagePatchSize = patchSizes.length > 0 ? patchSizes.reduce((a, b) => a + b, 0) / patchSizes.length : 0;
  const largestPatchResult = results.reduce((max, r) => r.patch.length > max.patch.length ? r : max, results[0]);
  const smallestPatchResult = results.filter(r => r.patch.length > 0).reduce((min, r) => r.patch.length < min.patch.length ? r : min, results.find(r => r.patch.length > 0) || results[0]);
  
  // Generate recommendations
  const recommendations: string[] = [];
  const successRate = successfulResults.length / results.length;
  
  if (successRate < 0.3) {
    recommendations.push("⚠️ Low success rate detected. Consider reviewing patch generation strategy.");
  }
  if (totalCost / results.length > 2.0) {
    recommendations.push("💰 High average cost per instance. Consider optimizing prompt efficiency.");
  }
  if (totalTime / results.length > 300000) {
    recommendations.push("⏱️ High average execution time. Consider timeout optimization.");
  }
  
  // Find top performing repositories
  const topRepos = Object.entries(successByRepo)
    .filter(([_, data]) => data.total >= 2)
    .sort((a, b) => b[1].rate - a[1].rate)
    .slice(0, 3);
  
  if (topRepos.length > 0) {
    recommendations.push(`🏆 Top performing repositories: ${topRepos.map(([repo, data]) => `${repo} (${(data.rate * 100).toFixed(1)}%)`).join(', ')}`);
  }
  
  return {
    metadata: {
      timestamp: startTime.toISOString(),
      total_instances: results.length,
      completed_instances: results.length,
      duration_hours: totalTime / (1000 * 60 * 60),
      average_time_per_instance: totalTime / results.length,
    },
    performance: {
      success_rate: successRate,
      successful_instances: successfulResults.length,
      failed_instances: results.length - successfulResults.length,
      compilation_success_rate: compilationSuccesses / results.length,
      test_pass_rate: results.filter(r => r.test_results && r.test_results.passed > 0).length / results.length,
      total_cost: totalCost,
      average_cost_per_instance: totalCost / results.length,
      total_tokens: totalTokens,
      average_iterations: results.reduce((sum, r) => sum + r.iterations, 0) / results.length,
    },
    detailed_results: results,
    analysis: {
      success_by_repo: successByRepo,
      common_failures: commonFailures,
      performance_metrics: {
        fastest_instance: { id: sortedByTime[0]?.instance_id || '', time: sortedByTime[0]?.execution_time || 0 },
        slowest_instance: { id: sortedByTime[sortedByTime.length - 1]?.instance_id || '', time: sortedByTime[sortedByTime.length - 1]?.execution_time || 0 },
        most_expensive: { id: sortedByCost[0]?.instance_id || '', cost: sortedByCost[0]?.token_usage?.cost || 0 },
        most_iterations: { id: sortedByIterations[0]?.instance_id || '', iterations: sortedByIterations[0]?.iterations || 0 },
      },
      patch_analysis: {
        average_patch_size: averagePatchSize,
        largest_patch: { id: largestPatchResult?.instance_id || '', size: largestPatchResult?.patch.length || 0 },
        smallest_patch: { id: smallestPatchResult?.instance_id || '', size: smallestPatchResult?.patch.length || 0 },
      },
    },
    recommendations,
  };
}

async function generateReport(): Promise<void> {
  console.log('🔍 Searching for latest benchmark results...');
  
  const resultsFile = await findLatestResults();
  if (!resultsFile) {
    console.error('❌ No results file found in .swe-bench-cache/results/');
    process.exit(1);
  }
  
  console.log(`📄 Loading results from: ${resultsFile}`);
  const results = await loadResults(resultsFile);
  
  console.log(`📊 Analyzing ${results.length} benchmark results...`);
  const report = analyzeResults(results);
  
  // Save comprehensive report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(process.cwd(), 'swe-bench-comprehensive-results');
  await fs.mkdir(reportDir, { recursive: true });
  
  const reportFile = path.join(reportDir, `comprehensive-report-${timestamp}.json`);
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  
  // Generate human-readable summary
  const summaryFile = path.join(reportDir, `summary-${timestamp}.md`);
  const summary = generateMarkdownSummary(report);
  await fs.writeFile(summaryFile, summary);
  
  // Copy all patches for review
  const patchesDir = path.join(reportDir, 'patches');
  await fs.mkdir(patchesDir, { recursive: true });
  
  for (const result of results) {
    if (result.patch && result.patch.trim()) {
      const patchFile = path.join(patchesDir, `${result.instance_id}.patch`);
      await fs.writeFile(patchFile, result.patch);
    }
  }
  
  console.log('✅ Comprehensive analysis complete!');
  console.log(`📁 Report directory: ${reportDir}`);
  console.log(`📄 Full report: ${reportFile}`);
  console.log(`📝 Summary: ${summaryFile}`);
  console.log(`🔧 Patches: ${patchesDir}`);
  
  // Print key metrics
  console.log('\n🎯 KEY METRICS:');
  console.log(`├─ Success Rate: ${(report.performance.success_rate * 100).toFixed(1)}% (${report.performance.successful_instances}/${report.metadata.total_instances})`);
  console.log(`├─ Total Cost: $${report.performance.total_cost.toFixed(2)}`);
  console.log(`├─ Average Time: ${(report.metadata.average_time_per_instance / 1000).toFixed(1)}s per instance`);
  console.log(`└─ Compilation Success: ${(report.performance.compilation_success_rate * 100).toFixed(1)}%`);
  
  if (report.recommendations.length > 0) {
    console.log('\n💡 RECOMMENDATIONS:');
    report.recommendations.forEach(rec => console.log(`   ${rec}`));
  }
}

function generateMarkdownSummary(report: ComprehensiveReport): string {
  return `# SWE-bench Comprehensive Benchmark Results

**Generated:** ${report.metadata.timestamp}

## Executive Summary

- **Total Instances:** ${report.metadata.total_instances}
- **Success Rate:** ${(report.performance.success_rate * 100).toFixed(1)}% (${report.performance.successful_instances}/${report.metadata.total_instances})
- **Total Cost:** $${report.performance.total_cost.toFixed(2)}
- **Average Cost:** $${report.performance.average_cost_per_instance.toFixed(3)} per instance
- **Compilation Success Rate:** ${(report.performance.compilation_success_rate * 100).toFixed(1)}%
- **Average Execution Time:** ${(report.metadata.average_time_per_instance / 1000).toFixed(1)} seconds

## Performance Metrics

### Speed Performance
- **Fastest Instance:** ${report.analysis.performance_metrics.fastest_instance.id} (${(report.analysis.performance_metrics.fastest_instance.time / 1000).toFixed(1)}s)
- **Slowest Instance:** ${report.analysis.performance_metrics.slowest_instance.id} (${(report.analysis.performance_metrics.slowest_instance.time / 1000).toFixed(1)}s)

### Cost Analysis
- **Most Expensive:** ${report.analysis.performance_metrics.most_expensive.id} ($${report.analysis.performance_metrics.most_expensive.cost.toFixed(3)})
- **Total Tokens:** ${report.performance.total_tokens.toLocaleString()}
- **Average Iterations:** ${report.performance.average_iterations.toFixed(1)}

### Patch Analysis
- **Average Patch Size:** ${report.analysis.patch_analysis.average_patch_size.toFixed(0)} characters
- **Largest Patch:** ${report.analysis.patch_analysis.largest_patch.id} (${report.analysis.patch_analysis.largest_patch.size.toLocaleString()} chars)
- **Smallest Patch:** ${report.analysis.patch_analysis.smallest_patch.id} (${report.analysis.patch_analysis.smallest_patch.size} chars)

## Repository Performance

| Repository | Success Rate | Successful | Total |
|------------|--------------|------------|-------|
${Object.entries(report.analysis.success_by_repo)
  .sort((a, b) => b[1].rate - a[1].rate)
  .slice(0, 10)
  .map(([repo, data]) => `| ${repo} | ${(data.rate * 100).toFixed(1)}% | ${data.successful} | ${data.total} |`)
  .join('\n')}

## Common Failure Patterns

${report.analysis.common_failures.slice(0, 5).map((failure, i) => 
  `${i + 1}. **${failure.count} instances:** ${failure.error.substring(0, 80)}...`
).join('\n')}

## Recommendations

${report.recommendations.map(rec => `- ${rec}`).join('\n')}

## Detailed Results

All individual results, patches, and logs are available in the comprehensive report JSON file.
`;
}

if (import.meta.main) {
  generateReport().catch(console.error);
}