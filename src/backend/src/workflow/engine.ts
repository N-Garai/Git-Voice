/**
 * Minimal typed workflow engine.
 *
 * A workflow is an ordered list of named steps. Each step receives the shared
 * context, returns a value merged into it, and reports its outcome into a live
 * trace so callers (widget, dashboard) can watch the machine work station by
 * station. A step that throws stops the run and marks the workflow failed —
 * unless the step itself catches its failure and downgrades it (the pipeline's
 * external integrations do exactly that: they degrade, never abort).
 */

export interface WorkflowStep<C extends object> {
  stepId: string;
  name: string;
  run: (ctx: C, helpers: StepHelpers<C>) => Promise<Partial<C> | void>;
}

export interface StepHelpers<C extends object> {
  onProgress: (detail: string) => void;
}

export interface WorkflowRun {
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface TraceSink {
  start(step: { stepId: string; name: string }): void;
  complete(stepId: string, durationMs: number, detail?: string): void;
  skip(stepId: string, detail: string): void;
  fail(stepId: string, durationMs: number, error: string): void;
}

export async function runWorkflow<C extends object>(
  steps: Array<WorkflowStep<C>>,
  ctx: C,
  trace: TraceSink
): Promise<WorkflowRun> {
  const startedAt = Date.now();

  for (const step of steps) {
    const t0 = Date.now();
    trace.start(step);
    try {
      const patch = await step.run(ctx, {
        onProgress: () => {
          /* reserved for future streaming updates */
        }
      });
      if (patch) Object.assign(ctx, patch);
      trace.complete(step.stepId, Date.now() - t0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace.fail(step.stepId, Date.now() - t0, message);
      return { ok: false, error: message, durationMs: Date.now() - startedAt };
    }
  }

  return { ok: true, durationMs: Date.now() - startedAt };
}
