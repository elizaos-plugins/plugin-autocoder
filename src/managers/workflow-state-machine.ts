import { elizaLogger as logger } from '@elizaos/core';
import type { PluginProject, DevelopmentPhase } from '../types/plugin-project';

/**
 * Manages workflow state transitions and validation
 */
export class WorkflowStateMachine {
  private static readonly validTransitions: Map<DevelopmentPhase, DevelopmentPhase[]> = new Map([
    ['idle', ['researching', 'failed']],
    ['researching', ['mvp_planning', 'failed']],
    ['mvp_planning', ['mvp_development', 'failed']],
    ['mvp_development', ['mvp_testing', 'failed']],
    ['mvp_testing', ['full_planning', 'mvp_development', 'failed']],
    ['full_planning', ['full_development', 'failed']],
    ['full_development', ['full_testing', 'failed']],
    ['full_testing', ['self_critique', 'full_development', 'failed']],
    ['self_critique', ['revision', 'publishing', 'failed']],
    ['revision', ['full_testing', 'failed']],
    ['publishing', ['completed', 'failed']],
    ['completed', []],
    ['failed', ['idle']],
    [
      'awaiting-secrets',
      [
        'researching',
        'mvp_planning',
        'mvp_development',
        'full_planning',
        'full_development',
        'failed',
      ],
    ],
  ]);

  /**
   * Check if a phase transition is valid
   */
  static isValidTransition(from: DevelopmentPhase, to: DevelopmentPhase): boolean {
    const validTargets = this.validTransitions.get(from);
    return validTargets?.includes(to) ?? false;
  }

  /**
   * Validate a transition and provide feedback
   */
  static validateTransition(
    from: DevelopmentPhase,
    to: DevelopmentPhase,
    project?: PluginProject
  ): {
    allowed: boolean;
    reason?: string;
    nextPhase?: DevelopmentPhase;
  } {
    // Check if transition is valid
    if (this.isValidTransition(from, to)) {
      return { allowed: true };
    }

    // Special case: if trying to transition to a phase that's already in history,
    // it might be a retry scenario
    if (project?.phaseHistory?.includes(to)) {
      return {
        allowed: false,
        reason: `Cannot transition back to ${to} - phase already completed`,
      };
    }

    // Check if we're trying to skip phases
    const validNext = this.getValidNextPhases(from);
    if (validNext.length > 0) {
      return {
        allowed: false,
        reason: `Cannot transition from ${from} to ${to}. Valid next phases: ${validNext.join(', ')}`,
        nextPhase: validNext[0], // Suggest the first valid next phase
      };
    }

    return {
      allowed: false,
      reason: `No valid transitions from ${from}`,
    };
  }

  /**
   * Get valid next phases from current phase
   */
  static getValidNextPhases(current: DevelopmentPhase): DevelopmentPhase[] {
    return this.validTransitions.get(current) ?? [];
  }

  /**
   * Transition project to new phase
   */
  static transitionTo(project: PluginProject, newPhase: DevelopmentPhase): boolean {
    if (!this.isValidTransition(project.status, newPhase)) {
      logger.warn(
        `Invalid transition from ${project.status} to ${newPhase} for project ${project.id}`
      );
      return false;
    }

    const oldPhase = project.status;
    project.status = newPhase;
    project.updatedAt = new Date();

    logger.info(`Project ${project.id} transitioned from ${oldPhase} to ${newPhase}`);
    return true;
  }

  /**
   * Check if project is in terminal state
   */
  static isTerminalState(phase: DevelopmentPhase): boolean {
    return phase === 'completed' || phase === 'failed';
  }

  /**
   * Check if project can be retried
   */
  static canRetry(phase: DevelopmentPhase): boolean {
    return phase === 'failed' || phase === 'mvp_testing' || phase === 'full_testing';
  }

  /**
   * Get phase display name
   */
  static getPhaseDisplayName(phase: DevelopmentPhase): string {
    const displayNames: Record<DevelopmentPhase, string> = {
      idle: 'Idle',
      researching: 'Researching',
      mvp_planning: 'MVP Planning',
      mvp_development: 'MVP Development',
      mvp_testing: 'MVP Testing',
      full_planning: 'Full Planning',
      full_development: 'Full Development',
      full_testing: 'Full Testing',
      self_critique: 'Self Critique',
      revision: 'Revision',
      publishing: 'Publishing',
      completed: 'Completed',
      failed: 'Failed',
      'awaiting-secrets': 'Awaiting Secrets',
    };
    return displayNames[phase] || phase;
  }

  /**
   * Get phase progress percentage
   */
  static getPhaseProgress(phase: DevelopmentPhase): number {
    const progressMap: Record<DevelopmentPhase, number> = {
      idle: 0,
      researching: 10,
      mvp_planning: 20,
      mvp_development: 30,
      mvp_testing: 40,
      full_planning: 50,
      full_development: 60,
      full_testing: 70,
      self_critique: 80,
      revision: 85,
      publishing: 95,
      completed: 100,
      failed: 0,
      'awaiting-secrets': 0,
    };
    return progressMap[phase] || 0;
  }
}
