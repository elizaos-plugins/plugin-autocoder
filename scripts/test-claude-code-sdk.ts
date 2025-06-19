#!/usr/bin/env bun

import { query, type SDKMessage } from "@anthropic-ai/claude-code";
import { elizaLogger } from '@elizaos/core';

async function testClaudeCodeSDK() {
  elizaLogger.info('Testing Claude Code SDK integration...');
  
  const messages: SDKMessage[] = [];
  
  try {
    // Simple test prompt
    const prompt = `Create a simple JavaScript function that adds two numbers together.`;
    
    elizaLogger.info('Sending prompt to Claude Code SDK:', prompt);
    
    for await (const message of query({
      prompt,
      abortController: new AbortController(),
      options: {
        maxTurns: 1,
        outputFormat: "stream-json" as const,
        allowedTools: ["Write"],
        permissionMode: "acceptEdits" as const
      }
    })) {
      messages.push(message);
      
      if (message.type === 'system' && message.subtype === 'init') {
        elizaLogger.info('Session started:', message.session_id);
      } else if (message.type === 'result') {
        elizaLogger.info('Session completed:', {
          turns: message.num_turns,
          cost: message.total_cost_usd,
          error: message.is_error
        });
      } else if (message.type === 'assistant') {
        elizaLogger.info('Assistant message received');
      }
    }
    
    elizaLogger.info('Test completed successfully!');
    elizaLogger.info('Total messages:', messages.length);
    
  } catch (error) {
    elizaLogger.error('Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testClaudeCodeSDK().catch(console.error); 