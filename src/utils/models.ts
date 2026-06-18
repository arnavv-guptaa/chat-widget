export const MODELS = [
  {
    name: 'GPT-5 Nano',
    value: 'openai/gpt-5-nano'
  },
  // Anthropic models
  {
    name: 'Claude Sonnet 4.5',
    value: 'anthropic/claude-sonnet-4-5',
  },
  {
    name: 'Claude Sonnet 4',
    value: 'anthropic/claude-sonnet-4-0',
  },
  {
    name: 'Claude Haiku 3.5',
    value: 'anthropic/claude-3-5-haiku-latest',
  },
  // OpenAI models
  {
    name: 'GPT-5',
    value: 'openai/gpt-5',
  },
  {
    name: 'GPT-OSS-120B',
    value: 'openai/gpt-oss-120b',
  },
  {
    name: 'GPT 4o',
    value: 'openai/gpt-4o',
  },
  // Google models
  {
    name: 'Gemini 2.5 Flash Lite',
    value: 'google/gemini-2.5-flash-lite',
  },
  {
    name: 'Gemini 2.5 Flash',
    value: 'google/gemini-2.5-flash',
  },
  {
    name: 'Gemini 2.5 Pro',
    value: 'google/gemini-2.5-pro',
  }
];

export const DEFAULT_MODEL = MODELS[0].value;
