import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/countries.ts', 'src/currency.ts', 'src/time.ts', 'src/tax.ts', 'src/laws.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  platform: 'neutral',
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
  treeshake: true,
});
