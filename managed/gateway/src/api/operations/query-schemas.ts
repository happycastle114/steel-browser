import {
  EventQuerySchema,
  AdmissionStateSchema,
  ManagedListQuerySchema,
  SessionStateSchema,
  WorkerStateSchema,
} from "@happycastle/steel-managed-shared";
import { z } from "zod";

const PageSizeSchema = z.preprocess(
  (value) =>
    typeof value === "string" && /^[0-9]+$/u.test(value)
      ? Number(value)
      : value,
  ManagedListQuerySchema.shape.pageSize.removeDefault(),
);

export const MANAGED_DEFAULT_PAGE_SIZE =
  ManagedListQuerySchema.parse({}).pageSize;

const EventPageSizeSchema = z.preprocess(
  (value) =>
    typeof value === "string" && /^[0-9]+$/u.test(value)
      ? Number(value)
      : value,
  EventQuerySchema.shape.pageSize,
);

function repeated<Output, Definition extends z.ZodTypeDef, Input>(
  schema: z.ZodType<Output, Definition, Input>,
) {
  return z.preprocess(
    (value) => (typeof value === "string" ? [value] : value),
    z.array(schema).min(1),
  );
}

const base = {
  cursor: z.string().optional(),
  pageSize: PageSizeSchema.optional(),
} as const;

export const WorkerHttpQuerySchema = z
  .object({ ...base, state: repeated(WorkerStateSchema).optional() })
  .strict();
export const SessionHttpQuerySchema = z
  .object({ ...base, state: repeated(SessionStateSchema).optional() })
  .strict();
export const QueueHttpQuerySchema = z
  .object({ ...base, state: repeated(AdmissionStateSchema).optional() })
  .strict();
export const EventHttpQuerySchema = z
  .object({
    cursor: z.string().optional(),
    pageSize: EventPageSizeSchema,
    snapshotCursor: z.string().optional(),
  })
  .strict();
