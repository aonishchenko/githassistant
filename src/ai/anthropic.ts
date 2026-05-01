import Anthropic from '@anthropic-ai/sdk';
import type { Config, AIProvider } from '../types.js';

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;
  private model: string;

  constructor(config: Config) {
    this.client = new Anthropic({ apiKey: config.ai.anthropicApiKey });
    this.model = config.ai.anthropicModel;
  }

  async summarise(prompt: string, content: string, maxTokens = 1024): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: `${prompt}\n\n${content}` }],
    });
    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected non-text response from Anthropic');
    return block.text;
  }
}
