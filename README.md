# Turni ospedale

Generatore di turni di reparto: sale operatorie e terapia intensiva. Si definiscono
turni, aree da coprire e medici; il generatore costruisce il mese rispettando
ferie, smonti e turni critici, e distribuisce notti, weekend e festivi in modo
equo anche fra un mese e l'altro.

Funziona interamente nel browser: nessun server, i dati restano nel
`localStorage` di chi usa l'app (con export/import di backup).

Online: <https://lurienzo.github.io/hospital-shift-generator/>

## Concetti

**Servizio.** Un ambito chiuso (Terapia Intensiva 1, Piastra Operatoria…) con
turni, aree, medici e calendari propri. Si crea da un modello: *Sale
operatorie*, *Terapia intensiva* o vuoto; oppure copiando la configurazione di
un altro servizio.

**Tipi di turno.** Completamente configurabili: nome, sigla, orario, colore.
Due proprietà cambiano il comportamento:

- *Notte*: il giorno dopo è **smonto** (vincolante, non si lavora); il secondo
  giorno è **riposo**, non obbligatorio ma conteggiato: se il medico lavora,
  compare come *riposo post-notte saltato* nel calendario e nelle statistiche.
- *Diurnismo*: si assegna a settimane intere allo stesso medico, anche a
  cavallo di due mesi.

**Aree e copertura.** Per ogni area (sala, postazione di TI, guardia) una
griglia turno × giorno dice quanti medici servono. La colonna **Festivo** vale
nei festivi infrasettimanali. Ogni casella può essere **critica** (C): va
coperta sempre, anche a costo di violare desiderate e preferenze.

**Lunghe.** Con *Lunghe* attivo (predefinito nel modello Sale) un medico può
fare più turni nella stessa giornata solo se sono **attaccati** (fine dell'uno =
inizio dell'altro) ed entro il massimo di ore impostato (12 di default):
mattina + pomeriggio sì, mattina + notte o pomeriggio + notte no. Regola
*Lunga nella stessa area*: chi fa mattina in una sala che prosegue il
pomeriggio, se fa anche il pomeriggio lo fa in quella sala; se fa solo la
mattina torna a casa e il pomeriggio lo copre un altro; se la sala chiude, può
spostarsi altrove. Obbligatoria (predefinito), preferibile o libera.

**Orari propri di un'area.** Una sala con orario diverso (es. 09–17) si crea
dalla sua scheda con *Orario di quest'area*: è un turno che vale solo lì e ha
orari modificabili sul posto. Un turno qualunque si può anche restringere a
un'area dalla colonna *Vale per* dei tipi di turno.

**Medici.** Per ciascuno: aree in cui lavora, turni che fa (es. niente notti),
giorni della settimana da evitare o vietati (anche per singolo turno), ore
settimanali proprie (part-time), massimo di notti al mese, data di ingresso.

**Ferie e desiderate.** Griglia medici × giorni del mese, compilata a pennello
(clic o trascinamento), con i medici in righe o in colonne a scelta:

| Sigla | Significato | Trattamento |
|---|---|---|
| F | Ferie | vincolo assoluto |
| A | Altra assenza (malattia, congresso…) | vincolo assoluto |
| D | Desiderata, giorno libero | rispettata se possibile |
| N | Niente notte quel giorno | rispettata se possibile |

Con *Proteggi le desiderate* (predefinito) un turno non critico resta scoperto
piuttosto che violare una desiderata. Le richieste si importano anche da file:
*Template Excel* scarica la griglia del mese già intestata con medici e giorni,
in uno dei due versi, la si compila e la si reimporta (.xlsx o .csv), oppure si
incolla direttamente da Excel. Il verso del file si riconosce da solo. I nomi vengono riconosciuti ignorando titoli e maiuscole, e prima di
importare si vede un riepilogo di cosa verrà inserito.

**Festivi.** Nazionali italiani automatici (Pasqua e Pasquetta calcolate, 4
ottobre dal 2026), più il santo patrono impostabile. Mese per mese si aggiunge
o toglie un festivo cliccando il giorno nella griglia delle richieste. Un
festivo conta come weekend e anche, a parte, come festivo.

**Calendario.** Vista per medico, per area o **per turno** (una colonna per
ogni turno, con la sala indicata solo se quel turno si fa in più sale), con i giorni in righe (sale o
medici in colonna; nella vista per area una colonna per sala con i turni del
giorno uno sopra l'altro, e ogni notte sempre in una colonna a parte, una per
area di notte) oppure in colonne. Le colonne seguono l'ordine delle aree, che si
cambia con ↑ ↓ in *Turni e copertura*. Di default le colonne
si dividono tutta la larghezza dello schermo; trascinando il bordo di una
qualunque intestazione si allargano o stringono tutte insieme (la larghezza
resta salvata) e *Adatta allo schermo* torna a quella automatica. Nella vista
per area si possono mostrare le colonne **Smonto** e **Riposo**, una coppia per
ogni notte e subito dopo di lei (es. Lunga | Notte | Smonto | Riposo | SEI Lunga
| SEI notte | Smonto | Riposo): chi ha fatto quella notte il giorno prima o due
giorni prima, con chi ha saltato il riposo in arancio barrato. Cliccando una casella si vede il perché
di errori e avvisi e si cambia il turno; trascinando un turno sopra quello di
un altro medico i due si scambiano (anche in giorni diversi), su una casella
vuota lo si sposta. I turni scoperti sono segnati con ‼ in rosso se critici e
con ! se normali. Le modifiche a mano non bloccano nulla: il lucchetto
(*Fissa*) è una scelta esplicita e serve solo a dire "rigenerando, questo turno
non cambia". Le sigle di turno e i nomi delle aree compaiono solo quando
servono a distinguere qualcosa. La stampa è un foglio schematico (una riga
per giorno, nomi nel colore del medico, weekend e festivi in grigio; servizio e
mese nella prima casella, nessuna intestazione né legenda, margini di 5 mm) che
sta tutto il mese su una pagina A4 orizzontale: prima di stampare l'app
misura il foglio, allunga le righe se avanza spazio o lo rimpicciolisce in
proporzione se serve, e nelle caselle i nomi vanno a capo invece di essere
tagliati.

**Statistiche.** Per il mese aperto oppure per *tutti i calendari* del
servizio (la versione definitiva di ogni mese, più il mese aperto): turni,
ore, notti, weekend, festivi, critici, settimane e giorni di diurnismo, riposi saltati, giorni di ferie e
assenze, desiderate e "no notte" rispettate su inserite, con lo scarto dalla
quota attesa.

**Turni del singolo giorno.** Dal calendario (vista per area o per turno) un
turno si può **rimuovere** per un giorno: la casella diventa grigia
"Rimosso", non va coperto e si ripristina con un clic. Con il **+** nella
casella del giorno si **aggiunge** un turno o un medico in più. Un turno si
può rendere **opzionale / da non coprire** per un giorno dal suo menu, oppure
sempre dalla colonna *Opzionale* in *Turni e copertura*: se resta vuoto non dà
avvisi, il generatore lo assegna solo a chi è sotto carico e non entra nelle
quote di equità.

**Ignorare una segnalazione.** Ogni avviso o errore (nel menu della casella o
nel pannello Segnalazioni) ha il pulsante *Ignora*; per gli errori viene
chiesta conferma. Le segnalazioni ignorate spariscono dal calendario e dai
conteggi di quella versione e restano nel gruppo *Ignorate*, da cui si
ripristinano. Le statistiche contano comunque i fatti reali (un riposo saltato
ignorato resta un riposo saltato).

**Versioni.** Ogni mese può avere più proposte. Una è **definitiva** (★):
alimenta le statistiche e l'equità dei mesi successivi.

## Il generatore

Le regole stanno in un solo punto (`src/domain/analysis.ts`): una funzione che
valuta i turni di un medico e restituisce violazioni rigide, avvisi con il loro
costo e il costo di equità. Il generatore la usa per scegliere, il calendario
per mostrare le segnalazioni: quello che il generatore evita è esattamente
quello che il calendario segnala.

1. I turni **fissati** a mano (🔒) restano dove sono.
2. I blocchi di **diurnismo** vengono assegnati per settimana intera.
3. **Giorno per giorno**, prima i critici, poi le notti, poi il resto: ogni
   posto va al medico per cui il costo complessivo cresce di meno.
4. Si ripete molte volte con ordini diversi e si tiene il risultato migliore.
5. Una **ricerca locale** (spostamenti e scambi fra medici) rifinisce il
   risultato.

Il pulsante principale genera sempre in modalità **accurata** (circa 10
secondi, con barra di avanzamento); la modalità rapida (circa 3 secondi) è nel
menu accanto.

Vincoli rigidi, mai violati: ferie e assenze, smonto, orari sovrapposti, aree e
turni esclusi, giorni vietati. Tre vincoli rigidi possono essere forzati solo
da un turno critico che altrimenti resterebbe scoperto: due turni non
sovrapposti nello stesso giorno, tetto di ore, catena della rotazione vincolante.

Avvisi (costi): desiderate e "no notte", riposo post-notte saltato, notti
troppo ravvicinate (distanza minima impostabile, 5 giorni di default), giorni
da evitare, notti oltre il massimo, troppi giorni di fila, ore fuori
intervallo, passi fuori rotazione.

Se le notti del mese sono più di quante i medici abilitati possano coprire
rispettando la distanza minima, il calendario lo dice prima di generare e
indica chi non fa notti: in quel caso le notti ravvicinate sono inevitabili.

**Equità cumulata.** Per ogni medico e ogni categoria (turni, ore, notti,
weekend, festivi, critici, per turno e per area) si calcola la quota attesa
ripartendo il carico di ogni mese in proporzione alla disponibilità: giorni di
ferie, part-time, chi non fa notti, data di ingresso. Lo scarto tra fatto e
atteso, sommato sui mesi definitivi (anno in corso, ultimi 12 mesi o tutto),
guida le scelte e compare nelle statistiche. Lo scarto ereditato dai mesi
precedenti si recupera gradualmente: in un mese al massimo circa metà della
quota mensile, così chi è rimasto indietro non si vede scaricare tutto (per
esempio tutte notti) in poche settimane. Il peso di ogni categoria si
regola in *Regole*.

**Rotazione.** Uno schema (es. Lunga → Notte → Smonto → Riposo) che i medici
seguono su tutte le aree. I turni che lo schema mette in giorni consecutivi
formano una **catena**: chi fa la lunga fa la notte il giorno dopo, e la notte
va a chi ha fatto la lunga il giorno prima. Il generatore assegna la catena
intera allo stesso medico, scegliendo per l'anello successivo la stessa area o
quella che la segue nell'ordine (Lunga → Notte, SEI Lunga → SEI notte), e la
ricerca locale sposta e scambia catene intere. Con la rotazione **vincolante**
una catena spezzata è un errore; lo smonto è comunque vincolante; il riposo è
l'unica cosa sacrificabile e, se salta, si conta come riposo saltato. Come
**preferenza** la catena spezzata è un avviso.

**Ore settimanali.** Forbice min–max (es. 36–42), con la scelta fra "si può
superare e recuperare" (conta il totale del mese) e "non si supera mai".

## Accesso

L'app può chiedere una password all'apertura. **Non è una misura di
sicurezza**: tutto gira nel browser e l'impronta della password è nel codice
pubblicato. Tiene fuori chi capita sull'indirizzo per caso; i turni comunque
restano nel browser di chi li crea.

Nel repo c'è solo l'impronta SHA-256:

```bash
npm run hash-password "una frase lunga"
```

stampa la riga per `.env.local` (`VITE_APP_PASSWORD_SHA256=…`, ignorato da git)
e il comando per il segreto del repository usato dalla pubblicazione. Senza la
variabile il blocco non si attiva. Con «Ricorda la password su questo
dispositivo» lo sblocco resta in `localStorage`; si revoca da *Servizi e backup
→ Accesso*.

## Sviluppo

```bash
npm install
npm run dev      # http://localhost:5173/hospital-shift-generator/
npm run check    # tipi + lint + test
npm run build    # produzione in dist/
```

Il percorso `/hospital-shift-generator/` è obbligatorio anche in locale: è il
`base` di Vite per la pubblicazione in sottocartella.

Ogni push su `master` pubblica su GitHub Pages tramite
`.github/workflows/deploy.yml` (controlli, build, deploy).

## Struttura

```
src/
  domain/          logica pura, senza React
    types.ts       modello dati
    dates.ts       date YYYY-MM-DD in UTC
    holidays.ts    festivi italiani e Pasqua
    defaults.ts    modelli di servizio e turni
    context.ts     contesto del mese: posti da coprire, coda del mese prima
    fairness.ts    quote attese ed equità cumulata
    analysis.ts    regole, avvisi e costi (unica fonte)
    generator.ts   generatore + ricerca locale (gira in un web worker)
  io/              Excel, CSV, incolla da Excel
  store/           stato salvato nel localStorage
  pages/           pagine dell'interfaccia
  ui/              componenti di base, icone, blocco password
```

Chiavi del `localStorage`: `turni2:services`, `turni2:svc:<id>:config`,
`turni2:svc:<id>:m:<YYYY-MM>`, `turni2:ui`. La versione 2 riparte da zero: i
dati della versione precedente (chiavi `hsg…`) restano nel browser ma non
vengono letti.
