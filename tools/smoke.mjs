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
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.APP_URL ?? 'http://localhost:5173/hospital-shift-generator/';
const OUT = 'tools/screenshots';
mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });

/*
 * Se l'applicazione e compilata con una password di accesso, il blocco
 * comparirebbe prima dell'interfaccia e la verifica si fermerebbe li. Lo
 * sblocco viene seminato a mano: la chiave contiene l'impronta attesa, che in
 * sviluppo sta in `.env.local`. Senza impronta il blocco non si attiva e non
 * c'e niente da sbloccare.
 */
const expectedHash = readExpectedHash();
if (expectedHash) {
  await context.addInitScript(hash => {
    sessionStorage.setItem('hsg_unlocked', hash);
  }, expectedHash);
}

const page = await context.newPage();

page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

/** Impronta della password di accesso, se l'applicazione ne ha una. */
function readExpectedHash() {
  const fromEnv = process.env.VITE_APP_PASSWORD_SHA256;
  if (fromEnv) return fromEnv.trim().toLowerCase();
  try {
    const file = readFileSync('.env.local', 'utf8');
    const match = file.match(/^VITE_APP_PASSWORD_SHA256\s*=\s*(\S+)/m);
    return match ? match[1].trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

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
await page.getByLabel('Nome dello schema').fill('Ciclo 4 giorni');
// Il diurnismo non è selezionabile: è una fascia a blocchi, non un passo del giro.
for (const step of ['Pomeriggio', 'Notte']) {
  await page.getByRole('dialog').getByRole('button', { name: step, exact: true }).click();
}
await page.getByRole('button', { name: '+ Smonto' }).click();
await page.getByRole('button', { name: '+ Riposo' }).click();
await shot('03-editor-schema');
await page.getByRole('button', { name: 'Salva schema' }).click();
await page.waitForTimeout(200);

// --- Lo schema diventa la regola di rotazione del servizio ---
console.log('4. rotazione del servizio');
await page.getByLabel('Schema da seguire').selectOption({ label: 'Ciclo 4 giorni' });
await page.waitForTimeout(200);
await shot('04-rotazione-servizio');


// --- Ore richieste per medico ---
console.log('5. ore richieste');
await page.getByLabel('Controlla le ore svolte').check();
await page.getByLabel('Minimo').fill('24');
await page.getByLabel('Massimo').fill('48');
await page.waitForTimeout(200);
await shot('05-ore-richieste');

// Il massimo resta recuperabile: la modalita a tetto si vede nell'altra scelta.
await page.getByRole('button', { name: 'Non si supera mai' }).click();
await page.waitForTimeout(150);
await shot('05b-ore-tetto');
await page.getByRole('button', { name: 'Si puo superare e recuperare' }).click();
await page.waitForTimeout(150);

// --- Sale ---
console.log('6. sale operative');
await tab('Sale operative');
await page.getByPlaceholder(/Nome della sala/).fill('Terapia Intensiva A');
await page.getByRole('button', { name: 'Aggiungi sala' }).click();
await page.waitForTimeout(200);

// Pomeriggi ogni giorno, più il diurnismo dal lunedì al venerdì: il primo
// entra nel giro di rotazione, il secondo si assegna a blocchi settimanali.
const pomeriggiRow = page.locator('.slot-grid tbody tr', { hasText: 'Pomeriggio' }).first();
await pomeriggiRow.getByRole('button', { name: 'Tutti' }).click();
await page.waitForTimeout(80);
const diurnismoRow = page.locator('.slot-grid tbody tr', { hasText: 'Diurnismo' }).first();
await diurnismoRow.getByRole('button', { name: 'Lun–Ven' }).click();
await page.waitForTimeout(150);
await shot('06-griglia-turni');

await page.getByRole('button', { name: 'Chiudi' }).click();
await page.getByPlaceholder(/Nome della sala/).fill('Guardia Notturna');
await page.getByRole('button', { name: 'Aggiungi sala' }).click();
await page.waitForTimeout(200);
const notteRow = page.locator('.slot-grid tbody tr', { hasText: 'Notte' }).first();
await notteRow.getByRole('button', { name: 'Tutti' }).click();
await page.waitForTimeout(150);
await shot('07-seconda-sala');

// --- Dottori ---
console.log('7. dottori');
await tab('Dottori');
for (const name of ['Rossi', 'Bianchi', 'Verdi', 'Neri', 'Gialli', 'Bruni']) {
  await page.getByPlaceholder(/Nome del dottore/).fill(name);
  await page.getByRole('button', { name: 'Aggiungi dottore' }).click();
  await page.waitForTimeout(80);
}
await shot('08-dottori');
// --- Preferenze di un medico ---
console.log('7b. preferenze del medico');
await page.locator('.doctor-card', { hasText: 'Rossi' }).first()
  .getByRole('button', { name: /Nessun vincolo|preferenze|divieti/ }).click();
await page.waitForTimeout(200);

// "No giovedi pomeriggio": un clic sulla casella la marca da evitare.
const prefs = page.locator('.doctor-preferences').first();
const pomRow = prefs.locator('tbody tr', { hasText: 'Pomeriggio' }).first();
await pomRow.locator('td').nth(3).locator('.rule-cell').click();
// Due clic sul sabato: divieto pieno.
await pomRow.locator('td').nth(5).locator('.rule-cell').click();
await pomRow.locator('td').nth(5).locator('.rule-cell').click();
await prefs.getByRole('button', { name: 'Turni lunghi' }).click();
await page.waitForTimeout(200);
await shot('08b-preferenze-medico');


// --- Generazione ---
console.log('8. generazione');
await tab('Genera');
await page.waitForTimeout(200);
await shot('09-genera');
await page.getByRole('button', { name: 'Genera calendario' }).click();
await page.waitForSelector('text=/Bozza non salvata/', { timeout: 60000 });
await page.waitForTimeout(400);
console.log('9. calendario generato');
await shot('10-calendario-per-sala');

// --- Viste del calendario ---
for (const [view, name] of [['Per dottore', '10-per-dottore'], ['Griglia mese', '11-griglia-mese']]) {
  await page.getByRole('button', { name: view, exact: true }).click();
  await page.waitForTimeout(250);
  await shot(name);
}
await page.getByRole('button', { name: 'Per sala', exact: true }).click();
await page.waitForTimeout(200);

// --- Aggiunta multi-turno ---
console.log('10. aggiunta multi-turno');
await page.getByRole('button', { name: 'Aggiungi turni' }).click();
const dialog = page.getByRole('dialog', { name: 'Aggiungi turni' });
await dialog.waitFor();
await dialog.getByRole('button', { name: 'Rossi', exact: true }).click();
await dialog.locator('.mini-head-cell', { hasText: 'LUN' }).click();
await dialog.getByRole('button', { name: 'Terapia Intensiva A', exact: true }).click();
await dialog.getByRole('button', { name: 'Pomeriggio', exact: true }).click();
await page.waitForTimeout(300);
await shot('13-aggiunta-multiturno');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// --- Modifica di un turno via popover ---
console.log('11. modifica turno');
await page.locator('.chip').first().click();
await page.waitForSelector('.popover');
await shot('14-popover-modifica');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// --- Salvataggio versione ---
console.log('12. salvataggio versione');
await page.locator('.version-bar').getByRole('button', { name: 'Salva', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Salva', exact: true }).click();
await page.waitForTimeout(400);
await shot('15-versione-salvata');

// --- Statistiche ---
console.log('13. statistiche');
await tab('Statistiche');
await page.waitForTimeout(400);
await shot('16-statistiche');

// --- Secondo servizio ---
console.log('14. secondo servizio');
await tab('Impostazioni');
await page.getByRole('button', { name: 'Nuovo servizio' }).click();
await page.getByLabel('Nome del servizio').fill('Piastra Operatoria');
await page.getByRole('button', { name: 'Crea e apri' }).click();
await page.waitForTimeout(500);
await shot('17-nuovo-servizio');
await tab('Dottori');
await page.waitForTimeout(200);
await shot('18-servizio-vuoto');

const header = await page.locator('.service-switcher').innerText();
console.log(`  servizio attivo: ${header.replace(/\n/g, ' ')}`);

await browser.close();

console.log(`\nErrori console: ${errors.length}`);
for (const e of errors.slice(0, 15)) console.log(`  ! ${e}`);
process.exit(errors.length > 0 ? 1 : 0);
