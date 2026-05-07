import type { Config, AIProvider, UsageTracker } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

export function createAIProvider(config: Config, tracker?: UsageTracker): AIProvider {
  switch (config.ai.provider) {
    case 'anthropic': return new AnthropicProvider(config, tracker);
    case 'openai': return new OpenAIProvider(config, tracker);
    default: throw new Error(`Unknown AI provider: "${config.ai.provider}"`);
  }
}
