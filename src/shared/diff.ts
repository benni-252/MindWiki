// Zeilenweiser Vergleich (längste gemeinsame Teilfolge) – für den Vergleich von Entwurf und Original.

export interface DiffLine {
  kind: 'same' | 'added' | 'removed'
  text: string
}

export function diffLines(before: string[], after: string[]): DiffLine[] {
  const n = before.length
  const m = after.length
  // lcs[i][j] = Länge der gemeinsamen Teilfolge von before[i..] und after[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ kind: 'same', text: before[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'removed', text: before[i++] })
    } else {
      out.push({ kind: 'added', text: after[j++] })
    }
  }
  while (i < n) out.push({ kind: 'removed', text: before[i++] })
  while (j < m) out.push({ kind: 'added', text: after[j++] })
  return out
}
