import OpenAI from 'openai';
import type { Config, AIProvider, UsageContext, UsageTracker } from '../types.js';
import { computeCost } from './pricing.js';

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;
  private tracker?: UsageTracker;

  constructor(config: Config, tracker?: UsageTracker) {
    this.client = new OpenAI({ apiKey: config.ai.openaiApiKey });
    this.model = config.ai.openaiModel;
    this.tracker = tracker;
  }

  async summarise(prompt: string, content: string, maxTokens = 1024, ctx?: UsageContext): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: `${prompt}\n\n${content}` }],
    });
    const text = response.choices[0]?.message?.content;
    if (!text) throw new Error('Unexpected empty response from OpenAI');
    if (this.tracker && ctx) {
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      await this.tracker({
        ...ctx,
        model: this.model,
        inputTokens,
        outputTokens,
        costUsd: computeCost(this.model, inputTokens, outputTokens),
      });
    }
    return text;
  }
}
