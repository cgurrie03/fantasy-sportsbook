// Quote delimiters and neutralize spreadsheet formulas in user-controlled text.
// Numeric values remain numeric, including negative profit.
export function csvCell(value: string | number) {
  const text = typeof value === "string" && /^[=+\-@\t\r\n]/.test(value)
    ? "'" + value : String(value);
  return '"' + text.replaceAll('"', '""') + '"';
}
