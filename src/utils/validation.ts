import type { Memory, Content } from '@elizaos/core';

/**
 * Validates if a memory contains a valid prompt
 */
export function validatePrompt(message: Memory): boolean {
  if (!message || !message.content || !message.content.text) {
    return false;
  }

  // Check if the text content is meaningful
  const text = message.content.text.trim();
  return text.length > 0;
}

/**
 * Validates if text looks like a JSON specification
 */
export function isValidJsonSpecification(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates if requirements are properly defined
 */
export function validateRequirements(requirements: any): boolean {
  if (!requirements || typeof requirements !== 'object') {
    return false;
  }

  // Basic validation for common requirement fields
  if (requirements.tools && !Array.isArray(requirements.tools)) {
    return false;
  }

  if (requirements.resources && !Array.isArray(requirements.resources)) {
    return false;
  }

  return true;
}
