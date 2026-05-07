// Per-million token prices in USD. Update when provider pricing changes.
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-sonnet-4-5':          { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-5-20251001': { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5':           { input: 0.80,  output: 4.00  },
  'claude-haiku-4-5-20251001':  { input: 0.80,  output: 4.00  },
  'claude-opus-4-5':            { input: 15.00, output: 75.00 },
  // OpenAI
  'gpt-4o':                     { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':                { input: 0.15,  output: 0.60  },
};

export function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
