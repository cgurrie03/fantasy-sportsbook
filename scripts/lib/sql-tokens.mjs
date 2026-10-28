// Compare formatting differences while preserving every literal and identifier.
// This does not execute or rewrite the inspected SQL.
export function sqlTokens(source) {
  const tokens = [];
  for (let i = 0; i < source.length;) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source.startsWith("--", i)) {
      const end = source.indexOf("\n", i); i = end < 0 ? source.length : end; continue;
    }
    if (source.startsWith("/*", i)) {
      let depth = 1; i += 2;
      while (i < source.length && depth) {
        if (source.startsWith("/*", i)) { depth++; i += 2; }
        else if (source.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error("Unterminated SQL comment");
      continue;
    }
    const dollar = /^\$[\w]*\$/.exec(source.slice(i));
    if (dollar) {
      const end = source.indexOf(dollar[0], i + dollar[0].length);
      if (end < 0) throw new Error("Unterminated SQL dollar literal");
      tokens.push(source.slice(i, end + dollar[0].length)); i = end + dollar[0].length; continue;
    }
    if (source[i] === "'" || source[i] === '"') {
      const start = i, quote = source[i++];
      const escaped = quote === "'" && /[eE]/.test(source[start - 1] ?? "") &&
        !/[\w]/.test(source[start - 2] ?? "");
      let closed = false;
      while (i < source.length) {
        if (escaped && source[i] === "\\") { i += 2; continue; }
        if (source[i] === quote) {
          if (source[i + 1] === quote) { i += 2; continue; }
          i++; closed = true; break;
        }
        i++;
      }
      if (!closed) throw new Error("Unterminated SQL quoted token");
      tokens.push(source.slice(start, i)); continue;
    }
    const word = /^[\w$]+/.exec(source.slice(i));
    if (word) { tokens.push(word[0].toLowerCase()); i += word[0].length; continue; }
    tokens.push(source[i++]);
  }
  return tokens;
}
