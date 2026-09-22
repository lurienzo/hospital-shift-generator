import { ReactNode, useEffect, useState } from 'react';
import './PasswordGate.css';

/**
 * Blocco di accesso all'applicazione.
 *
 * Non è una misura di sicurezza e non va usata come tale: l'applicazione gira
 * interamente nel browser, quindi tutto ciò che serve a verificare la password
 * viene scaricato insieme alla pagina. Serve a impedire che chi capita
 * sull'indirizzo per caso si trovi davanti il pianificatore del reparto.
 *
 * Nel codice non compare la password ma solo la sua impronta SHA-256, letta
 * dalla variabile d'ambiente `VITE_APP_PASSWORD_SHA256` al momento della
 * compilazione. Se la variabile non è impostata il blocco non si attiva, così
 * lo sviluppo in locale e i test restano senza attriti.
 *
 * I turni non sono comunque esposti: restano nel `localStorage` del browser di
 * chi li ha creati, e non passano da nessun server.
 */

const EXPECTED_HASH = (import.meta.env.VITE_APP_PASSWORD_SHA256 ?? '').trim().toLowerCase();

/**
 * Chiave dello sblocco, la stessa nei due archivi del browser. Dove finisce
 * dipende dalla spunta «ricorda la password»:
 *
 * - senza spunta va in `sessionStorage`, quindi vale finché il browser resta
 *   aperto e si ripete alla prossima apertura;
 * - con la spunta va in `localStorage`, quindi resta fino a quando non si
 *   dimentica da Impostazioni.
 *
 * Il valore salvato è l'impronta attesa, non un semplice "sì": se la password
 * dell'applicazione viene cambiata, quella ricordata non sblocca più niente.
 */
const UNLOCK_KEY = 'hsg_unlocked';

type Scope = 'session' | 'persistent';

export function PasswordGate({ children }: { children: ReactNode }) {
  const enabled = EXPECTED_HASH.length > 0;

  const [unlocked, setUnlocked] = useState(() => {
    if (!enabled) return true;
    return readUnlock('persistent') === EXPECTED_HASH
      || readUnlock('session') === EXPECTED_HASH;
  });

  if (unlocked) return <>{children}</>;
  return <PasswordForm onUnlock={() => setUnlocked(true)} />;
}

function PasswordForm({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // Un errore sparisce appena si ricomincia a scrivere: lasciarlo mentre si
  // corregge fa sembrare sbagliato anche il nuovo tentativo.
  useEffect(() => {
    if (password.length > 0) setError(null);
  }, [password]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || checking) return;

    setChecking(true);
    try {
      const digest = await sha256Hex(password);
      if (digest !== EXPECTED_HASH) {
        setError('Password non corretta.');
        setPassword('');
        return;
      }

      // Lo sblocco va in un archivio solo. Ripulire anche l'altro serve al caso
      // di chi aveva spuntato «ricorda» e ora non lo vuole più: senza questo il
      // valore permanente resterebbe lì a sbloccare per sempre.
      if (remember) {
        clearUnlock('session');
        writeUnlock('persistent');
      } else {
        clearUnlock('persistent');
        writeUnlock('session');
      }
      onUnlock();
    } catch (cause) {
      console.error('Verifica della password non riuscita', cause);
      setError('Impossibile verificare la password su questo browser.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="gate">
      <form className="gate-panel" onSubmit={submit}>
        <div className="gate-brand">
          <h1>Turni ospedale</h1>
          <p>Pianificazione e generazione dei turni</p>
        </div>

        <div className="field">
          <label htmlFor="gate-password">Password</label>
          <input
            id="gate-password"
            className={`input ${error ? 'invalid' : ''}`}
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            onChange={event => setPassword(event.target.value)}
          />
        </div>

        <label className="checkbox gate-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={event => setRemember(event.target.checked)}
          />
          <span>Ricorda la password su questo dispositivo</span>
        </label>

        {error && <p className="gate-error">{error}</p>}

        <button
          type="submit"
          className="btn btn-primary btn-lg"
          disabled={!password || checking}
        >
          {checking ? 'Verifica…' : 'Entra'}
        </button>

        <p className="gate-note">
          I turni restano salvati in questo browser e non passano da nessun server.
          {remember && ' Per farla richiedere di nuovo: Impostazioni, riquadro Accesso.'}
        </p>
      </form>
    </div>
  );
}

/**
 * Riquadro in Impostazioni per disdire il «ricorda la password».
 *
 * Non rimette il blocco sulla sessione in corso, di proposito: farlo adesso
 * smonterebbe l'applicazione e porterebbe via le modifiche non salvate. Toglie
 * solo il ricordo, così il blocco ricompare alla prossima apertura.
 */
export function PasswordAccessSettings() {
  const [remembered, setRemembered] = useState(() => readUnlock('persistent') === EXPECTED_HASH);

  if (EXPECTED_HASH.length === 0) return null;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Accesso</h3>
          <p className="hint">
            {remembered
              ? 'La password è ricordata su questo browser e l’applicazione si apre senza chiederla. Dimenticala se il computer non è solo tuo.'
              : 'La password viene chiesta a ogni nuova apertura del browser. Per non ripeterla, spunta «Ricorda la password su questo dispositivo» quando la inserisci.'}
          </p>
        </div>
        {remembered && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              clearUnlock('persistent');
              setRemembered(false);
            }}
          >
            Dimentica la password
          </button>
        )}
      </div>
    </section>
  );
}

/** Impronta SHA-256 in esadecimale, calcolata con l'API del browser. */
async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/*
 * Accesso agli archivi del browser. Quando i cookie sono bloccati, leggere
 * `localStorage` può essere vietato del tutto e non solo fallire in scrittura:
 * per questo anche la scelta dell'archivio sta dentro il `try`. Se non è
 * raggiungibile, lo sblocco vale solo per la schermata corrente.
 */

function storageFor(scope: Scope): Storage {
  return scope === 'persistent' ? localStorage : sessionStorage;
}

function readUnlock(scope: Scope): string | null {
  try {
    return storageFor(scope).getItem(UNLOCK_KEY);
  } catch {
    return null;
  }
}

function writeUnlock(scope: Scope): void {
  try {
    storageFor(scope).setItem(UNLOCK_KEY, EXPECTED_HASH);
  } catch {
    // Vedi il commento sopra.
  }
}

function clearUnlock(scope: Scope): void {
  try {
    storageFor(scope).removeItem(UNLOCK_KEY);
  } catch {
    // Vedi il commento sopra.
  }
}
