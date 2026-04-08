import { z } from 'zod';

// Define the schema for our environment variables
const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  SEARCH_API_KEY: z.string().min(1),
  SEARCH_API_PROVIDER: z.enum(['serp', 'brave']).default('serp'),
});

// Type for the config object
export type Config = z.infer<typeof envSchema>;

// Validate and export the config
const config = envSchema.parse({
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  SEARCH_API_KEY: process.env.SEARCH_API_KEY,
  SEARCH_API_PROVIDER: process.env.SEARCH_API_PROVIDER,
});

export { config };