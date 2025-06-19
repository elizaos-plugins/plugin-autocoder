import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SWEBenchDataLoader } from '../data-loader';
import { RepositoryManager } from '../repository-manager';
import { IssueAnalyzer } from '../issue-analyzer';
import { EvaluationBridge } from '../evaluation-bridge';
import type { SWEBenchInstance } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock node-fetch using vi.hoisted to prevent real network calls
const mockFetch = vi.hoisted(() => vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({}),
  text: async () => '',
}));

vi.mock('node-fetch', () => ({ default: mockFetch }));

describe('SWE-bench Components', () => {
  const testCacheDir = '.test-swe-bench-cache';
  const testWorkDir = '.test-swe-bench-work';

  beforeEach(async () => {
    // Create test directories
    await fs.mkdir(testCacheDir, { recursive: true });
    await fs.mkdir(testWorkDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup test directories
    try {
      await fs.rm(testCacheDir, { recursive: true, force: true });
      await fs.rm(testWorkDir, { recursive: true, force: true });
    } catch {}
  });

  describe('SWEBenchDataLoader', () => {
    it('should initialize and create necessary directories', async () => {
      const loader = new SWEBenchDataLoader(testCacheDir);
      await loader.initialize();

      // Check directories exist
      const instancesDir = path.join(testCacheDir, 'instances');
      const resultsDir = path.join(testCacheDir, 'results');
      
      const instancesDirExists = await fs.access(instancesDir).then(() => true).catch(() => false);
      const resultsDirExists = await fs.access(resultsDir).then(() => true).catch(() => false);
      
      expect(instancesDirExists).toBe(true);
      expect(resultsDirExists).toBe(true);
    });

    it('should load sample TypeScript instances', async () => {
      const loader = new SWEBenchDataLoader(testCacheDir);
      await loader.initialize();
      
      const instances = await loader.loadDataset();
      
      expect(instances).toBeDefined();
      expect(Array.isArray(instances)).toBe(true);
      expect(instances.length).toBeGreaterThan(0);
      
      // Check all instances are TypeScript or JavaScript
      const allTypeScript = instances.every(
        inst => inst.language === 'TypeScript' || inst.language === 'JavaScript'
      );
      expect(allTypeScript).toBe(true);
    });

    it('should save and load results', async () => {
      const loader = new SWEBenchDataLoader(testCacheDir);
      await loader.initialize();
      
      const testResults = [{
        instance_id: 'test-001',
        success: true,
        patch: 'test patch',
        execution_time: 1000,
        iterations: 1,
        token_usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total: 150,
          cost: 0.01
        }
      }];
      
      await loader.saveResults(testResults);
      
      // Check results were saved
      const resultsDir = path.join(testCacheDir, 'results');
      const files = await fs.readdir(resultsDir);
      expect(files.length).toBeGreaterThan(0);
    });

    it.skip('should get dataset statistics', async () => {
      const loader = new SWEBenchDataLoader(testCacheDir);
      await loader.initialize();
      const instances = await loader.loadDataset();
      
      const stats = loader.getDatasetStats();
      
      expect(stats).toBeDefined();
      expect(stats.total).toBeGreaterThanOrEqual(0);
      expect(stats.byLanguage).toBeDefined();
      expect(stats.byRepo).toBeDefined();
      // Stats should match loaded instances
      if (instances.length > 0) {
        expect(stats.total).toBe(instances.length);
      }
    });
  });

  describe('RepositoryManager', () => {
    let repoManager: RepositoryManager;

    beforeEach(async () => {
      repoManager = new RepositoryManager(testWorkDir);
      await repoManager.initialize();
    });

    it('should initialize work directory', async () => {
      const dirExists = await fs.access(testWorkDir).then(() => true).catch(() => false);
      expect(dirExists).toBe(true);
    });

    it('should find files by pattern', async () => {
      // Create test files
      const testRepoPath = path.join(testWorkDir, 'test-repo');
      await fs.mkdir(testRepoPath, { recursive: true });
      await fs.writeFile(path.join(testRepoPath, 'test.ts'), 'console.log("test");');
      await fs.writeFile(path.join(testRepoPath, 'test.js'), 'console.log("test");');
      await fs.writeFile(path.join(testRepoPath, 'test.md'), '# Test');
      
      const tsFiles = await repoManager.findFiles(testRepoPath, /\.(ts|js)$/);
      
      expect(tsFiles).toHaveLength(2);
      expect(tsFiles).toContain('test.ts');
      expect(tsFiles).toContain('test.js');
    });

    it('should get repository structure', async () => {
      // Create test structure
      const testRepoPath = path.join(testWorkDir, 'test-repo');
      await fs.mkdir(path.join(testRepoPath, 'src'), { recursive: true });
      await fs.writeFile(path.join(testRepoPath, 'package.json'), '{}');
      await fs.writeFile(path.join(testRepoPath, 'src', 'index.ts'), '');
      
      const structure = await repoManager.getRepoStructure(testRepoPath, 2);
      
      expect(structure).toBeDefined();
      expect(structure.name).toBe('test-repo');
      expect(structure.type).toBe('directory');
      expect(structure.children).toBeDefined();
    });
  });

  describe('IssueAnalyzer', () => {
    it('should extract requirements from issue', async () => {
      const repoManager = new RepositoryManager(testWorkDir);
      const analyzer = new IssueAnalyzer(repoManager);
      
      const testInstance: SWEBenchInstance = {
        instance_id: 'test-001',
        repo: 'test/repo',
        repo_url: 'https://github.com/test/repo',
        language: 'TypeScript',
        issue_title: 'Fix type inference bug',
        issue_body: 'The type inference should work correctly. We need to:\n- Fix the inference logic\n- Add proper tests\n- Update documentation',
        issue_number: 123,
        base_commit: 'abc123',
        created_at: new Date().toISOString(),
        version: '1.0'
      };
      
      const testRepoPath = path.join(testWorkDir, 'test-repo');
      await fs.mkdir(testRepoPath, { recursive: true });
      await fs.writeFile(path.join(testRepoPath, 'package.json'), '{}');
      
      const analysis = await analyzer.analyzeIssue(testInstance, testRepoPath);
      
      expect(analysis).toBeDefined();
      expect(analysis.requirements.length).toBeGreaterThanOrEqual(3);
      expect(analysis.complexity).toBeDefined();
      expect(analysis.suggested_approach).toContain('Fix type inference bug');
    });
  });

  describe('EvaluationBridge', () => {
    it('should initialize evaluation environment', async () => {
      const bridge = new EvaluationBridge('python3', undefined, testWorkDir);
      await bridge.initialize();
      
      const predictionsDir = path.join(testWorkDir, 'predictions');
      const resultsDir = path.join(testWorkDir, 'results');
      
      const predDirExists = await fs.access(predictionsDir).then(() => true).catch(() => false);
      const resDirExists = await fs.access(resultsDir).then(() => true).catch(() => false);
      
      expect(predDirExists).toBe(true);
      expect(resDirExists).toBe(true);
    });

    it('should create evaluation script', async () => {
      const scriptPath = path.join(testWorkDir, 'test-eval.py');
      const bridge = new EvaluationBridge('python3', scriptPath, testWorkDir);
      
      await bridge.initialize();
      await bridge.ensureEvaluationScript();
      
      const scriptExists = await fs.access(scriptPath).then(() => true).catch(() => false);
      expect(scriptExists).toBe(true);
    });
  });
});

describe('SWE-bench Integration', () => {
  it('should export all necessary components', () => {
    // Test that all components can be imported
    expect(SWEBenchDataLoader).toBeDefined();
    expect(RepositoryManager).toBeDefined();
    expect(IssueAnalyzer).toBeDefined();
    expect(EvaluationBridge).toBeDefined();
  });
});