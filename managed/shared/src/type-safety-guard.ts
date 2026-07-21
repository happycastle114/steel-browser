import * as ts from "typescript"

import { createSemanticSource, resolveRepositoryPath } from "./semantic-typescript-program.js"
import {
  hasSequenceProvenance,
  propagateSequenceParameters,
  type SequenceProvenanceContext,
} from "./sequence-provenance.js"

export const TYPE_SAFETY_VIOLATION = {
  EXPLICIT_ANY: "EXPLICIT_ANY",
  NON_NULL_ASSERTION: "NON_NULL_ASSERTION",
  TS_DIRECTIVE: "TS_DIRECTIVE",
  UNSAFE_SEQUENCE_NUMBER: "UNSAFE_SEQUENCE_NUMBER",
  UNSAFE_TYPE_ASSERTION: "UNSAFE_TYPE_ASSERTION",
} as const
export type TypeSafetyViolationKind = (typeof TYPE_SAFETY_VIOLATION)[keyof typeof TYPE_SAFETY_VIOLATION]
export type TypeSafetyViolation = Readonly<{
  readonly filePath: string
  readonly line: number
  readonly column: number
  readonly kind: TypeSafetyViolationKind
}>

export type TypeSafetyContext = SequenceProvenanceContext

const DOMAIN_TYPE_SOURCE = resolveRepositoryPath("managed/shared/src/control-plane-primitives.ts")
const DOMAIN_SEQUENCE_TYPES: ReadonlySet<string> = new Set(["CanonicalCursorSequence", "EventSequence"])
const NUMBER_CONVERSION = { NUMBER: "Number", PARSE_FLOAT: "parseFloat", PARSE_INT: "parseInt" } as const
const GLOBAL_NUMBER_CONVERSIONS: ReadonlySet<string> = new Set(Object.values(NUMBER_CONVERSION))
const NUMBER_NAMESPACE_CONVERSIONS: ReadonlySet<string> = new Set([
  NUMBER_CONVERSION.PARSE_FLOAT,
  NUMBER_CONVERSION.PARSE_INT,
])
const CONST_ASSERTION_TYPE = "const"

function exportedSequenceTypes(program: ts.Program, checker: ts.TypeChecker): readonly ts.Type[] {
  const types: ts.Type[] = []
  for (const sourceFile of program.getSourceFiles()) {
    if (resolveRepositoryPath(sourceFile.fileName) !== DOMAIN_TYPE_SOURCE) continue
    for (const statement of sourceFile.statements) {
      if (ts.isTypeAliasDeclaration(statement) && DOMAIN_SEQUENCE_TYPES.has(statement.name.text)) {
        types.push(checker.getTypeFromTypeNode(statement.type))
      }
    }
  }
  return types
}

export function createTypeSafetyContext(program: ts.Program): TypeSafetyContext {
  const checker = program.getTypeChecker()
  const context = { checker, sequenceSymbols: new Set<ts.Symbol>(), sequenceTypes: exportedSequenceTypes(program, checker) }
  propagateSequenceParameters(program, context)
  return context
}

function isGlobalIdentifier(expression: ts.Expression, names: ReadonlySet<string>, checker: ts.TypeChecker): boolean {
  if (!ts.isIdentifier(expression) || !names.has(expression.text)) return false
  const symbol = checker.getSymbolAtLocation(expression)
  if (symbol === undefined) return true
  return (symbol.declarations ?? []).every((declaration) => declaration.getSourceFile().isDeclarationFile)
}

function isNumberConversion(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  if (isGlobalIdentifier(expression, GLOBAL_NUMBER_CONVERSIONS, checker)) return true
  if (!ts.isPropertyAccessExpression(expression) || !NUMBER_NAMESPACE_CONVERSIONS.has(expression.name.text)) {
    return false
  }
  return isGlobalIdentifier(expression.expression, new Set([NUMBER_CONVERSION.NUMBER]), checker)
}

function unsafeSequenceConversion(node: ts.Node, context: TypeSafetyContext): boolean {
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.PlusToken) {
    return hasSequenceProvenance(node.operand, context)
  }
  if (!ts.isCallExpression(node) || !isNumberConversion(node.expression, context.checker)) return false
  const argument = node.arguments[0]
  return argument !== undefined && hasSequenceProvenance(argument, context)
}

function isConstAssertion(node: ts.AsExpression): boolean {
  return ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName) &&
    node.type.typeName.escapedText === CONST_ASSERTION_TYPE
}

function unsafeTypeAssertion(node: ts.Node): boolean {
  return ts.isTypeAssertionExpression(node) || (ts.isAsExpression(node) && !isConstAssertion(node))
}

function reportAt(
  sourceFile: ts.SourceFile,
  position: number,
  kind: TypeSafetyViolationKind,
): TypeSafetyViolation {
  const location = sourceFile.getLineAndCharacterOfPosition(position)
  return { filePath: sourceFile.fileName, line: location.line + 1, column: location.character + 1, kind }
}

function directiveViolations(sourceFile: ts.SourceFile): readonly TypeSafetyViolation[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, sourceFile.text)
  const violations: TypeSafetyViolation[] = []
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) continue
    for (const match of scanner.getTokenText().matchAll(/@ts-(?:ignore|expect-error|nocheck)\b/gu)) {
      violations.push(reportAt(sourceFile, scanner.getTokenPos() + (match.index ?? 0), TYPE_SAFETY_VIOLATION.TS_DIRECTIVE))
    }
  }
  return violations
}

export function findTypeSafetyViolationsInSource(
  sourceFile: ts.SourceFile,
  context: TypeSafetyContext,
): readonly TypeSafetyViolation[] {
  const violations: TypeSafetyViolation[] = [...directiveViolations(sourceFile)]
  const report = (node: ts.Node, kind: TypeSafetyViolationKind): void => {
    violations.push(reportAt(sourceFile, node.getStart(sourceFile), kind))
  }
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) report(node, TYPE_SAFETY_VIOLATION.EXPLICIT_ANY)
    if (unsafeSequenceConversion(node, context)) report(node, TYPE_SAFETY_VIOLATION.UNSAFE_SEQUENCE_NUMBER)
    if (unsafeTypeAssertion(node)) report(node, TYPE_SAFETY_VIOLATION.UNSAFE_TYPE_ASSERTION)
    if (ts.isNonNullExpression(node)) report(node, TYPE_SAFETY_VIOLATION.NON_NULL_ASSERTION)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations.sort((left, right) => left.line - right.line || left.column - right.column)
}

export function findTypeSafetyViolations(sourceText: string, filePath: string): readonly TypeSafetyViolation[] {
  const semantic = createSemanticSource(sourceText, filePath)
  return findTypeSafetyViolationsInSource(semantic.sourceFile, createTypeSafetyContext(semantic.program))
}
