import { elizaLogger } from '@elizaos/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import fetch from 'node-fetch';
import * as zlib from 'zlib';
import { promisify } from 'util';
import type { SWEBenchInstance, SWEBenchResult } from './types';

const gunzip = promisify(zlib.gunzip);

/**
 * Loads and manages SWE-bench dataset for TypeScript instances
 */
export class SWEBenchDataLoader {
  private cacheDir: string;
  private datasetUrls = {
    // Individual language-specific files
    javascript: [
      'https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/raw/main/js/axios__axios_dataset.jsonl',
      'https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/raw/main/js/expressjs__express_dataset.jsonl',
      'https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/raw/main/js/iamkun__dayjs_dataset.jsonl',
      'https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/raw/main/js/Kong__insomnia_dataset.jsonl',
      'https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/raw/main/js/sveltejs__svelte_dataset.jsonl',
      'https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/raw/main/js/anuraghazra__github-readme-stats_dataset.jsonl'
    ],
    typescript: [
      'https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/raw/main/ts/darkreader__darkreader_dataset.jsonl',
      'https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/raw/main/ts/mui__material-ui_dataset.jsonl',
      'https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/raw/main/ts/vuejs__core_dataset.jsonl'
    ]
  };
  private instances: Map<string, SWEBenchInstance> = new Map();

  constructor(cacheDir: string = path.join(process.cwd(), '.swe-bench-cache')) {
    this.cacheDir = cacheDir;
  }

  /**
   * Initialize the data loader and ensure cache directory exists
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.mkdir(path.join(this.cacheDir, 'instances'), { recursive: true });
    await fs.mkdir(path.join(this.cacheDir, 'results'), { recursive: true });
    await fs.mkdir(path.join(this.cacheDir, 'dataset'), { recursive: true });
  }

  /**
   * Load the complete dataset and filter for TypeScript instances
   */
  async loadDataset(forceRefresh: boolean = false): Promise<SWEBenchInstance[]> {
    const cacheFile = path.join(this.cacheDir, `typescript-instances-all.json`);
    
    // Check cache first
    if (!forceRefresh) {
      try {
        const cached = await fs.readFile(cacheFile, 'utf-8');
        const instances = JSON.parse(cached) as SWEBenchInstance[];
        elizaLogger.info(`[SWE-BENCH] Loaded ${instances.length} TypeScript/JavaScript instances from cache`);
        
        // Populate internal map
        instances.forEach(inst => this.instances.set(inst.instance_id, inst));
        return instances;
      } catch (error) {
        // Cache miss, continue to fetch
      }
    }

    elizaLogger.info(`[SWE-BENCH] Fetching Multi-SWE-bench TypeScript/JavaScript datasets...`);
    
    const allInstances: SWEBenchInstance[] = [];
    
    try {
      // Download all TypeScript and JavaScript datasets
      for (const [language, urls] of Object.entries(this.datasetUrls)) {
        for (const url of urls) {
          try {
            const repoName = url.split('/').pop()?.replace('_dataset.jsonl', '') || 'unknown';
            const datasetFile = path.join(this.cacheDir, 'dataset', `${language}-${repoName}.jsonl`);
            
            if (forceRefresh || !(await this.fileExists(datasetFile))) {
              elizaLogger.info(`[SWE-BENCH] Downloading ${language} dataset: ${repoName}...`);
              await this.downloadDatasetFromUrl(url, datasetFile);
            }

            // Read and parse dataset
            const datasetContent = await fs.readFile(datasetFile, 'utf-8');
            const lines = datasetContent.trim().split('\n').filter(line => line.trim());
            
            for (const line of lines) {
              try {
                const instance = JSON.parse(line) as any;
                // Map language properly
                instance.language = language === 'javascript' ? 'JavaScript' : 'TypeScript';
                
                // Ensure all required fields are present
                if (this.validateInstance(instance)) {
                  allInstances.push(instance);
                }
              } catch (error) {
                elizaLogger.warn(`[SWE-BENCH] Failed to parse instance from ${repoName}:`, error);
              }
            }
          } catch (error) {
            elizaLogger.warn(`[SWE-BENCH] Failed to load dataset from ${url}:`, error);
          }
        }
      }

      elizaLogger.info(`[SWE-BENCH] Found ${allInstances.length} TypeScript/JavaScript instances`);

      // If no instances were loaded, return sample instances
      if (allInstances.length === 0) {
        elizaLogger.info('[SWE-BENCH] No instances loaded from datasets, using sample instances');
        const sampleInstances = this.getSampleTypeScriptInstances();
        
        // Populate internal map with sample instances
        sampleInstances.forEach(inst => this.instances.set(inst.instance_id, inst));
        
        // Cache the sample instances
        try {
          await fs.writeFile(cacheFile, JSON.stringify(sampleInstances, null, 2));
        } catch (cacheError) {
          // Ignore cache write errors in test environment
        }
        
        return sampleInstances;
      }

      // Cache the instances
      await fs.writeFile(cacheFile, JSON.stringify(allInstances, null, 2));
      
      // Populate internal map
      allInstances.forEach(inst => this.instances.set(inst.instance_id, inst));
      
      return allInstances;
    } catch (error) {
      elizaLogger.error('[SWE-BENCH] Failed to load dataset:', error);
      
      // Return sample instances for development
      const sampleInstances = this.getSampleTypeScriptInstances();
      
      // Populate internal map with sample instances
      sampleInstances.forEach(inst => this.instances.set(inst.instance_id, inst));
      
      // Cache the sample instances
      try {
        await fs.writeFile(cacheFile, JSON.stringify(sampleInstances, null, 2));
      } catch (cacheError) {
        // Ignore cache write errors in test environment
      }
      
      return sampleInstances;
    }
  }

  /**
   * Download dataset from URL
   */
  private async downloadDatasetFromUrl(url: string, outputPath: string): Promise<void> {
    elizaLogger.info(`[SWE-BENCH] Downloading dataset from ${url}...`);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'ElizaOS-SWEBench/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.buffer();
      
      // Check if gzipped
      if (url.endsWith('.gz')) {
        const uncompressed = await gunzip(buffer);
        await fs.writeFile(outputPath, uncompressed);
      } else {
        await fs.writeFile(outputPath, buffer);
      }

      elizaLogger.info(`[SWE-BENCH] Dataset downloaded to ${outputPath}`);
    } catch (error) {
      elizaLogger.error('[SWE-BENCH] Failed to download dataset:', error);
      throw error;
    }
  }

  /**
   * Validate instance has all required fields
   */
  private validateInstance(instance: any): instance is SWEBenchInstance {
    // Multi-SWE-bench already has instance_id, just need to map other fields
    if (!instance.repo_url && instance.org && instance.repo) {
      instance.repo_url = `https://github.com/${instance.org}/${instance.repo}`;
    }
    
    if (!instance.issue_title && instance.title) {
      instance.issue_title = instance.title;
    }
    
    if (!instance.issue_body && instance.body) {
      instance.issue_body = instance.body;
    }
    
    if (!instance.issue_number && instance.number) {
      instance.issue_number = instance.number;
    }
    
    if (!instance.base_commit && instance.base?.sha) {
      instance.base_commit = instance.base.sha;
    }
    
    if (!instance.patch && instance.fix_patch) {
      instance.patch = instance.fix_patch;
    }
    
    if (!instance.problem_statement && instance.resolved_issues?.length > 0) {
      instance.problem_statement = instance.resolved_issues[0]?.body || instance.body;
    }
    
    // The essential fields we need
    const required = ['instance_id', 'repo', 'language'];
    const hasRequired = required.every(field => instance[field] !== undefined);
    
    // Also check we have enough info to work with
    const hasWorkableInfo = instance.fix_patch && (instance.base?.sha || instance.base_commit);
    
    return hasRequired && hasWorkableInfo;
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get a specific instance by ID
   */
  async getInstance(instanceId: string): Promise<SWEBenchInstance | null> {
    // Check memory first
    if (this.instances.has(instanceId)) {
      return this.instances.get(instanceId)!;
    }

    // Try to load from cache
    try {
      const instanceFile = path.join(this.cacheDir, 'instances', `${instanceId}.json`);
      const content = await fs.readFile(instanceFile, 'utf-8');
      return JSON.parse(content) as SWEBenchInstance;
    } catch {
      return null;
    }
  }

  /**
   * Save evaluation results
   */
  async saveResults(results: SWEBenchResult[]): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsFile = path.join(this.cacheDir, 'results', `results-${timestamp}.json`);
    
    await fs.writeFile(resultsFile, JSON.stringify(results, null, 2));
    
    // Also save individual results
    for (const result of results) {
      const resultFile = path.join(this.cacheDir, 'results', `${result.instance_id}-${timestamp}.json`);
      await fs.writeFile(resultFile, JSON.stringify(result, null, 2));
    }
    
    elizaLogger.info(`[SWE-BENCH] Saved ${results.length} results to ${resultsFile}`);
  }

  /**
   * Get sample TypeScript instances for development/testing
   */
  private getSampleTypeScriptInstances(): SWEBenchInstance[] {
    return [
      {
        instance_id: 'microsoft__TypeScript-12345',
        repo: 'microsoft/TypeScript',
        repo_url: 'https://github.com/microsoft/TypeScript',
        language: 'TypeScript',
        issue_title: 'Array.prototype.includes type narrowing improvement',
        issue_body: `When using Array.includes() for type narrowing, TypeScript should narrow the type correctly.

Example:
\`\`\`typescript
const values = ['a', 'b', 'c'] as const;
function test(x: string) {
  if (values.includes(x)) {
    // x should be narrowed to 'a' | 'b' | 'c'
  }
}
\`\`\`

Currently TypeScript doesn't narrow the type of x inside the if block.`,
        issue_number: 12345,
        base_commit: 'abc123def456',
        created_at: new Date().toISOString(),
        version: '1.0',
        problem_statement: 'Improve type narrowing for Array.includes method',
        hints: ['Consider type predicate functions', 'Look at existing type guards'],
        test_patch: `diff --git a/tests/baselines/reference/arrayIncludesTypeNarrowing.js b/tests/baselines/reference/arrayIncludesTypeNarrowing.js
new file mode 100644
index 0000000..test123
--- /dev/null
+++ b/tests/baselines/reference/arrayIncludesTypeNarrowing.js
@@ -0,0 +1,10 @@
+function test(x) {
+    const values = ['a', 'b', 'c'];
+    if (values.includes(x)) {
+        // x is 'a' | 'b' | 'c'
+        return x;
+    }
+    return null;
+}`
      },
      {
        instance_id: 'facebook__react-67890',
        repo: 'facebook/react',
        repo_url: 'https://github.com/facebook/react',
        language: 'JavaScript',
        issue_title: 'useState hook type inference issue with complex objects',
        issue_body: `When using useState with complex nested objects, TypeScript fails to infer the correct type.

Example:
\`\`\`typescript
interface User {
  name: string;
  settings: {
    theme: 'light' | 'dark';
    notifications: boolean;
  }
}

function Component() {
  const [user, setUser] = useState<User>({ 
    name: '', 
    settings: { theme: 'light', notifications: true } 
  });
  
  // This should work but TypeScript complains
  setUser(prev => ({ ...prev, settings: { ...prev.settings, theme: 'dark' } }));
}
\`\`\``,
        issue_number: 67890,
        base_commit: 'def456ghi789',
        created_at: new Date().toISOString(),
        version: '1.0',
        problem_statement: 'Fix useState type inference for complex objects'
      },
      {
        instance_id: 'vitejs__vite-11111',
        repo: 'vitejs/vite',
        repo_url: 'https://github.com/vitejs/vite',
        language: 'TypeScript',
        issue_title: 'HMR breaks with circular dependencies',
        issue_body: 'Hot Module Replacement fails when there are circular dependencies between modules.',
        issue_number: 11111,
        base_commit: 'ghi789jkl012',
        created_at: new Date().toISOString(),
        version: '1.0',
        problem_statement: 'Fix HMR with circular dependencies',
        hints: ['Check dependency graph traversal', 'Look at module invalidation logic']
      }
    ];
  }

  /**
   * Filter instances by various criteria
   */
  async filterInstances(
    instances: SWEBenchInstance[],
    criteria: {
      repos?: string[];
      complexity?: string;
      hasTests?: boolean;
      maxCount?: number;
    }
  ): Promise<SWEBenchInstance[]> {
    let filtered = [...instances];

    if (criteria.repos && criteria.repos.length > 0) {
      filtered = filtered.filter(inst => criteria.repos!.includes(inst.repo));
    }

    if (criteria.hasTests !== undefined) {
      filtered = filtered.filter(inst => 
        criteria.hasTests ? inst.test_patch !== undefined : inst.test_patch === undefined
      );
    }

    if (criteria.maxCount && criteria.maxCount > 0) {
      filtered = filtered.slice(0, criteria.maxCount);
    }

    return filtered;
  }

  /**
   * Get statistics about the loaded dataset
   */
  getDatasetStats(): {
    total: number;
    byLanguage: Record<string, number>;
    byRepo: Record<string, number>;
    withTests: number;
    withoutTests: number;
  } {
    const instances = Array.from(this.instances.values());
    
    const stats = {
      total: instances.length,
      byLanguage: {} as Record<string, number>,
      byRepo: {} as Record<string, number>,
      withTests: 0,
      withoutTests: 0
    };

    for (const instance of instances) {
      // Count by language
      stats.byLanguage[instance.language] = (stats.byLanguage[instance.language] || 0) + 1;
      
      // Count by repo
      stats.byRepo[instance.repo] = (stats.byRepo[instance.repo] || 0) + 1;
      
      // Count test availability
      if (instance.test_patch) {
        stats.withTests++;
      } else {
        stats.withoutTests++;
      }
    }

    return stats;
  }

  /**
   * Export instances to JSONL format for evaluation
   */
  async exportToJSONL(instances: SWEBenchInstance[], outputPath: string): Promise<void> {
    const lines = instances.map(inst => JSON.stringify(inst));
    await fs.writeFile(outputPath, lines.join('\n'));
    elizaLogger.info(`[SWE-BENCH] Exported ${instances.length} instances to ${outputPath}`);
  }

  /**
   * Load previous results for comparison
   */
  async loadPreviousResults(instanceIds?: string[]): Promise<Map<string, SWEBenchResult>> {
    const resultsMap = new Map<string, SWEBenchResult>();
    
    try {
      const resultsDir = path.join(this.cacheDir, 'results');
      const files = await fs.readdir(resultsDir);
      
      for (const file of files) {
        if (!file.endsWith('.json') || !file.includes('results-')) continue;
        
        const content = await fs.readFile(path.join(resultsDir, file), 'utf-8');
        const results = JSON.parse(content) as SWEBenchResult[];
        
        for (const result of results) {
          if (!instanceIds || instanceIds.includes(result.instance_id)) {
            // Keep the most recent result for each instance
            if (!resultsMap.has(result.instance_id)) {
              resultsMap.set(result.instance_id, result);
            }
          }
        }
      }
    } catch (error) {
      elizaLogger.warn('[SWE-BENCH] Failed to load previous results:', error);
    }
    
    return resultsMap;
  }
}