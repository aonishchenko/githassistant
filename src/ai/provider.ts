import type { Config, AIProvider } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

export function createAIProvider(config: Config): AIProvider {
  switch (config.ai.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    default:
      throw new Error(`Unknown AI provider: "${config.ai.provider}". Supported: anthropic, openai`);
  }
}
