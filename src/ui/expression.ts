/**
 * Tiny, CSP-safe expression evaluator for UI bindings.
 *
 * We must NOT use `eval`/`new Function` — they are blocked by the Tauri desktop CSP. This is a
 * hand-written recursive-descent parser/evaluator supporting:
 *   numbers, strings, identifiers (incl. dotted like `self.health` and bracketed
 *   lookups like `vars['Gold Coins']`), `+ - * / %`,
 *   comparisons (`> >= < <= == !=`), `&& || !`, parentheses, and a ternary `cond ? a : b`.
 *
 * Identifiers resolve against a context: `vars` (project variables by name) and an optional
 * `self` record (the host object's instance data, for world-space UI). Unknown identifiers
 * resolve to `undefined`; the evaluator is total — it never throws — returning `undefined` on
 * malformed input so a bad binding degrades gracefully instead of crashing the HUD.
 */

export interface UIExprContext {
  vars: Record<string, unknown>;
  self?: Record<string, unknown>;
}

export type UIExprValue = number | string | boolean | undefined;

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

const OPS = [
  '===',
  '!==',
  '==',
  '!=',
  '>=',
  '<=',
  '&&',
  '||',
  '>',
  '<',
  '+',
  '-',
  '*',
  '/',
  '%',
  '!',
  '(',
  ')',
  '?',
  ':',
  '.',
  '[',
  ']',
];

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let str = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          str += src[j + 1];
          j += 2;
          continue;
        }
        str += src[j];
        j += 1;
      }
      if (j >= src.length) return null; // unterminated string
      tokens.push({ t: 'str', v: str });
      i = j + 1;
      continue;
    }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i;
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j += 1;
      tokens.push({ t: 'num', v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      tokens.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ t: 'op', v: op });
      i += op.length;
      continue;
    }
    return null; // unknown character
  }
  return tokens;
}

/** Recursive-descent parser → evaluator. Operates directly on the token stream. */
class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private ctx: UIExprContext) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private eatOp(v: string): boolean {
    const tk = this.peek();
    if (tk && tk.t === 'op' && tk.v === v) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  parse(): UIExprValue {
    const value = this.ternary();
    if (this.pos !== this.tokens.length) return undefined; // trailing garbage
    return value;
  }

  private ternary(): UIExprValue {
    const cond = this.or();
    if (this.eatOp('?')) {
      const a = this.ternary();
      if (!this.eatOp(':')) return undefined;
      const b = this.ternary();
      return truthy(cond) ? a : b;
    }
    return cond;
  }

  private or(): UIExprValue {
    let left = this.and();
    while (this.eatOp('||')) {
      const right = this.and();
      left = truthy(left) ? left : right;
    }
    return left;
  }

  private and(): UIExprValue {
    let left = this.equality();
    while (this.eatOp('&&')) {
      const right = this.equality();
      left = truthy(left) ? right : left;
    }
    return left;
  }

  private equality(): UIExprValue {
    let left = this.comparison();
    for (;;) {
      if (this.eatOp('==') || this.eatOp('===')) left = looseEq(left, this.comparison());
      else if (this.eatOp('!=') || this.eatOp('!==')) left = !looseEq(left, this.comparison());
      else break;
    }
    return left;
  }

  private comparison(): UIExprValue {
    let left = this.additive();
    for (;;) {
      if (this.eatOp('>=')) left = num(left) >= num(this.additive());
      else if (this.eatOp('<=')) left = num(left) <= num(this.additive());
      else if (this.eatOp('>')) left = num(left) > num(this.additive());
      else if (this.eatOp('<')) left = num(left) < num(this.additive());
      else break;
    }
    return left;
  }

  private additive(): UIExprValue {
    let left = this.multiplicative();
    for (;;) {
      if (this.eatOp('+')) {
        const right = this.multiplicative();
        // string concat if either side is a string
        left = typeof left === 'string' || typeof right === 'string' ? `${str(left)}${str(right)}` : num(left) + num(right);
      } else if (this.eatOp('-')) left = num(left) - num(this.multiplicative());
      else break;
    }
    return left;
  }

  private multiplicative(): UIExprValue {
    let left = this.unary();
    for (;;) {
      if (this.eatOp('*')) left = num(left) * num(this.unary());
      else if (this.eatOp('/')) left = num(left) / num(this.unary());
      else if (this.eatOp('%')) left = num(left) % num(this.unary());
      else break;
    }
    return left;
  }

  private unary(): UIExprValue {
    if (this.eatOp('!')) return !truthy(this.unary());
    if (this.eatOp('-')) return -num(this.unary());
    return this.primary();
  }

  private primary(): UIExprValue {
    const tk = this.peek();
    if (!tk) return undefined;
    if (this.eatOp('(')) {
      const value = this.ternary();
      if (!this.eatOp(')')) return undefined;
      return value;
    }
    if (tk.t === 'num') {
      this.pos += 1;
      return tk.v;
    }
    if (tk.t === 'str') {
      this.pos += 1;
      return tk.v;
    }
    if (tk.t === 'id') {
      this.pos += 1;
      // Path: id ('.' id | '[' string ']')*
      const path = [tk.v];
      for (;;) {
        if (this.eatOp('.')) {
          const next = this.peek();
          if (!next || next.t !== 'id') return undefined;
          path.push(next.v);
          this.pos += 1;
          continue;
        }
        if (this.eatOp('[')) {
          const next = this.peek();
          if (!next || next.t !== 'str') return undefined;
          path.push(next.v);
          this.pos += 1;
          if (!this.eatOp(']')) return undefined;
          continue;
        }
        break;
      }
      return this.resolve(path);
    }
    return undefined;
  }

  private resolve(path: string[]): UIExprValue {
    const root = path[0];
    if (path.length === 1 && root === 'true') return true;
    if (path.length === 1 && root === 'false') return false;
    if (root === 'vars' && path.length > 1) {
      return coerce(this.ctx.vars[path.slice(1).join('.')]);
    }
    if (root === 'self' && path.length > 1) {
      return coerce(this.ctx.self?.[path.slice(1).join('.')]);
    }
    return coerce(this.ctx.vars[path.join('.')]);
  }
}

function coerce(v: unknown): UIExprValue {
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.join(', ');
  return undefined;
}

function num(v: UIExprValue): number {
  return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v ?? 0) || 0;
}
function str(v: UIExprValue): string {
  return v === undefined ? '' : String(v);
}
function truthy(v: UIExprValue): boolean {
  return typeof v === 'number' ? v !== 0 : Boolean(v);
}
function looseEq(a: UIExprValue, b: UIExprValue): boolean {
  if (typeof a === 'number' || typeof b === 'number') return num(a) === num(b);
  return a === b;
}

/** Evaluate a binding expression against a context. Returns `undefined` on empty/malformed input. */
export function evalExpression(src: string, ctx: UIExprContext): UIExprValue {
  const trimmed = src?.trim();
  if (!trimmed) return undefined;
  if (Object.prototype.hasOwnProperty.call(ctx.vars, trimmed)) return coerce(ctx.vars[trimmed]);
  const tokens = tokenize(src);
  if (!tokens || tokens.length === 0) return undefined;
  return new Parser(tokens, ctx).parse();
}
