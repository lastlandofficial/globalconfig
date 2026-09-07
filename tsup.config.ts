import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { 'check/index': 'src/check/index.ts', 'check/cli': 'src/check/cli.ts' },
    format: ['esm', 'cjs'], dts: true, target: 'node20', platform: 'node',
    splitting: true, sourcemap: true, external: ['playwright', '@playwright/test', '@axe-core/playwright'],
  },
  {
    entry: ['src/index.ts', 'src/countries.ts', 'src/currency.ts', 'src/time.ts', 'src/tax.ts', 'src/laws.ts'],
    format: ['esm', 'cjs'], target: 'es2022', platform: 'neutral', dts: true,
    clean: false, sourcemap: true, splitting: true, treeshake: true,
  },
  {
    entry: {
      'ui/index': 'src/ui/index.ts', 'ui/browser/index': 'src/ui/browser/index.ts',
      'ui/playwright/index': 'src/ui/playwright/index.ts', 'ui/native/index': 'src/ui/native/index.ts',
    },
    format: ['esm', 'cjs'], dts: true, sourcemap: true, splitting: false,
    target: 'es2022', external: ['playwright', '@axe-core/playwright'],
  },
  {
    entry: { 'ui/react/index': 'src/ui/react/index.tsx' }, format: ['esm', 'cjs'], dts: true,
    sourcemap: true, splitting: false, target: 'es2022', external: ['react', 'react/jsx-runtime'],
    banner: { js: '"use client";' },
  },
  {
    entry: { 'ui/cli/index': 'src/ui/cli/index.ts' }, format: ['esm'], target: 'node20',
    splitting: true, sourcemap: true, external: ['playwright', '@axe-core/playwright'],
  },
]);
