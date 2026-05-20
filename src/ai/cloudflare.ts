import type { Config, AIProvider } from '../types.js';

interface CfAiBinding {
  run(model: string, inputs: { messages: Array<{ role: string; content: string }> }): Promise<{ response?: string } | ReadableStream>;
}

export class CloudflareAIProvider implements AIProvider {
  private binding: CfAiBinding;
  private model: string;

  constructor(config: Config, binding: CfAiBinding) {
    this.binding = binding;
    this.model = config.ai.cfAiModel;
  }

  async summarise(prompt: string, content: string, maxTokens = 1024): Promise<string> {
    const result = await this.binding.run(this.model, {
      messages: [{ role: 'user', content: `${prompt}\n\n${content}` }],
    });
    if (result instanceof ReadableStream) throw new Error('Unexpected streaming response from CF AI');
    const text = result.response;
    if (!text) throw new Error('Unexpected empty response from CF AI');
    return text;
  }
}
