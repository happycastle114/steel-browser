import {
  AdmissionListSchema,
  AdmissionSchema,
  SessionListSchema,
  SessionSchema,
  VersionSchema,
  WorkerListSchema,
  WorkerSchema,
} from "@happycastle/steel-managed-shared/browser"
import { z } from "zod"

export {
  AdmissionListSchema,
  AdmissionSchema,
  SessionListSchema,
  SessionSchema,
  VersionSchema,
  WorkerListSchema,
  WorkerSchema,
}

export type Worker = z.output<typeof WorkerSchema>
export type Session = z.output<typeof SessionSchema>
export type Admission = z.output<typeof AdmissionSchema>
export type Version = z.output<typeof VersionSchema>
export type WorkerList = z.output<typeof WorkerListSchema>
export type SessionList = z.output<typeof SessionListSchema>
export type AdmissionList = z.output<typeof AdmissionListSchema>
