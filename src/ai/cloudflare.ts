import type { Config, AIProvider } from '../types.js';

interface CfAiBinding {
  run(model: string, inputs: {
    messages: Array<{ role: string; content: string }>;
    max_tokens?: number;
  }): Promise<
    | { response?: string }
    | { choices?: Array<{ message?: { content?: string } }> }
    | ReadableStream
  >;
}

export class CloudflareAIProvider implements AIProvider {
  private binding: CfAiBinding;
  private model: string;

  constructor(config: Config, binding: CfAiBinding) {
    this.binding = binding;
    this.model = config.ai.cfAiModel;
  }

  async summarise(prompt: string, content: string): Promise<string> {
    // max_tokens intentionally omitted — reasoning models (kimi-k2, etc.) consume
    // explicit token caps entirely on internal thinking, leaving content: null.
    const result = await this.binding.run(this.model, {
      messages: [{ role: 'user', content: `${prompt}\n\n${content}` }],
    });
    if (result instanceof ReadableStream) throw new Error('Unexpected streaming response from CF AI');

    // Standard CF AI format
    if ('response' in result && result.response) return result.response;

    // OpenAI-compatible format (newer models like kimi-k2)
    if ('choices' in result) {
      const text = result.choices?.[0]?.message?.content;
      if (text) return text;
    }

    throw new Error(`Empty response from CF AI model ${this.model}: ${JSON.stringify(result)}`);
  }
}
