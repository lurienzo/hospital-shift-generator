import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Root } from './Root';
import { ServiceProvider } from './state/ServiceProvider';
import { StorageService } from './services/StorageService';
import { ServiceRegistry } from './services/ServiceRegistry';
import { EVERY_DAY, MORNING, NIGHT, makeDoctor, makeRoom, slotsOn } from './domain/testFixtures';

/**
 * Prova di integrazione dell'interfaccia: monta l'applicazione completa e
 * percorre le sezioni. Serve a intercettare gli errori di render, che i test
 * sul dominio non possono vedere.
 */

function renderApp() {
  return render(
    <ServiceProvider>
      <Root />
    </ServiceProvider>,
  );
}

/** Apre una sezione cliccando la scheda, cercandola solo dentro la navigazione. */
async function openTab(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  const nav = screen.getByRole('navigation', { name: /sezioni/i });
  await user.click(within(nav).getByRole('button', { name: label }));
}

beforeEach(() => {
  localStorage.clear();
  // Le finestre di conferma bloccherebbero i test: si assume risposta
  // affermativa e si ignorano gli avvisi.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('avvio a vuoto', () => {
  it('mostra il calendario vuoto e invita a generare', () => {
    renderApp();

    expect(screen.getByRole('heading', { name: /turni ospedale/i })).toBeTruthy();
    expect(screen.getByText(/nessun calendario per/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /genera calendario/i })).toBeTruthy();
  });

  it('crea un servizio iniziale e lo mostra nell’intestazione', () => {
    renderApp();
    const services = ServiceRegistry.list();

    expect(services).toHaveLength(1);
    expect(screen.getByTitle('Cambia servizio').textContent).toContain(services[0].name);
  });

  it('naviga fra tutte le sezioni senza errori', async () => {
    const user = userEvent.setup();
    renderApp();

    for (const label of [
      /^sale operative/i, /^dottori/i, /^genera$/i, /^calendario$/i,
      /^statistiche$/i, /^impostazioni$/i,
    ]) {
      await openTab(user, label);
    }

    // Nelle impostazioni compaiono servizi, fasce orarie e schemi.
    expect(screen.getByRole('heading', { name: /^servizi$/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /fasce orarie/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /schemi turni/i })).toBeTruthy();
  });
});

describe('configurazione di base', () => {
  it('permette di aggiungere una sala e un dottore', async () => {
    const user = userEvent.setup();
    renderApp();

    await openTab(user, /^sale operative/i);
    await user.type(screen.getByPlaceholderText(/nome della sala/i), 'Sala Rossa');
    await user.click(screen.getByRole('button', { name: /aggiungi sala/i }));

    expect(screen.getByRole('button', { name: 'Sala Rossa' })).toBeTruthy();
    expect(StorageService.loadRooms().map(room => room.name)).toEqual(['Sala Rossa']);

    await openTab(user, /^dottori/i);
    await user.type(screen.getByPlaceholderText(/nome del dottore/i), 'Rossi');
    await user.click(screen.getByRole('button', { name: /aggiungi dottore/i }));

    expect(StorageService.loadDoctors().map(doctor => doctor.name)).toEqual(['Rossi']);
  });

  it('rifiuta una sala con nome già esistente', async () => {
    const user = userEvent.setup();
    renderApp();

    await openTab(user, /^sale operative/i);
    const input = screen.getByPlaceholderText(/nome della sala/i);

    await user.type(input, 'Sala 1');
    await user.click(screen.getByRole('button', { name: /aggiungi sala/i }));
    await user.type(input, 'sala 1');
    await user.click(screen.getByRole('button', { name: /aggiungi sala/i }));

    expect(window.alert).toHaveBeenCalled();
    expect(StorageService.loadRooms()).toHaveLength(1);
  });

  it('mostra la griglia dei turni quando si configura una sala', async () => {
    const user = userEvent.setup();
    renderApp();

    await openTab(user, /^sale operative/i);
    await user.type(screen.getByPlaceholderText(/nome della sala/i), 'Sala 1');
    await user.click(screen.getByRole('button', { name: /aggiungi sala/i }));

    // La sala appena creata si apre da sola sulla configurazione.
    expect(screen.getByRole('heading', { name: /turni della settimana/i })).toBeTruthy();
    expect(screen.getByText('Mattina')).toBeTruthy();
    expect(screen.getByText('Notte')).toBeTruthy();
  });
});

describe('fasce orarie', () => {
  it('aggiunge una fascia a rotazione dalle impostazioni', async () => {
    const user = userEvent.setup();
    renderApp();

    await openTab(user, /^impostazioni$/i);
    await user.click(screen.getByRole('button', { name: /aggiungi fascia/i }));

    await user.type(screen.getByLabelText('Nome'), 'Diurnismo');
    await user.type(screen.getByLabelText('Sigla'), 'D');
    // 08:00-14:00 coinciderebbe con Mattina: il diurnismo finisce alle 16.
    fireEvent.change(screen.getByLabelText('Fine'), { target: { value: '16:00' } });
    await user.click(screen.getByLabelText(/fascia a rotazione/i));
    await user.click(screen.getByRole('button', { name: /^salva$/i }));

    const saved = StorageService.loadShiftTypes().find(item => item.name === 'Diurnismo');
    expect(saved).toBeTruthy();
    expect(saved?.rotational).toBe(true);
    expect(saved?.blockLengthDays).toBe(7);
  });

  it('segnala il nome duplicato invece di salvare', async () => {
    const user = userEvent.setup();
    renderApp();

    await openTab(user, /^impostazioni$/i);
    await user.click(screen.getByRole('button', { name: /aggiungi fascia/i }));

    await user.type(screen.getByLabelText('Nome'), 'Mattina');
    await user.type(screen.getByLabelText('Sigla'), 'X');
    await user.click(screen.getByRole('button', { name: /^salva$/i }));

    expect(screen.getByText(/esiste già una fascia con questo nome/i)).toBeTruthy();
    expect(StorageService.loadShiftTypes()).toHaveLength(3);
  });
});

describe('servizi separati', () => {
  it('apre un nuovo servizio senza i dati del precedente', async () => {
    const user = userEvent.setup();
    StorageService.saveDoctors([makeDoctor('rossi')]);
    StorageService.saveRooms([makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id))]);

    renderApp();

    // Il servizio iniziale mostra i conteggi nella barra di navigazione.
    expect(screen.getByRole('button', { name: /dottori/i }).textContent).toContain('1');

    await openTab(user, /^impostazioni$/i);
    await user.click(screen.getByRole('button', { name: /nuovo servizio/i }));
    await user.type(screen.getByLabelText(/nome del servizio/i), 'Terapia Intensiva 2');
    await user.click(screen.getByRole('button', { name: /crea e apri/i }));

    expect(ServiceRegistry.list()).toHaveLength(2);
    expect(screen.getByTitle('Cambia servizio').textContent).toContain('Terapia Intensiva 2');

    // Il nuovo servizio non ha dottori né sale.
    await openTab(user, /^dottori/i);
    expect(screen.getByText(/nessun dottore configurato/i)).toBeTruthy();
  });

  it('duplica la configurazione di un servizio', async () => {
    const user = userEvent.setup();
    StorageService.saveDoctors([makeDoctor('rossi'), makeDoctor('bianchi')]);
    StorageService.saveRooms([makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id))]);

    renderApp();
    await openTab(user, /^impostazioni$/i);

    const serviceRow = screen.getByRole('heading', { name: /^servizi$/i })
      .closest('section') as HTMLElement;
    await user.click(within(serviceRow).getByRole('button', { name: /duplica/i }));

    await user.type(screen.getByLabelText(/nome del servizio/i), 'Piastra Operatoria');
    await user.click(screen.getByRole('button', { name: /crea e apri/i }));

    expect(StorageService.loadDoctors()).toHaveLength(2);
    expect(StorageService.loadRooms()).toHaveLength(1);
  });
});

describe('generazione e calendario', () => {
  /** Configurazione minima ma completa per poter generare. */
  function seed() {
    StorageService.saveDoctors([
      makeDoctor('a', { name: 'ROSSI' }),
      makeDoctor('b', { name: 'BIANCHI' }),
      makeDoctor('c', { name: 'VERDI' }),
    ]);
    StorageService.saveRooms([
      makeRoom('sala1', [
        ...slotsOn(EVERY_DAY, MORNING.id),
        ...slotsOn(EVERY_DAY, NIGHT.id, { requiresNextDayRest: true, isFullDayExclusive: true }),
      ]),
    ]);
  }

  it('genera un calendario e lo mostra nel calendario mensile', async () => {
    const user = userEvent.setup();
    seed();
    renderApp();

    await openTab(user, /^genera$/i);
    expect(screen.getByText(/turni da coprire/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /genera calendario/i }));

    // Finita la generazione si passa al calendario con la bozza non salvata.
    expect(await screen.findByText(/bozza non salvata/i, undefined, { timeout: 15000 }))
      .toBeTruthy();
    expect(screen.getByText('Turni totali')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /riepilogo per dottore/i })).toBeTruthy();
  }, 30000);

  it('salva la bozza come versione', async () => {
    const user = userEvent.setup();
    seed();
    renderApp();

    await openTab(user, /^genera$/i);
    await user.click(screen.getByRole('button', { name: /genera calendario/i }));
    await screen.findByText(/bozza non salvata/i, undefined, { timeout: 15000 });

    const versionBar = screen.getByText(/bozza non salvata/i).closest('section') as HTMLElement;
    await user.click(within(versionBar).getByRole('button', { name: /^salva$/i }));

    const dialog = await screen.findByRole('dialog', { name: /salva versione/i });
    await user.click(within(dialog).getByRole('button', { name: /^salva$/i }));

    const versions = StorageService.loadVersionsForMonth(
      new Date().getFullYear(), new Date().getMonth() + 1);
    expect(versions).toHaveLength(1);
    expect(versions[0].isActive).toBe(true);
  }, 30000);

  it('apre la finestra di aggiunta multipla dal calendario', async () => {
    const user = userEvent.setup();
    seed();
    renderApp();

    await openTab(user, /^genera$/i);
    await user.click(screen.getByRole('button', { name: /genera calendario/i }));
    await screen.findByText(/bozza non salvata/i, undefined, { timeout: 15000 });

    await user.click(screen.getByRole('button', { name: /aggiungi turni/i }));

    const dialog = await screen.findByRole('dialog', { name: /aggiungi turni/i });
    expect(within(dialog).getByText(/^Dottore$/)).toBeTruthy();
    expect(within(dialog).getByText(/^Fasce/)).toBeTruthy();
    // Senza selezioni non c'è nulla da aggiungere.
    expect(within(dialog).getByText(/seleziona dottore, giorni, sale e fasce/i)).toBeTruthy();
  }, 30000);

  it('riassegna tutto il mese a un dottore con una sola operazione', async () => {
    const user = userEvent.setup();
    StorageService.saveDoctors([
      makeDoctor('a', { name: 'ROSSI' }),
      makeDoctor('b', { name: 'BIANCHI' }),
    ]);
    StorageService.saveRooms([makeRoom('sala1', slotsOn(EVERY_DAY, MORNING.id))]);
    renderApp();

    await openTab(user, /^genera$/i);
    await user.click(screen.getByRole('button', { name: /genera calendario/i }));
    await screen.findByText(/bozza non salvata/i, undefined, { timeout: 15000 });

    // Generato il mese, i turni sono divisi fra i due dottori.
    await user.click(screen.getByRole('button', { name: /aggiungi turni/i }));
    const dialog = await screen.findByRole('dialog', { name: /aggiungi turni/i });

    await user.click(within(dialog).getByRole('button', { name: /^BIANCHI$/ }));
    await user.click(within(dialog).getByRole('button', { name: /^Tutti$/ }));
    await user.click(within(dialog).getByRole('button', { name: /^SALA1$/ }));
    await user.click(within(dialog).getByRole('button', { name: /^Mattina$/ }));
    await user.click(within(dialog).getByLabelText(/sostituisci i turni già assegnati/i));

    const apply = within(dialog).getByRole('button', { name: /^Aggiungi \d+$/ });
    await user.click(apply);

    // Dopo la sostituzione l'intero mese è di BIANCHI.
    const table = screen.getByRole('heading', { name: /riepilogo per dottore/i })
      .closest('section') as HTMLElement;
    const rows = within(table).getAllByRole('row');
    const bianchiRow = rows.find(row => row.textContent?.includes('BIANCHI'))!;
    const rossiRow = rows.find(row => row.textContent?.startsWith('ROSSI'))!;

    const daysInMonth = new Date(
      new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();

    expect(within(bianchiRow).getAllByRole('cell')[1].textContent).toBe(String(daysInMonth));
    expect(within(rossiRow).getAllByRole('cell')[1].textContent).toBe('0');
  }, 30000);
});
