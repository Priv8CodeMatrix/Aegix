/**
 * Agent Authentication Middleware
 * Validates X-Agent-Key header and attaches agent/owner info to request
 */

import { Request, Response, NextFunction } from 'express';
import { validateAgentKey, canAgentSpend } from '../routes/agents.js';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      agent?: {
        id: string;
        name: string;
        owner: string;
        privacyLevel: string;
      };
      isAgentRequest?: boolean;
    }
  }
}

const AGENT_KEY_HEADER = 'x-agent-key';

/**
 * Middleware to authenticate agent API keys
 * Use on routes that agents can access
 */
export function agentAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers[AGENT_KEY_HEADER] as string;
  
  if (!apiKey) {
    req.isAgentRequest = false;
    return next(); // Allow through without agent (might be direct user request)
  }

  // Validate the API key
  const result = validateAgentKey(apiKey);
  
  if (!result) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired agent API key',
      hint: 'Check your X-Agent-Key header',
    });
  }

  // Attach agent info to request
  req.agent = {
    id: result.agent.id,
    name: result.agent.name,
    owner: result.owner,
    privacyLevel: result.agent.privacyLevel,
  };
  req.isAgentRequest = true;

  console.log(`[AgentAuth] Request from agent: ${result.agent.name} (owner: ${result.owner.slice(0, 8)}...)`);
  
  next();
}

/**
 * Middleware to require agent authentication
 * Use on routes that MUST be accessed by an agent
 */
export function requireAgent(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers[AGENT_KEY_HEADER] as string;
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'Agent API key required',
      hint: 'Include X-Agent-Key header with your agent API key',
    });
  }

  const result = validateAgentKey(apiKey);
  
  if (!result) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired agent API key',
    });
  }

  req.agent = {
    id: result.agent.id,
    name: result.agent.name,
    owner: result.owner,
    privacyLevel: result.agent.privacyLevel,
  };
  req.isAgentRequest = true;
  
  next();
}

/**
 * Check if agent can make a payment (for use in payment routes)
 */
export function checkAgentSpending(agentId: string, amount: string, resource: string) {
  return canAgentSpend(agentId, amount, resource);
}

export { AGENT_KEY_HEADER };

