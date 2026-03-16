import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const logs = [];
const errors = [];

page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
page.on('pageerror', err => errors.push(err.message));

console.log('Navigating to http://localhost:1420...');
await page.goto('http://localhost:1420', { timeout: 10000 });
await page.waitForTimeout(3000);

const bodyText = await page.evaluate(() => document.body.innerText);
console.log('BODY TEXT (first 500 chars):', bodyText.substring(0, 500));

const appHtml = await page.evaluate(() => document.getElementById('app')?.innerHTML?.substring(0, 2000));
console.log('APP HTML (first 2000 chars):', appHtml);

console.log('\n--- Console logs ---');
for (const l of logs.slice(0, 20)) console.log(l);

console.log('\n--- Page errors ---');
for (const e of errors) console.log(e);

await browser.close();
