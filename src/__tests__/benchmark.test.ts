import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsCollector } from '../benchmarks/metrics-collector';
import { DecisionLogger } from '../benchmarks/decision-logger';
import { OutputValidator } from '../benchmarks/output-validator';
import { benchmarkScenarios, getBenchmarkScenario } from '../benchmarks/scenarios';
import type { PluginProject } from '../types/plugin-project';
import type { BenchmarkScenario } from '../benchmarks/types';
import type { UUID } from '@elizaos/core';
import * as fs from 'fs/promises';

// Mock fs and child_process modules
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(''),
  appendFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('child_process', () => ({
  exec: vi.fn((command, options, callback) => {
    if (callback) {
      callback(null, { stdout: '', stderr: '' });
    }
    return {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => {
        if (event === 'close') {
          cb(0);
        }
      }),
    };
  }),
}));

describe.skip('Benchmarking System', () => {
  describe('MetricsCollector', () => {
    let collector: MetricsCollector;

    beforeEach(() => {
      collector = new MetricsCollector();
    });

    it('should track phase durations', () => {
      collector.startPhase('researching');
      // Simulate some work
      const start = Date.now();
      while (Date.now() - start < 10) {
        /* wait */
      }
      collector.endPhase('researching');

      const metrics = collector.getSnapshot();
      expect(metrics.phasesDurations.has('researching')).toBe(true);
      expect(metrics.phasesDurations.get('researching')).toBeGreaterThan(0);
    });

    it('should record token usage', () => {
      collector.recordTokenUsage(100, 200, 0.05);
      collector.recordTokenUsage(50, 100, 0.025);

      const metrics = collector.getSnapshot();
      expect(metrics.tokenUsage.input).toBe(150);
      expect(metrics.tokenUsage.output).toBe(300);
      expect(metrics.tokenUsage.total).toBe(450);
      expect(metrics.tokenUsage.cost).toBeCloseTo(0.075);
    });

    it('should track iterations and healing cycles', () => {
      collector.incrementIteration();
      collector.incrementIteration();
      collector.incrementHealingCycles();

      const metrics = collector.getSnapshot();
      expect(metrics.iterationCount).toBe(2);
      expect(metrics.healingCycles).toBe(1);
    });

    it('should record compilation and test results', () => {
      collector.recordCompilationResult(false, 5);
      collector.recordTestResults(8, 10);
      collector.recordEslintResults(3);

      const metrics = collector.getSnapshot();
      expect(metrics.compilationSuccess).toBe(false);
      expect(metrics.typeErrorCount).toBe(5);
      expect(metrics.testPassRate).toBe(80);
      expect(metrics.eslintErrorCount).toBe(3);
    });

    it('should export metrics as JSON', () => {
      collector.recordTokenUsage(100, 200, 0.05);
      collector.setRequirementsCoverage(85);

      const json = collector.exportToJson();
      const parsed = JSON.parse(json);

      expect(parsed.metrics).toBeDefined();
      expect(parsed.metrics.tokenUsage).toBeDefined();
      expect(parsed.metrics.requirementsCoverage).toBe(85);
      expect(parsed.timestamp).toBeDefined();
    });
  });

  describe('DecisionLogger', () => {
    let logger: DecisionLogger;
    const logDir = '/tmp/test-logs';
    const projectId = 'test-project';

    beforeEach(() => {
      vi.clearAllMocks();
      logger = new DecisionLogger(logDir, projectId, false);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.appendFile).mockResolvedValue(undefined);
    });

    it('should log design decisions', async () => {
      await logger.logDesignDecision(
        'mvp_planning',
        1,
        'Choosing modular architecture',
        ['monolithic', 'modular', 'microservices'],
        'modular',
        85,
        ['Create extensible plugin system']
      );

      const decisions = logger.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0].decision.type).toBe('design');
      expect(decisions[0].decision.chosenPath).toBe('modular');
      expect(decisions[0].decision.confidence).toBe(85);
    });

    it('should log fix decisions', async () => {
      const error = {
        errorType: 'typescript' as const,
        message: 'Type error',
        file: 'test.ts',
        line: 10,
        fixAttempts: 0,
        resolved: false,
      };

      await logger.logFixDecision(
        'full_development',
        2,
        error,
        'Add type annotations',
        'Missing type information',
        ['Add any type', 'Add proper types', 'Ignore error'],
        90
      );

      const decisions = logger.getDecisionsByType('fix');
      expect(decisions).toHaveLength(1);
      expect(decisions[0].context.errors).toHaveLength(1);
      expect(decisions[0].decision.chosenPath).toBe('Add type annotations');
    });

    it('should generate decision summary', async () => {
      await logger.logDesignDecision('mvp_planning', 1, 'reason', [], 'path', 80, []);
      await logger.logFixDecision(
        'full_development',
        2,
        {
          errorType: 'eslint',
          message: 'error',
          fixAttempts: 1,
          resolved: false,
        },
        'fix',
        'reason',
        [],
        70
      );

      logger.updateDecisionOutcome(0, true, 'Successfully implemented', []);

      const summary = logger.generateSummary();
      expect(summary.totalDecisions).toBe(2);
      expect(summary.byType.design).toBe(1);
      expect(summary.byType.fix).toBe(1);
      expect(summary.successRate).toBe(50);
      expect(summary.averageConfidence).toBe(75);
    });
  });

  describe('OutputValidator', () => {
    let validator: OutputValidator;
    const mockProject: PluginProject = {
      id: 'test-project',
      name: 'test-plugin',
      description: 'Test plugin',
      type: 'create',
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
      logs: [],
      userId: 'test-user-id' as UUID,
      userNotifications: [],
      phaseHistory: ['completed'],
      currentIteration: 1,
      maxIterations: 10,
      infiniteMode: false,
      requiredSecrets: [],
      providedSecrets: [],
      errors: [],
      errorAnalysis: new Map(),
      customInstructions: [],
      knowledgeIds: [],
      totalPhases: 10,
      phase: 10,
      localPath: '/tmp/test-plugin',
    };

    beforeEach(() => {
      validator = new OutputValidator(false);
      vi.clearAllMocks();
    });

    it('should validate compilation success', async () => {
      const scenario: BenchmarkScenario = {
        id: 'test',
        name: 'Test',
        description: 'Test scenario',
        requirements: [],
        constraints: [],
        expectedDuration: 60000,
        successCriteria: {
          mustCompile: true,
          mustPassTests: false,
        },
      };

      vi.mocked(require('child_process').exec).mockImplementation((cmd, opts, cb) => {
        cb(null, { stdout: 'Build successful', stderr: '' });
      });

      const result = await validator.validate(mockProject, scenario);
      expect(result.criteria.compilation).toBe(true);
    });

    it('should check requirements coverage', async () => {
      const scenario: BenchmarkScenario = {
        id: 'test',
        name: 'Test',
        description: 'Test scenario',
        requirements: [
          'Create an action called echo',
          'Include unit tests',
          'Export plugin structure',
        ],
        constraints: [],
        expectedDuration: 60000,
        successCriteria: {
          mustCompile: true,
          mustPassTests: false,
        },
      };

      // Mock file system checks
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'echo.ts', isDirectory: () => false } as any,
      ]);
      vi.mocked(fs.readFile).mockResolvedValue(
        'export const echoAction: Action = { name: "echo" }'
      );

      const result = await validator.validate(mockProject, scenario);
      expect(result.details.requirementsCovered.length).toBeGreaterThan(0);
    });

    it('should validate a successful project', async () => {
      const project: PluginProject = {
        id: 'test-project',
        name: 'Test Project',
        description: 'A test project',
        type: 'create',
        status: 'completed',
        localPath: '/tmp/test-project',
        logs: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: 'test-user-id' as UUID,
        userNotifications: [],
        phaseHistory: ['completed'],
        currentIteration: 1,
        maxIterations: 1,
        infiniteMode: false,
        requiredSecrets: [],
        providedSecrets: [],
        errors: [],
        errorAnalysis: new Map(),
        customInstructions: [],
        knowledgeIds: [],
        totalPhases: 10,
        phase: 10,
      };

      const scenario = getBenchmarkScenario('simple-action') as BenchmarkScenario;
      const result = await validator.validate(project, scenario);

      const isSuccess =
        result.details.requirementsMissed.length === 0 &&
        result.details.unexpectedBehaviors.length === 0 &&
        result.details.performanceIssues.length === 0;

      expect(isSuccess).toBe(true);
      expect(result.details.requirementsCovered.length).toBe(scenario.requirements.length);
    });
  });

  describe('Benchmark Scenarios', () => {
    it('should have all required scenarios', () => {
      const scenarios = benchmarkScenarios;
      expect(scenarios).toHaveLength(5);

      const scenarioIds = scenarios.map((s) => s.id);
      expect(scenarioIds).toContain('simple-action');
      expect(scenarioIds).toContain('api-integration');
      expect(scenarioIds).toContain('stateful-service');
      expect(scenarioIds).toContain('multi-component');
      expect(scenarioIds).toContain('plugin-update');
    });

    it('should have valid success criteria', () => {
      for (const scenario of benchmarkScenarios) {
        expect(scenario.successCriteria.mustCompile).toBe(true);
        expect(scenario.expectedDuration).toBeGreaterThan(0);
        expect(scenario.requirements.length).toBeGreaterThan(0);
      }
    });

    it('should retrieve scenarios by ID', () => {
      const scenario = getBenchmarkScenario('simple-action');
      expect(scenario).toBeDefined();
      expect(scenario?.name).toBe('Simple Action Plugin');
    });
  });
});
