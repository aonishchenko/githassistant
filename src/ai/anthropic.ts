import Anthropic from '@anthropic-ai/sdk';
import type { Config, AIProvider, UsageContext, UsageTracker } from '../types.js';
import { computeCost } from './pricing.js';

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;
  private model: string;
  private tracker?: UsageTracker;

  constructor(config: Config, tracker?: UsageTracker) {
    this.client = new Anthropic({ apiKey: config.ai.anthropicApiKey, maxRetries: 4 });
    this.model = config.ai.anthropicModel;
    this.tracker = tracker;
  }

  async summarise(prompt: string, content: string, maxTokens = 1024, ctx?: UsageContext): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: `${prompt}\n\n${content}` }],
    });
    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected non-text response from Anthropic');
    if (this.tracker && ctx) {
      await this.tracker({
        ...ctx,
        model: this.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costUsd: computeCost(this.model, response.usage.input_tokens, response.usage.output_tokens),
      });
    }
    return block.text;
  }
}
