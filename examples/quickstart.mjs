import { createGlobalConfig, convertCurrency, convertLocalTime, calculateTax } from '../dist/index.js';

const india = createGlobalConfig({ country: 'IN', facts: { collectsPersonalData: true, sellsTaxableItems: true } });
console.log(india.currency.format('123456.78'));
console.log(india.time.convert('2026-09-01T12:00:00Z'));
console.log(india.tax.calculate({ amount: '1000', rate: '18', supply: 'intra-state' }));
console.log(india.currency.toMinorUnits('10.25'));

// Illustrative fixtures, not current market quotes.
console.log(convertCurrency({ amount: '100', from: 'USD', to: 'JPY', rates: {
  base: 'USD', rates: { INR: '83.25', JPY: '150' }, asOf: '2026-09-01T00:00:00Z', source: 'Demo fixtures',
} }));
console.log(convertLocalTime('2026-09-01T09:00', { from: 'America/New_York', to: 'JP' }));
console.log(calculateTax({ country: 'JP', amount: '1000', category: 'standard' }));
const plan = india.laws.plan();
console.log('Questions:', plan.questions);
console.table(plan.tasks.map(({ ruleId, controlId, applicability, source }) => ({ ruleId, controlId, applicability, source })));
