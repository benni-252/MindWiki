/** „1.10.0“ ist neuer als „1.9.2“; ein führendes „v“ wird ignoriert. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string): number[] =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[.-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0)
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}
