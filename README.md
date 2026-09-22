# Turni ospedale

Applicazione per pianificare i turni di un reparto: si definiscono sale, fasce
orarie e medici, e il generatore produce il calendario del mese cercando la
distribuzione più equa possibile fra tutti.

Funziona interamente nel browser. Non c'è un server e i dati non lasciano il
computer: tutto è salvato nel `localStorage`.

## Indice

- [Concetti](#concetti)
- [Come si usa](#come-si-usa)
- [Vincoli e generazione](#vincoli-e-generazione)
- [Accesso all'applicazione](#accesso-allapplicazione)
- [Pubblicazione](#pubblicazione)
- [Sviluppo](#sviluppo)
- [Struttura del codice](#struttura-del-codice)

## Concetti

### Servizi

Un **servizio** è un ambito di lavoro chiuso: Terapia Intensiva 1, Piastra
Operatoria, e così via. Ogni servizio ha le proprie sale, i propri medici, le
proprie fasce orarie e i propri calendari, e i dati non si mescolano mai fra
servizi. Si passa da uno all'altro dal selettore in alto a destra.

Creando un servizio si può copiare la configurazione di uno esistente (sale,
medici, fasce, schemi) senza portarsi dietro calendari e statistiche.

### Fasce orarie

Le fasce sono configurabili in *Impostazioni*. Di base ci sono Mattina
(08–14), Pomeriggio (14–20) e Notte (20–08), ma si possono modificare e
aggiungerne altre: una lunga 08–20, una guardia di 24 ore, quello che serve.

Due fasce che si sovrappongono nel tempo non possono essere coperte dallo
stesso medico nella stessa giornata, e l'applicazione lo segnala da sola. La
notte 20–08 termina esattamente quando inizia la mattina del giorno dopo,
quindi non è una sovrapposizione: quel vincolo si esprime col flag
*smontante*.

### Fasce a rotazione

Alcuni turni non si assegnano giorno per giorno ma a **blocchi interi**. Il
caso tipico è il diurnismo: 08–16 dal lunedì al venerdì, dove la settimana è
un impegno unico affidato a una persona sola.

Marcando una fascia come *a rotazione* si indicano la durata del blocco
(tipicamente una settimana) e il giorno in cui comincia. Da quel momento:

- tutti i turni della fascia che cadono nello stesso blocco vanno allo stesso
  medico;
- il blocco conta **una unità** nelle statistiche, non i suoi singoli turni:
  ciò che si confronta fra i medici è quante settimane ciascuno ha fatto;
- il bilanciamento tiene conto dei blocchi già svolti nei mesi precedenti,
  così la rotazione resta equa sull'arco dell'anno;
- una settimana a cavallo di due mesi resta un blocco unico, e chi l'ha
  iniziata a fine mese la completa nel mese successivo.

### Schemi turni e rotazione del servizio

Uno **schema** è una sequenza standard di giornate, per esempio
`Pomeriggio → Lunga → Notte → Smonto → Riposo`. Smonto e riposo non sono
turni da coprire: indicano i giorni in cui non si lavora.

Lo schema descrive come si succedono le giornate di un **medico**, non cosa
serve a una sala. Attivandolo come **rotazione del servizio** (in
*Impostazioni*) diventa la regola che tutti cercano di seguire, e qualunque
sala può fornire il turno che il passo richiede: chi copre un pomeriggio in
Terapia Intensiva può trovarsi la notte in Piastra Operatoria, perché è il
passo successivo del giro.

**Non c'è un giorno di partenza da impostare.** La posizione di un medico nello
schema deriva dal turno che ha svolto più recentemente: chi ha fatto la notte è
atteso in smonto il giorno dopo. Da questo seguono tre cose utili:

- la rotazione **si avvia da sola** col primo calendario generato, e i medici
  si distribuiscono sulle posizioni del giro senza doverli sfasare a mano;
- **si riallinea** quando qualcuno esce dal giro per coprire un buco, invece di
  accumulare scarti rispetto a un calendario teorico;
- **prosegue fra i mesi**, riprendendo da dove era arrivata.

La regola ha due intensità. *Da seguire* è una preferenza: il generatore la
rispetta quando può, ma non lascia turni scoperti per rispettarla, e gli
scostamenti compaiono nel calendario come avvisi. *Vincolante* impedisce di
assegnare turni nei giorni di smonto e riposo previsti, anche a costo di
lasciarli scoperti.

Si può limitare la regola a un sottoinsieme di medici, per chi sta fuori dal
giro. Le statistiche mostrano l'**aderenza alla rotazione** di ciascuno.

Le fasce a rotazione (i blocchi, vedi sopra) restano fuori dal giro
giornaliero: impegnano un medico per una settimana intera, quindi durante un
blocco la rotazione resta sospesa e riprende dopo. Per questo non sono
selezionabili come passo di uno schema.

### Ore per medico

In *Impostazioni* si indica quante ore ciascuno dovrebbe svolgere, con un
minimo e un massimo per settimana o per mese (per esempio 36–42 ore
settimanali).

Il **minimo guida la distribuzione**: a parità di altri criteri viene servito
prima chi è più lontano dalla soglia, ma nessuno viene costretto a lavorare più
di quanto il servizio richieda.

Per il **massimo** si scelgono due comportamenti.

- **Si può superare e recuperare**, il predefinito, perché è come funziona un
  reparto: una settimana si sfora e nelle vicine si sta sotto. Quello che viene
  controllato è il **totale sui periodi completi**: con 36–42 ore su quattro
  settimane il totale ammesso va da 144 a 168 ore, e una settimana da 48
  compensata da tre da 36 rientra. I periodi sopra soglia che si recuperano
  vengono elencati a parte nel calendario, senza contare come problema.
- **Non si supera mai**, per i casi in cui il massimo è un limite invalicabile.
  Il generatore lo rispetta anche a costo di lasciare un turno scoperto.

Un medico può avere ore proprie, diverse da quelle del servizio, impostate
nella sua scheda.

Le settimane a cavallo di due mesi sono il punto delicato: guardate dal solo
mese in corso sembrerebbero sempre sotto il minimo. Per questo vengono
giudicate sul minimo solo quando il mese precedente è già salvato, e per lo
stesso motivo restano fuori dal bilancio complessivo, che si calcola sui soli
periodi interamente noti.

### Preferenze dei medici

Nella scheda di ciascun medico, oltre alle sale in cui non lavora, si
impostano:

- **Giorni e fasce.** Una griglia con i sette giorni e le fasce configurate,
  dove ogni casella ha tre stati: libera, *preferisce evitare* (avviso) e *non
  lavora mai* (errore). La riga "tutto il giorno" agisce sulla giornata intera
  e le caselle che ne derivano sono tratteggiate. Così si esprime sia "il
  giovedì non lavora" sia "preferisce non fare il giovedì pomeriggio".
- **Durata dei turni preferita.** Turni lunghi o turni brevi. La soglia fra i
  due non è un numero fisso: è il punto medio fra la fascia più breve e la più
  lunga del servizio, e viene mostrata nella scheda. Se tutte le fasce hanno la
  stessa durata la distinzione non si applica.
- **Ore proprie**, quando diverse da quelle del servizio.

Le preferenze orientano la scelta del generatore ma non lasciano turni
scoperti: quando nessuno è disponibile, il turno viene assegnato comunque e
compare fra gli avvisi. I divieti invece non vengono mai violati.

## Come si usa

1. **Sale operative** — aggiungi le sale o i reparti da coprire. Per ciascuno
   definisci la griglia dei turni della settimana: quali fasce servono in
   quali giorni. I pulsanti a fine riga riempiono una fascia su tutti i
   giorni, sui giorni lavorativi o sul weekend.
2. **Dottori** — aggiungi le persone. Per ognuna si indicano le sale in cui non
   lavora, i giorni e le fasce da evitare o vietate, la durata di turno
   preferita e le eventuali ore proprie.
3. **Genera** — scegli mese e anno, segna i festivi, indica assenze e
   disponibilità del mese, eventualmente fissa a mano qualche turno, e genera.
4. **Calendario** — la bozza appare qui. Si modifica cliccando i turni,
   trascinandoli per scambiare i medici, o aggiungendone molti in una volta
   con *Aggiungi turni*. Quando va bene, si salva come versione.
5. **Statistiche** — somma le versioni *attive* di ogni mese e mostra come è
   distribuito il carico. Per includere un mese, rendi attiva una delle sue
   versioni dal calendario.

### Versioni

Un mese può avere più versioni del calendario, per confrontare alternative.
Una sola è **attiva**: è quella che alimenta le statistiche e il bilanciamento
degli altri mesi. Le altre restano salvate e consultabili.

### Aggiunta multi-turno

*Aggiungi turni* crea molte assegnazioni in un'unica operazione: si scelgono
un medico, i giorni (anche per colonna, cliccando l'intestazione di un giorno
della settimana), le sale e le fasce. L'anteprima elenca esattamente cosa
verrà creato e perché qualcosa viene saltato: turno non previsto in quel
giorno, posto già occupato, turno già presente o conflitto con un vincolo.

## Vincoli e generazione

Il generatore prova molte soluzioni con punti di partenza diversi e tiene la
migliore. Il punteggio somma, in ordine di peso:

1. i turni rimasti **scoperti**;
2. le **violazioni** dei vincoli rigidi;
3. gli **avvisi**, cioè i vincoli morbidi;
4. lo **squilibrio** del carico fra medici.

Anche quando nessuna soluzione è perfetta viene restituita quella meno
problematica, e il calendario segnala turni scoperti, errori e avvisi.

### Vincoli rigidi

Un turno che li viola è segnato come errore:

| Vincolo | Significato |
|---|---|
| Non disponibile | assenza dichiarata per quel giorno o quella fascia |
| Sala esclusa | il medico non lavora in quella sala |
| Giorno escluso | il medico non lavora in quel giorno, o in quella sua fascia |
| Doppio turno | stesso medico due volte sulla stessa fascia |
| Orari sovrapposti | due turni dello stesso medico che si accavallano |
| Smontante | il giorno dopo un turno che impone riposo |
| Turno esclusivo | un altro turno nella giornata di un turno esclusivo |

### Vincoli morbidi

Segnalati come avvisi, il generatore li evita quando può ma non lascia turni
scoperti per rispettarli:

- **Riposo secondo giorno** — il secondo giorno dopo un turno che lo richiede.
- **Blocco diviso** — un blocco a rotazione coperto da medici diversi.
- **Fuori rotazione** — un turno che non corrisponde al passo previsto dalla
  rotazione del servizio, o assegnato in una giornata che lo schema vorrebbe
  libera.
- **Preferenza** — un turno in un giorno o una fascia che il medico preferisce
  evitare.
- **Oltre le ore** — un periodo oltre il massimo, quando il massimo è
  impostato come limite invalicabile. Col recupero attivo, al suo posto viene
  segnalato il bilancio complessivo fuori intervallo.

Gli scostamenti dalle ore richieste e dalla durata di turno preferita hanno un
pannello dedicato nel calendario, *Ore e preferenze*, diviso in tre parti: il
bilancio complessivo fuori intervallo, i singoli periodi fuori intervallo, e i
periodi sopra il massimo che si sono recuperati.

### Flag dei turni

Nella griglia della settimana ogni turno ha quattro flag:

- **C** critico — turno pesante, distribuito con priorità in modo equo;
- **S** smontante — il giorno dopo il medico non lavora;
- **R** riposo secondo giorno — anche il secondo giorno è di riposo;
- **E** esclusivo — nessun altro turno per quel medico in giornata.

I flag appartengono alla coppia giorno + fascia: la notte del sabato può avere
impostazioni diverse da quella del lunedì.

### Continuità dentro una sala

Oltre alla rotazione del servizio, ogni sala può chiedere una continuità
propria. Le modalità sono alternative fra loro:

- **Nessuna** — ogni turno assegnato singolarmente, cercando l'equilibrio.
- **Turni consecutivi** — N turni di fila allo stesso medico, eventualmente
  allineati a un giorno fisso della settimana.
- **Gruppi di giorni** — i giorni dello stesso gruppo vanno allo stesso medico
  nella medesima settimana.

Sono cose diverse dalla rotazione del servizio: riguardano la continuità
*dentro una sala*, non la successione delle giornate di un medico su tutte le
sale. Le fasce a rotazione agiscono comunque, perché sono una proprietà della
fascia e non della sala.

### Ordine di assegnazione

Il generatore procede per priorità decrescente di rigidità:

1. i turni fissati a mano;
2. i **blocchi** delle fasce a rotazione, che impegnano un medico per giorni;
3. i **gruppi di giorni** delle sale;
4. i **turni consecutivi** delle sale;
5. tutto il resto, dove i criteri di scelta sono, in ordine: la rotazione del
   servizio, le preferenze del medico sul giorno, la distanza dal minimo di
   ore, la durata di turno preferita e infine l'equità del carico.

I divieti per giorno agiscono prima di tutto questo, come condizione di
ammissibilità: un medico che li violerebbe non viene considerato. Il massimo di
ore fa lo stesso solo se impostato come limite invalicabile; col recupero
attivo resta un criterio di preferenza, e fra chi ha già raggiunto il minimo
viene scelto il meno carico, così le ore in eccesso si ripartiscono invece di
accumularsi sulla stessa persona.

## Accesso all'applicazione

L'applicazione può chiedere una password all'apertura. Serve a impedire che chi
capita sull'indirizzo per caso si trovi davanti il pianificatore del reparto.

**Non è una misura di sicurezza.** L'applicazione gira interamente nel browser,
quindi tutto ciò che serve a verificare la password viene scaricato insieme alla
pagina: chi apre gli strumenti per sviluppatori la aggira. Per una protezione
vera serve un controllo lato server, per esempio la protezione con password di
Netlify o Cloudflare Access davanti al sito.

Con il repository pubblico c'è un punto in più da tenere presente: l'impronta
della password sta nel codice compilato, che chiunque può scaricare. Da lì una
password corta o presente in un dizionario si ricava in pochi secondi, senza
nemmeno passare dall'applicazione. Vale quindi la pena scegliere una frase
lunga, non una parola con qualche cifra in coda.

I turni non sono comunque esposti: restano nel `localStorage` del browser di chi
li ha creati e non passano da nessun server. Chi apre l'indirizzo senza aver mai
usato l'app vede un'applicazione vuota.

### Come si imposta

Nel repo non finisce mai la password in chiaro, solo la sua impronta SHA-256.

```bash
npm run hash-password "la mia password"
```

Il comando stampa la riga da mettere in `.env.local`, che git ignora:

```
VITE_APP_PASSWORD_SHA256=<impronta>
```

Per la versione pubblicata, la stessa impronta va impostata come segreto del
repository, che il workflow di deploy legge in fase di compilazione:

```bash
gh secret set VITE_APP_PASSWORD_SHA256 --body <impronta>
```

> **Il prefisso `VITE_` pubblica.** Vite incorpora nel codice compilato ogni
> variabile che inizia per `VITE_`, e quel codice è scaricabile da chiunque apra
> il sito. Va bene per un'impronta, che è pensata per stare lì; non va bene per
> una chiave di un servizio esterno. Se un domani servisse una chiave vera,
> nessun prefisso `VITE_` la renderebbe segreta: servirebbe un pezzo lato
> server che la tenga e faccia lui le chiamate. Oggi il problema non esiste,
> perché l'applicazione non contatta nessun servizio: le sole dipendenze di
> esecuzione sono `react` e `react-dom`, e nel codice non c'è una `fetch`.

Se la variabile non è impostata il blocco non si attiva e l'applicazione si apre
senza chiedere nulla: è il comportamento voluto in sviluppo e nei test. Per
questo `tools/smoke.mjs` semina lo sblocco da sé leggendo l'impronta da
`.env.local`, altrimenti la verifica visiva si fermerebbe sul blocco.

### Quanto dura lo sblocco

Di default vale per la sessione del browser: sta in `sessionStorage`, quindi
riaprendo il browser la password va reinserita. Spuntando **«Ricorda la password
su questo dispositivo»** finisce invece in `localStorage` e resta.

Si disdice da *Impostazioni → Accesso*, con **Dimentica la password**. Quel
pulsante non rimette il blocco sulla sessione in corso, di proposito: farlo
smonterebbe l'applicazione e porterebbe via le modifiche non salvate. Toglie il
ricordo, e il blocco ricompare alla prossima apertura.

Nei due casi il valore salvato è l'impronta attesa, non un semplice sì. Così
cambiando la password dell'applicazione chi aveva spuntato «ricorda» si ritrova
il blocco, invece di restare dentro con un permesso vecchio.

## Pubblicazione

Il sito è pubblicato su GitHub Pages a ogni push su `master`, dal workflow
`.github/workflows/deploy.yml`:

<https://lurienzo.github.io/hospital-shift-generator/>

Il workflow esegue i controlli, compila, e carica `dist` su Pages con le azioni
ufficiali (`configure-pages`, `upload-pages-artifact`, `deploy-pages`). Pubblica
solo sul Pages di questo repository: non ha token né accesso ad altri repo.

Due cose da sapere se si riparte da zero su un altro account:

- in *Settings → Pages* la voce **Source** deve essere **GitHub Actions**, non un
  ramo. Il workflow prova ad attivarla da sé al primo giro (`enablement: true`),
  ma se il repository è privato serve un piano a pagamento e la pubblicazione
  non parte.
- `base` in `vite.config.ts` deve combaciare col nome del repository, perché il
  sito vive in una sottocartella. Se non combaciano la pagina esce bianca e in
  console si vedono i file `assets/` in errore 404.

## Sviluppo

```bash
npm install
npm run dev      # server di sviluppo
npm run check    # tipi + lint + test
npm run build    # produzione in dist/
```

| Comando | Cosa fa |
|---|---|
| `npm run dev` | server di sviluppo con ricarica a caldo |
| `npm run build` | controllo dei tipi e build di produzione |
| `npm run lint` | ESLint su tutti i sorgenti TypeScript |
| `npm test` | suite di test (Vitest) |
| `npm run check` | tipi, lint e test insieme |
| `npm run smoke` | verifica visiva in un browser headless |
| `npm run hash-password` | impronta della password di accesso |

### Verifica visiva

`npm run smoke` pilota l'applicazione in Chromium lungo un percorso completo
— creazione fasce, schema, sala, medici, generazione, aggiunta multi-turno,
salvataggio, statistiche, secondo servizio — e salva uno screenshot per ogni
passaggio in `tools/screenshots`, riportando eventuali errori di console.

Richiede il server di sviluppo avviato e, la prima volta,
`npx playwright install chromium`.

## Struttura del codice

```
src/
  models/types.ts       tipi del dominio
  domain/               logica pura, senza React
    shiftTypes.ts       fasce orarie, sovrapposizioni, blocchi di rotazione
    schemes.ts          schemi turni
    rotation.ts         posizione dei medici nel giro di rotazione
    preferences.ts      divieti, preferenze e durata dei turni
    hours.ts            ore per periodo, con i periodi a cavallo del mese
    validation.ts       vincoli, violazioni, turni da coprire
    stats.ts            statistiche e colonne delle tabelle
  services/
    ServiceRegistry.ts  anagrafica dei servizi e namespace dei dati
    StorageService.ts   persistenza e export CSV
    ScheduleGeneratorService.ts   generatore
  state/                configurazione e servizio attivo (contesti React)
  components/           interfaccia
  utils/                date e identificatori
```

Il livello `domain/` non dipende da React ed è dove vivono le regole: i vincoli
sono definiti una volta sola e usati sia dal generatore sia dall'interfaccia,
così quello che il generatore evita è esattamente quello che il calendario
segnala.

### Dati salvati

Le chiavi del `localStorage` hanno la forma `hsg:<idServizio>:<ambito>`, dove
l'ambito è `rooms`, `doctors`, `shiftTypes`, `schemes`, `rotationRule`,
`hoursTarget`, `schedule`, `versions` o `generationConfig`. L'elenco dei servizi sta in `hsg_services` e quello
attivo in `hsg_active_service`.

I dati salvati dalle versioni precedenti, che usavano chiavi globali senza
servizio, vengono ricondotti automaticamente a un primo servizio al primo
avvio. Alla lettura vengono convertiti anche il vecchio campo `timeSlot` delle
assegnazioni, che diventa `shiftTypeId`, e l'elenco `excludedWeekdays` dei
medici, che diventa un divieto di giornata intera fra le nuove regole. Nessuna
di queste conversioni è distruttiva.
