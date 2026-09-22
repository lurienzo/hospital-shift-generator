/*
 * Calcola l'impronta SHA-256 di una password, da usare come valore di
 * VITE_APP_PASSWORD_SHA256.
 *
 * Nel repo non finisce mai la password in chiaro: solo la sua impronta, e
 * solo in `.env.local` (ignorato da git) o nei segreti di GitHub Actions.
 *
 *   node tools/hash-password.mjs "la mia password"
 *
 * Attenzione: l'impronta di una password breve o comune si risale in pochi
 * secondi con un dizionario. Questo blocco tiene fuori chi capita
 * sull'indirizzo per caso, non chi vuole davvero entrare.
 */
import { createHash } from 'node:crypto';

const password = process.argv[2];

if (!password) {
  console.error('Uso: node tools/hash-password.mjs "<password>"');
  process.exit(1);
}

const hash = createHash('sha256').update(password, 'utf8').digest('hex');

console.log('');
console.log('Aggiungi questa riga a .env.local per lo sviluppo in locale:');
console.log('');
console.log(`  VITE_APP_PASSWORD_SHA256=${hash}`);
console.log('');
console.log('E impostala come segreto per la pubblicazione:');
console.log('');
console.log(`  gh secret set VITE_APP_PASSWORD_SHA256 --body ${hash}`);
console.log('');
