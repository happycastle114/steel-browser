import * as ts from "typescript"

export type SequenceProvenanceContext = Readonly<{
  readonly checker: ts.TypeChecker
  readonly sequenceSymbols: Set<ts.Symbol>
  readonly sequenceTypes: readonly ts.Type[]
}>

type Bindings = ReadonlyMap<ts.Symbol, ts.Expression>
const STRING_CONVERSION = "String"

function containsSequenceType(type: ts.Type, context: SequenceProvenanceContext): boolean {
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return false
  if (type.isUnion()) return type.types.some((member) => containsSequenceType(member, context))
  return context.sequenceTypes.some((sequenceType) => context.checker.isTypeAssignableTo(type, sequenceType))
}

function resolvedSymbol(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(node)
  return symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(symbol)
    : symbol
}

function isGlobalStringConversion(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  if (!ts.isIdentifier(expression) || expression.text !== STRING_CONVERSION) return false
  const symbol = checker.getSymbolAtLocation(expression)
  return symbol === undefined || (symbol.declarations ?? []).every((item) => item.getSourceFile().isDeclarationFile)
}

function declarationInitializer(declaration: ts.Declaration): ts.Expression | undefined {
  if (
    ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration) ||
    ts.isBindingElement(declaration)
  ) {
    return declaration.initializer
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

function returnExpressions(declaration: ImplementedFunction): readonly ts.Expression[] {
  if (ts.isArrowFunction(declaration) && !ts.isBlock(declaration.body)) return [declaration.body]
  if (declaration.body === undefined) return []
  const expressions: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression !== undefined) expressions.push(node.expression)
    else if (isImplementedFunction(node)) return
    else ts.forEachChild(node, visit)
  }
  visit(declaration.body)
  return expressions
}

function parameterBindings(
  declaration: ImplementedFunction,
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): Bindings {
  const bindings = new Map<ts.Symbol, ts.Expression>()
  declaration.parameters.forEach((parameter, index) => {
    const argument = call.arguments[index]
    const symbol = resolvedSymbol(parameter.name, checker)
    if (argument !== undefined && symbol !== undefined) bindings.set(symbol, argument)
  })
  return bindings
}

function expressionHasSequence(
  expression: ts.Expression,
  context: SequenceProvenanceContext,
  bindings: Bindings,
  visited: ReadonlySet<ts.Node>,
): boolean {
  if (visited.has(expression)) return false
  const nextVisited = new Set(visited).add(expression)
  if (containsSequenceType(context.checker.getTypeAtLocation(expression), context)) return true
  if (
    ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression) ||
    ts.isAwaitExpression(expression)
  ) return expressionHasSequence(expression.expression, context, bindings, nextVisited)
  if (ts.isConditionalExpression(expression)) {
    return expressionHasSequence(expression.whenTrue, context, bindings, nextVisited) ||
      expressionHasSequence(expression.whenFalse, context, bindings, nextVisited)
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return expressionHasSequence(expression.left, context, bindings, nextVisited) ||
      expressionHasSequence(expression.right, context, bindings, nextVisited)
  }
  if (ts.isTemplateExpression(expression)) {
    return expression.templateSpans.some((span) =>
      expressionHasSequence(span.expression, context, bindings, nextVisited)
    )
  }
  if (ts.isCallExpression(expression)) {
    if (isGlobalStringConversion(expression.expression, context.checker)) {
      const argument = expression.arguments[0]
      return argument !== undefined && expressionHasSequence(argument, context, bindings, nextVisited)
    }
    const declaration = context.checker.getResolvedSignature(expression)?.declaration
    if (declaration === undefined || !isImplementedFunction(declaration)) return false
    const callBindings = parameterBindings(declaration, expression, context.checker)
    return returnExpressions(declaration).some((returned) =>
      expressionHasSequence(returned, context, callBindings, nextVisited)
    )
  }
  const location = ts.isPropertyAccessExpression(expression) ? expression.name : expression
  const symbol = resolvedSymbol(location, context.checker)
  if (symbol === undefined) return false
  if (context.sequenceSymbols.has(symbol)) return true
  const bound = bindings.get(symbol)
  if (bound !== undefined) return expressionHasSequence(bound, context, bindings, nextVisited)
  return (symbol.declarations ?? []).some((declaration) => {
    const value = declarationInitializer(declaration)
    return value !== undefined && expressionHasSequence(value, context, bindings, nextVisited)
  })
}

export function hasSequenceProvenance(
  expression: ts.Expression,
  context: SequenceProvenanceContext,
): boolean {
  return expressionHasSequence(expression, context, new Map(), new Set())
}

export function propagateSequenceParameters(program: ts.Program, context: SequenceProvenanceContext): void {
  let changed = true
  while (changed) {
    changed = false
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const declaration = context.checker.getResolvedSignature(node)?.declaration
        declaration?.parameters.forEach((parameter, index) => {
          const argument = node.arguments[index]
          const symbol = resolvedSymbol(parameter.name, context.checker)
          if (
            argument !== undefined && symbol !== undefined && !context.sequenceSymbols.has(symbol) &&
            hasSequenceProvenance(argument, context)
          ) {
            context.sequenceSymbols.add(symbol)
            changed = true
          }
        })
      }
      ts.forEachChild(node, visit)
    }
    program.getSourceFiles().filter((source) => !source.isDeclarationFile).forEach(visit)
  }
}
