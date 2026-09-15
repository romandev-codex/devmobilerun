import { z } from "zod"

const envSchema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB: z.string().min(1).optional(),
  EXECUTOR_URL: z.url().default("http://127.0.0.1:8765"),
  EXECUTOR_TOKEN: z.string().min(1, "EXECUTOR_TOKEN is required"),
})

export type Env = z.infer<typeof envSchema>

/** Parsed lazily so tests can set process.env before first use. */
export function getEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`
    )
    throw new Error(`Invalid environment: ${issues.join("; ")}`)
  }
  return parsed.data
}
