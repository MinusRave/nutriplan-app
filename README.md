# DietingWithJoe

DietingWithJoe è un'applicazione web che utilizza l'intelligenza artificiale (Claude di Anthropic) per aiutare gli utenti a ottenere piani alimentari personalizzati attraverso una conversazione naturale con Joe, un assistente nutrizionale virtuale.

## Caratteristiche

- 🤖 **Interfaccia conversazionale** con Joe (alimentato da Claude AI) per raccogliere informazioni nutrizionali
- 💬 **Risposte in streaming** per un'esperienza utente più reattiva e naturale
- 🌐 **Supporto multilingua** (Italiano, Inglese, Francese, Spagnolo, Tedesco, Portoghese)
- 📱 **Design responsive** ottimizzato per dispositivi mobili e desktop
- 🌙 **Modalità dark** che si adatta automaticamente alle preferenze del sistema
- 🔒 **Sicurezza integrata** con protezione CSRF, rate limiting e altre misure
- 📊 **Analytics** con Google Analytics e Meta Pixel (opzionale)
- ♿ **Accessibilità** con supporto per screen reader e altre tecnologie assistive

## Demo

Prova l'applicazione live su [dietingwithjoe.fly.dev](https://dietingwithjoe.fly.dev)

## Prerequisiti

- Node.js (versione 16.x o superiore)
- Un account Anthropic con API key per Claude

## Installazione Locale

1. Clona il repository:
   ```
   git clone https://github.com/MinusRave/dietingwithjoe.git
   cd dietingwithjoe
   ```

2. Installa le dipendenze:
   ```
   npm install
   ```

3. Crea un file `.env` basato su `.env.example`:
   ```
   cp .env.example .env
   ```

4. Modifica il file `.env` inserendo la tua API key di Anthropic e altre configurazioni.

5. Avvia l'applicazione in modalità sviluppo:
   ```
   npm run dev
   ```

L'applicazione sarà disponibile all'indirizzo `http://localhost:3000` (o alla porta specificata nel file `.env`).

## Deployment su Fly.io

### Prerequisiti

- Account su [Fly.io](https://fly.io)
- Flyctl CLI installata sul tuo computer ([istruzioni di installazione](https://fly.io/docs/hands-on/install-flyctl/))

### Procedure di Deployment

1. Accedi a Fly.io:
   ```
   fly auth login
   ```

2. Inizializza l'applicazione (solo la prima volta):
   ```
   fly launch
   ```
   Segui le istruzioni e scegli un nome univoco per la tua app.

3. Imposta i segreti per le variabili d'ambiente:
   ```
   fly secrets set ANTHROPIC_API_KEY=your_api_key
   fly secrets set SESSION_SECRET=your_random_secret
   ```

4. Esegui il deployment:
   ```
   fly deploy
   ```

5. Apri la tua applicazione:
   ```
   fly open
   ```

## Struttura del Progetto

```
dietingwithjoe/
├── app.js              # File principale dell'applicazione
├── package.json        # Dipendenze e script
├── Dockerfile          # Configurazione per container Docker
├── fly.toml            # Configurazione per Fly.io
├── .env                # Configurazione ambiente (non versionata)
├── .env.example        # Esempio di configurazione
├── public/             # File statici
│   ├── css/            # Fogli di stile
│   ├── js/             # Script client-side
│   └── images/         # Immagini
├── views/              # Template EJS
│   ├── index.ejs       # Layout principale
│   └── pages/          # Pagine statiche (privacy, terms, contact)
└── locales/            # File di traduzione
    ├── it/             # Italiano
    ├── en/             # Inglese
    └── ...             # Altre lingue
```

## Funzionamento

L'applicazione utilizza Claude AI per guidare l'utente attraverso una conversazione strutturata che raccoglie:

1. **Dati personali**: età, genere, altezza, peso, livello di attività
2. **Obiettivi specifici**: perdita peso, mantenimento, aumento massa muscolare
3. **Condizioni mediche**: patologie, allergie, intolleranze
4. **Preferenze alimentari**: cibi preferiti/sgraditi, regimi alimentari
5. **Abitudini attuali**: numero pasti, orari, idratazione

Al termine della conversazione, i dati vengono inviati a un endpoint esterno per l'elaborazione del piano alimentare, che verrà poi inviato all'email dell'utente.

### Risposte in Streaming (SSE)

DietingWithJoe utilizza Server-Sent Events (SSE) per implementare il flusso di risposta in tempo reale da Claude AI:

1. **Esperienza utente migliorata**: Le risposte appaiono progressivamente mentre Claude genera il testo, offrendo un'esperienza più naturale simile a una chat reale
2. **Performance ottimizzata**: Riduce il tempo di attesa percepito dall'utente
3. **Implementazione robusta**: Sistema di fallback automatico a richieste tradizionali in caso di browser non supportati o problemi di connessione
4. **Indicatori di digitazione avanzati**: Animazioni e feedback visivi durante la generazione delle risposte

Il sistema di streaming è implementato sia lato server (Express.js) che lato client (JavaScript puro) senza dipendenze esterne aggiuntive.

## Personalizzazione

### Prompt di Sistema

È possibile modificare il prompt di sistema per Claude nel file `app.js` nella classe `NutritionalConversation`.

### Stile

Lo stile dell'applicazione può essere personalizzato modificando il file `public/css/style.css`.

### Traduzioni

Aggiungi o modifica le traduzioni nei file JSON nella cartella `locales/`.

## Manutenzione su Fly.io

- Visualizza i log:
  ```
  fly logs
  ```

- Scala l'applicazione:
  ```
  fly scale count 2  # Aumenta a 2 istanze
  ```

- Imposta dimensione della VM:
  ```
  fly scale vm shared-cpu-1x --memory 512
  ```

## Licenza

Distribuito con licenza MIT. Vedi il file `LICENSE` per maggiori informazioni.