import { elizaLogger } from '@elizaos/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { RealEvaluationEngine } from './real-evaluation-engine';
import type {
  PatchSubmission,
  EvaluationResults,
  EvaluationConfig,
  RawEvaluationResults,
  InstanceResult
} from './types';

/**
 * Bridge between TypeScript and Python Multi-SWE-bench evaluation
 */
export class EvaluationBridge {
  private pythonPath: string;
  private evaluationScriptPath: string;
  private workDir: string;

  constructor(
    pythonPath: string = 'python3',
    evaluationScriptPath?: string,
    workDir: string = path.join(process.cwd(), '.swe-bench-eval')
  ) {
    this.pythonPath = pythonPath;
    this.evaluationScriptPath = evaluationScriptPath || path.join(
      process.cwd(),
      'scripts',
      'evaluate-swe-bench.py'
    );
    this.workDir = workDir;
  }

  /**
   * Initialize evaluation environment
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.workDir, { recursive: true });
    await fs.mkdir(path.join(this.workDir, 'predictions'), { recursive: true });
    await fs.mkdir(path.join(this.workDir, 'results'), { recursive: true });
    await fs.mkdir(path.join(this.workDir, 'logs'), { recursive: true });
  }

  /**
   * Evaluate patches using real Multi-SWE-bench evaluation
   */
  async evaluate(
    patches: PatchSubmission[],
    config: EvaluationConfig
  ): Promise<EvaluationResults> {
    elizaLogger.info(`[EVAL-BRIDGE] Evaluating ${patches.length} patches`);

    // Check if we should use mock evaluation (only for explicit testing)
    const useMock = process.env.SWE_BENCH_MOCK === 'true';
    
    if (useMock) {
      elizaLogger.warn('[EVAL-BRIDGE] Using mock evaluation (SWE_BENCH_MOCK=true)');
      const predictionsFile = await this.writePredictions(patches);
      const rawResults = await this.mockEvaluation(predictionsFile);
      return this.formatResults(rawResults, patches);
    }

    // Use real evaluation engine
    elizaLogger.info('[EVAL-BRIDGE] Using real Multi-SWE-bench evaluation');
    const realEngine = new RealEvaluationEngine(config);
    await realEngine.initialize();
    
    return await realEngine.evaluate(patches);
  }

  /**
   * Write predictions to JSONL file
   */
  private async writePredictions(patches: PatchSubmission[]): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `predictions-${timestamp}.jsonl`;
    const filePath = path.join(this.workDir, 'predictions', fileName);

    const lines = patches.map(patch => JSON.stringify({
      instance_id: patch.instance_id,
      model_patch: patch.model_patch,
      model_name: patch.model_name || 'eliza-autocoder',
      timestamp: patch.timestamp
    }));

    await fs.writeFile(filePath, lines.join('\n'));
    elizaLogger.info(`[EVAL-BRIDGE] Wrote ${patches.length} predictions to ${filePath}`);
    
    return filePath;
  }

  /**
   * Write evaluation configuration
   */
  private async writeConfig(config: EvaluationConfig): Promise<string> {
    const configPath = path.join(this.workDir, 'eval-config.json');
    
    const evalConfig = {
      dataset: config.dataset,
      split: 'test',
      language_filter: config.language_filter,
      max_workers: config.parallel_instances || 4,
      timeout: config.timeout_per_instance || 3600,
      output_dir: config.output_dir || path.join(this.workDir, 'results'),
      cache_dir: config.cache_dir || path.join(this.workDir, 'cache'),
      docker_enabled: config.docker_enabled || false,
      save_artifacts: config.save_artifacts || false,
      log_dir: path.join(this.workDir, 'logs')
    };

    await fs.writeFile(configPath, JSON.stringify(evalConfig, null, 2));
    return configPath;
  }

  /**
   * Run Python evaluation script
   */
  private async runPythonEvaluation(
    predictionsFile: string,
    configFile: string
  ): Promise<RawEvaluationResults[]> {
    // First ensure evaluation script exists
    await this.ensureEvaluationScript();
    
    return new Promise((resolve, reject) => {
      const results: RawEvaluationResults[] = [];
      const logFile = path.join(this.workDir, 'logs', `eval-${Date.now()}.log`);
      let logStream: any;
      
      fs.open(logFile, 'w').then(handle => {
        logStream = handle.createWriteStream();
        
        // Run Python evaluation
        const pythonProcess = spawn(this.pythonPath, [
          this.evaluationScriptPath,
          '--predictions', predictionsFile,
          '--config', configFile,
          '--output-format', 'jsonl'
        ], {
          cwd: this.workDir
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          const dataStr = data.toString();
          stdout += dataStr;
          logStream?.write(`[STDOUT] ${dataStr}`);
          
          // Try to parse streaming results
          const lines = dataStr.split('\n');
          for (const line of lines) {
            if (line.trim() && line.startsWith('{')) {
              try {
                const result = JSON.parse(line);
                if (result.instance_id) {
                  results.push(result);
                  elizaLogger.info(`[EVAL-BRIDGE] Evaluated ${result.instance_id}: ${result.resolved ? 'PASS' : 'FAIL'}`);
                }
              } catch (error) {
                // Not a JSON line, continue
              }
            }
          }
        });

        pythonProcess.stderr.on('data', (data) => {
          const dataStr = data.toString();
          stderr += dataStr;
          logStream?.write(`[STDERR] ${dataStr}`);
          
          // Log warnings but don't fail
          if (dataStr.includes('WARNING')) {
            elizaLogger.warn('[EVAL-BRIDGE] Python warning:', dataStr);
          }
        });

        pythonProcess.on('close', async (code) => {
          await logStream?.close();
          
          if (code !== 0) {
            elizaLogger.error(`[EVAL-BRIDGE] Python process exited with code ${code}`);
            elizaLogger.error(`[EVAL-BRIDGE] Check logs at: ${logFile}`);
            
            // If no results were parsed, try to parse from stdout
            if (results.length === 0 && stdout) {
              try {
                // Try parsing as JSON array
                const parsed = JSON.parse(stdout);
                if (Array.isArray(parsed)) {
                  resolve(parsed);
                  return;
                }
              } catch {}
            }
            
            reject(new Error(`Python evaluation failed with code ${code}. Check ${logFile} for details.`));
          } else {
            if (results.length === 0) {
              // Try to parse final output
              const lines = stdout.trim().split('\n');
              for (const line of lines) {
                if (line.trim() && line.startsWith('{')) {
                  try {
                    const result = JSON.parse(line);
                    if (result.instance_id) {
                      results.push(result);
                    }
                  } catch {}
                }
              }
            }
            
            elizaLogger.info(`[EVAL-BRIDGE] Evaluation complete. ${results.length} results processed.`);
            resolve(results);
          }
        });

        pythonProcess.on('error', (error) => {
          logStream?.close();
          reject(new Error(`Failed to start Python evaluation: ${error.message}`));
        });
      }).catch(reject);
    });
  }

  /**
   * Mock evaluation for development/testing
   */
  private async mockEvaluation(predictionsFile: string): Promise<RawEvaluationResults[]> {
    const predictions = await fs.readFile(predictionsFile, 'utf-8');
    const patches = predictions.trim().split('\n').map(line => JSON.parse(line));

    // Simulate more realistic results
    return patches.map((patch, index) => {
      // Make results somewhat deterministic based on instance ID
      const hashCode = patch.instance_id.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0);
      
      const resolved = (hashCode % 10) > 6; // ~30% success rate
      const compilationSuccess = (hashCode % 10) > 2; // ~70% compile
      
      return {
        instance_id: patch.instance_id,
        resolved,
        test_output: resolved ? 'All tests passed' : 'Some tests failed',
        patch_applied: compilationSuccess,
        error: !compilationSuccess ? 'Compilation error' : undefined,
        metadata: {
          mock: true,
          timestamp: new Date().toISOString(),
          model: patch.model_name
        }
      };
    });
  }

  /**
   * Format raw results into final evaluation results
   */
  private formatResults(
    rawResults: RawEvaluationResults[],
    patches: PatchSubmission[]
  ): EvaluationResults {
    const instanceResults: InstanceResult[] = rawResults.map(raw => ({
      instance_id: raw.instance_id,
      resolved: raw.resolved,
      tests_passed: raw.resolved,
      compilation_success: raw.patch_applied !== false,
      execution_time: raw.metadata?.execution_time || 0,
      error: raw.error
    }));

    const resolved = instanceResults.filter(r => r.resolved).length;
    const total = instanceResults.length;
    const compiled = instanceResults.filter(r => r.compilation_success).length;
    const testsPassed = instanceResults.filter(r => r.tests_passed).length;

    return {
      total_instances: total,
      resolved_instances: resolved,
      resolution_rate: total > 0 ? resolved / total : 0,
      exact_matches: 0, // Would require ground truth comparison
      test_pass_rate: total > 0 ? testsPassed / total : 0,
      compilation_success_rate: total > 0 ? compiled / total : 0,
      per_instance_results: instanceResults,
      summary: {
        avg_execution_time: this.calculateAverage(instanceResults.map(r => r.execution_time)),
        avg_token_usage: 0, // Would be calculated from tracking
        total_cost: 0, // Would be calculated from tracking
        success_by_complexity: this.groupByComplexity(instanceResults),
        common_errors: this.extractCommonErrors(instanceResults)
      }
    };
  }

  /**
   * Calculate average of numbers
   */
  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  }

  /**
   * Group results by complexity (simplified)
   */
  private groupByComplexity(results: InstanceResult[]): Record<string, number> {
    // In a real implementation, this would use actual complexity metrics
    const groups = {
      low: 0,
      medium: 0,
      high: 0
    };
    
    results.forEach((r, i) => {
      // Mock complexity assignment
      if (i % 3 === 0) groups.low += r.resolved ? 1 : 0;
      else if (i % 3 === 1) groups.medium += r.resolved ? 1 : 0;
      else groups.high += r.resolved ? 1 : 0;
    });
    
    return groups;
  }

  /**
   * Extract common errors from results
   */
  private extractCommonErrors(results: InstanceResult[]): Array<{ error: string; count: number }> {
    const errorCounts = new Map<string, number>();
    
    for (const result of results) {
      if (result.error) {
        const errorType = this.classifyError(result.error);
        errorCounts.set(errorType, (errorCounts.get(errorType) || 0) + 1);
      }
    }

    return Array.from(errorCounts.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  /**
   * Classify error types
   */
  private classifyError(error: string): string {
    const errorLower = error.toLowerCase();
    
    if (errorLower.includes('compilation') || errorLower.includes('compile')) {
      return 'Compilation Error';
    }
    if (errorLower.includes('test') || errorLower.includes('assertion')) {
      return 'Test Failure';
    }
    if (errorLower.includes('timeout')) {
      return 'Timeout';
    }
    if (errorLower.includes('patch') || errorLower.includes('apply')) {
      return 'Patch Application Failed';
    }
    if (errorLower.includes('import') || errorLower.includes('module')) {
      return 'Import Error';
    }
    return 'Other Error';
  }

  /**
   * Create Python evaluation script if it doesn't exist
   */
  async ensureEvaluationScript(): Promise<void> {
    const scriptDir = path.dirname(this.evaluationScriptPath);
    await fs.mkdir(scriptDir, { recursive: true });

    // Check if script already exists
    try {
      await fs.access(this.evaluationScriptPath);
      return; // Script exists
    } catch {
      // Script doesn't exist, create it
    }

    const scriptContent = `#!/usr/bin/env python3
"""
Multi-SWE-bench evaluation script for TypeScript instances
This is a wrapper around the actual Multi-SWE-bench evaluation
"""
import json
import sys
import argparse
import subprocess
import os
from pathlib import Path
from datetime import datetime

def main():
    parser = argparse.ArgumentParser(description='Evaluate SWE-bench predictions')
    parser.add_argument('--predictions', required=True, help='Path to predictions JSONL file')
    parser.add_argument('--config', required=True, help='Path to config JSON file')
    parser.add_argument('--output-format', default='json', choices=['json', 'jsonl'])
    args = parser.parse_args()

    # Load predictions
    predictions = []
    with open(args.predictions, 'r') as f:
        for line in f:
            predictions.append(json.loads(line.strip()))

    # Load config
    with open(args.config, 'r') as f:
        config = json.load(f)

    # Check if we can run actual Multi-SWE-bench evaluation
    try:
        import swebench
        # Run actual evaluation
        print("Running Multi-SWE-bench evaluation...", file=sys.stderr)
        results = run_swebench_evaluation(predictions, config)
    except ImportError:
        print("WARNING: Multi-SWE-bench not installed. Using mock evaluation.", file=sys.stderr)
        print("Install with: pip install multi-swe-bench", file=sys.stderr)
        results = mock_evaluation(predictions, config)

    # Output results
    if args.output_format == 'jsonl':
        for result in results:
            print(json.dumps(result))
    else:
        print(json.dumps(results))

def run_swebench_evaluation(predictions, config):
    """Run actual Multi-SWE-bench evaluation"""
    from swebench.harness.run_evaluation import main as run_eval
    
    # Prepare evaluation arguments
    eval_args = [
        '--predictions_path', args.predictions,
        '--max_workers', str(config.get('max_workers', 4)),
        '--timeout', str(config.get('timeout', 3600)),
    ]
    
    if config.get('docker_enabled'):
        eval_args.append('--use_docker')
    
    # Run evaluation
    results = run_eval(eval_args)
    
    # Convert to our format
    formatted_results = []
    for instance_id, result in results.items():
        formatted_results.append({
            'instance_id': instance_id,
            'resolved': result.get('resolved', False),
            'test_output': result.get('test_output', ''),
            'patch_applied': result.get('apply_test_patch_success', True),
            'error': result.get('error'),
            'metadata': {
                'execution_time': result.get('duration', 0),
                'model': predictions[0].get('model_name', 'unknown')
            }
        })
    
    return formatted_results

def mock_evaluation(predictions, config):
    """Mock evaluation for testing"""
    import random
    import time
    
    results = []
    for pred in predictions:
        # Simulate some work
        time.sleep(0.1)
        
        # Generate mock results
        success = random.random() > 0.7  # 30% success rate
        
        result = {
            'instance_id': pred['instance_id'],
            'resolved': success,
            'test_output': 'Mock test output\\nAll tests passed' if success else 'Mock test output\\nTest failed',
            'patch_applied': random.random() > 0.2,  # 80% apply successfully
            'metadata': {
                'model': pred.get('model_name', 'unknown'),
                'timestamp': datetime.now().isoformat(),
                'execution_time': random.uniform(10, 60)
            }
        }
        
        if not result['patch_applied']:
            result['error'] = 'Failed to apply patch'
        elif not success:
            result['error'] = 'Tests failed'
            
        results.append(result)
        
    return results

if __name__ == '__main__':
    main()
`;

    await fs.writeFile(this.evaluationScriptPath, scriptContent);
    await fs.chmod(this.evaluationScriptPath, 0o755);
    
    elizaLogger.info(`[EVAL-BRIDGE] Created evaluation script at ${this.evaluationScriptPath}`);
  }
}