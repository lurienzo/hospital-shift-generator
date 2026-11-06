import { useEffect, useState, type ReactNode } from 'react';
import { SERVICE_KIND_LABELS } from './domain/defaults';
import { CalendarPage } from './pages/CalendarPage';
import { DoctorsPage } from './pages/DoctorsPage';
import { RequestsPage } from './pages/RequestsPage';
import { RulesPage } from './pages/RulesPage';
import { ServicesPage, NewServiceForm } from './pages/ServicesPage';
import { ShiftsPage } from './pages/ShiftsPage';
import { StatsPage } from './pages/StatsPage';
import { setUi, switchService, useStore, type Page } from './store/store';
import {
  IconBuilding, IconCalendar, IconChart, IconChevronDown, IconClock,
  IconInbox, IconMenu, IconMoon, IconSliders, IconSun, IconUsers,
} from './ui/icons';
import { Popover, Toasts } from './ui/kit';

const NAV: { page: Page; label: string; icon: ReactNode; group: 'month' | 'setup' }[] = [
  { page: 'calendar', label: 'Calendario', icon: <IconCalendar />, group: 'month' },
  { page: 'requests', label: 'Ferie e desiderate', icon: <IconInbox />, group: 'month' },
  { page: 'stats', label: 'Statistiche', icon: <IconChart />, group: 'month' },
  { page: 'doctors', label: 'Medici', icon: <IconUsers />, group: 'setup' },
  { page: 'shifts', label: 'Turni e copertura', icon: <IconClock />, group: 'setup' },
  { page: 'rules', label: 'Regole', icon: <IconSliders />, group: 'setup' },
];

export function App() {
  const services = useStore(s => s.services);
  const activeId = useStore(s => s.activeId);
  const page = useStore(s => s.ui.page);
  const theme = useStore(s => s.ui.theme);
  const config = useStore(s => s.config);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  if (services.length === 0 || !activeId || !config) return <><Welcome /><Toasts /></>;

  const go = (p: Page) => { setUi({ page: p }); setMenuOpen(false); };
  const counts: Partial<Record<Page, number>> = {
    doctors: config.doctors.filter(d => d.active).length,
    shifts: config.shiftTypes.length,
  };

  return (
    <div className={`app ${menuOpen ? 'menu-open' : ''}`}>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Cross /></div>
          <div>
            <div className="brand-name">Turni</div>
            <div className="brand-sub">Generatore di reparto</div>
          </div>
        </div>
        <ServiceSwitcher onManage={() => go('services')} />
        <div className="nav-section">Mese</div>
        {NAV.filter(n => n.group === 'month').map(n => (
          <button key={n.page} className={`nav-item ${page === n.page ? 'active' : ''}`} onClick={() => go(n.page)}>
            {n.icon}{n.label}
          </button>
        ))}
        <div className="nav-section">Configurazione</div>
        {NAV.filter(n => n.group === 'setup').map(n => (
          <button key={n.page} className={`nav-item ${page === n.page ? 'active' : ''}`} onClick={() => go(n.page)}>
            {n.icon}{n.label}{counts[n.page] !== undefined && <span className="count">{counts[n.page]}</span>}
          </button>
        ))}
        <div className="sidebar-footer">
          <button className={`nav-item ${page === 'services' ? 'active' : ''}`} onClick={() => go('services')}>
            <IconBuilding />Servizi e backup
          </button>
          <button className="nav-item" onClick={() => setUi({ theme: nextTheme(theme) })} title="Cambia tema">
            {theme === 'dark' ? <IconMoon /> : <IconSun />}
            Tema: {theme === 'auto' ? 'automatico' : theme === 'dark' ? 'scuro' : 'chiaro'}
          </button>
        </div>
      </aside>
      <main className="main">
        <button className="btn ghost icon mobile-bar" style={{ position: 'fixed', top: 12, left: 10, zIndex: 30 }} onClick={() => setMenuOpen(true)} aria-label="Menu"><IconMenu /></button>
        {page === 'calendar' && <CalendarPage />}
        {page === 'requests' && <RequestsPage />}
        {page === 'stats' && <StatsPage />}
        {page === 'doctors' && <DoctorsPage />}
        {page === 'shifts' && <ShiftsPage />}
        {page === 'rules' && <RulesPage />}
        {page === 'services' && <ServicesPage />}
      </main>
      <Toasts />
    </div>
  );
}

function nextTheme(t: 'auto' | 'light' | 'dark') {
  return t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto';
}

function Cross() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" /></svg>;
}

function ServiceSwitcher({ onManage }: { onManage: () => void }) {
  const services = useStore(s => s.services);
  const activeId = useStore(s => s.activeId);
  const active = services.find(s => s.id === activeId);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button className="btn" style={{ justifyContent: 'flex-start', height: 46, padding: '0 10px', width: '100%' }}
        onClick={e => setAnchor(e.currentTarget.getBoundingClientRect())}>
        <span className="col grow" style={{ gap: 0, alignItems: 'flex-start', minWidth: 0 }}>
          <span className="tiny muted">{active ? SERVICE_KIND_LABELS[active.kind] : ''}</span>
          <span style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{active?.name}</span>
        </span>
        <IconChevronDown size={16} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)}>
          <div className="pop-label">Servizi</div>
          {services.map(s => (
            <button key={s.id} className="pop-item" onClick={() => { switchService(s.id); setAnchor(null); }}>
              <span style={{ fontWeight: s.id === activeId ? 650 : 500 }}>{s.name}</span>
              <span className="why">{SERVICE_KIND_LABELS[s.kind]}</span>
            </button>
          ))}
          <div className="pop-sep" />
          <button className="pop-item" onClick={() => { setAnchor(null); onManage(); }}>Nuovo servizio, rinomina, backup…</button>
        </Popover>
      )}
    </>
  );
}

function Welcome() {
  return (
    <div className="gate">
      <div className="card" style={{ width: 'min(720px, 100%)', padding: 28 }}>
        <div className="row" style={{ marginBottom: 18 }}>
          <div className="brand-mark" style={{ width: 40, height: 40 }}><Cross /></div>
          <div>
            <h1>Benvenuto</h1>
            <p className="muted">Crea il primo servizio: potrai aggiungerne altri (es. una seconda terapia intensiva) in seguito.</p>
          </div>
        </div>
        <NewServiceForm />
      </div>
    </div>
  );
}

