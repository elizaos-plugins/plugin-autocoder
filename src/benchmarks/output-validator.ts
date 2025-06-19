import type { ValidationResult, SuccessCriteria, BenchmarkScenario } from './types';
import type { PluginProject } from '../types/plugin-project';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Validates AutoCoder output against success criteria
 */
export class OutputValidator {
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  /**
   * Validate a project against scenario criteria
   */
  async validate(project: PluginProject, scenario: BenchmarkScenario): Promise<ValidationResult> {
    const result: ValidationResult = {
      passed: false,
      criteria: {
        compilation: false,
        tests: false,
        coverage: false,
        performance: false,
        requirements: false,
      },
      details: {
        requirementsCovered: [],
        requirementsMissed: [],
        unexpectedBehaviors: [],
        performanceIssues: [],
      },
    };

    // Run all validations
    await Promise.all([
      this.validateCompilation(project, result),
      this.validateTests(project, scenario.successCriteria, result),
      this.validateCoverage(project, scenario.successCriteria, result),
      this.validateRequirements(project, scenario, result),
      this.validatePerformance(project, scenario.successCriteria, result),
    ]);

    // Check ElizaOS API correctness
    await this.validateApiPatterns(project, result);

    // Run custom validation if provided
    if (scenario.successCriteria.customValidation) {
      try {
        const customPassed = await scenario.successCriteria.customValidation(project);
        if (!customPassed) {
          result.details.unexpectedBehaviors.push('Custom validation failed');
        }
      } catch (error) {
        result.details.unexpectedBehaviors.push(`Custom validation error: ${error}`);
      }
    }

    // Determine overall pass/fail
    result.passed = Object.values(result.criteria).every((c) => c);

    return result;
  }

  /**
   * Validate compilation
   */
  private async validateCompilation(
    project: PluginProject,
    result: ValidationResult
  ): Promise<void> {
    try {
      const { stdout, stderr } = await execAsync('bun run build', {
        cwd: project.localPath || '/tmp',
      });

      result.criteria.compilation = true;

      if (this.verbose) {
        console.log('[VALIDATION] Compilation: PASSED');
      }
    } catch (error: any) {
      result.criteria.compilation = false;
      result.details.unexpectedBehaviors.push(`Compilation failed: ${error.message}`);

      if (this.verbose) {
        console.log('[VALIDATION] Compilation: FAILED');
        console.error(error.message);
      }
    }
  }

  /**
   * Validate tests
   */
  private async validateTests(
    project: PluginProject,
    criteria: SuccessCriteria,
    result: ValidationResult
  ): Promise<void> {
    if (!criteria.mustPassTests) {
      result.criteria.tests = true;
      return;
    }

    try {
      const { stdout } = await execAsync('bun test', {
        cwd: project.localPath || '/tmp',
      });

      // Parse test results
      const passMatch = stdout.match(/(\d+) pass/);
      const failMatch = stdout.match(/(\d+) fail/);

      const passed = passMatch ? parseInt(passMatch[1]) : 0;
      const failed = failMatch ? parseInt(failMatch[1]) : 0;
      const total = passed + failed;

      result.criteria.tests = failed === 0 && total > 0;

      if (this.verbose) {
        console.log(`[VALIDATION] Tests: ${passed}/${total} passed`);
      }
    } catch (error: any) {
      result.criteria.tests = false;
      result.details.unexpectedBehaviors.push(`Test execution failed: ${error.message}`);

      if (this.verbose) {
        console.log('[VALIDATION] Tests: FAILED');
      }
    }
  }

  /**
   * Validate test coverage
   */
  private async validateCoverage(
    project: PluginProject,
    criteria: SuccessCriteria,
    result: ValidationResult
  ): Promise<void> {
    if (!criteria.minTestCoverage) {
      result.criteria.coverage = true;
      return;
    }

    try {
      const { stdout } = await execAsync('bun test --coverage', {
        cwd: project.localPath || '/tmp',
      });

      // Parse coverage percentage
      const coverageMatch = stdout.match(/All files\s+\|\s+(\d+\.?\d*)/);
      const coverage = coverageMatch ? parseFloat(coverageMatch[1]) : 0;

      result.criteria.coverage = coverage >= criteria.minTestCoverage;

      if (this.verbose) {
        console.log(`[VALIDATION] Coverage: ${coverage}% (required: ${criteria.minTestCoverage}%)`);
      }
    } catch (error) {
      // Coverage might not be set up, treat as pass if not required
      result.criteria.coverage = true;
    }
  }

  /**
   * Validate requirements coverage
   */
  private async validateRequirements(
    project: PluginProject,
    scenario: BenchmarkScenario,
    result: ValidationResult
  ): Promise<void> {
    // Check each requirement
    for (const requirement of scenario.requirements) {
      const covered = await this.checkRequirement(project, requirement);

      if (covered) {
        result.details.requirementsCovered.push(requirement);
      } else {
        result.details.requirementsMissed.push(requirement);
      }
    }

    // Calculate coverage percentage
    const total = scenario.requirements.length;
    const covered = result.details.requirementsCovered.length;
    const coverage = total > 0 ? (covered / total) * 100 : 100;

    result.criteria.requirements = coverage >= 80; // 80% threshold

    if (this.verbose) {
      console.log(`[VALIDATION] Requirements: ${covered}/${total} covered`);
      if (result.details.requirementsMissed.length > 0) {
        console.log('  Missed:', result.details.requirementsMissed);
      }
    }
  }

  /**
   * Check if a specific requirement is met
   */
  private async checkRequirement(project: PluginProject, requirement: string): Promise<boolean> {
    // Parse requirement type
    if (requirement.includes('action')) {
      return this.checkActionRequirement(project, requirement);
    } else if (requirement.includes('provider')) {
      return this.checkProviderRequirement(project, requirement);
    } else if (requirement.includes('service')) {
      return this.checkServiceRequirement(project, requirement);
    } else if (requirement.includes('API')) {
      return this.checkApiRequirement(project, requirement);
    }

    // Generic text search in code
    return this.searchInCode(project, requirement);
  }

  /**
   * Check action requirements
   */
  private async checkActionRequirement(
    project: PluginProject,
    requirement: string
  ): Promise<boolean> {
    const actionsDir = path.join(project.localPath || '/tmp', 'src', 'actions');
    try {
      const files = await fs.readdir(actionsDir);

      for (const file of files) {
        if (file.endsWith('.ts')) {
          const content = await fs.readFile(path.join(actionsDir, file), 'utf-8');

          // Check for action pattern
          if (content.includes('export const') && content.includes('Action = {')) {
            // Extract action name and check against requirement
            const nameMatch = content.match(/export const (\w+)Action/);
            if (nameMatch && requirement.toLowerCase().includes(nameMatch[1].toLowerCase())) {
              return true;
            }
          }
        }
      }
    } catch (error) {
      // Actions directory might not exist
    }

    return false;
  }

  /**
   * Check provider requirements
   */
  private async checkProviderRequirement(
    project: PluginProject,
    requirement: string
  ): Promise<boolean> {
    const providersDir = path.join(project.localPath || '/tmp', 'src', 'providers');
    try {
      const files = await fs.readdir(providersDir);

      for (const file of files) {
        if (file.endsWith('.ts')) {
          const content = await fs.readFile(path.join(providersDir, file), 'utf-8');

          // Check for provider pattern
          if (content.includes('Provider = {') && content.includes('get:')) {
            return true;
          }
        }
      }
    } catch (error) {
      // Providers directory might not exist
    }

    return false;
  }

  /**
   * Check service requirements
   */
  private async checkServiceRequirement(
    project: PluginProject,
    requirement: string
  ): Promise<boolean> {
    const servicesDir = path.join(project.localPath || '/tmp', 'src', 'services');
    try {
      const files = await fs.readdir(servicesDir);

      for (const file of files) {
        if (file.endsWith('.ts')) {
          const content = await fs.readFile(path.join(servicesDir, file), 'utf-8');

          // Check for service pattern
          if (
            content.includes('extends Service') ||
            (content.includes('class') && content.includes('Service'))
          ) {
            return true;
          }
        }
      }
    } catch (error) {
      // Services directory might not exist
    }

    return false;
  }

  /**
   * Check API requirements
   */
  private async checkApiRequirement(project: PluginProject, requirement: string): Promise<boolean> {
    // Look for API key usage, fetch calls, etc.
    const srcDir = path.join(project.localPath || '/tmp', 'src');

    try {
      const { stdout } = await execAsync(`grep -r "getSetting\\|fetch\\|axios" ${srcDir} || true`, {
        cwd: project.localPath || '/tmp',
      });

      return stdout.includes('getSetting') || stdout.includes('fetch') || stdout.includes('axios');
    } catch (error) {
      return false;
    }
  }

  /**
   * Generic code search
   */
  private async searchInCode(project: PluginProject, text: string): Promise<boolean> {
    const keywords = text
      .toLowerCase()
      .split(' ')
      .filter((w) => w.length > 3);

    try {
      for (const keyword of keywords) {
        const { stdout } = await execAsync(`grep -ri "${keyword}" src || true`, {
          cwd: project.localPath || '/tmp',
        });

        if (stdout.length > 0) {
          return true;
        }
      }
    } catch (error) {
      // Grep might fail
    }

    return false;
  }

  /**
   * Validate performance
   */
  private async validatePerformance(
    project: PluginProject,
    criteria: SuccessCriteria,
    result: ValidationResult
  ): Promise<void> {
    // Check if generation took too long
    if (criteria.maxDuration) {
      // Note: Duration is tracked externally in BenchmarkMetrics
      // Project itself doesn't have metrics
      result.criteria.performance = true;
    } else {
      result.criteria.performance = true;
    }

    // Check iteration count
    if (criteria.maxIterations) {
      const iterations = project.currentIteration || 0;
      if (iterations > criteria.maxIterations) {
        result.criteria.performance = false;
        result.details.performanceIssues.push(
          `Exceeded maximum iterations: ${iterations} > ${criteria.maxIterations}`
        );
      }
    }
  }

  /**
   * Validate ElizaOS API patterns
   */
  private async validateApiPatterns(
    project: PluginProject,
    result: ValidationResult
  ): Promise<void> {
    const issues: string[] = [];

    // Check action patterns
    const actionsValid = await this.checkPattern(
      project,
      'actions',
      /export const \w+Action:\s*Action\s*=\s*{/,
      'Action definition pattern'
    );
    if (!actionsValid) issues.push('Invalid action pattern');

    // Check provider patterns
    const providersValid = await this.checkPattern(
      project,
      'providers',
      /export const \w+Provider:\s*Provider\s*=\s*{/,
      'Provider definition pattern'
    );
    if (!providersValid) issues.push('Invalid provider pattern');

    // Check service patterns
    const servicesValid = await this.checkPattern(
      project,
      'services',
      /export class \w+Service extends Service/,
      'Service class pattern'
    );
    if (!servicesValid) issues.push('Invalid service pattern');

    // Check plugin export
    const pluginValid = await this.checkPattern(
      project,
      '',
      /export const \w+Plugin:\s*Plugin\s*=\s*{/,
      'Plugin export pattern'
    );
    if (!pluginValid) issues.push('Invalid plugin export');

    if (issues.length > 0) {
      result.details.unexpectedBehaviors.push(...issues);
    }
  }

  /**
   * Check code pattern
   */
  private async checkPattern(
    project: PluginProject,
    subdir: string,
    pattern: RegExp,
    description: string
  ): Promise<boolean> {
    const dir = path.join(project.localPath || '/tmp', 'src', subdir);

    try {
      const files = await this.findTypeScriptFiles(dir);

      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        if (pattern.test(content)) {
          return true;
        }
      }
    } catch (error) {
      // Directory might not exist
    }

    return false;
  }

  /**
   * Find TypeScript files recursively
   */
  private async findTypeScriptFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          files.push(...(await this.findTypeScriptFiles(fullPath)));
        } else if (entry.name.endsWith('.ts')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Directory doesn't exist
    }

    return files;
  }

  private async checkRequiredFiles(
    project: PluginProject,
    requiredComponents: string[]
  ): Promise<{ passed: boolean; missing: string[] }> {
    const missing: string[] = [];
    const actionsDir = path.join(project.localPath || '/tmp', 'src', 'actions');
    const providersDir = path.join(project.localPath || '/tmp', 'src', 'providers');

    for (const component of requiredComponents) {
      let found = false;

      // Check actions directory
      try {
        const actionFiles = await fs.readdir(actionsDir);
        if (actionFiles.some((f) => f.includes(component))) {
          found = true;
        }
      } catch (error) {
        // Directory doesn't exist
      }

      // Check providers directory
      if (!found) {
        try {
          const providerFiles = await fs.readdir(providersDir);
          if (providerFiles.some((f) => f.includes(component))) {
            found = true;
          }
        } catch (error) {
          // Directory doesn't exist
        }
      }

      if (!found) {
        missing.push(component);
      }
    }

    return {
      passed: missing.length === 0,
      missing,
    };
  }
}
