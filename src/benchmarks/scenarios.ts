import type { BenchmarkScenario } from './types';

/**
 * Benchmark scenarios for testing AutoCoder capabilities
 */
export const benchmarkScenarios: BenchmarkScenario[] = [
  {
    id: 'simple-action',
    name: 'Simple Action Plugin',
    description: 'Create a basic plugin with a single action that echoes user input',
    requirements: [
      'Create an action called "echo" that repeats user input',
      'Action should validate that input is provided',
      'Action should return the input with a prefix',
      'Include unit tests for the action',
      'Export a proper ElizaOS plugin structure',
    ],
    constraints: ['Use TypeScript', 'Follow ElizaOS patterns', 'Include proper error handling'],
    expectedDuration: 120000, // 2 minutes
    successCriteria: {
      mustCompile: true,
      mustPassTests: true,
      minTestCoverage: 80,
      maxDuration: 1800000, // 30 minutes max for 100 iterations
      maxIterations: 100, // Allow up to 100 iterations to fix all issues
      requiredComponents: ['action'],
    },
  },
  {
    id: 'api-integration',
    name: 'API Integration Plugin',
    description: 'Create a weather plugin that fetches data from OpenWeatherMap API',
    requirements: [
      'Create a weather action that fetches current weather',
      'Use runtime.getSetting() for API key management',
      'Implement caching to avoid excessive API calls',
      'Handle API errors gracefully',
      'Parse weather data and format response',
      'Include a weather provider for context',
      'Add unit tests with mocked API responses',
    ],
    constraints: [
      'Must not hardcode API keys',
      'Cache results for at least 5 minutes',
      'Handle network timeouts',
      'Support city name input',
    ],
    expectedDuration: 300000, // 5 minutes
    successCriteria: {
      mustCompile: true,
      mustPassTests: true,
      minTestCoverage: 75,
      maxDuration: 420000, // 7 minutes max
      maxIterations: 100, // Allow up to 100 iterations
      requiredComponents: ['action', 'provider'],
      customValidation: async (project) => {
        // Check for proper API key handling
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        try {
          const { stdout } = await execAsync('grep -r "getSetting.*API_KEY" src || true', {
            cwd: project.localPath,
          });
          return stdout.length > 0;
        } catch {
          return false;
        }
      },
    },
  },
  {
    id: 'stateful-service',
    name: 'Stateful Service Plugin',
    description: 'Create a todo list plugin with CRUD operations and persistence',
    requirements: [
      'Create a TodoService that maintains a list of tasks',
      'Implement actions for add, remove, update, and list todos',
      'Service should persist todos using runtime database',
      'Handle concurrent access safely',
      'Include a provider to show current todos count',
      'Add comprehensive tests for all operations',
      'Support todo priorities and due dates',
    ],
    constraints: [
      'Use ElizaOS database adapter',
      'Implement proper service lifecycle',
      'Thread-safe operations',
      'Data validation on all inputs',
    ],
    expectedDuration: 480000, // 8 minutes
    successCriteria: {
      mustCompile: true,
      mustPassTests: true,
      minTestCoverage: 80,
      maxDuration: 600000, // 10 minutes max
      maxIterations: 100, // Allow up to 100 iterations
      requiredComponents: ['service', 'action', 'provider'],
    },
  },
  {
    id: 'multi-component',
    name: 'Multi-Component Plugin',
    description: 'Create an analytics plugin with actions, providers, evaluators, and service',
    requirements: [
      'Create AnalyticsService to track events',
      'Implement track action to record custom events',
      'Add analytics provider showing recent events',
      'Create evaluator that analyzes conversation sentiment',
      'Store analytics data in database',
      'Generate summary reports',
      'Include visualization helpers',
      'Comprehensive test coverage',
    ],
    constraints: [
      'All components must work together',
      'Proper data flow between components',
      'Efficient storage and retrieval',
      'Real-time updates',
    ],
    expectedDuration: 600000, // 10 minutes
    successCriteria: {
      mustCompile: true,
      mustPassTests: true,
      minTestCoverage: 75,
      maxDuration: 900000, // 15 minutes max
      maxIterations: 100, // Allow up to 100 iterations
      requiredComponents: ['service', 'action', 'provider', 'evaluator'],
    },
  },
  {
    id: 'plugin-update',
    name: 'Plugin Update Scenario',
    description: 'Add rate limiting feature to an existing plugin',
    requirements: [
      'Load an existing plugin (weather plugin)',
      'Add rate limiting to prevent API abuse',
      'Implement per-user rate limits',
      'Add rate limit status to responses',
      'Preserve all existing functionality',
      'Update tests to cover rate limiting',
      'Add configuration for rate limits',
    ],
    constraints: [
      'Do not break existing features',
      'Maintain backward compatibility',
      'Clean integration with existing code',
      'Efficient rate limit checking',
    ],
    expectedDuration: 300000, // 5 minutes
    successCriteria: {
      mustCompile: true,
      mustPassTests: true,
      minTestCoverage: 80,
      maxDuration: 420000, // 7 minutes max
      maxIterations: 100, // Allow up to 100 iterations
      requiredComponents: ['action', 'provider'],
      customValidation: async (project) => {
        // Check for rate limiting implementation
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        try {
          const { stdout } = await execAsync('grep -r "rate.*limit\\|rateLimit" src || true', {
            cwd: project.localPath,
          });
          return stdout.length > 0;
        } catch {
          return false;
        }
      },
    },
  },
];

/**
 * Get a benchmark scenario by ID
 */
export function getBenchmarkScenario(id: string): BenchmarkScenario | undefined {
  return benchmarkScenarios.find((s) => s.id === id);
}

/**
 * Get all benchmark scenario IDs
 */
export function getBenchmarkScenarioIds(): string[] {
  return benchmarkScenarios.map((s) => s.id);
}
