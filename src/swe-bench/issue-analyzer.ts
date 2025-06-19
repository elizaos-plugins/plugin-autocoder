import { elizaLogger } from '@elizaos/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { SWEBenchInstance, IssueAnalysis, RepoContext } from './types';
import { RepositoryManager } from './repository-manager';

/**
 * Analyzes GitHub issues to extract requirements and context
 */
export class IssueAnalyzer {
  constructor(private repoManager: RepositoryManager) {}

  /**
   * Analyze a SWE-bench instance to extract actionable information
   */
  async analyzeIssue(instance: SWEBenchInstance, repoPath: string): Promise<IssueAnalysis> {
    elizaLogger.info(`[ISSUE-ANALYZER] Analyzing issue ${instance.instance_id}`);

    // Extract requirements from issue
    const requirements = this.extractRequirements(instance);
    
    // Get repository context
    const repoContext = await this.getRepoContext(repoPath);
    
    // Find potentially affected files
    const affectedFiles = await this.identifyAffectedFiles(instance, repoPath, repoContext);
    
    // Determine complexity
    const complexity = this.assessComplexity(requirements, affectedFiles);
    
    // Generate approach
    const suggestedApproach = this.generateApproach(instance, requirements, affectedFiles);

    // Extract test requirements if test patch exists
    const testRequirements = instance.test_patch ? 
      this.extractTestRequirements(instance.test_patch) : undefined;

    return {
      requirements,
      affected_files: affectedFiles,
      suggested_approach: suggestedApproach,
      complexity,
      context: {
        repo: instance.repo,
        issue_number: instance.issue_number,
        has_tests: !!instance.test_patch,
        language: instance.language
      },
      test_requirements: testRequirements
    };
  }

  /**
   * Extract requirements from issue description
   */
  private extractRequirements(instance: SWEBenchInstance): string[] {
    const requirements: string[] = [];
    const text = `${instance.issue_title}\n${instance.issue_body}`;
    
    // Extract explicit requirements (bullets, numbered lists)
    const bulletPoints = text.match(/^[\*\-\+]\s+(.+)$/gm) || [];
    const numberedPoints = text.match(/^\d+\.\s+(.+)$/gm) || [];
    
    bulletPoints.forEach((point: string) => {
      requirements.push(point.replace(/^[\*\-\+]\s+/, '').trim());
    });
    
    numberedPoints.forEach((point: string) => {
      requirements.push(point.replace(/^\d+\.\s+/, '').trim());
    });

    // Extract requirements from common patterns
    const patterns = [
      /should\s+(.+?)(?:\.|$)/gi,
      /need(?:s)?\s+to\s+(.+?)(?:\.|$)/gi,
      /must\s+(.+?)(?:\.|$)/gi,
      /fix\s+(.+?)(?:\.|$)/gi,
      /implement\s+(.+?)(?:\.|$)/gi,
      /add\s+support\s+for\s+(.+?)(?:\.|$)/gi
    ];

    patterns.forEach(pattern => {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          requirements.push(match[1].trim());
        }
      }
    });

    // Use problem statement if available
    if (instance.problem_statement) {
      requirements.push(instance.problem_statement);
    }

    // Add hints as additional context
    if (instance.hints && instance.hints.length > 0) {
      instance.hints.forEach(hint => {
        requirements.push(`Hint: ${hint}`);
      });
    }

    // Deduplicate and clean
    const uniqueRequirements = Array.from(new Set(requirements))
      .filter(req => req.length > 10) // Filter out very short fragments
      .slice(0, 10); // Limit to top 10 requirements

    return uniqueRequirements.length > 0 ? uniqueRequirements : [instance.issue_title];
  }

  /**
   * Get repository context
   */
  private async getRepoContext(repoPath: string): Promise<RepoContext> {
    const structure = await this.repoManager.getRepoStructure(repoPath, 2);
    
    // Read package.json for dependencies
    let dependencies: Record<string, string> = {};
    let testFramework: string | undefined;
    let buildSystem: string | undefined;

    try {
      const packageJsonPath = path.join(repoPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      
      dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };

      // Detect test framework
      if (dependencies.jest || dependencies['@types/jest']) testFramework = 'jest';
      else if (dependencies.vitest) testFramework = 'vitest';
      else if (dependencies.mocha) testFramework = 'mocha';

      // Detect build system
      if (packageJson.scripts?.build) buildSystem = 'npm';
      if (dependencies.typescript) buildSystem = 'typescript';
    } catch {}

    // Find TypeScript/JavaScript files
    const codeFiles = await this.repoManager.findFiles(repoPath, /\.(ts|tsx|js|jsx)$/);
    const relevantFiles = codeFiles.slice(0, 20); // Limit to prevent overwhelming context

    return {
      structure,
      dependencies,
      test_framework: testFramework,
      build_system: buildSystem,
      relevant_files: relevantFiles,
      code_patterns: [] // Could be extended to detect common patterns
    };
  }

  /**
   * Identify files likely affected by the issue
   */
  private async identifyAffectedFiles(
    instance: SWEBenchInstance, 
    repoPath: string,
    repoContext: RepoContext
  ): Promise<string[]> {
    const affectedFiles: Set<string> = new Set();
    
    // First, try to extract files from fix_patch if available (for training guidance)
    if (instance.fix_patch) {
      const patchFiles = this.extractFilesFromPatch(instance.fix_patch);
      patchFiles.forEach(file => affectedFiles.add(file));
    }
    
    // Then use semantic search based on issue content
    const searchTerms = this.extractSearchTerms(instance);

    // Search for files containing relevant terms
    for (const term of searchTerms) {
      // Search in file names
      const fileMatches = repoContext.relevant_files.filter(file => 
        file.toLowerCase().includes(term.toLowerCase())
      );
      fileMatches.forEach(file => affectedFiles.add(file));

      // Search in file contents (limited to avoid performance issues)
      for (const file of repoContext.relevant_files.slice(0, 20)) {
        try {
          const content = await fs.readFile(path.join(repoPath, file), 'utf-8');
          if (content.toLowerCase().includes(term.toLowerCase())) {
            affectedFiles.add(file);
          }
        } catch {}
      }
    }

    // For adapter-related issues, specifically look for adapter files
    if (this.isAdapterRelatedIssue(instance)) {
      const adapterFiles = repoContext.relevant_files.filter(file => 
        file.includes('adapter') || 
        file.includes('http') || 
        file.includes('xhr') ||
        file.includes('defaults')
      );
      adapterFiles.forEach(file => affectedFiles.add(file));
    }

    return Array.from(affectedFiles).slice(0, 8); // Increased to 8 files for better coverage
  }

  /**
   * Extract file paths from a git patch
   */
  private extractFilesFromPatch(patch: string): string[] {
    const files: string[] = [];
    const lines = patch.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('diff --git a/')) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)$/);
        if (match) {
          files.push(match[1]); // Add the file path
        }
      } else if (line.startsWith('--- a/')) {
        const match = line.match(/--- a\/(.+)$/);
        if (match) {
          files.push(match[1]);
        }
      }
    }
    
    return [...new Set(files)]; // Remove duplicates
  }

  /**
   * Check if this is an adapter-related issue
   */
  private isAdapterRelatedIssue(instance: SWEBenchInstance): boolean {
    const text = `${instance.issue_title} ${instance.issue_body}`.toLowerCase();
    return text.includes('adapter') || 
           text.includes('http') || 
           text.includes('xhr') ||
           text.includes('network') ||
           text.includes('pretender') ||
           text.includes('request') ||
           text.includes('connection');
  }

  /**
   * Extract search terms from issue
   */
  private extractSearchTerms(instance: SWEBenchInstance): string[] {
    const text = `${instance.issue_title} ${instance.issue_body}`;
    const terms: Set<string> = new Set();

    // Extract code identifiers (camelCase, snake_case, etc.)
    const codePattern = /\b([a-zA-Z_]\w+)\b/g;
    const matches = text.matchAll(codePattern);
    
    for (const match of matches) {
      const term = match[1];
      // Filter for likely code identifiers
      if (term.length > 3 && (
        term.includes('_') || // snake_case
        /[a-z][A-Z]/.test(term) || // camelCase
        /^[A-Z]/.test(term) // PascalCase
      )) {
        terms.add(term);
      }
    }

    // Extract quoted strings
    const quotedPattern = /["'`]([^"'`]+)["'`]/g;
    const quotedMatches = text.matchAll(quotedPattern);
    
    for (const match of quotedMatches) {
      if (match[1].length > 2 && match[1].length < 50) {
        terms.add(match[1]);
      }
    }

    return Array.from(terms).slice(0, 10);
  }

  /**
   * Assess issue complexity
   */
  private assessComplexity(
    requirements: string[], 
    affectedFiles: string[]
  ): 'low' | 'medium' | 'high' {
    const reqCount = requirements.length;
    const fileCount = affectedFiles.length;

    if (reqCount <= 2 && fileCount <= 2) return 'low';
    if (reqCount >= 5 || fileCount >= 4) return 'high';
    return 'medium';
  }

  /**
   * Generate suggested approach
   */
  private generateApproach(
    instance: SWEBenchInstance,
    requirements: string[],
    affectedFiles: string[]
  ): string {
    const parts: string[] = [];

    parts.push(`Issue: ${instance.issue_title}`);
    parts.push(`\nRepository: ${instance.repo}`);
    
    if (requirements.length > 0) {
      parts.push(`\nKey Requirements:`);
      requirements.slice(0, 3).forEach((req, i) => {
        parts.push(`${i + 1}. ${req}`);
      });
    }

    if (affectedFiles.length > 0) {
      parts.push(`\nLikely affected files:`);
      affectedFiles.forEach(file => {
        parts.push(`- ${file}`);
      });
    }

    parts.push(`\nSuggested approach:`);
    parts.push(`1. Analyze the issue in detail`);
    parts.push(`2. Examine the affected files and understand current implementation`);
    parts.push(`3. Implement the required changes`);
    parts.push(`4. Ensure all tests pass`);
    
    if (instance.test_patch) {
      parts.push(`5. Verify the fix with provided test cases`);
    }

    return parts.join('\n');
  }

  /**
   * Extract test requirements from test patch
   */
  private extractTestRequirements(testPatch: string): string[] {
    const requirements: string[] = [];
    
    // Extract test names
    const testPatterns = [
      /(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      /(?:it|test|describe)\s*\.\s*(?:only|skip)?\s*\(\s*['"`]([^'"`]+)['"`]/g
    ];

    testPatterns.forEach(pattern => {
      const matches = testPatch.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          requirements.push(`Test: ${match[1]}`);
        }
      }
    });

    // Extract assertions
    const assertPatterns = [
      /expect\s*\([^)]+\)\s*\.\s*(\w+)/g,
      /assert\s*\.\s*(\w+)/g
    ];

    const assertions = new Set<string>();
    assertPatterns.forEach(pattern => {
      const matches = testPatch.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          assertions.add(match[1]);
        }
      }
    });

    if (assertions.size > 0) {
      requirements.push(`Assertions: ${Array.from(assertions).join(', ')}`);
    }

    return requirements;
  }
}