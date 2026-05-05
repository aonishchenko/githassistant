import OpenAI from 'openai';
import type { Config, AIProvider } from '../types.js';

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;

  constructor(config: Config) {
    this.client = new OpenAI({ apiKey: config.ai.openaiApiKey });
    this.model = config.ai.openaiModel;
  }

  async summarise(prompt: string, content: string, maxTokens = 1024): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: `${prompt}\n\n${content}` }],
    });
    const text = response.choices[0]?.message?.content;
    if (!text) throw new Error('Unexpected empty response from OpenAI');
    return text;
  }
}
