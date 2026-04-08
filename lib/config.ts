import { z } from 'zod';

// Define the schema for our environment variables
const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  SEARCH_API_KEY: z.string().min(1),
  SEARCH_API_PROVIDER: z.enum(['serp', 'brave']).default('serp'),
});

// Type for the config object
export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

// Lazily validate and return the config — throws at runtime if env vars are missing
export function getConfig(): Config {
  if (_config) return _config;
  _config = envSchema.parse({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    SEARCH_API_KEY: process.env.SEARCH_API_KEY,
    SEARCH_API_PROVIDER: process.env.SEARCH_API_PROVIDER,
  });
  return _config;
}
