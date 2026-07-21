import path from "node:path"
import { fileURLToPath } from "node:url"

import * as ts from "typescript"

const COMPILER_OPTIONS: ts.CompilerOptions = {
  exactOptionalPropertyTypes: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noUncheckedIndexedAccess: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
}
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

export type SemanticSource = Readonly<{
  readonly checker: ts.TypeChecker
  readonly program: ts.Program
  readonly sourceFile: ts.SourceFile
}>

export function createSemanticProgram(filePaths: readonly string[]): ts.Program {
  return ts.createProgram(filePaths.map((filePath) => path.resolve(filePath)), COMPILER_OPTIONS)
}

export function resolveRepositoryPath(relativePath: string): string {
  return path.resolve(REPOSITORY_ROOT, relativePath)
}

export function createSemanticSource(sourceText: string, filePath: string): SemanticSource {
  const resolvedPath = path.resolve(filePath)
  const host = ts.createCompilerHost(COMPILER_OPTIONS)
  const defaultFileExists = host.fileExists.bind(host)
  const defaultGetSourceFile = host.getSourceFile.bind(host)
  host.fileExists = (candidate) => candidate === resolvedPath || defaultFileExists(candidate)
  host.getSourceFile = (candidate, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (candidate === resolvedPath) {
      return ts.createSourceFile(candidate, sourceText, languageVersion, true, ts.ScriptKind.TS)
    }
    return defaultGetSourceFile(candidate, languageVersion, onError, shouldCreateNewSourceFile)
  }
  const program = ts.createProgram([resolvedPath], COMPILER_OPTIONS, host)
  const sourceFile = program.getSourceFile(resolvedPath)
  if (sourceFile === undefined) throw new TypeError(`TypeScript source was not loaded: ${resolvedPath}`)
  return { checker: program.getTypeChecker(), program, sourceFile }
}
