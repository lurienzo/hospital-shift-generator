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

async function renderGate(expected?: string) {
  vi.resetModules();
  vi.stubEnv('VITE_APP_PASSWORD_SHA256', expected ?? '');

  const { PasswordGate } = await import('./PasswordGate');
  return render(<PasswordGate><p>Contenuto riservato</p></PasswordGate>);
}

beforeEach(() => {
  sessionStorage.clear();
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

/** Stessa impronta calcolata dal componente, per costruire il caso di prova. */
async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}
