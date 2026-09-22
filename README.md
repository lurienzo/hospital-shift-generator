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

## Come si usa

1. **Sale operative** — aggiungi le sale o i reparti da coprire. Per ciascuno
   definisci la griglia dei turni della settimana: quali fasce servono in
   quali giorni. I pulsanti a fine riga riempiono una fascia su tutti i
   giorni, sui giorni lavorativi o sul weekend.
2. **Dottori** — aggiungi le persone. Per ognuna si possono indicare le sale e
   i giorni della settimana in cui non lavora mai.
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
| Giorno escluso | il medico non lavora in quel giorno della settimana |
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
5. tutto il resto, dove la rotazione del servizio è il primo criterio di
   scelta e l'equità del carico il secondo.

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
`schedule`, `versions` o `generationConfig`. L'elenco dei servizi sta in `hsg_services` e quello
attivo in `hsg_active_service`.

I dati salvati dalle versioni precedenti, che usavano chiavi globali senza
servizio, vengono ricondotti automaticamente a un primo servizio al primo
avvio. Anche il vecchio campo `timeSlot` delle assegnazioni viene convertito in
`shiftTypeId` alla lettura, senza migrazioni distruttive.
