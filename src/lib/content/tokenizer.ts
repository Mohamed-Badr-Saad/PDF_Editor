// Minimal PDF content-stream parser. It keeps byte offsets for every operator
// so unchanged operators can be written back byte-for-byte.

export type Operand =
  | number
  | boolean
  | null
  | { t: 'name'; v: string }
  | { t: 'str'; bytes: Uint8Array; hex: boolean }
  | { t: 'arr'; v: Operand[] }
  | { t: 'dict'; v: Record<string, Operand> };

export interface Op {
  op: string;
  args: Operand[];
  /** Byte range in the content stream, covering operands and operator. */
  start: number;
  end: number;
}

const WS = new Uint8Array(256);
[0, 9, 10, 12, 13, 32].forEach((c) => (WS[c] = 1));
const DELIM = new Uint8Array(256);
'()<>[]{}/%'.split('').forEach((c) => (DELIM[c.charCodeAt(0)] = 1));

const isRegular = (c: number) => !WS[c] && !DELIM[c];

export function tokenize(data: Uint8Array): Op[] {
  const ops: Op[] = [];
  let pos = 0;
  const n = data.length;
  let args: Operand[] = [];
  let argStart = -1;

  const skipWs = () => {
    for (;;) {
      while (pos < n && WS[data[pos]]) pos++;
      if (pos < n && data[pos] === 0x25 /* % */) {
        while (pos < n && data[pos] !== 10 && data[pos] !== 13) pos++;
      } else break;
    }
  };

  const readLiteral = (): Uint8Array => {
    // assumes data[pos] === '('
    pos++;
    let depth = 1;
    const out: number[] = [];
    while (pos < n) {
      const c = data[pos++];
      if (c === 0x5c /* \ */) {
        const e = data[pos++];
        switch (e) {
          case 0x6e: out.push(10); break; // n
          case 0x72: out.push(13); break; // r
          case 0x74: out.push(9); break; // t
          case 0x62: out.push(8); break; // b
          case 0x66: out.push(12); break; // f
          case 0x28: case 0x29: case 0x5c: out.push(e); break;
          case 13: if (data[pos] === 10) pos++; break; // line continuation
          case 10: break;
          default:
            if (e >= 0x30 && e <= 0x37) {
              let v = e - 0x30;
              for (let k = 0; k < 2 && data[pos] >= 0x30 && data[pos] <= 0x37; k++) v = v * 8 + (data[pos++] - 0x30);
              out.push(v & 255);
            } else if (e !== undefined) out.push(e);
        }
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x29) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return Uint8Array.from(out);
  };

  const readHex = (): Uint8Array => {
    pos++; // <
    const digits: number[] = [];
    while (pos < n && data[pos] !== 0x3e) {
      const c = data[pos++];
      const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1;
      if (v >= 0) digits.push(v);
    }
    pos++; // >
    if (digits.length % 2) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = digits[2 * i] * 16 + digits[2 * i + 1];
    return out;
  };

  const readName = (): string => {
    pos++; // /
    let s = '';
    while (pos < n && isRegular(data[pos])) {
      if (data[pos] === 0x23 && pos + 2 < n) {
        s += String.fromCharCode(parseInt(String.fromCharCode(data[pos + 1], data[pos + 2]), 16));
        pos += 3;
      } else s += String.fromCharCode(data[pos++]);
    }
    return s;
  };

  const readWord = (): string => {
    let s = '';
    while (pos < n && isRegular(data[pos])) s += String.fromCharCode(data[pos++]);
    return s;
  };

  const readObject = (): Operand | { kw: string } | undefined => {
    skipWs();
    if (pos >= n) return undefined;
    const c = data[pos];
    if (c === 0x28) return { t: 'str', bytes: readLiteral(), hex: false };
    if (c === 0x2f) return { t: 'name', v: readName() };
    if (c === 0x5b) {
      pos++;
      const v: Operand[] = [];
      for (;;) {
        skipWs();
        if (pos >= n) break;
        if (data[pos] === 0x5d) {
          pos++;
          break;
        }
        const o = readObject();
        if (o === undefined) break;
        if (o !== null && typeof o === 'object' && 'kw' in o) continue; // stray keyword inside array
        v.push(o);
      }
      return { t: 'arr', v };
    }
    if (c === 0x3c) {
      if (data[pos + 1] === 0x3c) {
        pos += 2;
        const v: Record<string, Operand> = {};
        for (;;) {
          skipWs();
          if (pos >= n) break;
          if (data[pos] === 0x3e && data[pos + 1] === 0x3e) {
            pos += 2;
            break;
          }
          const k = readObject();
          const val = readObject();
          if (k && typeof k === 'object' && 't' in k && k.t === 'name' && val !== undefined && !(val && typeof val === 'object' && 'kw' in val)) {
            v[k.v] = val as Operand;
          }
        }
        return { t: 'dict', v };
      }
      return { t: 'str', bytes: readHex(), hex: true };
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      pos++;
      return { kw: String.fromCharCode(c) };
    }
    const w = readWord();
    if (!w) {
      pos++;
      return { kw: '' };
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return parseFloat(w);
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    return { kw: w };
  };

  while (pos < n) {
    skipWs();
    if (pos >= n) break;
    const tokStart = pos;
    const o = readObject();
    if (o === undefined) break;
    if (o !== null && typeof o === 'object' && 'kw' in o) {
      const kw = o.kw;
      if (!kw) continue;
      if (kw === 'BI') {
        // Inline image: BI <dict entries> ID <binary> EI
        const start = argStart >= 0 ? argStart : tokStart;
        const dict: Record<string, Operand> = {};
        for (;;) {
          const k = readObject();
          if (k === undefined) break;
          if (k && typeof k === 'object' && 'kw' in k) {
            if (k.kw === 'ID') break;
            continue;
          }
          const v = readObject();
          if (k && typeof k === 'object' && 't' in k && k.t === 'name' && v !== undefined && !(v && typeof v === 'object' && 'kw' in v)) {
            dict[k.v] = v as Operand;
          }
        }
        pos++; // single whitespace after ID
        // Find "EI" surrounded by whitespace.
        let end = n;
        for (let i = pos; i < n - 1; i++) {
          if (data[i] === 0x45 && data[i + 1] === 0x49 && (i === 0 || WS[data[i - 1]]) && (i + 2 >= n || WS[data[i + 2]] || DELIM[data[i + 2]])) {
            end = i + 2;
            break;
          }
        }
        pos = end;
        ops.push({ op: 'BI', args: [{ t: 'dict', v: dict }], start, end });
      } else {
        ops.push({ op: kw, args, start: argStart >= 0 ? argStart : tokStart, end: pos });
      }
      args = [];
      argStart = -1;
    } else {
      if (argStart < 0) argStart = tokStart;
      args.push(o);
    }
  }
  return ops;
}

// ---------- Serialisation helpers ----------

const hexByte = (b: number) => (b < 16 ? '0' : '') + b.toString(16);

export function hexString(bytes: Uint8Array | number[]): string {
  let s = '<';
  for (const b of bytes) s += hexByte(b);
  return s + '>';
}

export function num(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
