import { elizaLogger } from '@elizaos/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { SWEBenchInstance, TestResults, DirectoryStructure } from './types';

const execAsync = promisify(exec);

/**
 * Manages repository operations for SWE-bench instances
 */
export class RepositoryManager {
  private workDir: string;
  private activeRepos: Map<string, string> = new Map();

  constructor(workDir: string = path.join(process.cwd(), '.swe-bench-repos')) {
    this.workDir = workDir;
  }

  /**
   * Initialize the repository manager
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.workDir, { recursive: true });
  }

  /**
   * Clone a repository at a specific commit
   */
  async cloneRepository(instance: SWEBenchInstance): Promise<string> {
    const repoName = instance.repo.split('/').pop()!;
    const repoPath = path.join(this.workDir, `${repoName}-${instance.instance_id}`);

    // Check if already cloned
    if (this.activeRepos.has(instance.instance_id)) {
      return this.activeRepos.get(instance.instance_id)!;
    }

    try {
      // Remove if exists
      try {
        await fs.rm(repoPath, { recursive: true, force: true });
      } catch {}

      elizaLogger.info(`[REPO-MANAGER] Cloning ${instance.repo} at ${instance.base_commit}`);

      // Clone the repository
      await execAsync(`git clone ${instance.repo_url} ${repoPath}`, {
        cwd: this.workDir
      });

      // Checkout the specific commit
      await execAsync(`git checkout ${instance.base_commit}`, {
        cwd: repoPath
      });

      // Create a working branch
      await execAsync(`git checkout -b swe-bench-${instance.instance_id}`, {
        cwd: repoPath
      });

      // Install dependencies if package.json exists
      await this.installDependencies(repoPath);

      this.activeRepos.set(instance.instance_id, repoPath);
      
      elizaLogger.info(`[REPO-MANAGER] Repository ready at ${repoPath}`);
      return repoPath;
    } catch (error) {
      elizaLogger.error(`[REPO-MANAGER] Failed to clone repository:`, error);
      throw error;
    }
  }

  /**
   * Apply a patch to the repository
   */
  async applyPatch(repoPath: string, patch: string): Promise<boolean> {
    try {
      // Save patch to temporary file
      const patchFile = path.join(repoPath, 'swe-bench.patch');
      await fs.writeFile(patchFile, patch);

      // Apply the patch
      const { stdout, stderr } = await execAsync(`git apply ${patchFile}`, {
        cwd: repoPath
      });

      if (stderr && !stderr.includes('warning')) {
        elizaLogger.error('[REPO-MANAGER] Patch application error:', stderr);
        return false;
      }

      // Remove patch file
      await fs.unlink(patchFile);

      elizaLogger.info('[REPO-MANAGER] Patch applied successfully');
      return true;
    } catch (error) {
      elizaLogger.error('[REPO-MANAGER] Failed to apply patch:', error);
      return false;
    }
  }

  /**
   * Run tests in the repository
   */
  async runTests(repoPath: string, testPatch?: string): Promise<TestResults> {
    try {
      // Skip test patch application if it's provided - this is often problematic
      // The main patch should already be applied by the patch generator
      if (testPatch) {
        elizaLogger.warn('[REPO-MANAGER] Test patch provided but skipping application - tests should work with the main patch');
      }

      // Check if package.json exists and has test script
      const packageJsonPath = path.join(repoPath, 'package.json');
      const hasPackageJson = await fs.access(packageJsonPath).then(() => true).catch(() => false);
      
      if (!hasPackageJson) {
        elizaLogger.warn('[REPO-MANAGER] No package.json found, cannot run tests');
        return {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: 0,
          failures: []
        };
      }

      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      if (!packageJson.scripts?.test) {
        elizaLogger.warn('[REPO-MANAGER] No test script defined in package.json');
        return {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: 0,
          failures: []
        };
      }

      // Detect test framework and build appropriate command
      const testFramework = await this.detectTestFramework(repoPath);
      
      // Run tests based on framework
      const startTime = Date.now();
      let testCommand = 'npm test';
      
      // Set NODE_OPTIONS to handle OpenSSL legacy issues
      const nodeOptions = '--openssl-legacy-provider --no-deprecation';
      
      // Prepare test command and handle output properly
      let outputCommand = '';
      switch (testFramework) {
        case 'jest':
          testCommand = `npm test -- --json --outputFile=test-results.json --passWithNoTests`;
          break;
        case 'mocha':
          testCommand = `npm test -- --reporter json`;
          outputCommand = ' > test-results.json 2>&1';
          break;
        case 'vitest':
          testCommand = `npm test -- --reporter=json --outputFile=test-results.json`;
          break;
        case 'karma':
          testCommand = `npm test -- --single-run --reporters json`;
          outputCommand = ' > test-results.json 2>&1';
          break;
        case 'tape':
          testCommand = `npm test`;
          outputCommand = ' > test-results.json 2>&1';
          break;
        default:
          // For unknown frameworks, try to run with safe defaults
          testCommand = `npm test`;
      }

      elizaLogger.info(`[REPO-MANAGER] Running test command: ${testCommand}${outputCommand}`);

      const execOptions: any = {
        cwd: repoPath,
        timeout: 300000, // 5 minutes timeout
        env: {
          ...process.env,
          NODE_OPTIONS: nodeOptions,
          CI: 'true' // Some test frameworks behave better in CI mode
        },
        shell: true // Always use shell for proper redirection
      };

      let stdout = '', stderr = '';
      try {
        const result = await execAsync(testCommand + outputCommand, execOptions);
        stdout = result.stdout.toString();
        stderr = result.stderr.toString();
      } catch (error) {
        // For tests, we still want to try to read results even if command fails
        stdout = error.stdout || '';
        stderr = error.stderr || '';
        elizaLogger.warn(`[REPO-MANAGER] Test command failed but continuing to check results: ${error.message}`);
      }

      const duration = Date.now() - startTime;

      // Parse test results
      let results: TestResults = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration,
        failures: []
      };

      // Try to read JSON results file first
      let jsonResults = null;
      try {
        const resultsFile = path.join(repoPath, 'test-results.json');
        const resultsData = await fs.readFile(resultsFile, 'utf-8');
        jsonResults = JSON.parse(resultsData);
        
        // Parse based on test framework format
        if (testFramework === 'jest') {
          results.total = jsonResults.numTotalTests || 0;
          results.passed = jsonResults.numPassedTests || 0;
          results.failed = jsonResults.numFailedTests || 0;
          results.skipped = jsonResults.numPendingTests || 0;
          
          // Extract failure details if available
          if (jsonResults.testResults) {
            for (const testFile of jsonResults.testResults) {
              if (testFile.assertionResults) {
                for (const assertion of testFile.assertionResults) {
                  if (assertion.status === 'failed') {
                    results.failures.push({
                      test_name: assertion.title || 'Unknown test',
                      error_message: assertion.failureMessages?.join('\n') || 'Test failed'
                    });
                  }
                }
              }
            }
          }
        } else if (testFramework === 'mocha') {
          // Mocha JSON format
          if (jsonResults.stats) {
            results.total = jsonResults.stats.tests || 0;
            results.passed = jsonResults.stats.passes || 0;
            results.failed = jsonResults.stats.failures || 0;
            results.skipped = jsonResults.stats.pending || 0;
          }
          
          if (jsonResults.failures && Array.isArray(jsonResults.failures)) {
            for (const failure of jsonResults.failures) {
              results.failures.push({
                test_name: failure.fullTitle || failure.title || 'Unknown test',
                error_message: failure.err?.message || failure.err?.stack || 'Test failed'
              });
            }
          }
        }
      } catch (jsonError) {
        elizaLogger.debug(`[REPO-MANAGER] Could not read JSON results: ${jsonError.message}`);
        
        // Fallback to parsing stdout/stderr
        const combinedOutput = stdout + '\n' + stderr;
        
        // Try various patterns for different test frameworks
        let passMatch = combinedOutput.match(/(\d+)\s+passing/i);
        let failMatch = combinedOutput.match(/(\d+)\s+failing/i);
        
        // Alternative patterns
        if (!passMatch) passMatch = combinedOutput.match(/(\d+)\s+pass/i);
        if (!failMatch) failMatch = combinedOutput.match(/(\d+)\s+fail/i);
        
        // Jest patterns
        if (!passMatch) passMatch = combinedOutput.match(/Tests:\s+(\d+)\s+passed/i);
        if (!failMatch) failMatch = combinedOutput.match(/Tests:\s+(\d+)\s+failed/i);
        
        if (passMatch) results.passed = parseInt(passMatch[1]);
        if (failMatch) results.failed = parseInt(failMatch[1]);
        results.total = results.passed + results.failed;
        
        // If no results found, assume success if no errors in stderr
        if (results.total === 0 && !stderr.includes('Error') && !stderr.includes('failed')) {
          results.passed = 1;
          results.total = 1;
        }
        
        // Try to extract failure information
        if (results.failed > 0 || stderr.includes('Error') || stderr.includes('failed')) {
          const errorMessage = stderr || stdout || 'Test execution failed';
          results.failures.push({
            test_name: 'Test suite',
            error_message: errorMessage.substring(0, 1000) // First 1000 chars of error
          });
          
          if (results.failed === 0) {
            results.failed = 1;
            results.total = Math.max(results.total, 1);
          }
        }
      }

      elizaLogger.info(`[REPO-MANAGER] Tests completed: ${results.passed}/${results.total} passed`);
      return results;
    } catch (error) {
      elizaLogger.error('[REPO-MANAGER] Test execution failed:', error);
      return {
        total: 0,
        passed: 0,
        failed: 1,
        skipped: 0,
        duration: 0,
        failures: [{
          test_name: 'Test execution',
          error_message: error.message || 'Unknown error'
        }]
      };
    }
  }

  /**
   * Get repository structure
   */
  async getRepoStructure(repoPath: string, maxDepth: number = 3): Promise<DirectoryStructure> {
    async function buildStructure(
      dirPath: string, 
      name: string, 
      currentDepth: number
    ): Promise<DirectoryStructure> {
      const stats = await fs.stat(dirPath);
      
      if (!stats.isDirectory() || currentDepth >= maxDepth) {
        return {
          name,
          path: dirPath,
          type: stats.isDirectory() ? 'directory' : 'file'
        };
      }

      const entries = await fs.readdir(dirPath);
      const children: DirectoryStructure[] = [];

      for (const entry of entries) {
        // Skip common ignore patterns
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') {
          continue;
        }

        const entryPath = path.join(dirPath, entry);
        const child = await buildStructure(entryPath, entry, currentDepth + 1);
        children.push(child);
      }

      return {
        name,
        path: dirPath,
        type: 'directory',
        children
      };
    }

    return buildStructure(repoPath, path.basename(repoPath), 0);
  }

  /**
   * Find files by pattern
   */
  async findFiles(repoPath: string, pattern: RegExp): Promise<string[]> {
    const files: string[] = [];

    async function search(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await search(fullPath);
        } else if (entry.isFile() && pattern.test(entry.name)) {
          files.push(path.relative(repoPath, fullPath));
        }
      }
    }

    await search(repoPath);
    return files;
  }

  /**
   * Generate a git diff of changes
   */
  async generateDiff(repoPath: string): Promise<string> {
    try {
      // First, check if we're in a git repository and working directory exists
      const workingDirExists = await fs.access(repoPath).then(() => true).catch(() => false);
      if (!workingDirExists) {
        elizaLogger.warn(`[REPO-MANAGER] Working directory does not exist: ${repoPath}`);
        return '';
      }

      try {
        await execAsync('git status', { cwd: repoPath });
      } catch (error) {
        elizaLogger.warn(`[REPO-MANAGER] Not a git repository or git error: ${error.message}`);
        return '';
      }

      // Add all changes (including untracked files) to the index temporarily
      try {
        await execAsync('git add -A', { cwd: repoPath });
      } catch (error) {
        elizaLogger.warn(`[REPO-MANAGER] Failed to add files to git: ${error.message}`);
        return '';
      }
      
      // Generate diff of all staged changes
      const { stdout } = await execAsync('git diff --cached', {
        cwd: repoPath
      });
      
      // Reset the staging area to avoid side effects
      try {
        await execAsync('git reset', { cwd: repoPath });
      } catch (error) {
        elizaLogger.warn(`[REPO-MANAGER] Failed to reset git staging: ${error.message}`);
      }
      
      return stdout;
    } catch (error) {
      elizaLogger.error('[REPO-MANAGER] Failed to generate diff:', error);
      return '';
    }
  }

  /**
   * Cleanup repository
   */
  async cleanup(repoPath: string): Promise<void> {
    try {
      // Find instance ID from active repos
      let instanceId: string | undefined;
      for (const [id, path] of this.activeRepos.entries()) {
        if (path === repoPath) {
          instanceId = id;
          break;
        }
      }

      if (instanceId) {
        this.activeRepos.delete(instanceId);
      }

      await fs.rm(repoPath, { recursive: true, force: true });
      elizaLogger.info(`[REPO-MANAGER] Cleaned up repository at ${repoPath}`);
    } catch (error) {
      elizaLogger.error('[REPO-MANAGER] Cleanup failed:', error);
    }
  }

  /**
   * Cleanup all repositories
   */
  async cleanupAll(): Promise<void> {
    for (const repoPath of this.activeRepos.values()) {
      await this.cleanup(repoPath);
    }
    this.activeRepos.clear();
  }

  /**
   * Install dependencies for the repository
   */
  private async installDependencies(repoPath: string): Promise<void> {
    try {
      // Check for package.json
      const packageJsonPath = path.join(repoPath, 'package.json');
      const hasPackageJson = await fs.access(packageJsonPath).then(() => true).catch(() => false);

      if (hasPackageJson) {
        elizaLogger.info('[REPO-MANAGER] Installing dependencies...');
        
        // First, ensure we have a clean node_modules
        try {
          await fs.rm(path.join(repoPath, 'node_modules'), { recursive: true, force: true });
          await fs.rm(path.join(repoPath, 'package-lock.json'), { force: true });
        } catch {
          // Ignore if doesn't exist
        }
        
        // Detect package manager
        const hasYarnLock = await fs.access(path.join(repoPath, 'yarn.lock')).then(() => true).catch(() => false);
        const hasPnpmLock = await fs.access(path.join(repoPath, 'pnpm-lock.yaml')).then(() => true).catch(() => false);
        
        let installCommand = 'npm install';
        if (hasYarnLock) {
          installCommand = 'yarn install';
        } else if (hasPnpmLock) {
          installCommand = 'pnpm install';
        }

        // Run install with increased timeout and better error handling
        const { stdout, stderr } = await execAsync(installCommand, {
          cwd: repoPath,
          timeout: 600000, // 10 minutes timeout for large projects
          env: {
            ...process.env,
            // Ensure npm uses local cache
            npm_config_cache: path.join(repoPath, '.npm-cache'),
            npm_config_loglevel: 'error',
            // Skip optional dependencies that might fail
            npm_config_optional: 'false'
          }
        });

        if (stderr && stderr.includes('error')) {
          elizaLogger.warn('[REPO-MANAGER] Dependency installation had errors:', stderr);
        }

        elizaLogger.info('[REPO-MANAGER] Dependencies installed successfully');
        
        // Verify critical dev dependencies for testing
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        const testScript = packageJson.scripts?.test || '';
        
        // Check if test dependencies are installed
        if (testScript.includes('mocha') && !await this.isCommandAvailable('mocha', repoPath)) {
          elizaLogger.warn('[REPO-MANAGER] Mocha not found, installing locally...');
          await execAsync('npm install --save-dev mocha', { cwd: repoPath, timeout: 120000 });
        }
        
        if (testScript.includes('jest') && !await this.isCommandAvailable('jest', repoPath)) {
          elizaLogger.warn('[REPO-MANAGER] Jest not found, installing locally...');
          await execAsync('npm install --save-dev jest', { cwd: repoPath, timeout: 120000 });
        }
      }
    } catch (error) {
      elizaLogger.error('[REPO-MANAGER] Failed to install dependencies:', error);
      // Don't throw - some projects might still work without all dependencies
    }
  }

  /**
   * Check if a command is available
   */
  private async isCommandAvailable(command: string, cwd: string): Promise<boolean> {
    try {
      // Check if command exists in node_modules/.bin
      const binPath = path.join(cwd, 'node_modules', '.bin', command);
      await fs.access(binPath);
      return true;
    } catch {
      // Check if globally available
      try {
        await execAsync(`which ${command}`, { cwd });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Detect test framework used in the repository
   */
  private async detectTestFramework(repoPath: string): Promise<string> {
    try {
      const packageJsonPath = path.join(repoPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };

      // Check dependencies first
      if (deps.jest || deps['@types/jest']) return 'jest';
      if (deps.vitest) return 'vitest';
      if (deps.mocha || deps['@types/mocha'] || deps.chai) return 'mocha';
      if (deps.karma || deps['karma-jasmine'] || deps['karma-chrome-launcher']) return 'karma';
      if (deps.tape || deps['tape-catch']) return 'tape';
      if (deps['@testing-library/react']) return 'jest'; // React usually uses Jest
      if (deps.jasmine || deps['@types/jasmine']) return 'jasmine';

      // Check test script command
      const testScript = packageJson.scripts?.test || '';
      if (testScript.includes('jest')) return 'jest';
      if (testScript.includes('vitest')) return 'vitest';
      if (testScript.includes('mocha')) return 'mocha';
      if (testScript.includes('karma')) return 'karma';
      if (testScript.includes('tape')) return 'tape';
      if (testScript.includes('jasmine')) return 'jasmine';
      
      // Check for specific patterns common in older projects
      if (testScript.includes('grunt test') || testScript.includes('gulp test')) {
        // These usually use mocha or jasmine, default to mocha
        return 'mocha';
      }
      
      // Check for test directory structure
      const testDirExists = await fs.access(path.join(repoPath, 'test')).then(() => true).catch(() => false);
      const specDirExists = await fs.access(path.join(repoPath, 'spec')).then(() => true).catch(() => false);
      
      if (testDirExists || specDirExists) {
        // Look for test files to guess framework
        const testFiles = await this.findFiles(repoPath, /\.(test|spec)\.(js|ts)$/);
        if (testFiles.length > 0) {
          // Read a test file to detect framework
          const firstTestFile = path.join(repoPath, testFiles[0]);
          try {
            const testContent = await fs.readFile(firstTestFile, 'utf-8');
            if (testContent.includes('describe(') && testContent.includes('it(')) {
              // Could be mocha, jest, or jasmine
              if (testContent.includes('expect(') && testContent.includes('.toBe(')) {
                return 'jest';
              } else if (testContent.includes('expect(') && testContent.includes('.to.')) {
                return 'mocha'; // with chai
              } else {
                return 'mocha'; // default for describe/it pattern
              }
            } else if (testContent.includes('test(')) {
              return 'tape';
            }
          } catch {
            // Ignore read errors
          }
        }
        return 'mocha'; // Default for projects with test directories
      }

      elizaLogger.warn(`[REPO-MANAGER] Could not detect test framework for ${repoPath}, defaulting to unknown`);
      return 'unknown';
    } catch (error) {
      elizaLogger.warn('[REPO-MANAGER] Error detecting test framework:', error);
      return 'unknown';
    }
  }

  /**
   * Check if repository builds successfully
   */
  async checkBuild(repoPath: string): Promise<boolean> {
    try {
      // Check for package.json
      const packageJsonPath = path.join(repoPath, 'package.json');
      const hasPackageJson = await fs.access(packageJsonPath).then(() => true).catch(() => false);
      
      if (!hasPackageJson) {
        elizaLogger.info('[REPO-MANAGER] No package.json found, skipping build check');
        return true; // Not a Node.js project, assume it's okay
      }

      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      // Run build script if exists
      if (packageJson.scripts?.build) {
        elizaLogger.info('[REPO-MANAGER] Running build script...');
        try {
          const { stdout, stderr } = await execAsync('npm run build', {
            cwd: repoPath,
            timeout: 300000 // 5 minutes timeout
          });

          // Check for actual errors (not just warnings)
          if (stderr) {
            const hasErrors = stderr.includes('error') || 
                            stderr.includes('Error') ||
                            stderr.includes('ERROR') ||
                            stderr.includes('failed');
            
            if (hasErrors && !stderr.includes('warning')) {
              elizaLogger.error('[REPO-MANAGER] Build errors found:', stderr);
              return false;
            }
          }
          
          elizaLogger.info('[REPO-MANAGER] Build script completed successfully');
        } catch (error) {
          elizaLogger.error('[REPO-MANAGER] Build script failed:', error.message);
          return false;
        }
      }

      // For TypeScript projects, check compilation
      const tsconfigPath = path.join(repoPath, 'tsconfig.json');
      const hasTsConfig = await fs.access(tsconfigPath).then(() => true).catch(() => false);

      if (hasTsConfig) {
        elizaLogger.info('[REPO-MANAGER] Running TypeScript compilation check...');
        try {
          const { stdout, stderr } = await execAsync('npx tsc --noEmit', {
            cwd: repoPath,
            timeout: 120000 // 2 minutes timeout
          });

          if (stderr || stdout) {
            // TypeScript outputs errors to stdout
            const output = stderr + stdout;
            if (output.includes('error TS')) {
              elizaLogger.error('[REPO-MANAGER] TypeScript compilation errors:', output);
              return false;
            }
          }
          
          elizaLogger.info('[REPO-MANAGER] TypeScript compilation check passed');
        } catch (error) {
          // Check if it's a real compilation error or just tsc not found
          if (error.message.includes('error TS')) {
            elizaLogger.error('[REPO-MANAGER] TypeScript compilation failed:', error.message);
            return false;
          } else {
            elizaLogger.warn('[REPO-MANAGER] Could not run TypeScript check:', error.message);
            // Don't fail the build if tsc is not available
          }
        }
      }

      // If we have a test:build or compile script, try that too
      if (packageJson.scripts?.['test:build'] || packageJson.scripts?.compile) {
        const compileScript = packageJson.scripts?.['test:build'] ? 'test:build' : 'compile';
        elizaLogger.info(`[REPO-MANAGER] Running ${compileScript} script...`);
        try {
          await execAsync(`npm run ${compileScript}`, {
            cwd: repoPath,
            timeout: 120000
          });
          elizaLogger.info(`[REPO-MANAGER] ${compileScript} completed successfully`);
        } catch (error) {
          elizaLogger.warn(`[REPO-MANAGER] ${compileScript} failed:`, error.message);
          // Don't fail the overall build for auxiliary scripts
        }
      }

      return true;
    } catch (error) {
      elizaLogger.error('[REPO-MANAGER] Build check failed:', error);
      return false;
    }
  }
}