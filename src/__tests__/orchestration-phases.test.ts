import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrchestrationManager } from '../managers/orchestration-manager';
import type { IAgentRuntime } from '@elizaos/core';
import { UUID } from '@elizaos/core';

describe('OrchestrationManager - Phase & Healing Tests', () => {
  let manager: OrchestrationManager;
  let mockRuntime: IAgentRuntime;

  beforeEach(async () => {
    mockRuntime = {
      getSetting: vi.fn(),
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

  it('should transition through phases correctly', async () => {
    const project = await manager.createPluginProject(
      'phase-test',
      'A test of phases',
      'user-123' as UUID
    );
    (manager as any).projects.set(project.id, project); // Ensure project is tracked

    // Mock out the actual phase logic to just check transitions
    const researchSpy = vi
      .spyOn(manager as any, 'executeResearchPhase')
      .mockImplementation(async (id) => {
        await (manager as any).updateProjectStatus(id, 'mvp_planning');
      });

    const planningSpy = vi
      .spyOn(manager as any, 'executeMVPPlanningPhase')
      .mockImplementation(async (id) => {
        await (manager as any).updateProjectStatus(id, 'mvp_development');
      });

    const devSpy = vi
      .spyOn(manager as any, 'executeMVPDevelopmentPhase')
      .mockImplementation(async (id) => {
        await (manager as any).updateProjectStatus(id, 'mvp_testing');
      });

    // Mock the remaining phases to prevent the workflow from failing
    vi.spyOn(manager as any, 'executeFullPlanningPhase').mockImplementation(async (id) => {
      await (manager as any).updateProjectStatus(id, 'full_development');
    });

    vi.spyOn(manager as any, 'executeFullDevelopmentPhase').mockImplementation(async (id) => {
      await (manager as any).updateProjectStatus(id, 'self_critique');
    });

    vi.spyOn(manager as any, 'executeCriticalReviewPhase').mockImplementation(async (id) => {
      await (manager as any).updateProjectStatus(id, 'completed');
    });

    // Start the workflow
    await (manager as any).startCreationWorkflow(project.id);

    // Verify spies were called
    expect(researchSpy).toHaveBeenCalledWith(project.id);
    expect(planningSpy).toHaveBeenCalledWith(project.id);
    expect(devSpy).toHaveBeenCalledWith(project.id);

    // Verify final state
    const finalProject = await manager.getProject(project.id);
    expect(finalProject?.status).toBe('completed'); // Change expectation to completed
    expect(finalProject?.phaseHistory).toContain('researching');
    expect(finalProject?.phaseHistory).toContain('mvp_planning');
    expect(finalProject?.phaseHistory).toContain('mvp_development');
    expect(finalProject?.phaseHistory).toContain('mvp_testing');
  });

  it('should trigger healing when a check fails', async () => {
    const project = await manager.createPluginProject(
      'healing-trigger-test',
      'A test',
      'user-123' as UUID
    );
    (manager as any).projects.set(project.id, project);

    // Set the project to mvp_development phase
    project.status = 'mvp_development';

    // Mock checks to fail once, then succeed
    let checksFailed = false;
    const checksSpy = vi.spyOn(manager as any, 'runAllChecks').mockImplementation(async () => {
      if (!checksFailed) {
        checksFailed = true;
        return [{ phase: 'tsc', success: false, errorCount: 1, errors: ['TS2345: Error'] }];
      }
      return [{ phase: 'tsc', success: true, errorCount: 0 }];
    });

    // Mock code generation to be called for the fix
    const generateSpy = vi.spyOn(manager as any, 'generatePluginCode').mockResolvedValue(undefined);

    // Run the development loop
    await (manager as any).runDevelopmentLoop(project, 'mvp');

    // Should have run checks twice (initial fail, then success)
    expect(checksSpy).toHaveBeenCalledTimes(2);
    // Should have called generate code twice (once for each iteration)
    expect(generateSpy).toHaveBeenCalledTimes(2);
    // Final status should be testing
    expect(project.status).toBe('mvp_testing');
  });
});
