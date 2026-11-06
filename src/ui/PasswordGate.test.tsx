import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Il modulo legge l'impronta attesa al momento dell'import, quindi ogni caso
 * imposta la variabile d'ambiente e poi reimporta il modulo con
 * `vi.resetModules`. Senza questo tutti i test vedrebbero il primo valore.
 *
 * La password usata qui è inventata e la sua impronta viene calcolata al
 * momento: nel repo non deve finire nessuna password reale, nemmeno nei test.
 */

const PASSWORD = 'password-di-prova';
let hash = '';

beforeAll(async () => {
  hash = await sha256Hex(PASSWORD);
});

async function importGate(expected?: string) {
  vi.resetModules();
  vi.stubEnv('VITE_APP_PASSWORD_SHA256', expected ?? '');
  return import('./PasswordGate');
}

async function renderGate(expected?: string) {
  const { PasswordGate } = await importGate(expected);
  return render(<PasswordGate><p>Contenuto riservato</p></PasswordGate>);
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('blocco con password', () => {
  it('non chiede nulla se la variabile non è impostata', async () => {
    await renderGate();

    expect(screen.getByText('Contenuto riservato')).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('nasconde l’applicazione quando la variabile è impostata', async () => {
    await renderGate(hash);

    expect(screen.queryByText('Contenuto riservato')).toBeNull();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('apre con la password giusta', async () => {
    const user = userEvent.setup();
    await renderGate(hash);

    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: /entra/i }));

    expect(await screen.findByText('Contenuto riservato')).toBeTruthy();
  });

  it('rifiuta la password sbagliata e svuota il campo', async () => {
    const user = userEvent.setup();
    await renderGate(hash);

    await user.type(screen.getByLabelText('Password'), 'sbagliata');
    await user.click(screen.getByRole('button', { name: /entra/i }));

    expect(await screen.findByText(/password non corretta/i)).toBeTruthy();
    expect(screen.queryByText('Contenuto riservato')).toBeNull();
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  it('non tiene l’errore mentre si corregge', async () => {
    const user = userEvent.setup();
    await renderGate(hash);

    await user.type(screen.getByLabelText('Password'), 'sbagliata');
    await user.click(screen.getByRole('button', { name: /entra/i }));
    await screen.findByText(/password non corretta/i);

    await user.type(screen.getByLabelText('Password'), 'x');
    expect(screen.queryByText(/password non corretta/i)).toBeNull();
  });

  it('resta aperta per il resto della sessione del browser', async () => {
    const user = userEvent.setup();
    const first = await renderGate(hash);

    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: /entra/i }));
    await screen.findByText('Contenuto riservato');
    first.unmount();

    // Ricaricando la pagina nella stessa sessione non richiede la password.
    const { PasswordGate } = await import('./PasswordGate');
    render(<PasswordGate><p>Contenuto riservato</p></PasswordGate>);
    expect(screen.getByText('Contenuto riservato')).toBeTruthy();
  });

  it('richiede di nuovo la password se la sessione è stata svuotata', async () => {
    const user = userEvent.setup();
    const first = await renderGate(hash);

    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: /entra/i }));
    await screen.findByText('Contenuto riservato');
    first.unmount();

    sessionStorage.clear();

    const { PasswordGate } = await import('./PasswordGate');
    render(<PasswordGate><p>Contenuto riservato</p></PasswordGate>);
    expect(screen.queryByText('Contenuto riservato')).toBeNull();
  });

  it('non sblocca con un valore di sessione che non corrisponde', async () => {
    sessionStorage.setItem('hsg_unlocked', 'valore-inventato');
    await renderGate(hash);

    expect(screen.queryByText('Contenuto riservato')).toBeNull();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });
});

describe('ricorda la password', () => {
  it('senza la spunta lo sblocco vale solo per la sessione del browser', async () => {
    const user = userEvent.setup();
    await renderGate(hash);

    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: /entra/i }));
    await screen.findByText('Contenuto riservato');

    expect(sessionStorage.getItem('hsg_unlocked')).toBe(hash);
    expect(localStorage.getItem('hsg_unlocked')).toBeNull();
  });

  it('con la spunta resta sbloccata in una sessione nuova del browser', async () => {
    const user = userEvent.setup();
    const first = await renderGate(hash);

    await user.click(screen.getByLabelText(/ricorda la password/i));
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: /entra/i }));
    await screen.findByText('Contenuto riservato');
    expect(localStorage.getItem('hsg_unlocked')).toBe(hash);
    first.unmount();

    // Chiudere il browser svuota `sessionStorage` ma non `localStorage`.
    sessionStorage.clear();

    const { PasswordGate } = await import('./PasswordGate');
    render(<PasswordGate><p>Contenuto riservato</p></PasswordGate>);
    expect(screen.getByText('Contenuto riservato')).toBeTruthy();
  });

  it('sbloccando senza la spunta dimentica quello che era ricordato', async () => {
    // Succede quando la password dell'applicazione viene cambiata: il valore
    // ricordato non combacia piu, quindi il blocco ricompare. Chi entra senza
    // spuntare non deve restare ricordato per via del valore vecchio.
    localStorage.setItem('hsg_unlocked', 'impronta-di-una-password-vecchia');

    const user = userEvent.setup();
    await renderGate(hash);
    expect(screen.getByLabelText('Password')).toBeTruthy();

    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: /entra/i }));
    await screen.findByText('Contenuto riservato');

    expect(localStorage.getItem('hsg_unlocked')).toBeNull();
  });

  it('non sblocca con un valore ricordato che non corrisponde', async () => {
    localStorage.setItem('hsg_unlocked', 'valore-inventato');
    await renderGate(hash);

    expect(screen.queryByText('Contenuto riservato')).toBeNull();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });
});

describe('riquadro Accesso in Impostazioni', () => {
  it('non compare se il blocco non e attivo', async () => {
    const { PasswordAccessSettings } = await importGate();
    const { container } = render(<PasswordAccessSettings />);

    expect(container.firstChild).toBeNull();
  });

  it('non offre niente da dimenticare se la password non e ricordata', async () => {
    const { PasswordAccessSettings } = await importGate(hash);
    render(<PasswordAccessSettings />);

    expect(screen.queryByRole('button', { name: /dimentica la password/i })).toBeNull();
    expect(screen.getByText(/viene chiesta a ogni nuova apertura/i)).toBeTruthy();
  });

  it('dimentica la password ricordata', async () => {
    localStorage.setItem('hsg_unlocked', hash);

    const user = userEvent.setup();
    const { PasswordAccessSettings } = await importGate(hash);
    render(<PasswordAccessSettings />);

    await user.click(screen.getByRole('button', { name: /dimentica la password/i }));

    expect(localStorage.getItem('hsg_unlocked')).toBeNull();
    expect(screen.queryByRole('button', { name: /dimentica la password/i })).toBeNull();
    expect(screen.getByText(/viene chiesta a ogni nuova apertura/i)).toBeTruthy();
  });
});

/** Stessa impronta calcolata dal componente, per costruire il caso di prova. */
async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}
