export const GATE_COMMANDS = [
  ["npm", "run", "check:managed"],
  ["npm", "run", "test"],
  ["npm", "run", "build"],
  ["node", "scripts/upstream-sync/verify-license.mjs"],
  ["git", "diff", "--check"],
]

const SHELL_OPERATORS = new Set([";", "&&", "||", "&", "|", "(", ")", "{", "}"])
const COMMAND_KEYWORDS = new Set(["if", "then", "else", "do", "!"])
const GATE_OUTCOME = Object.freeze({
  ZERO: Symbol("zero"),
  NONZERO: Symbol("nonzero"),
  UNKNOWN: Symbol("unknown"),
})

function tokenizeShell(line) {
  const tokens = []
  let word = ""
  let quote = ""
  const flush = () => {
    if (word !== "") tokens.push({ type: "word", value: word }), (word = "")
  }
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const next = line[index + 1]
    if (quote === "'") {
      if (character === "'") quote = ""
      else word += character
      continue
    }
    if (quote === '"') {
      if (character === '"') quote = ""
      else if (character === "\\" && next !== undefined) word += next, (index += 1)
      else word += character
      continue
    }
    if (character === "#" && word === "") break
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character === "\\" && next !== undefined) {
      word += next
      index += 1
      continue
    }
    if (/\s/u.test(character)) {
      flush()
      continue
    }
    const operator = character + (next === "&" || next === "|" ? next : "")
    if (SHELL_OPERATORS.has(operator)) {
      flush()
      tokens.push({ type: "operator", value: operator })
      if (operator.length === 2) index += 1
      continue
    }
    word += character
  }
  flush()
  return tokens
}

function commandOutcome(tokens) {
  while (tokens.at(-1)?.value === ";") tokens = tokens.slice(0, -1)
  const values = tokens.filter((token) => token.type === "word").map((token) => token.value)
  if (values.length === 0) return GATE_OUTCOME.UNKNOWN
  if (values[0] === "true" || values[0] === ":") return GATE_OUTCOME.ZERO
  if (values[0] === "false") return GATE_OUTCOME.NONZERO
  if (values[0] === "exit" || values[0] === "return") {
    const status = values[1]
    return status === "0" ? GATE_OUTCOME.ZERO : status !== undefined && /^[1-9][0-9]*$/u.test(status) ? GATE_OUTCOME.NONZERO : GATE_OUTCOME.UNKNOWN
  }
  if (tokens[0].value === "{" || tokens[0].value === "(") {
    const close = tokens.at(-1)?.value
    if ((tokens[0].value === "{" && close === "}") || (tokens[0].value === "(" && close === ")")) return commandOutcome(tokens.slice(1, -1))
  }
  const separators = tokens.reduce((indexes, token, index) => token.value === ";" ? [...indexes, index] : indexes, [])
  if (separators.length > 0) return commandOutcome(tokens.slice(separators.at(-1) + 1))
  return GATE_OUTCOME.UNKNOWN
}

function findGate(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index - 1]?.type === "word") continue
    for (const command of GATE_COMMANDS) {
      if (command.every((word, offset) => tokens[index + offset]?.value === word)) return { index, length: command.length }
    }
  }
  return undefined
}

function gateIsNeutralized(line) {
  const tokens = tokenizeShell(line)
  for (let offset = 0; offset < tokens.length; offset += 1) {
    const gate = findGate(tokens.slice(offset))
    if (gate === undefined) return false
    gate.index += offset
    const end = gate.index + gate.length
    const next = tokens[end]
    const operator = next?.value === ")" || next?.value === "}" ? tokens[end + 1] : next
    if (operator?.value === "&&" || operator?.value === "&" || operator?.value === "|") return true
    if (operator?.value === "||") {
      const branch = tokens.slice(tokens.indexOf(operator) + 1)
      if ((branch[0]?.value === "{" || branch[0]?.value === "(") && branch.at(-1)?.value !== (branch[0].value === "{" ? "}" : ")")) return false
      if (commandOutcome(branch) !== GATE_OUTCOME.NONZERO) return true
    }
    offset = end
  }
  return false
}

function functionGateNames(candidate) {
  const names = new Set()
  const definition = /(?:^|[;\n])\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*\))?\s*\{([\s\S]*?)\}/gmu
  for (const match of candidate.matchAll(definition)) {
    if (findGate(tokenizeShell(match[2])) !== undefined) names.add(match[1])
  }
  return names
}

function functionCallIsNeutralized(line, names) {
  const tokens = tokenizeShell(line)
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index - 1]?.type === "word" || !names.has(tokens[index].value)) continue
    const operator = tokens[index + 1]
    if (operator?.value !== "||" && operator?.value !== "&&") continue
    return commandOutcome(tokens.slice(index + 2)) !== GATE_OUTCOME.NONZERO
  }
  return false
}

export function hasGateCommand(candidate, command) {
  return candidate.split("\n").some((line) => tokenizeShell(line).some((token, index, tokens) => {
    if (tokens[index - 1]?.type === "word" && !COMMAND_KEYWORDS.has(tokens[index - 1].value)) return false
    return token.value === command[0] && command.every((word, offset) => tokens[index + offset]?.value === word)
  }))
}

export function verifyFailClosedGates(candidate) {
  const normalized = candidate.replace(/\\\r?\n[ \t]*/gu, " ")
  const functionNames = functionGateNames(candidate)
  if (functionNames.size > 0 || normalized.split("\n").some((line) => /(?:^|[;{])\s*(?:if|while|until)\b[^;\n]*(?:npm run (?:check:managed|test|build)|node scripts\/upstream-sync\/verify-license\.mjs|git diff --check)/u.test(line))) {
    throw new Error("candidate script contains a failure neutralizer")
  }
  const lines = []
  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim()
    if (/^(?:\|\||&&|&|\|)\s*/u.test(line) && lines.length > 0) lines[lines.length - 1] += ` ${line}`
    else lines.push(rawLine)
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (gateIsNeutralized(line) || functionCallIsNeutralized(line, functionNames)) throw new Error("candidate script contains a failure neutralizer")
    if (/\|\|\s*\{/u.test(line) && !/\}/u.test(line)) {
      let compound = line
      while (index + 1 < lines.length && !/\}/u.test(compound)) compound += ` ; ${lines[++index]}`
      if (gateIsNeutralized(compound)) throw new Error("candidate script contains a failure neutralizer")
    }
  }
}
