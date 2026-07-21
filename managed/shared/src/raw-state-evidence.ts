import * as ts from "typescript"

import { isTrustedVocabularyDeclaration } from "./raw-state-vocabulary-policy.js"

export type LiteralEvidence = Readonly<{ readonly node: ts.Node; readonly member: string }>
type Evaluation = Readonly<{ readonly node: ts.Node; readonly value: string }>
type EvaluationContext = Readonly<{ readonly checker: ts.TypeChecker; readonly closed: ReadonlySet<string> }>

function unwrap(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression)
  ) return unwrap(expression.expression)
  return expression
}

function resolvedSymbol(expression: ts.Expression, checker: ts.TypeChecker): ts.Symbol | undefined {
  const candidate = unwrap(expression)
  const location = ts.isPropertyAccessExpression(candidate) ? candidate.name : candidate
  const symbol = checker.getSymbolAtLocation(location)
  return symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(symbol)
    : symbol
}

function initializer(declaration: ts.Declaration, checker: ts.TypeChecker): ts.Expression | undefined {
  if (isTrustedVocabularyDeclaration(declaration)) return undefined
  if (
    ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration) ||
    ts.isBindingElement(declaration)
  ) {
    return declaration.initializer
  }
  if (!ts.isShorthandPropertyAssignment(declaration)) return undefined
  const symbol = checker.getShorthandAssignmentValueSymbol(declaration)
  return symbol?.valueDeclaration === undefined ? undefined : initializer(symbol.valueDeclaration, checker)
}

function propertyName(name: ts.PropertyName, context: EvaluationContext): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  return ts.isComputedPropertyName(name) ? evaluateString(name.expression, context, new Set())?.value : undefined
}

function objectProperty(
  expression: ts.Expression,
  key: string,
  context: EvaluationContext,
  visited: ReadonlySet<ts.Symbol>,
): Evaluation | undefined {
  const candidate = unwrap(expression)
  if (ts.isObjectLiteralExpression(candidate)) {
    for (const property of candidate.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = objectProperty(property.expression, key, context, visited)
        if (spread !== undefined) return spread
      } else if (ts.isPropertyAssignment(property) && propertyName(property.name, context) === key) {
        return evaluateString(property.initializer, context, visited)
      }
    }
  }
  const symbol = resolvedSymbol(candidate, context.checker)
  if (symbol === undefined || visited.has(symbol)) return undefined
  const nextVisited = new Set(visited).add(symbol)
  for (const declaration of symbol.declarations ?? []) {
    const value = initializer(declaration, context.checker)
    if (value !== undefined) {
      const found = objectProperty(value, key, context, nextVisited)
      if (found !== undefined) return found
    }
  }
  return undefined
}

type ImplementedFunction =
  | ts.ArrowFunction
  | ts.ConstructorDeclaration
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.MethodDeclaration
  | ts.SetAccessorDeclaration

function isImplementedFunction(node: ts.Node): node is ImplementedFunction {
  return ts.isArrowFunction(node) || ts.isConstructorDeclaration(node) || ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) || ts.isGetAccessorDeclaration(node) || ts.isMethodDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
}

function returnedExpressions(declaration: ImplementedFunction): readonly ts.Expression[] {
  if (ts.isArrowFunction(declaration) && !ts.isBlock(declaration.body)) return [declaration.body]
  const values: ts.Expression[] = []
  if (declaration.body === undefined) return values
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression !== undefined) values.push(node.expression)
    else if (isImplementedFunction(node)) return
    else ts.forEachChild(node, visit)
  }
  visit(declaration.body)
  return values
}

function evaluateCall(
  expression: ts.CallExpression,
  context: EvaluationContext,
  visited: ReadonlySet<ts.Symbol>,
): Evaluation | undefined {
  const symbol = resolvedSymbol(expression.expression, context.checker)
  if (symbol !== undefined && visited.has(symbol)) return undefined
  const nextVisited = symbol === undefined ? visited : new Set(visited).add(symbol)
  const declaration = context.checker.getResolvedSignature(expression)?.declaration
  if (declaration === undefined || !isImplementedFunction(declaration)) return undefined
  for (const returned of returnedExpressions(declaration)) {
    const value = evaluateString(returned, context, nextVisited)
    if (value !== undefined) return value
  }
  return undefined
}

function evaluateString(
  expression: ts.Expression,
  context: EvaluationContext,
  visited: ReadonlySet<ts.Symbol>,
): Evaluation | undefined {
  const candidate = unwrap(expression)
  if (ts.isStringLiteralLike(candidate)) return { node: candidate, value: candidate.text }
  if (ts.isBinaryExpression(candidate) && candidate.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evaluateString(candidate.left, context, visited)
    const right = evaluateString(candidate.right, context, visited)
    return left === undefined || right === undefined ? undefined : { node: candidate, value: left.value + right.value }
  }
  if (ts.isElementAccessExpression(candidate) && candidate.argumentExpression !== undefined) {
    const key = evaluateString(candidate.argumentExpression, context, visited)?.value
    if (key !== undefined) return objectProperty(candidate.expression, key, context, visited)
  }
  if (ts.isCallExpression(candidate)) return evaluateCall(candidate, context, visited)
  const symbol = resolvedSymbol(candidate, context.checker)
  if (symbol === undefined || visited.has(symbol)) return undefined
  const nextVisited = new Set(visited).add(symbol)
  for (const declaration of symbol.declarations ?? []) {
    const value = initializer(declaration, context.checker)
    if (value === undefined) continue
    const evaluated = evaluateString(value, context, nextVisited)
    if (evaluated !== undefined) return evaluated
  }
  return undefined
}

export function literalEvidence(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  closed: ReadonlySet<string>,
): LiteralEvidence | undefined {
  const evaluated = evaluateString(expression, { checker, closed }, new Set())
  return evaluated !== undefined && closed.has(evaluated.value)
    ? { node: evaluated.node, member: evaluated.value }
    : undefined
}

export function collectionEvidence(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  closed: ReadonlySet<string>,
  visited: ReadonlySet<ts.Symbol> = new Set(),
): LiteralEvidence | undefined {
  const candidate = unwrap(expression)
  if (ts.isArrayLiteralExpression(candidate)) {
    for (const element of candidate.elements) {
      const evidence = ts.isSpreadElement(element)
        ? collectionEvidence(element.expression, checker, closed, visited)
        : literalEvidence(element, checker, closed)
      if (evidence !== undefined) return evidence
    }
    return undefined
  }
  if (ts.isNewExpression(candidate) && candidate.arguments?.[0] !== undefined) {
    return collectionEvidence(candidate.arguments[0], checker, closed, visited)
  }
  const symbol = resolvedSymbol(candidate, checker)
  if (symbol === undefined || visited.has(symbol)) return undefined
  const nextVisited = new Set(visited).add(symbol)
  for (const declaration of symbol.declarations ?? []) {
    const value = initializer(declaration, checker)
    if (value === undefined) continue
    const evidence = collectionEvidence(value, checker, closed, nextVisited)
    if (evidence !== undefined) return evidence
  }
  return undefined
}
