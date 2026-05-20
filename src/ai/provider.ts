import type { Config, AIProvider, UsageTracker } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { CloudflareAIProvider } from './cloudflare.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAIProvider(config: Config, tracker?: UsageTracker, cfAiBinding?: any): AIProvider {
  switch (config.ai.provider) {
    case 'anthropic': return new AnthropicProvider(config, tracker);
    case 'openai': return new OpenAIProvider(config, tracker);
    case 'cloudflare': {
      if (!cfAiBinding) throw new Error('CF AI binding is required when provider is "cloudflare"');
      return new CloudflareAIProvider(config, cfAiBinding);
    }
    default: throw new Error(`Unknown AI provider: "${config.ai.provider}"`);
  }
}
