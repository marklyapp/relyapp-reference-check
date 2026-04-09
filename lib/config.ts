import { z } from 'zod';

// Define the schema for our environment variables
const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  // SEARCH_API_KEY is optional when provider is 'azure' (azure uses OPENAI_API_KEY)
  SEARCH_API_KEY: z.string().optional(),
  SEARCH_API_PROVIDER: z.enum(['serp', 'brave', 'azure']).default('azure'),
  // Optional Azure OpenAI endpoint — used as fallback if LiteLLM proxy doesn't support Responses API
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1'),
  /** Model used for Stage 1 web search (Responses API + web_search tool) */
  SEARCH_MODEL: z.string().default('gpt-4.1'),
  /** Model used for Stage 2 report consolidation (Chat Completions streaming) */
  REPORT_MODEL: z.string().default('claude-opus-4-6'),
  /**
   * Override temperature for report generation.
   * If not set: 0.3 for gpt-4 models, omitted entirely for gpt-5 models.
   */
  REPORT_TEMPERATURE: z.coerce.number().optional(),
});

// Refine: SEARCH_API_KEY is required for serp/brave, but not for azure
const refinedSchema = envSchema.superRefine((val, ctx) => {
  if (val.SEARCH_API_PROVIDER !== 'azure' && !val.SEARCH_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'SEARCH_API_KEY is required when SEARCH_API_PROVIDER is serp or brave',
      path: ['SEARCH_API_KEY'],
    });
  }
});

// Type for the config object
export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

// Lazily validate and return the config — throws at runtime if env vars are missing
export function getConfig(): Config {
  if (_config) return _config;
  const parsed = refinedSchema.parse({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    SEARCH_API_KEY: process.env.SEARCH_API_KEY,
    SEARCH_API_PROVIDER: process.env.SEARCH_API_PROVIDER,
    AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    SEARCH_MODEL: process.env.SEARCH_MODEL,
    REPORT_MODEL: process.env.REPORT_MODEL,
    REPORT_TEMPERATURE: process.env.REPORT_TEMPERATURE,
  });
  _config = parsed as Config;
  return _config;
}

/** Reset the cached config — useful in tests when env vars change */
export function resetConfig(): void {
  _config = null;
}
