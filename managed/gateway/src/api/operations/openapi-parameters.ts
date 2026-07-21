import {
  ADMISSION_STATE,
  SESSION_STATE,
  WORKER_STATE,
} from "@happycastle/steel-managed-shared";
import type { OpenApiParameter } from "./openapi-types.js";

export const UUID_PARAMETER: OpenApiParameter = {
  in: "path",
  name: "id",
  required: true,
  schema: { type: "string", format: "uuid" },
};

const PAGE_SIZE_PARAMETER: OpenApiParameter = {
  in: "query",
  name: "pageSize",
  required: false,
  schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
};

const CURSOR_PARAMETER: OpenApiParameter = {
  in: "query",
  name: "cursor",
  required: false,
  schema: { type: "string", pattern: "^[A-Za-z0-9_-]+$", minLength: 2 },
};

const SNAPSHOT_CURSOR_PARAMETER: OpenApiParameter = {
  ...CURSOR_PARAMETER,
  name: "snapshotCursor",
};

function stateParameter(values: readonly string[]): OpenApiParameter {
  return {
    in: "query",
    name: "state",
    required: false,
    style: "form",
    explode: true,
    schema: {
      type: "array",
      minItems: 1,
      items: { type: "string", enum: values },
    },
  };
}

export const WORKER_LIST_PARAMETERS = [
  PAGE_SIZE_PARAMETER,
  CURSOR_PARAMETER,
  stateParameter(Object.values(WORKER_STATE)),
];

export const SESSION_LIST_PARAMETERS = [
  PAGE_SIZE_PARAMETER,
  CURSOR_PARAMETER,
  stateParameter(Object.values(SESSION_STATE)),
];

export const QUEUE_LIST_PARAMETERS = [
  PAGE_SIZE_PARAMETER,
  CURSOR_PARAMETER,
  stateParameter(Object.values(ADMISSION_STATE)),
];

export const EVENT_LIST_PARAMETERS = [
  PAGE_SIZE_PARAMETER,
  CURSOR_PARAMETER,
  SNAPSHOT_CURSOR_PARAMETER,
];
