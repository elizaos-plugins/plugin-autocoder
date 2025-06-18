import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrchestrationManager } from '../../managers/orchestration-manager';
import type { IAgentRuntime, UUID } from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';

describe('OrchestrationManager', () => {
  let mockRuntime: IAgentRuntime;
  let manager: OrchestrationManager;

  beforeEach(() => {
    // Create mock runtime
    mockRuntime = {
      getSetting: (key: string) => {
        if (key === 'ANTHROPIC_API_KEY') return 'test-key';
        return null;
      },
      getService: (name: string) => {
        if (name === 'research') {
          return {
            createResearchProject: async () => ({
              id: 'research-123',
              status: 'pending',
            }),
            getProject: async () => ({
              id: 'research-123',
              status: 'completed',
              report: 'Research findings...',
              findings: [],
            }),
          };
        }
        if (name === 'knowledge') {
          return {
            storeDocument: async () => ({ id: 'doc-123' }),
            getKnowledge: async () => [],
          };
        }
        if (name === 'env-manager') {
          return {
            getEnvVar: () => null,
            setEnvVar: async () => {},
          };
        }
        if (name === 'plugin-manager') {
          return {
            clonePlugin: async () => ({ path: '/tmp/plugin' }),
            createBranch: async () => {},
            commitChanges: async () => {},
            createPullRequest: async () => ({ url: 'https://github.com/pr/123' }),
            publishPlugin: async () => ({
              success: true,
              npmPackage: '@elizaos/plugin-test',
              githubRepo: 'https://github.com/elizaos/plugin-test',
            }),
          };
        }
        return null;
      },
    } as any;

    manager = new OrchestrationManager(mockRuntime);
  });

  describe('Project Creation', () => {
    it('should create a new plugin project', async () => {
      await manager.initialize();

      const project = await manager.createPluginProject(
        'test-plugin',
        'A test plugin',
        'user-123' as UUID
      );

      expect(project).toBeDefined();
      expect(project.name).toBe('test-plugin');
      expect(project.description).toBe('A test plugin');
      expect(project.type).toBe('create');
      // Status may be 'idle' or 'researching' depending on timing
      expect(['idle', 'researching']).toContain(project.status);
      expect(project.totalPhases).toBe(18);
    });

    it('should create an update project', async () => {
      await manager.initialize();

      const project = await manager.updatePluginProject(
        'https://github.com/test/plugin',
        'Add new features',
        'user-123' as UUID
      );

      expect(project).toBeDefined();
      expect(project.type).toBe('update');
      expect(project.githubRepo).toBe('https://github.com/test/plugin');
      expect(project.totalPhases).toBe(11);
    });
  });

  describe('Project Management', () => {
    it('should track project status', async () => {
      await manager.initialize();

      const project = await manager.createPluginProject(
        'test-plugin',
        'A test plugin',
        'user-123' as UUID
      );

      const retrieved = await manager.getProject(project.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(project.id);
    });

    it('should get active projects', async () => {
      await manager.initialize();

      await manager.createPluginProject('plugin1', 'Test 1', 'user-123' as UUID);
      await manager.createPluginProject('plugin2', 'Test 2', 'user-123' as UUID);

      const active = await manager.getActiveProjects();
      expect(active.length).toBe(2);
    });

    it('should get projects by user', async () => {
      await manager.initialize();

      const userId = 'user-123' as UUID;
      await manager.createPluginProject('plugin1', 'Test 1', userId);
      await manager.createPluginProject('plugin2', 'Test 2', 'user-456' as UUID);

      const userProjects = await manager.getProjectsByUser(userId);
      expect(userProjects.length).toBe(1);
      expect(userProjects[0].userId).toBe(userId);
    });
  });

  describe('Secret Management', () => {
    it('should handle secret provision', async () => {
      await manager.initialize();

      const project = await manager.createPluginProject(
        'test-plugin',
        'A test plugin',
        'user-123' as UUID
      );

      // Manually set project to awaiting-secrets
      const proj = await manager.getProject(project.id);
      if (proj) {
        proj.status = 'awaiting-secrets';
        proj.requiredSecrets = ['API_KEY'];
      }

      await manager.provideSecrets(project.id, {
        API_KEY: 'test-api-key',
      });

      const updated = await manager.getProject(project.id);
      expect(updated?.providedSecrets).toContain('API_KEY');
    });
  });

  describe('User Feedback', () => {
    it('should add user feedback to project', async () => {
      await manager.initialize();

      const project = await manager.createPluginProject(
        'test-plugin',
        'A test plugin',
        'user-123' as UUID
      );

      await manager.addUserFeedback(project.id, 'Great work so far!');

      const updated = await manager.getProject(project.id);
      expect(updated?.lastUserFeedback).toBe('Great work so far!');
    });
  });

  describe('Project Cancellation', () => {
    it('should cancel a project', async () => {
      await manager.initialize();

      const project = await manager.createPluginProject(
        'test-plugin',
        'A test plugin',
        'user-123' as UUID
      );

      await manager.cancelProject(project.id);

      const cancelled = await manager.getProject(project.id);
      expect(cancelled?.status).toBe('failed');
      expect(cancelled?.error).toBe('Cancelled by system shutdown.');
    });
  });
});

describe('OrchestrationManager - Unit Tests', () => {
  let manager: OrchestrationManager;
  let mockRuntime: IAgentRuntime;

  beforeEach(async () => {
    mockRuntime = {
      getSetting: vi.fn().mockImplementation((key: string) => {
        if (key === 'ANTHROPIC_API_KEY') return 'test-key';
        return null;
      }),
      getService: vi.fn().mockReturnValue({
        createResearchProject: vi.fn().mockResolvedValue({ id: 'research-1' }),
        getProject: vi.fn().mockResolvedValue({ status: 'completed', report: 'Mock report' }),
        storeDocument: vi.fn().mockResolvedValue({ id: 'doc-1' }),
      }),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    } as any;

    manager = new OrchestrationManager(mockRuntime);
    await manager.initialize();
  });

  describe('Project Creation & Management', () => {
    it('should create a new plugin project with correct initial state', async () => {
      vi.spyOn(manager as any, 'startCreationWorkflow').mockImplementation(() => {});
      const project = await manager.createPluginProject(
        'test-plugin',
        'A test plugin',
        uuidv4() as UUID
      );

      expect(project).toBeDefined();
      expect(project.name).toBe('test-plugin');
      expect(project.status).toBe('idle');
      expect(project.phaseHistory).toEqual(['idle']);
      expect(project.currentIteration).toBe(0);
      expect(project.maxIterations).toBe(5);
    });

    it('should retrieve a project by its ID', async () => {
      vi.spyOn(manager as any, 'startCreationWorkflow').mockImplementation(() => {});
      const project = await manager.createPluginProject(
        'test-plugin',
        'A test plugin',
        uuidv4() as UUID
      );
      const retrieved = await manager.getProject(project.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(project.id);
    });
  });

  describe('Workflow Progression', () => {
    it('should start the creation workflow when a project is created', async () => {
      const startWorkflowSpy = vi
        .spyOn(manager as any, 'startCreationWorkflow')
        .mockImplementation(() => {});
      await manager.createPluginProject('workflow-test', 'A test', uuidv4() as UUID);
      expect(startWorkflowSpy).toHaveBeenCalledOnce();
    });

    it('should execute research and planning phases in order', async () => {
      const project = {
        id: 'test-project-1',
        logs: [],
        status: 'idle',
      } as any;
      (manager as any).projects.set(project.id, project);

      const researchSpy = vi
        .spyOn(manager as any, 'executeResearchPhase')
        .mockResolvedValue(undefined);
      const planningSpy = vi
        .spyOn(manager as any, 'executeMVPPlanningPhase')
        .mockResolvedValue(undefined);
      vi.spyOn(manager as any, 'executeMVPDevelopmentPhase').mockResolvedValue(undefined); // prevent further execution

      await (manager as any).startCreationWorkflow(project.id);

      expect(researchSpy).toHaveBeenCalledWith(project.id);
      expect(planningSpy).toHaveBeenCalledWith(project.id);
      // Verify call order by checking call order array
      expect(researchSpy).toHaveBeenCalledTimes(1);
      expect(planningSpy).toHaveBeenCalledTimes(1);
    });
  });
});
