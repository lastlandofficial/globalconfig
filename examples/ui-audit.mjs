import { chromium } from 'playwright';
import { auditPage, assertUI } from 'glocon/playwright';
import { formatReport } from 'glocon';
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(process.argv[2] ?? 'http://localhost:3000');
  const report = await auditPage(page, { readySelector: 'main' });
  console.log(formatReport(report));
  assertUI(report);
} finally {
  await browser.close();
}
