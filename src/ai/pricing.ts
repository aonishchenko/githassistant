// Per-million token prices in USD (base input / output). Source: anthropic.com/pricing
// Cache write/hit pricing not modelled — only base input tokens counted.
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic — Claude 4.x
  'claude-opus-4-7':              { input: 5.00,  output: 25.00 },
  'claude-opus-4-6':              { input: 5.00,  output: 25.00 },
  'claude-opus-4-5':              { input: 5.00,  output: 25.00 },
  'claude-opus-4-1':              { input: 15.00, output: 75.00 },
  'claude-opus-4-0':              { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':            { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-5':            { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-0':            { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5':             { input: 1.00,  output: 5.00  },
  'claude-haiku-4-5-20251001':    { input: 1.00,  output: 5.00  },
  // Anthropic — Claude 3.x
  'claude-sonnet-3-7':            { input: 3.00,  output: 15.00 },
  'claude-sonnet-3-7-20250219':   { input: 3.00,  output: 15.00 },
  'claude-haiku-3-5':             { input: 0.80,  output: 4.00  },
  'claude-haiku-3-5-20241022':    { input: 0.80,  output: 4.00  },
  'claude-3-opus-20240229':       { input: 15.00, output: 75.00 },
  'claude-3-haiku-20240307':      { input: 0.25,  output: 1.25  },
  // OpenAI
  'gpt-5.5':                      { input: 5.00,  output: 30.00 },
  'gpt-5.5-pro':                  { input: 30.00, output: 180.00 },
  'gpt-5.4':                      { input: 2.50,  output: 15.00 },
  'gpt-5.4-mini':                 { input: 0.75,  output: 4.50  },
  'gpt-5.4-nano':                 { input: 0.20,  output: 1.25  },
  'gpt-5.4-pro':                  { input: 30.00, output: 180.00 },
  'gpt-5.2':                      { input: 1.75,  output: 14.00  },
  'gpt-5.2-pro':                  { input: 21.00, output: 168.00 },
  'gpt-5.1':                      { input: 1.25,  output: 10.00  },
  'gpt-5':                        { input: 1.25,  output: 10.00  },
  'gpt-5-mini':                   { input: 0.25,  output: 2.00   },
  'gpt-5-nano':                   { input: 0.05,  output: 0.40   },
  'gpt-5-pro':                    { input: 15.00, output: 120.00 },
  'gpt-4.1':                      { input: 2.00,  output: 8.00   },
  'gpt-4.1-mini':                 { input: 0.40,  output: 1.60   },
  'gpt-4.1-nano':                 { input: 0.10,  output: 0.40   },
  'gpt-4o':                       { input: 2.50,  output: 10.00  },
  'gpt-4o-mini':                  { input: 0.15,  output: 0.60   },
};

export function computeCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = PRICING[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
