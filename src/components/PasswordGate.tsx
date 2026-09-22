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
 * Lo sblocco vale per la sessione del browser: riaprendo la scheda va
 * reinserito, chiudendo e riaprendo un collegamento nella stessa sessione no.
 */
const UNLOCK_KEY = 'hsg_unlocked';

export function PasswordGate({ children }: { children: ReactNode }) {
  const enabled = EXPECTED_HASH.length > 0;

  const [unlocked, setUnlocked] = useState(() => {
    if (!enabled) return true;
    try {
      return sessionStorage.getItem(UNLOCK_KEY) === EXPECTED_HASH;
    } catch {
      return false;
    }
  });

  if (unlocked) return <>{children}</>;
  return <PasswordForm onUnlock={() => setUnlocked(true)} />;
}

function PasswordForm({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('');
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

      try {
        sessionStorage.setItem(UNLOCK_KEY, EXPECTED_HASH);
      } catch {
        // Senza sessionStorage l'accesso vale solo per questa schermata.
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
        </p>
      </form>
    </div>
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
