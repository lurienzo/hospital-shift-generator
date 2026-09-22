/*
 * Verifica visiva: pilota l'applicazione in un browser headless lungo un
 * percorso completo e salva uno screenshot per ogni passaggio. Serve a
 * intercettare i problemi che i test su dominio e interfaccia non vedono,
 * come un pannello tagliato o una colonna che collassa.
 *
 *   npm run dev            # in un terminale
 *   npx playwright install chromium   # una volta sola
 *   node tools/smoke.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.APP_URL ?? 'http://localhost:5173/hospital-shift-generator/';
const OUT = 'tools/screenshots';
mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

const shot = async name => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`  shot: ${name}`);
};
const tab = async name => {
  await page.locator('nav.app-nav button', { hasText: new RegExp(`^${name}`) }).first().click();
  await page.waitForTimeout(250);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.app-header');
console.log('1. avvio');
await shot('01-avvio');

// --- Fasce orarie: aggiungo il diurnismo a rotazione ---
console.log('2. impostazioni: fascia a rotazione');
await tab('Impostazioni');
await page.getByRole('button', { name: 'Aggiungi fascia' }).click();
await page.getByLabel('Nome').fill('Diurnismo');
await page.getByLabel('Sigla').fill('D');
await page.getByLabel('Fine').fill('16:00');
await page.getByLabel('Fascia a rotazione').check();
await shot('02-fascia-rotazionale');
await page.getByRole('button', { name: 'Salva', exact: true }).click();
await page.waitForTimeout(200);

// --- Schema turni personalizzato ---
console.log('3. schema turni');
await page.getByRole('button', { name: 'Nuovo schema' }).click();
await page.getByLabel('Nome dello schema').fill('Ciclo 5 giorni');
for (const step of ['Pomeriggio', 'Diurnismo', 'Notte']) {
  await page.getByRole('dialog').getByRole('button', { name: step, exact: true }).click();
}
await page.getByRole('button', { name: '+ Smonto' }).click();
await page.getByRole('button', { name: '+ Riposo' }).click();
await shot('03-editor-schema');
await page.getByRole('button', { name: 'Salva schema' }).click();
await page.waitForTimeout(200);
await shot('04-impostazioni');

// --- Sale ---
console.log('4. sale operative');
await tab('Sale operative');
await page.getByPlaceholder(/Nome della sala/).fill('Terapia Intensiva A');
await page.getByRole('button', { name: 'Aggiungi sala' }).click();
await page.waitForTimeout(200);

// riempio la settimana con lo schema
await page.getByRole('button', { name: 'Applica schema' }).click();
await page.waitForTimeout(300);
await shot('05-applica-schema');
await page.getByRole('button', { name: 'Applica', exact: true }).click();
await page.waitForTimeout(300);
await shot('06-griglia-turni');

// --- Dottori ---
console.log('5. dottori');
await tab('Dottori');
for (const name of ['Rossi', 'Bianchi', 'Verdi', 'Neri', 'Gialli', 'Bruni']) {
  await page.getByPlaceholder(/Nome del dottore/).fill(name);
  await page.getByRole('button', { name: 'Aggiungi dottore' }).click();
  await page.waitForTimeout(80);
}
await shot('07-dottori');

// --- Generazione ---
console.log('6. generazione');
await tab('Genera');
await page.waitForTimeout(200);
await shot('08-genera');
await page.getByRole('button', { name: 'Genera calendario' }).click();
await page.waitForSelector('text=/Bozza non salvata/', { timeout: 60000 });
await page.waitForTimeout(400);
console.log('7. calendario generato');
await shot('09-calendario-per-sala');

// --- Viste del calendario ---
for (const [view, name] of [['Per dottore', '10-per-dottore'], ['Griglia mese', '11-griglia-mese']]) {
  await page.getByRole('button', { name: view, exact: true }).click();
  await page.waitForTimeout(250);
  await shot(name);
}
await page.getByRole('button', { name: 'Per sala', exact: true }).click();
await page.waitForTimeout(200);

// --- Aggiunta multi-turno ---
console.log('8. aggiunta multi-turno');
await page.getByRole('button', { name: 'Aggiungi turni' }).click();
const dialog = page.getByRole('dialog', { name: 'Aggiungi turni' });
await dialog.waitFor();
await dialog.getByRole('button', { name: 'Rossi', exact: true }).click();
await dialog.locator('.mini-head-cell', { hasText: 'LUN' }).click();
await dialog.getByRole('button', { name: 'Terapia Intensiva A', exact: true }).click();
await dialog.getByRole('button', { name: 'Mattina', exact: true }).click();
await page.waitForTimeout(300);
await shot('12-aggiunta-multiturno');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// --- Modifica di un turno via popover ---
console.log('9. modifica turno');
await page.locator('.chip').first().click();
await page.waitForSelector('.popover');
await shot('13-popover-modifica');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// --- Salvataggio versione ---
console.log('10. salvataggio versione');
await page.locator('.version-bar').getByRole('button', { name: 'Salva', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Salva', exact: true }).click();
await page.waitForTimeout(400);
await shot('14-versione-salvata');

// --- Statistiche ---
console.log('11. statistiche');
await tab('Statistiche');
await page.waitForTimeout(400);
await shot('15-statistiche');

// --- Secondo servizio ---
console.log('12. secondo servizio');
await tab('Impostazioni');
await page.getByRole('button', { name: 'Nuovo servizio' }).click();
await page.getByLabel('Nome del servizio').fill('Piastra Operatoria');
await page.getByRole('button', { name: 'Crea e apri' }).click();
await page.waitForTimeout(500);
await shot('16-nuovo-servizio');
await tab('Dottori');
await page.waitForTimeout(200);
await shot('17-servizio-vuoto');

const header = await page.locator('.service-switcher').innerText();
console.log(`  servizio attivo: ${header.replace(/\n/g, ' ')}`);

await browser.close();

console.log(`\nErrori console: ${errors.length}`);
for (const e of errors.slice(0, 15)) console.log(`  ! ${e}`);
process.exit(errors.length > 0 ? 1 : 0);
