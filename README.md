# DietingWithJoe

DietingWithJoe è un'applicazione web che utilizza l'intelligenza artificiale (Claude di Anthropic) per aiutare gli utenti a ottenere piani alimentari personalizzati attraverso una conversazione naturale con Joe, un assistente nutrizionale virtuale.

## Caratteristiche

- 🤖 **Interfaccia conversazionale** con Joe (alimentato da Claude AI) per raccogliere informazioni nutrizionali
- 🌐 **Supporto multilingua** (Italiano, Inglese, Francese, Spagnolo, Tedesco, Portoghese)
- 📱 **Design responsive** ottimizzato per dispositivi mobili e desktop
- 🔒 **Sicurezza integrata** con protezione CSRF, rate limiting e altre misure
- 📊 **Analytics** con Google Analytics e Meta Pixel (opzionale)
- ♿ **Accessibilità** con supporto per screen reader e altre tecnologie assistive

## Prerequisiti

- Node.js (versione 14.x o superiore)
- Un account Anthropic con API key per Claude

## Installazione

1. Clona il repository:
   ```
   git clone https://github.com/yourusername/nutriplan.git
   cd nutriplan
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

5. Crea la cartella per le traduzioni:
   ```
   mkdir -p locales/it locales/en locales/fr locales/es locales/de locales/pt
   ```

6. Crea la cartella per i file statici:
   ```
   mkdir -p public/css public/js public/images/favicon
   ```

7. Copia i file di localizzazione nella cartella locales.

8. Copia i file CSS e JS nella cartella public.

## Avvio

Per avviare l'applicazione in modalità sviluppo:

```
npm run dev
```

Per avviare l'applicazione in produzione:

```
npm start
```

L'applicazione sarà disponibile all'indirizzo `http://localhost:3000` (o alla porta specificata nel file `.env`).

## Struttura del Progetto

```
nutriplan/
├── app.js              # File principale dell'applicazione
├── package.json        # Dipendenze e script
├── .env                # Configurazione ambiente (non versionata)
├── .env.example        # Esempio di configurazione
├── public/             # File statici
│   ├── css/            # Fogli di stile
│   ├── js/             # Script client-side
│   └── images/         # Immagini
├── views/              # Template EJS
│   └── index.ejs       # Layout principale
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

## Personalizzazione

### Prompt di Sistema

È possibile modificare il prompt di sistema per Claude nel file `app.js` nella classe `NutritionalConversation`.

### Stile

Lo stile dell'applicazione può essere personalizzato modificando il file `public/css/style.css`.

### Traduzioni

Aggiungi o modifica le traduzioni nei file JSON nella cartella `locales/`.

## Licenza

Distribuito con licenza MIT. Vedi il file `LICENSE` per maggiori informazioni.
