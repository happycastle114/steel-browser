import * as ts from "typescript"

import { CONTROL_PLANE_CLOSED_STATE_MEMBERS } from "./control-plane-vocabulary.js"
import { CLOSED_STATE_MEMBERS as DEPLOYMENT_CLOSED_STATE_MEMBERS } from "./deployment-vocabulary.js"
import { collectionEvidence, literalEvidence, type LiteralEvidence } from "./raw-state-evidence.js"
import { createSemanticSource } from "./semantic-typescript-program.js"
import { LOCK_STAGE } from "./upstream-lock.js"

export const CLOSED_STATE_MEMBERS = Object.freeze(
  Array.from(new Set([
    ...DEPLOYMENT_CLOSED_STATE_MEMBERS,
    ...CONTROL_PLANE_CLOSED_STATE_MEMBERS,
    ...Object.values(LOCK_STAGE),
  ])).sort(),
)

export type RawStateComparisonViolation = Readonly<{
  readonly filePath: string
  readonly line: number
  readonly column: number
  readonly member: string
  readonly operator: string
}>

const CLOSED_MEMBER_SET: ReadonlySet<string> = new Set(CLOSED_STATE_MEMBERS)
const COMPARISON_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
])
const MEMBERSHIP_METHOD = { HAS: "has", INCLUDES: "includes" } as const

function report(
  sourceFile: ts.SourceFile,
  evidence: LiteralEvidence,
  operator: string,
): RawStateComparisonViolation {
  const position = sourceFile.getLineAndCharacterOfPosition(evidence.node.getStart(sourceFile))
  return { filePath: sourceFile.fileName, line: position.line + 1, column: position.character + 1, member: evidence.member, operator }
}

export function findRawStateComparisonsInSource(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): readonly RawStateComparisonViolation[] {
  const violations: RawStateComparisonViolation[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && COMPARISON_OPERATORS.has(node.operatorToken.kind)) {
      const evidence = literalEvidence(node.left, checker, CLOSED_MEMBER_SET) ??
        literalEvidence(node.right, checker, CLOSED_MEMBER_SET)
      if (evidence !== undefined) violations.push(report(sourceFile, evidence, ts.tokenToString(node.operatorToken.kind) ?? "comparison"))
    }
    if (ts.isCaseClause(node)) {
      const evidence = literalEvidence(node.expression, checker, CLOSED_MEMBER_SET)
      if (evidence !== undefined) violations.push(report(sourceFile, evidence, "case"))
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      if (method === MEMBERSHIP_METHOD.INCLUDES || method === MEMBERSHIP_METHOD.HAS) {
        const evidence = collectionEvidence(node.expression.expression, checker, CLOSED_MEMBER_SET) ??
          (node.arguments[0] === undefined ? undefined : literalEvidence(node.arguments[0], checker, CLOSED_MEMBER_SET))
        if (evidence !== undefined) violations.push(report(sourceFile, evidence, method))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}

export function findRawStateComparisons(sourceText: string, filePath: string): readonly RawStateComparisonViolation[] {
  const semantic = createSemanticSource(sourceText, filePath)
  return findRawStateComparisonsInSource(semantic.sourceFile, semantic.checker)
}
