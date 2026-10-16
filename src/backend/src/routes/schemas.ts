import { z } from "zod";
import type { Telemetry } from "../types.js";

const consoleEntry = z.object({
  level: z.string().max(16).default("log"),
  text: z.string().max(2000),
  ts: z.number().optional()
});

const pageError = z.object({
  message: z.string().max(1000),
  source: z.string().max(400).optional(),
  line: z.number().optional(),
  col: z.number().optional(),
  ts: z.number().optional()
});

const clickEvent = z.object({
  selector: z.string().max(300),
  label: z.string().max(200).optional(),
  ts: z.number().optional()
});

export const telemetrySchema = z.object({
  url: z.string().max(500).default(""),
  route: z.string().max(300).default("/"),
  title: z.string().max(300).optional(),
  viewport: z
    .object({
      w: z.number().min(0).max(20000),
      h: z.number().min(0).max(20000),
      dpr: z.number().min(0).max(20).optional()
    })
    .default({ w: 0, h: 0 }),
  userAgent: z.string().max(500).default(""),
  language: z.string().max(40).optional(),
  referrer: z.string().max(500).optional(),
  sessionMs: z.number().min(0).max(1000 * 60 * 60 * 24).optional(),
  consoleLogs: z.array(consoleEntry).max(120).default([]),
  errors: z.array(pageError).max(30).default([]),
  clicks: z.array(clickEvent).max(30).default([])
});

export type TelemetryInput = z.infer<typeof telemetrySchema>;

export function parseTelemetry(raw: unknown): Telemetry {
  const parsed = telemetrySchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "telemetry"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid telemetry payload — ${issues}`);
  }
  return parsed.data as Telemetry;
}
