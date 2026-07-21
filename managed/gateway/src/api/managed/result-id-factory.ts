import { randomUUID } from "node:crypto"

import {
  ResultIdSchema,
  type ResultId,
} from "@happycastle/steel-managed-shared"

export interface ResultIdFactory {
  next(): ResultId
}

export class RandomResultIdFactory implements ResultIdFactory {
  public next(): ResultId {
    return ResultIdSchema.parse(randomUUID())
  }
}
