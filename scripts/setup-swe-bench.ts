#!/usr/bin/env bun
/**
 * Setup script for SWE-bench environment
 */
import { elizaLogger } from '@elizaos/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function setup() {
  elizaLogger.info('Setting up SWE-bench environment...');

  try {
    // Create necessary directories
    const dirs = [
      '.swe-bench-cache',
      '.swe-bench-cache/instances',
      '.swe-bench-cache/results',
      '.swe-bench-work',
      '.swe-bench-repos',
      'scripts'
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
      elizaLogger.info(`Created directory: ${dir}`);
    }

    // Check Python installation
    try {
      const { stdout } = await execAsync('python3 --version');
      elizaLogger.info(`Python version: ${stdout.trim()}`);
    } catch (error) {
      elizaLogger.error('Python 3 is required but not found. Please install Python 3.');
      process.exit(1);
    }

    // Install Python dependencies
    elizaLogger.info('Installing Python dependencies...');
    const pythonDeps = [
      'requests',
      'jsonlines',
      'docker',
      'gitpython'
    ];

    try {
      await execAsync(`pip3 install ${pythonDeps.join(' ')}`);
      elizaLogger.info('Python dependencies installed');
    } catch (error) {
      elizaLogger.warn('Failed to install Python dependencies. You may need to install them manually.');
    }

    // Check Docker installation (optional)
    try {
      const { stdout } = await execAsync('docker --version');
      elizaLogger.info(`Docker version: ${stdout.trim()}`);
    } catch (error) {
      elizaLogger.warn('Docker not found. Docker support will be disabled.');
    }

    // Check Git installation
    try {
      const { stdout } = await execAsync('git --version');
      elizaLogger.info(`Git version: ${stdout.trim()}`);
    } catch (error) {
      elizaLogger.error('Git is required but not found. Please install Git.');
      process.exit(1);
    }

    // Create sample Multi-SWE-bench data file
    const sampleData = [
      {
        instance_id: 'typescript-sample-001',
        repo: 'microsoft/TypeScript',
        repo_url: 'https://github.com/microsoft/TypeScript',
        language: 'TypeScript',
        issue_title: 'Improve error message for missing type declaration',
        issue_body: 'When a type declaration is missing, the error message should be more helpful...',
        issue_number: 12345,
        base_commit: 'abc123',
        created_at: new Date().toISOString(),
        version: '1.0',
        problem_statement: 'Improve TypeScript error messages for better developer experience'
      },
      {
        instance_id: 'react-sample-001',
        repo: 'facebook/react',
        repo_url: 'https://github.com/facebook/react',
        language: 'JavaScript',
        issue_title: 'useState not updating immediately',
        issue_body: 'The useState hook does not update the state immediately when called...',
        issue_number: 67890,
        base_commit: 'def456',
        created_at: new Date().toISOString(),
        version: '1.0',
        problem_statement: 'Fix useState hook behavior for immediate updates'
      }
    ];

    const sampleDataPath = path.join('.swe-bench-cache', 'multi-swe-bench.jsonl');
    const lines = sampleData.map(d => JSON.stringify(d));
    await fs.writeFile(sampleDataPath, lines.join('\n'));
    elizaLogger.info(`Created sample dataset at ${sampleDataPath}`);

    // Create Python evaluation script
    const evalScriptPath = path.join('scripts', 'evaluate-swe-bench.py');
    const evalScript = `#!/usr/bin/env python3
"""
Multi-SWE-bench evaluation script for TypeScript instances
"""
import json
import sys
import argparse
import time
import random
from pathlib import Path

def evaluate_patch(instance_id, patch):
    """Mock evaluation of a patch"""
    # In production, this would:
    # 1. Apply the patch to the repository
    # 2. Run tests
    # 3. Check if the issue is resolved
    
    # For now, return mock results
    success = random.random() > 0.3  # 70% success rate for demo
    return {
        'instance_id': instance_id,
        'resolved': success,
        'test_output': 'All tests passed' if success else 'Some tests failed',
        'patch_applied': True,
        'compilation_success': random.random() > 0.1,
        'execution_time': random.uniform(10, 60)
    }

def main():
    parser = argparse.ArgumentParser(description='Evaluate SWE-bench predictions')
    parser.add_argument('--predictions', required=True, help='Path to predictions JSONL file')
    parser.add_argument('--config', required=True, help='Path to config JSON file')
    parser.add_argument('--output', help='Output file for results')
    args = parser.parse_args()

    # Load predictions
    predictions = []
    with open(args.predictions, 'r') as f:
        for line in f:
            predictions.append(json.loads(line.strip()))

    # Load config
    with open(args.config, 'r') as f:
        config = json.load(f)

    print(f"Evaluating {len(predictions)} predictions...")
    
    # Evaluate each prediction
    results = []
    for i, pred in enumerate(predictions):
        print(f"Evaluating {i+1}/{len(predictions)}: {pred['instance_id']}")
        result = evaluate_patch(pred['instance_id'], pred.get('model_patch', ''))
        result['metadata'] = {
            'model': pred.get('model_name', 'unknown'),
            'timestamp': pred.get('timestamp', ''),
            'config': config.get('dataset', 'unknown')
        }
        results.append(result)
        
        # Stream results
        print(json.dumps(result))
        time.sleep(0.5)  # Simulate processing time

    # Save results if output specified
    if args.output:
        with open(args.output, 'w') as f:
            json.dump({
                'results': results,
                'summary': {
                    'total': len(results),
                    'resolved': sum(1 for r in results if r['resolved']),
                    'success_rate': sum(1 for r in results if r['resolved']) / len(results) if results else 0
                }
            }, f, indent=2)
        print(f"Results saved to {args.output}")

if __name__ == '__main__':
    main()
`;

    await fs.writeFile(evalScriptPath, evalScript);
    await fs.chmod(evalScriptPath, 0o755);
    elizaLogger.info(`Created evaluation script at ${evalScriptPath}`);

    // Update .gitignore
    const gitignorePath = '.gitignore';
    const gitignoreAdditions = `
# SWE-bench
.swe-bench-cache/
.swe-bench-work/
.swe-bench-repos/
.swe-bench-eval/
*.patch
test-results.json
`;

    try {
      const existing = await fs.readFile(gitignorePath, 'utf-8');
      if (!existing.includes('SWE-bench')) {
        await fs.writeFile(gitignorePath, existing + gitignoreAdditions);
        elizaLogger.info('Updated .gitignore');
      }
    } catch {
      await fs.writeFile(gitignorePath, gitignoreAdditions);
      elizaLogger.info('Created .gitignore');
    }

    elizaLogger.info('✅ SWE-bench setup complete!');
    elizaLogger.info('\nNext steps:');
    elizaLogger.info('1. Download the full Multi-SWE-bench dataset (optional)');
    elizaLogger.info('2. Run: bun run build');
    elizaLogger.info('3. Test with: bun run test');
    elizaLogger.info('4. Start evaluation: Use the RUN_SWE_BENCH action in your agent');

  } catch (error) {
    elizaLogger.error('Setup failed:', error);
    process.exit(1);
  }
}

// Run setup
setup().catch(console.error);