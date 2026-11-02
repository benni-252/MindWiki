import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Einige Tests schreiben echte SQLite-Dateien. Auf den Windows-Rechnern von GitHub ist die
    // Festplatte manchmal sehr langsam (ein Test brauchte dort einmal 0,3 s, einmal über 5 s) –
    // das Standardlimit von 5 s reicht dafür nicht.
    testTimeout: 30_000
  }
})
