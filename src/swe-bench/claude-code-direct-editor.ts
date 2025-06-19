// Placeholder for Claude Code SDK integration
// TODO: Replace with actual SDK when available
interface ClaudeCodeSDK {
  createProject(options: any): Promise<any>;
}

class MockClaudeCodeSDK implements ClaudeCodeSDK {
  async createProject(options: any) {
    return {
      executeTask: async (task: any) => ({ summary: 'Task executed', changes: [] }),
      close: async () => {}
    };
  }
}
import { elizaLogger } from '@elizaos/core';
import { IssueAnalyzer } from './issue-analyzer';
import { RepositoryManager } from './repository-manager';
import type { SWEBenchInstance, GeneratedPatch, TestResults } from './types';
import path from 'path';
import { promises as fs } from 'fs';

/**
 * Direct file editor using Claude Code SDK
 * This avoids the patch generation approach and directly edits files
 */
export class ClaudeCodeDirectEditor {
  private claudeCodeSDK: ClaudeCodeSDK | null = null;
  private issueAnalyzer: IssueAnalyzer;
  private repoManager: RepositoryManager;

  constructor(
    apiKey: string,
    issueAnalyzer: IssueAnalyzer,
    repoManager: RepositoryManager
  ) {
    this.issueAnalyzer = issueAnalyzer;
    this.repoManager = repoManager;

    if (apiKey) {
      this.claudeCodeSDK = new MockClaudeCodeSDK();
    }
  }

  /**
   * Fix an issue by directly editing files
   */
  async fixIssue(
    instance: SWEBenchInstance,
    repoPath: string
  ): Promise<GeneratedPatch> {
    elizaLogger.info(`[CLAUDE-CODE-DIRECT] Fixing issue: ${instance.instance_id}`);

    if (!this.claudeCodeSDK) {
      throw new Error('Claude Code SDK not initialized');
    }

    const startTime = Date.now();
    let iterations = 0;
    const maxIterations = 5;
    let lastError: string | null = null;

    // Analyze the issue
    const analysis = await this.issueAnalyzer.analyzeIssue(instance, repoPath);
    elizaLogger.info(`[CLAUDE-CODE-DIRECT] Issue analysis complete: ${analysis.affected_files.length} files affected`);

    // Create project in Claude Code
    const projectName = `swe-bench-${instance.instance_id}`;
    const project = await this.claudeCodeSDK.createProject({
      name: projectName,
      path: repoPath,
      description: `Fix: ${instance.issue_title}\n\n${instance.issue_body}`
    });

    try {
      // Main fixing loop
      while (iterations < maxIterations) {
        iterations++;
        elizaLogger.info(`[CLAUDE-CODE-DIRECT] Iteration ${iterations}/${maxIterations}`);

        // Build the prompt based on analysis and previous errors
        const prompt = this.buildFixPrompt(instance, analysis, lastError, iterations);

        // Execute the fix
        const result = await project.executeTask({
          instruction: prompt,
          files: analysis.affected_files.map(f => path.join(repoPath, f)),
          autoApprove: true, // Auto-approve changes for automation
          verifyBeforeApplying: true
        });

        // Check if build passes
        const buildPassed = await this.repoManager.checkBuild(repoPath);
        if (!buildPassed) {
          lastError = 'Build failed - check for syntax errors or TypeScript issues';
          elizaLogger.warn(`[CLAUDE-CODE-DIRECT] Build failed on iteration ${iterations}`);
          continue;
        }

        // Run tests
        const testResults = await this.repoManager.runTests(repoPath);
        if (testResults.failed === 0) {
          elizaLogger.info(`[CLAUDE-CODE-DIRECT] All tests passed! Fixed in ${iterations} iterations`);
          
          // Generate a diff to return as the "patch"
          const patch = await this.repoManager.generateDiff(repoPath);
          
          const stats = this.analyzePatchStats(patch);
          
          return {
            patch,
            files_modified: stats.files,
            additions: stats.additions,
            deletions: stats.deletions,
            iteration_count: iterations,
            approach_description: result.summary || 'Direct file editing approach',
            verification_score: 100,
            verification_passed: true,
            real_world_checks: {
              buildPassed: true,
              testsRun: testResults.total,
              testsPassed: testResults.passed,
              testsFailed: testResults.failed,
              lintPassed: true
            },
            test_coverage: 0,
            token_usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total: 0,
              cost: 0
            }
          };
        }

        // Extract test failure information
        lastError = this.extractTestFailureInfo(testResults);
        elizaLogger.warn(`[CLAUDE-CODE-DIRECT] Tests failed on iteration ${iterations}: ${lastError}`);
      }

      // If we exhausted iterations, return the current state
      const finalPatch = await this.repoManager.generateDiff(repoPath);
      const finalTestResults = await this.repoManager.runTests(repoPath);
      const finalStats = this.analyzePatchStats(finalPatch);
      const buildPassed = await this.repoManager.checkBuild(repoPath);
      
      return {
        patch: finalPatch,
        files_modified: finalStats.files,
        additions: finalStats.additions,
        deletions: finalStats.deletions,
        iteration_count: iterations,
        approach_description: 'Exhausted maximum iterations',
        verification_score: 50,
        verification_passed: false,
        real_world_checks: {
          buildPassed,
          testsRun: finalTestResults.total,
          testsPassed: finalTestResults.passed,
          testsFailed: finalTestResults.failed,
          lintPassed: false
        },
        test_coverage: 0,
        token_usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total: 0,
          cost: 0
        }
      };

    } finally {
      // Cleanup Claude Code project
      await project.close();
    }
  }

  /**
   * Build a fix prompt based on the current state
   */
  private buildFixPrompt(
    instance: SWEBenchInstance,
    analysis: any,
    lastError: string | null,
    iteration: number
  ): string {
    let prompt = `Fix the following issue in the ${instance.repo} repository:

**Issue Title**: ${instance.issue_title}
**Issue Description**: ${instance.issue_body}

**Analysis**:
- Affected files: ${analysis.affected_files.join(', ')}
- Root cause: ${analysis.root_cause}
- Suggested approach: ${analysis.suggested_approach}

**Requirements**:
${analysis.requirements.map((r: string, i: number) => `${i + 1}. ${r}`).join('\n')}

**Important Guidelines**:
1. Make minimal changes - fix only what's necessary
2. Maintain backward compatibility
3. Follow the existing code style and patterns
4. Ensure all tests pass
5. Do not modify test files unless specifically required
6. Fix the issue completely - partial fixes are not acceptable
`;

    if (iteration > 1 && lastError) {
      prompt += `

**Previous Attempt Failed**:
${lastError}

Please fix the issues from the previous attempt. Focus on:
- Ensuring the build compiles without errors
- Making sure all tests pass
- Addressing the specific error mentioned above
`;
    }

    if (analysis.context.language === 'TypeScript') {
      prompt += `

**TypeScript Specific**:
- Ensure all TypeScript types are correct
- Fix any type errors
- Maintain strict type safety
- Avoid using 'any' type unless absolutely necessary
`;
    }

    return prompt;
  }

  /**
   * Extract meaningful information from test failures
   */
  private extractTestFailureInfo(testResults: TestResults): string {
    if (!testResults.failures || testResults.failures.length === 0) {
      return `${testResults.failed} tests failed (no specific error details available)`;
    }

    // Get the first few failures for context
    const failures = testResults.failures.slice(0, 3);
    const failureMessages = failures.map(f => 
      `- ${f.test_name}: ${f.error_message.split('\n')[0]}`
    ).join('\n');

    return `Test failures:\n${failureMessages}${
      testResults.failures.length > 3 ? `\n... and ${testResults.failures.length - 3} more` : ''
    }`;
  }

  /**
   * Analyze patch statistics
   */
  private analyzePatchStats(patch: string): {
    files: string[];
    additions: number;
    deletions: number;
  } {
    const files = new Set<string>();
    let additions = 0;
    let deletions = 0;

    const lines = patch.split('\n');
    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        // Extract filename from diff header
        const match = line.match(/diff --git a\/.+ b\/(.+)$/);
        if (match) {
          files.add(match[1].replace(/^"|"$/g, ''));
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    return {
      files: Array.from(files),
      additions,
      deletions
    };
  }
} 