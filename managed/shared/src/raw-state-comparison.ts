import * as ts from "typescript"

import { CLOSED_STATE_MEMBERS } from "./deployment-vocabulary.js"

export { CLOSED_STATE_MEMBERS }

export type RawStateComparisonViolation = Readonly<{
  readonly filePath: string
  readonly line: number
  readonly column: number
  readonly member: string
  readonly operator: string
}>

const CLOSED_STATE_MEMBER_SET: ReadonlySet<string> = new Set(CLOSED_STATE_MEMBERS)
const COMPARISON_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
])

function directStringLiteral(expression: ts.Expression): ts.StringLiteralLike | undefined {
  let current = expression
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return ts.isStringLiteralLike(current) ? current : undefined
}

function violationForBinaryExpression(
  sourceFile: ts.SourceFile,
  expression: ts.BinaryExpression,
): RawStateComparisonViolation | undefined {
  if (!COMPARISON_OPERATORS.has(expression.operatorToken.kind)) return undefined
  const literal = directStringLiteral(expression.left) ?? directStringLiteral(expression.right)
  if (literal === undefined || !CLOSED_STATE_MEMBER_SET.has(literal.text)) return undefined
  const position = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile))
  return {
    filePath: sourceFile.fileName,
    line: position.line + 1,
    column: position.character + 1,
    member: literal.text,
    operator: ts.tokenToString(expression.operatorToken.kind) ?? "comparison",
  }
}

export function findRawStateComparisons(
  sourceText: string,
  filePath: string,
): readonly RawStateComparisonViolation[] {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const violations: RawStateComparisonViolation[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) {
      const violation = violationForBinaryExpression(sourceFile, node)
      if (violation !== undefined) violations.push(violation)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}
