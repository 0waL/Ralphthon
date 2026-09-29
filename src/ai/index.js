import { createClaudeAi, AiError } from './claude.js';
import { createHeuristicAi } from './heuristic.js';

export { AiError };

/**
 * AI_MODE=claude | heuristic 로 강제할 수 있다.
 * 지정하지 않으면 Claude 인증 정보가 환경 변수에 있을 때만 Claude를 쓴다.
 */
export function createAi(env = process.env) {
  const mode = env.AI_MODE || (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN ? 'claude' : 'heuristic');
  return mode === 'claude' ? createClaudeAi() : createHeuristicAi();
}
