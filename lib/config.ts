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
  });
  _config = parsed as Config;
  return _config;
}
