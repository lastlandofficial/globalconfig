import { defineContract, checkContract, formatReport } from 'glocon';
const contract = defineContract({ name: 'orders', states: {
  loading: { required: [{ selector: '[role="status"]', description: 'loading feedback' }] },
  error: { required: [{ selector: '#retry', description: 'a retry action' }] },
} });
// These counts are illustrative. In a real harness, measure visible matches.
const report = checkContract(contract, { error: { visibleCounts: { '#retry': 0 } } });
console.log(formatReport(report));
