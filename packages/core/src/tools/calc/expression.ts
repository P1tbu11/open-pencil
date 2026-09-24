/**
 * Arithmetic expression evaluator for the `calc` tool.
 *
 * The grammar is deliberately the one the tool documents and nothing more: no
 * variables, constants, strings, member access, or non-deterministic
 * functions. Expressions arrive from a model, so the evaluator never compiles
 * input into JavaScript and exposes no host object.
 *
 *   expression := additive
 *   additive   := multiplicative (('+' | '-') multiplicative)*
 *   multiplicative := unary (('*' | '/' | '%') unary)*
 *   unary      := ('-' | '+') unary | power
 *   power      := primary ('**' unary)?
 *   primary    := number | '(' expression ')' | function '(' arguments ')'
 *
 * `**` is right-associative and binds tighter than a leading sign, so
 * `-2 ** 2` is `-4` as in Python and ordinary mathematical notation, rather
 * than the syntax error JavaScript raises.
 */

/** Functions the tool documents, with their accepted argument counts. */
const FUNCTIONS = {
  min: { arity: [1, Number.POSITIVE_INFINITY], apply: (args: number[]) => Math.min(...args) },
  max: { arity: [1, Number.POSITIVE_INFINITY], apply: (args: number[]) => Math.max(...args) },
  floor: { arity: [1, 1], apply: ([value]: number[]) => Math.floor(value) },
  ceil: { arity: [1, 1], apply: ([value]: number[]) => Math.ceil(value) },
  round: { arity: [1, 1], apply: ([value]: number[]) => Math.round(value) },
  abs: { arity: [1, 1], apply: ([value]: number[]) => Math.abs(value) },
  sqrt: { arity: [1, 1], apply: ([value]: number[]) => Math.sqrt(value) },
  pow: { arity: [2, 2], apply: ([base, exponent]: number[]) => base ** exponent }
} as const satisfies Record<
  string,
  { arity: readonly [number, number]; apply: (args: number[]) => number }
>

export type CalcFunction = keyof typeof FUNCTIONS

export const CALC_FUNCTIONS = Object.keys(FUNCTIONS) as CalcFunction[]

/** Raised for input the grammar rejects; the message reaches the caller. */
export class CalcSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalcSyntaxError'
  }
}

type TokenType = 'number' | 'identifier' | 'operator' | 'paren' | 'comma'

interface Token {
  readonly type: TokenType
  readonly value: string
  /** Zero-based offset in the source, used to point at the offending text. */
  readonly start: number
}

const OPERATORS = ['**', '+', '-', '*', '/', '%'] as const

// Decimal literals with an optional fraction and exponent: 1, 1.5, .5, 1e3.
const NUMBER_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*/

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    const character = source[index]
    if (/\s/.test(character)) {
      index += 1
      continue
    }
    if (character === '(' || character === ')') {
      tokens.push({ type: 'paren', value: character, start: index })
      index += 1
      continue
    }
    if (character === ',') {
      tokens.push({ type: 'comma', value: character, start: index })
      index += 1
      continue
    }
    const rest = source.slice(index)
    const operator = OPERATORS.find((candidate) => rest.startsWith(candidate))
    if (operator) {
      tokens.push({ type: 'operator', value: operator, start: index })
      index += operator.length
      continue
    }
    const number = NUMBER_PATTERN.exec(rest)?.[0]
    if (number) {
      tokens.push({ type: 'number', value: number, start: index })
      index += number.length
      continue
    }
    const identifier = IDENTIFIER_PATTERN.exec(rest)?.[0]
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier, start: index })
      index += identifier.length
      continue
    }
    throw new CalcSyntaxError(`Unexpected character '${character}' at position ${index + 1}`)
  }
  return tokens
}

class Parser {
  private index = 0

  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    if (this.tokens.length === 0) throw new CalcSyntaxError('Expression is empty')
    const value = this.additive()
    const extra = this.peek()
    if (extra) {
      throw new CalcSyntaxError(
        `Unexpected '${extra.value}' at position ${extra.start + 1}; expected end of expression`
      )
    }
    return value
  }

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private consumeOperator(...values: string[]): Token | undefined {
    const token = this.peek()
    if (token?.type === 'operator' && values.includes(token.value)) {
      this.index += 1
      return token
    }
    return undefined
  }

  private additive(): number {
    let left = this.multiplicative()
    let operator = this.consumeOperator('+', '-')
    while (operator) {
      const right = this.multiplicative()
      left = operator.value === '+' ? left + right : left - right
      operator = this.consumeOperator('+', '-')
    }
    return left
  }

  private multiplicative(): number {
    let left = this.unary()
    let operator = this.consumeOperator('*', '/', '%')
    while (operator) {
      const right = this.unary()
      if (operator.value === '*') left = left * right
      else if (operator.value === '/') left = left / right
      else left = left % right
      operator = this.consumeOperator('*', '/', '%')
    }
    return left
  }

  private unary(): number {
    const sign = this.consumeOperator('-', '+')
    if (sign) {
      const value = this.unary()
      return sign.value === '-' ? -value : value
    }
    return this.power()
  }

  private power(): number {
    const base = this.primary()
    // Right-associative, and the right side may carry its own sign.
    return this.consumeOperator('**') ? base ** this.unary() : base
  }

  private primary(): number {
    const token = this.peek()
    if (!token) throw new CalcSyntaxError('Expression ends after an operator')

    if (token.type === 'number') {
      this.index += 1
      return Number(token.value)
    }

    if (token.type === 'paren' && token.value === '(') {
      this.index += 1
      const value = this.additive()
      this.expectClosingParen()
      return value
    }

    if (token.type === 'identifier') {
      this.index += 1
      return this.call(token)
    }

    throw new CalcSyntaxError(`Unexpected '${token.value}' at position ${token.start + 1}`)
  }

  private call(name: Token): number {
    if (!(name.value in FUNCTIONS)) {
      throw new CalcSyntaxError(
        `Unknown function '${name.value}'; supported: ${CALC_FUNCTIONS.join(', ')}`
      )
    }
    const open = this.peek()
    if (open?.type !== 'paren' || open.value !== '(') {
      throw new CalcSyntaxError(`Expected '(' after '${name.value}'`)
    }
    this.index += 1

    const args: number[] = [this.additive()]
    while (this.peek()?.type === 'comma') {
      this.index += 1
      args.push(this.additive())
    }
    this.expectClosingParen()

    const { arity, apply } = FUNCTIONS[name.value as CalcFunction]
    const [minimum, maximum] = arity
    if (args.length < minimum || args.length > maximum) {
      throw new CalcSyntaxError(
        `'${name.value}' takes ${describeArity(minimum, maximum)}, received ${args.length}`
      )
    }
    return apply(args)
  }

  private expectClosingParen(): void {
    const token = this.peek()
    if (token?.type !== 'paren' || token.value !== ')') {
      throw new CalcSyntaxError(
        token ? `Expected ')' at position ${token.start + 1}` : "Expected ')' before end"
      )
    }
    this.index += 1
  }
}

function describeArity(minimum: number, maximum: number): string {
  if (minimum === maximum) return `${minimum} argument${minimum === 1 ? '' : 's'}`
  if (maximum === Number.POSITIVE_INFINITY) return `at least ${minimum} argument(s)`
  return `${minimum} to ${maximum} arguments`
}

/**
 * Evaluate an arithmetic expression. Throws `CalcSyntaxError` when the input
 * is outside the grammar; a well-formed expression may still return a
 * non-finite number, which the caller reports rather than the evaluator.
 */
export function evaluateExpression(source: string): number {
  return new Parser(tokenize(source)).parse()
}
