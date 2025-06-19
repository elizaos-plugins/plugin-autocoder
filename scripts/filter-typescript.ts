#!/usr/bin/env bun
/**
 * Filter Multi-SWE-bench dataset for TypeScript/JavaScript instances
 */
import { elizaLogger } from '@elizaos/core';
import * as fs from 'fs/promises';
import * as path from 'path';

const CACHE_DIR = '.swe-bench-cache';

async function filterTypeScriptInstances() {
  elizaLogger.info('Filtering TypeScript/JavaScript instances from Multi-SWE-bench...');
  
  try {
    // Read the full dataset
    const datasetPath = path.join(CACHE_DIR, 'multi-swe-bench-full.jsonl');
    let content: string;
    
    try {
      content = await fs.readFile(datasetPath, 'utf-8');
    } catch {
      // Try the regular file
      const altPath = path.join(CACHE_DIR, 'multi-swe-bench.jsonl');
      content = await fs.readFile(altPath, 'utf-8');
    }
    
    // Parse JSONL
    const lines = content.trim().split('\n');
    const allInstances = lines.map(line => JSON.parse(line));
    
    elizaLogger.info(`Total instances: ${allInstances.length}`);
    
    // Filter for TypeScript and JavaScript
    const tsInstances = allInstances.filter(
      inst => inst.language === 'TypeScript' || inst.language === 'JavaScript'
    );
    
    elizaLogger.info(`TypeScript/JavaScript instances: ${tsInstances.length}`);
    
    // Group by repository
    const byRepo = tsInstances.reduce((acc, inst) => {
      if (!acc[inst.repo]) acc[inst.repo] = [];
      acc[inst.repo].push(inst);
      return acc;
    }, {} as Record<string, any[]>);
    
    elizaLogger.info('\nInstances by repository:');
    for (const [repo, instances] of Object.entries(byRepo)) {
      elizaLogger.info(`  ${repo}: ${instances.length} instances`);
    }
    
    // Save filtered dataset
    const outputPath = path.join(CACHE_DIR, 'typescript-instances.json');
    await fs.writeFile(outputPath, JSON.stringify(tsInstances, null, 2));
    
    // Also save as JSONL
    const jsonlPath = path.join(CACHE_DIR, 'typescript-instances.jsonl');
    const jsonlContent = tsInstances.map(inst => JSON.stringify(inst)).join('\n');
    await fs.writeFile(jsonlPath, jsonlContent);
    
    // Create a summary file
    const summary = {
      total_instances: tsInstances.length,
      languages: {
        TypeScript: tsInstances.filter(i => i.language === 'TypeScript').length,
        JavaScript: tsInstances.filter(i => i.language === 'JavaScript').length
      },
      repositories: Object.keys(byRepo).sort(),
      complexity_distribution: {
        low: tsInstances.filter(i => i.complexity === 'low').length,
        medium: tsInstances.filter(i => i.complexity === 'medium').length,
        high: tsInstances.filter(i => i.complexity === 'high').length,
        unknown: tsInstances.filter(i => !i.complexity).length
      },
      with_tests: tsInstances.filter(i => i.test_patch).length,
      without_tests: tsInstances.filter(i => !i.test_patch).length,
      sample_instances: tsInstances.slice(0, 5).map(i => ({
        id: i.instance_id,
        repo: i.repo,
        title: i.issue_title
      }))
    };
    
    const summaryPath = path.join(CACHE_DIR, 'typescript-dataset-summary.json');
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    
    elizaLogger.info(`\nFiltered dataset saved to: ${outputPath}`);
    elizaLogger.info(`JSONL format saved to: ${jsonlPath}`);
    elizaLogger.info(`Summary saved to: ${summaryPath}`);
    
    return {
      instances: tsInstances,
      summary
    };
  } catch (error) {
    elizaLogger.error('Failed to filter dataset:', error);
    throw error;
  }
}

// Run filter
filterTypeScriptInstances().catch(console.error);