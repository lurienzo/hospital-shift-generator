import App from './App';
import { ConfigProvider } from './state/ConfigProvider';
import { useServices } from './state/serviceContext';

/**
 * Il servizio attivo fa da chiave dell'albero: cambiandolo, configurazione e
 * calendario vengono ricostruiti da zero e nessun dato di un servizio resta
 * visibile in un altro.
 */
export function Root() {
  const { activeId } = useServices();

  return (
    <ConfigProvider key={activeId}>
      <App key={activeId} />
    </ConfigProvider>
  );
}
