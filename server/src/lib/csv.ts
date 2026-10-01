/** Serialise rows to CSV. Cells starting with = + - @ are prefixed to defuse spreadsheet formula injection. */
export function toCsv(headers: string[], rows: (string | number | boolean | null | undefined | Date)[][]): string {
  const cell = (v: string | number | boolean | null | undefined | Date): string => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
