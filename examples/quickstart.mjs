import { createGlobalConfig, convertCurrency, convertLocalTime, calculateTax } from '../dist/index.js';

const india = createGlobalConfig({ country: 'IN' });
console.log(india.currency.format('123456.78'));
console.log(india.time.convert('2026-09-01T12:00:00Z'));
console.log(india.tax.calculate({ country: 'IN', amount: '1000', rate: '18', supply: 'intra-state' }));

// Illustrative fixtures, not current market quotes.
console.log(convertCurrency({ amount: '100', from: 'USD', to: 'JPY', rates: {
  base: 'USD', rates: { INR: '83.25', JPY: '150' }, asOf: '2026-09-01T00:00:00Z', source: 'Demo fixtures',
} }));
console.log(convertLocalTime('2026-09-01T09:00', { from: 'America/New_York', to: 'JP' }));
console.log(calculateTax({ country: 'JP', amount: '1000', category: 'standard' }));
console.log(india.laws.assess({ facts: { collectsPersonalData: true, sellsTaxableItems: true } }));
