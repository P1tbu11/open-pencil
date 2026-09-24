import { describe, expect, test } from 'bun:test'

import {
  CALC_FUNCTIONS,
  CalcSyntaxError,
  evaluateExpression
} from '@open-pencil/core/tools/calc/expression'

describe('calc expression evaluator', () => {
  test.each([
    ['844 - 56 - 96 - 82', 610],
    ['1440 * 8 / 12', 960],
    ['(952 - 16) / 2', 468],
    ['  8   *   4  ', 32],
    ['2 + 2 * 2', 6],
    ['(2 + 2) * 2', 8],
    ['7 / 2', 3.5],
    ['10 % 3', 1],
    ['-10 % 3', -1],
    ['1e3', 1000],
    ['1E3 + 1', 1001],
    ['.5 + 1', 1.5],
    ['1.', 1],
    ['2.5e-2', 0.025]
  ])('evaluates %s', (expression, expected) => {
    expect(evaluateExpression(expression)).toBe(expected)
  })

  test.each([
    ['-5', -5],
    ['+5', 5],
    ['--5', 5],
    ['3 - -2', 5],
    ['3 * -2', -6],
    ['-(2 + 3)', -5]
  ])('applies the sign in %s', (expression, expected) => {
    expect(evaluateExpression(expression)).toBe(expected)
  })

  describe('exponentiation', () => {
    test('is right-associative', () => {
      expect(evaluateExpression('2 ** 3 ** 2')).toBe(512)
    })

    test('binds tighter than a leading sign, as in ordinary notation', () => {
      expect(evaluateExpression('-2 ** 2')).toBe(-4)
      expect(evaluateExpression('(-2) ** 2')).toBe(4)
    })

    test('binds tighter than multiplication and accepts a signed exponent', () => {
      expect(evaluateExpression('3 * 2 ** 3')).toBe(24)
      expect(evaluateExpression('2 ** -2')).toBe(0.25)
    })
  })

  describe('functions', () => {
    test.each([
      ['floor(390 * 0.6)', 234],
      ['ceil(1.2)', 2],
      ['round(2.5)', 3],
      ['round(-2.5)', -2],
      ['abs(-4)', 4],
      ['sqrt(16)', 4],
      ['pow(2, 10)', 1024],
      ['min(3, 1, 2)', 1],
      ['max(3, 1, 2)', 3],
      ['min(3)', 3],
      ['max(1 + 1, 3 - 2)', 2],
      ['floor(min(4.7, 9))', 4]
    ])('evaluates %s', (expression, expected) => {
      expect(evaluateExpression(expression)).toBe(expected)
    })

    test('rejects a wrong argument count', () => {
      expect(() => evaluateExpression('round(2.345, 2)')).toThrow(/takes 1 argument, received 2/)
      expect(() => evaluateExpression('pow(2)')).toThrow(/takes 2 arguments, received 1/)
    })

    test('names the supported functions when one is unknown', () => {
      expect(() => evaluateExpression('sin(0)')).toThrow(/Unknown function 'sin'/)
      for (const name of CALC_FUNCTIONS) {
        expect(() => evaluateExpression('sin(0)')).toThrow(new RegExp(`\\b${name}\\b`))
      }
    })
  })

  describe('results outside the real numbers', () => {
    test.each([
      ['1 / 0', Number.POSITIVE_INFINITY],
      ['-1 / 0', Number.NEGATIVE_INFINITY]
    ])('returns %s as a non-finite number for the caller to report', (expression, expected) => {
      expect(evaluateExpression(expression)).toBe(expected)
    })

    test.each(['0 / 0', 'sqrt(-1)', '0 % 0'])('returns NaN for %s', (expression) => {
      expect(evaluateExpression(expression)).toBeNaN()
    })
  })

  describe('input outside the grammar', () => {
    test.each([
      ['', 'Expression is empty'],
      ['   ', 'Expression is empty'],
      ['1 +', 'Expression ends after an operator'],
      ['(1 + 2', "Expected ')' before end"],
      ['1 + 2)', "Unexpected ')'"],
      ['1 2', "Unexpected '2'"],
      ['5!', "Unexpected character '!'"],
      ['1 ; 2', "Unexpected character ';'"],
      ['1_000 + 1', "Unexpected '_000'"],
      ['2 < 3', "Unexpected character '<'"],
      ['"a" + "b"', "Unexpected character '\"'"],
      ['[1,2][0]', "Unexpected character '['"],
      ['a.b', "Unexpected character '.'"],
      ['x + 1', "Unknown function 'x'"],
      ['PI', "Unknown function 'PI'"],
      ['random()', "Unknown function 'random'"],
      ['3 and 4', "Unexpected 'and'"],
      ['if(1, 2, 3)', "Unknown function 'if'"],
      ['pow(2, 10', "Expected ')' before end"],
      ['floor 1', "Expected '(' after 'floor'"]
    ])('rejects %s', (expression, message) => {
      expect(() => evaluateExpression(expression)).toThrow(CalcSyntaxError)
      expect(() => evaluateExpression(expression)).toThrow(message)
    })

    test('reports the position of the offending character', () => {
      expect(() => evaluateExpression('12 + $')).toThrow('position 6')
    })
  })

  test('evaluates without reaching host globals', () => {
    for (const expression of [
      'constructor',
      'globalThis',
      'this',
      'process',
      'Math',
      'Function("return 1")()',
      '(function(){return 1})()',
      '__proto__'
    ]) {
      expect(() => evaluateExpression(expression)).toThrow(CalcSyntaxError)
    }
  })
})
