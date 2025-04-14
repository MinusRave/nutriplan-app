// app.js - File principale dell'applicazione
require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const csurf = require('csurf');
const { Anthropic } = require('@anthropic-ai/sdk');
const i18next = require('i18next');
const i18nextMiddleware = require('i18next-http-middleware');
const Backend = require('i18next-fs-backend');
const UAParser = require('ua-parser-js');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid'); // Aggiungi dipendenza per generare ID univoci

// Configurazione Anthropic (Claude)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'your-api-key-here'
});

// Creazione dell'app Express
const app = express();

// MIDDLEWARE DI SICUREZZA

// Configurazione Helmet per la sicurezza
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com", "https://connect.facebook.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://www.facebook.com", "https://connect.facebook.net"],
      connectSrc: ["'self'", "https://www.google-analytics.com", "https://region1.google-analytics.com", "https://connect.facebook.net"]
    }
  },
  // Impostazione del flag HttpOnly per i cookie
  xssFilter: true,
  noSniff: true
}));

// Rate limiting per prevenire abusi
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 100, // limite per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Troppe richieste da questo IP, riprova più tardi'
});

// CONFIGURAZIONE MIDDLEWARE

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Configurazione sessione
// Funzione per determinare se usare cookie secure
const isSecure = () => {
  // In Fly.io tutti gli accessi sono già protetti da HTTPS
  if (process.env.FLY_APP_NAME) {
    return true;
  }
  // Altrimenti usiamo la variabile d'ambiente
  return process.env.NODE_ENV === 'production';
};

app.use(session({
  secret: process.env.SESSION_SECRET || 'nutriplan_secret_key',
  resave: true, // Per garantire sessioni persistenti
  saveUninitialized: true,
  cookie: { 
    secure: isSecure(), // Logica migliorata per Fly.io
    httpOnly: true, // Protegge contro attacchi XSS
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 giorni
    sameSite: 'lax' // Migliore compatibilità su mobile
  }
}));

// CSRF protection
const csrfProtection = csurf({ 
  cookie: { 
    httpOnly: true, 
    sameSite: 'lax', // Compatibilità mobile
    secure: isSecure(), // Usa la stessa logica della sessione
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 giorni (stessa durata della sessione)
  } 
});

// Configurazione del rilevamento della lingua e della localizzazione
i18next
  .use(Backend)
  .use(i18nextMiddleware.LanguageDetector)
  .init({
    backend: {
      loadPath: './locales/{{lng}}/{{ns}}.json'
    },
    fallbackLng: 'it',
    supportedLngs: ['it', 'en', 'fr', 'es', 'de', 'pt'],
    preload: ['it', 'en', 'fr', 'es', 'de', 'pt'],
    ns: ['common', 'nutrition'],
    defaultNS: 'common',
    detection: {
      order: ['querystring', 'cookie', 'header'],
      lookupQuerystring: 'lng',
      lookupCookie: 'i18next',
      lookupHeader: 'accept-language',
      caches: ['cookie']
    }
  });

app.use(i18nextMiddleware.handle(i18next));

// Configurazione EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware per raccogliere info sul client
app.use((req, res, next) => {
  const userAgent = req.headers['user-agent'] || '';
  const parser = new UAParser(userAgent);
  const result = parser.getResult();
  
  // Determina se è un dispositivo mobile
  const isMobile = 
    (result.device.type === 'mobile' || 
     result.device.type === 'tablet' || 
     /mobile|android|iphone|ipad|ipod/i.test(userAgent.toLowerCase()));
  
  req.clientInfo = {
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    userAgent: userAgent,
    browser: parser.getBrowser(),
    os: parser.getOS(),
    device: parser.getDevice(),
    isMobile: isMobile,
    language: req.language || 'it',
    timezone: req.headers['x-timezone'] || 'UTC',
    referrer: req.headers.referer || '',
    sessionId: req.session.id
  };
  
  // Log delle informazioni di sessione
  console.log(`Richiesta ${req.method} ${req.path} da ${isMobile ? 'mobile' : 'desktop'}, sessionId: ${req.session.id.substring(0, 8)}...`);
  
  next();
});

// GESTIONE CONVERSAZIONI

// Map per memorizzare le conversazioni attive
const conversations = new Map();
// Map per memorizzare le connessioni streaming attive
const activeStreamConnections = new Map();

/**
 * Classe per gestire una conversazione con Claude
 */
class NutritionalConversation {
  constructor(language) {
    this.id = uuidv4(); // Genera un ID univoco per ogni conversazione
    this.language = language || 'it';
    this.systemPrompt = this.getSystemPrompt();
    this.messages = [];
    this.claudeMessages = [];
    this.active = true;
    this.collectedData = null;
    this.lastInteraction = Date.now();
    this.conversationStep = 1;
    this.activeStreams = new Set(); // Per tenere traccia delle connessioni di streaming attive
  }

  /**
   * Ottiene il prompt di sistema nella lingua corretta
   */
  getSystemPrompt() {
    // Base del prompt in italiano
    const basePrompt = `
    # Istruzioni per Assistente Nutrizionale

    Sei un assistente specializzato chiamato Joe, esperto in nutrizione, cordiale e professionale.
    Il tuo compito è raccogliere informazioni per creare un piano alimentare personalizzato.
    
    ## Informazioni da raccogliere
    Devi raccogliere tutte queste informazioni dall'utente:

    1. Nome dell'utente
       * Chiedi subito il nome dell'utente all'inizio e utilizzalo durante la conversazione

    2. Dati personali di base:
       * Età
       * Genere
       * Altezza (in cm) e peso (in kg)
       * Livello di attività fisica (sedentario, moderatamente attivo, molto attivo)

    3. Obiettivi specifici:
       * Perdita di peso, mantenimento, aumento di massa muscolare
       * Eventuali obiettivi di salute specifici

    4. Condizioni mediche rilevanti:
       * Patologie preesistenti (diabete, ipertensione, ecc.)
       * Allergie o intolleranze alimentari
       * Restrizioni dietetiche per motivi medici

    5. Preferenze alimentari:
       * Alimenti preferiti e non graditi
       * Eventuali regimi alimentari seguiti (vegetariano, vegano, ecc.)
       * Preferenze culturali o religiose legate all'alimentazione

    6. Abitudini attuali:
       * Numero di pasti giornalieri
       * Orari dei pasti
       * Abitudini di idratazione

    ## Regole per la conversazione
    - Sii amichevole ma conciso
    - Utilizza il nome dell'utente per rendere la conversazione più personale
    - Guida l'utente passo dopo passo
    - Valida i dati (ad es. peso tra 30-300kg, età tra 1-120 anni, ecc.)
    - Se un dato non è valido, chiedi gentilmente di fornirlo di nuovo
    - Se l'utente fornisce già informazioni in una volta, usa quelle e chiedi solo le informazioni mancanti
    - Quando hai raccolto tutte le informazioni, fornisci un riepilogo completo e chiedi all'utente di confermare
    - Se conferma, chiedi l'email dove inviare il piano alimentare
    - Valida bene l'email
    - Dopo aver ottenuto l'email, concludi la conversazione con un messaggio di ringraziamento personalizzato con il nome
    
    ## Formato speciale per la conclusione
    Quando hai raccolto tutti i dati validi, DEVI concludere il messaggio con questo tag: 
    <DATI_COMPLETI>
    {
      "nome": "valore",
      "datiPersonali": {
        "nome" : valore
        "eta": valore,
        "genere": "valore",
        "peso": valore,
        "altezza": valore,
        "livelloAttivita": "valore"
      },
      "obiettivi": {
        "tipoObiettivo": "valore",
        "obiettiviSalute": ["valore1", "valore2"] o []
      },
      "condizioniMediche": {
        "patologie": ["valore1", "valore2"] o [],
        "allergie": ["valore1", "valore2"] o [],
        "restrizioniDietetiche": ["valore1", "valore2"] o []
      },
      "preferenzeAlimentari": {
        "alimentiPreferiti": ["valore1", "valore2"] o [],
        "alimentiNonGraditi": ["valore1", "valore2"] o [],
        "regimeAlimentare": "valore",
        "preferenzeCulturali": "valore" o null
      },
      "abitudiniAttuali": {
        "numeroPasti": valore,
        "orariPasti": ["valore1", "valore2", "valore3"] o [],
        "abitudiniIdratazione": "valore"
      },
      "email": "valore"
    }
    </DATI_COMPLETI>
    
    Dopo questo tag, la conversazione è considerata conclusa.
    `;

    // Traduzioni disponibili (per ora solo inglese come esempio)
    const translations = {
      en: `
      # Instructions for Nutritional Assistant

      You are a specialized assistant named Joe, expert in nutrition, friendly and professional.
      Your task is to collect information to create a personalized meal plan.
      
      ## Information to collect
      You must collect all this information from the user:

      1. User's name
         * Ask for the user's name at the beginning and use it throughout the conversation

      2. Basic personal data:
         * Age
         * Gender
         * Height (in cm) and weight (in kg)
         * Physical activity level (sedentary, moderately active, very active)

      3. Specific goals:
         * Weight loss, maintenance, muscle gain
         * Any specific health goals

      4. Relevant medical conditions:
         * Pre-existing conditions (diabetes, hypertension, etc.)
         * Food allergies or intolerances
         * Dietary restrictions for medical reasons

      5. Food preferences:
         * Favorite and disliked foods
         * Any dietary regimes followed (vegetarian, vegan, etc.)
         * Cultural or religious preferences related to food

      6. Current habits:
         * Number of daily meals
         * Meal times
         * Hydration habits

      ## Conversation rules
      - Be friendly but concise
      - Use the user's name to make the conversation more personal
      - Guide the user step by step
      - Validate the data (e.g. weight between 30-300kg, age between 1-120 years, etc.)
      - If data is invalid, kindly ask for it again
      - If the user already provides information at once, use it and only ask for missing information
      - When you have collected all the information, provide a complete summary and ask the user to confirm
      - If confirmed, ask for the email where to send the meal plan
      - Validate the email carefully
      - After obtaining the email, conclude the conversation with a personalized thank you message using their name
      
      ## Special format for conclusion
      When you have collected all valid data, YOU MUST conclude the message with this tag:
      <DATI_COMPLETI>
      {
        "nome": "value",
        "datiPersonali": {
          "eta": value,
          "genere": "value",
          "peso": value,
          "altezza": value,
          "livelloAttivita": "value"
        },
        "obiettivi": {
          "tipoObiettivo": "value",
          "obiettiviSalute": ["value1", "value2"] or []
        },
        "condizioniMediche": {
          "patologie": ["value1", "value2"] or [],
          "allergie": ["value1", "value2"] or [],
          "restrizioniDietetiche": ["value1", "value2"] or []
        },
        "preferenzeAlimentari": {
          "alimentiPreferiti": ["value1", "value2"] or [],
          "alimentiNonGraditi": ["value1", "value2"] or [],
          "regimeAlimentare": "value",
          "preferenzeCulturali": "value" or null
        },
        "abitudiniAttuali": {
          "numeroPasti": value,
          "orariPasti": ["value1", "value2", "value3"] or [],
          "abitudiniIdratazione": "value"
        },
        "email": "value"
      }
      </DATI_COMPLETI>
      
      After this tag, the conversation is considered concluded.
      `
      // Qui si potrebbero aggiungere altre traduzioni (fr, es, de, pt)
    };

    // Restituisci il prompt nella lingua corretta o quello italiano come fallback
    return translations[this.language] || basePrompt;
  }

  /**
   * Aggiunge un messaggio alla conversazione
   * @param {string} content - Il messaggio dell'utente
   * @param {function} streamCallback - Callback opzionale per lo streaming della risposta
   * @param {string} requestId - ID univoco della richiesta per evitare duplicazioni
   */
  async addMessage(content, streamCallback = null, requestId = null) {
    // Aggiorna timestamp ultima interazione
    this.lastInteraction = Date.now();

    // Aggiungi messaggio dell'utente
    this.messages.push({
      role: 'user',
      content: content
    });

    // Prepara i messaggi per Claude
    const messagesForClaude = [
      ...this.claudeMessages,
      { role: 'user', content: content }
    ];

    try {
      let responseContent = '';
      let isStreaming = !!streamCallback;

      if (isStreaming) {
        // Se è fornito un requestId, memorizziamo la connessione
        if (requestId) {
          // Registriamo la nuova stream e chiudiamo eventuali stream precedenti
          if (this.activeStreams.size > 0) {
            console.log(`Chiusura di ${this.activeStreams.size} connessioni streaming precedenti per conversazione ${this.id}`);
            
            // Crea una copia dell'insieme per evitare problemi durante l'iterazione
            const previousStreamIds = [...this.activeStreams];
            
            // Chiudi ogni connessione precedente
            for (const streamId of previousStreamIds) {
              // Recupera e chiudi la connessione dal registro globale
              const previousConnection = activeStreamConnections.get(streamId);
              if (previousConnection && previousConnection.res && !previousConnection.res.finished) {
                console.log(`Chiusura connessione streaming: ${streamId}`);
                try {
                  // Invia un messaggio di chiusura
                  previousConnection.res.write(`data: {"isComplete":true,"forceClose":true}\n\n`);
                  previousConnection.res.end();
                } catch (e) {
                  console.error(`Errore nella chiusura della connessione: ${e.message}`);
                }
                
                // Rimuovi dal registro delle connessioni attive
                activeStreamConnections.delete(streamId);
              }
              
              // Rimuovi dall'insieme delle stream attive per questa conversazione
              this.activeStreams.delete(streamId);
            }
          }
          
          // Registra la nuova connessione
          this.activeStreams.add(requestId);
          activeStreamConnections.set(requestId, { 
            res: streamCallback.res, 
            timestamp: Date.now(),
            conversationId: this.id
          });
          
          console.log(`Registrata nuova connessione streaming: ${requestId} per conversazione ${this.id}`);
        }
        
        // Streaming call
        const stream = await anthropic.messages.stream({
          model: 'claude-3-7-sonnet-20250219',
          system: this.systemPrompt,
          messages: messagesForClaude,
          max_tokens: 1500,
          temperature: 0.7
        });

        // Initialize a buffer to collect the chunks
        let fullContent = '';
        
        // Process each chunk as it arrives
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            const chunkText = chunk.delta.text;
            fullContent += chunkText;
            
            // Send each chunk to the client in real-time
            if (streamCallback) {
              // Verifica se la connessione è ancora attiva prima di inviare
              if (this.activeStreams.has(requestId)) {
                const streamData = {
                  chunk: chunkText,
                  fullContent,
                  isComplete: false,
                  conversationStep: this.conversationStep,
                  requestId: requestId
                };
                
                streamCallback(streamData);
              } else {
                console.log(`Connessione ${requestId} non più attiva, interruzione streaming`);
                break;
              }
            }
          }
        }
        
        // Get the full response
        responseContent = fullContent;
        
        // Final update with complete flag
        if (streamCallback && this.activeStreams.has(requestId)) {
          const finalData = {
            chunk: '',
            fullContent: responseContent,
            isComplete: true,
            conversationStep: this.conversationStep,
            requestId: requestId
          };
          
          streamCallback(finalData);
          
          // Dopo l'invio del messaggio finale, rimuovi la connessione
          this.activeStreams.delete(requestId);
          activeStreamConnections.delete(requestId);
        }
      } else {
        // Non-streaming call (fallback)
        const response = await anthropic.messages.create({
          model: 'claude-3-7-sonnet-20250219',
          system: this.systemPrompt,
          messages: messagesForClaude,
          max_tokens: 1500,
          temperature: 0.7
        });

        responseContent = response.content[0].text;
      }

      // Aggiungi la risposta alla cronologia
      this.messages.push({
        role: 'assistant',
        content: responseContent
      });

      this.claudeMessages.push(
        { role: 'user', content: content },
        { role: 'assistant', content: responseContent }
      );

      // Aggiorna lo stato della conversazione
      this.updateConversationState(responseContent);

      // Controlla se è presente il tag di completamento
      if (responseContent.includes('<DATI_COMPLETI>')) {
        this.active = false;
        
        // Estrai i dati JSON dal tag
        try {
          const regex = /<DATI_COMPLETI>([\s\S]*?)<\/DATI_COMPLETI>/;
          const match = responseContent.match(regex);
          
          if (match && match[1]) {
            this.collectedData = JSON.parse(match[1].trim());
          }
        } catch (error) {
          console.error('Errore nell\'estrazione dei dati:', error);
        }
      }

      return {
        content: responseContent,
        isActive: this.active,
        collectedData: this.collectedData,
        conversationStep: this.conversationStep
      };
    } catch (error) {
      console.error('Errore nella chiamata a Claude:', error);
      throw error;
    }
  }

  /**
   * Aggiorna lo stato della conversazione in base alla risposta
   */
  updateConversationState(response) {
    // Step 1: Benvenuto (già impostato all'inizio)
    
    // Step 2: Nome e Dati personali
    if (response.includes('nome') || response.includes('mi chiamo') || 
        response.includes('eta') || response.includes('età') || 
        response.includes('genere') || response.includes('peso') || 
        response.includes('altezza') || response.includes('attività fisica')) {
      this.conversationStep = Math.max(2, this.conversationStep);
    }
    
    // Step 3: Obiettivi
    else if (response.includes('obiettivi') || response.includes('perdita di peso') || 
             response.includes('mantenimento') || response.includes('massa muscolare')) {
      this.conversationStep = Math.max(3, this.conversationStep);
    }
    
    // Step 4: Condizioni mediche
    else if (response.includes('condizioni mediche') || response.includes('patologie') || 
             response.includes('allergie') || response.includes('intolleranze')) {
      this.conversationStep = Math.max(4, this.conversationStep);
    }
    
    // Step 5: Preferenze alimentari
    else if (response.includes('preferenze alimentari') || response.includes('alimenti preferiti') || 
             response.includes('cibi graditi') || response.includes('regimi alimentari')) {
      this.conversationStep = Math.max(5, this.conversationStep);
    }
    
    // Step 6: Abitudini
    else if (response.includes('abitudini') || response.includes('pasti giornalieri') || 
             response.includes('orari dei pasti') || response.includes('idratazione')) {
      this.conversationStep = Math.max(6, this.conversationStep);
    }
    
    // Step 7: Email
    else if (response.includes('email') || response.includes('indirizzo email') || 
             response.includes('contatto')) {
      this.conversationStep = Math.max(7, this.conversationStep);
    }
    
    // Step 8: Riepilogo
    else if (response.includes('riepilogo') || response.includes('riassunto') || 
             response.includes('confermare')) {
      this.conversationStep = Math.max(8, this.conversationStep);
    }
  }

  /**
   * Ottiene lo stato attuale della conversazione
   */
  getState() {
    return {
      isActive: this.active,
      collectedData: this.collectedData,
      lastInteraction: this.lastInteraction,
      conversationStep: this.conversationStep,
      isCompleted: this.collectedData !== null, // Una conversazione è completa solo se ha dati raccolti
      messages: this.messages.map(msg => {
        if (msg.role === 'assistant') {
          return {
            ...msg,
            content: msg.content.replace(/<DATI_COMPLETI>[\s\S]*?<\/DATI_COMPLETI>/g, '').trim()
          };
        }
        return msg;
      })
    };
  }
  
  /**
   * Chiude tutte le connessioni di streaming attive per questa conversazione
   */
  closeAllStreams() {
    if (this.activeStreams.size > 0) {
      console.log(`Chiusura di ${this.activeStreams.size} connessioni streaming per conversazione ${this.id}`);
      
      // Crea una copia per evitare problemi durante l'iterazione
      const streamIds = [...this.activeStreams];
      
      // Chiudi ogni connessione
      for (const streamId of streamIds) {
        const connection = activeStreamConnections.get(streamId);
        if (connection && connection.res && !connection.res.finished) {
          try {
            connection.res.write(`data: {"isComplete":true,"forceClose":true}\n\n`);
            connection.res.end();
          } catch (e) {
            console.error(`Errore nella chiusura della connessione: ${e.message}`);
          }
          
          // Rimuovi dai registri
          activeStreamConnections.delete(streamId);
        }
        
        this.activeStreams.delete(streamId);
      }
    }
  }
}

// ROUTING

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', version: process.env.npm_package_version || '1.0.0' });
});

// Home page
app.get('/', csrfProtection, (req, res) => {
  res.render('index', { 
    csrfToken: req.csrfToken(),
    clientInfo: req.clientInfo,
    currentLang: req.language
  });
});

// Static pages
app.engine('ejs', require('ejs').renderFile);

// Helper function to capture included content
app.locals.captureContent = function(template, data) {
  return require('ejs').render(template, data);
};

app.get('/privacy', (req, res) => {
  // First render the template content
  const templatePath = path.join(__dirname, 'views', 'pages', 'privacy.ejs');
  const templateContent = require('fs').readFileSync(templatePath, 'utf8');
  const data = {
    t: req.t,
    currentLang: req.language
  };
  
  // Capture the content
  const html = require('ejs').render(templateContent, data);
  
  // Then render with the layout
  res.render('pages/layout', {
    pageTitle: req.t('pages.privacy.title'),
    pageContent: html,
    currentLang: req.language,
    t: req.t,
    originalUrl: req.originalUrl
  });
});

app.get('/terms', (req, res) => {
  // First render the template content
  const templatePath = path.join(__dirname, 'views', 'pages', 'terms.ejs');
  const templateContent = require('fs').readFileSync(templatePath, 'utf8');
  const data = {
    t: req.t,
    currentLang: req.language
  };
  
  // Capture the content
  const html = require('ejs').render(templateContent, data);
  
  // Then render with the layout
  res.render('pages/layout', {
    pageTitle: req.t('pages.terms.title'),
    pageContent: html,
    currentLang: req.language,
    t: req.t,
    originalUrl: req.originalUrl
  });
});

app.get('/contact', (req, res) => {
  // First render the template content
  const templatePath = path.join(__dirname, 'views', 'pages', 'contact.ejs');
  const templateContent = require('fs').readFileSync(templatePath, 'utf8');
  const data = {
    t: req.t,
    currentLang: req.language
  };
  
  // Capture the content
  const html = require('ejs').render(templateContent, data);
  
  // Then render with the layout
  res.render('pages/layout', {
    pageTitle: req.t('pages.contact.title'),
    pageContent: html,
    currentLang: req.language,
    t: req.t,
    originalUrl: req.originalUrl
  });
});

// Cambio lingua
app.get('/changelanguage/:lng', (req, res) => {
  const supportedLangs = ['it', 'en', 'fr', 'es', 'de', 'pt'];
  const lng = req.params.lng;
  const redirect = req.query.redirect || '/';
  
  if (supportedLangs.includes(lng)) {
    res.cookie('i18next', lng);
    req.language = lng;
  }
  
  res.redirect(redirect);
});

// API: Inizia una nuova conversazione
app.post('/api/conversation/start', apiLimiter, csrfProtection, (req, res) => {
  try {
    const sessionId = req.session.id;
    const language = req.language || 'it';
    
    // Verifica se esiste già una conversazione per questa sessione
    let conversation = conversations.get(sessionId);
    
    // Se la conversazione esiste, chiudi tutte le connessioni streaming aperte
    if (conversation) {
      conversation.closeAllStreams();
    }
    
    // Crea una nuova conversazione
    conversation = new NutritionalConversation(language);
    
    // Salvala nella mappa
    conversations.set(sessionId, conversation);
    
    // Prepara il messaggio di benvenuto (specifico per lingua)
    let welcomeMessage;
    
    switch(language) {
      case 'en':
        welcomeMessage = "Hi! I'm Joe, your nutrition assistant. I'll help you create a personalized meal plan. What's your name?";
        break;
      case 'fr':
        welcomeMessage = "Bonjour ! Je suis Joe, votre assistant nutritionnel. Je vais vous aider à créer un plan alimentaire personnalisé. Comment vous appelez-vous ?";
        break;
      case 'es':
        welcomeMessage = "¡Hola! Soy Joe, tu asistente nutricional. Te ayudaré a crear un plan de alimentación personalizado. ¿Cómo te llamas?";
        break;
      case 'de':
        welcomeMessage = "Hallo! Ich bin Joe, Ihr Ernährungsassistent. Ich helfe Ihnen, einen persönlichen Ernährungsplan zu erstellen. Wie heißen Sie?";
        break;
      case 'pt':
        welcomeMessage = "Olá! Sou o Joe, seu assistente nutricional. Vou ajudá-lo a criar um plano alimentar personalizado. Qual é o seu nome?";
        break;
      default:
        welcomeMessage = "Ciao! Sono Joe, il tuo assistente nutrizionale. Ti aiuterò a creare un piano alimentare personalizzato. Come ti chiami?";
    }
    
    // Aggiungi il messaggio di benvenuto
    conversation.messages.push({
      role: 'assistant',
      content: welcomeMessage
    });
    
    // Salva l'ID univoco della conversazione nella risposta
    res.json({
      conversationId: sessionId,
      message: welcomeMessage,
      conversationStep: 1,
      conversationUUID: conversation.id
    });
  } catch (error) {
    console.error('Errore nell\'avvio della conversazione:', error);
    res.status(500).json({ 
      error: req.t('error.generic'),
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

// API: Invia un messaggio alla conversazione
app.post('/api/conversation/message', apiLimiter, csrfProtection, async (req, res) => {
  try {
    const { message, stream } = req.body;
    const sessionId = req.session.id;
    
    if (!message) {
      return res.status(400).json({ error: req.t('error.invalidMessage') });
    }
    
    // Ottieni la conversazione corrente o creane una nuova
    let conversation = conversations.get(sessionId);
    if (!conversation) {
      conversation = new NutritionalConversation(req.language);
      conversations.set(sessionId, conversation);
    }
    
    // Determina se usare streaming in base al parametro nella richiesta
    const useStreaming = stream === true;
    
    if (useStreaming) {
      // Genera un ID univoco per questa richiesta di streaming
      const requestId = `${sessionId}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
      console.log(`Nuova richiesta di streaming: ${requestId} per conversazione ${conversation.id}`);
      
      // Set headers for SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Important for NGINX proxying
      res.setHeader('Access-Control-Allow-Origin', '*'); // Allow cross-origin requests
      res.flushHeaders(); // Immediately send headers
      
      // Crea un timeout per la risposta
      const responseTimeout = setTimeout(() => {
        console.warn(`Timeout per richiesta streaming ${requestId}`);
        
        // Invia un messaggio di errore al client
        const errorData = JSON.stringify({
          error: 'Timeout nella generazione della risposta',
          isComplete: true
        });
        
        res.write(`data: ${errorData}\n\n`);
        res.end();
        
        // Rimuovi dai registri
        conversation.activeStreams.delete(requestId);
        activeStreamConnections.delete(requestId);
      }, 60000); // 60 secondi
      
      // Streaming callback function
      const sendStreamChunk = (data) => {
        const { chunk, fullContent, isComplete, conversationStep, requestId: streamRequestId } = data;
        
        // Verifica che la risposta sia ancora aperta e non conclusa
        if (res.finished) {
          console.log(`Risposta già conclusa per ${streamRequestId}, ignoro il chunk`);
          return;
        }
        
        // Prepare visible content (remove DATI_COMPLETI tag if present)
        let visibleContent = fullContent;
        let collectedData = null;
        let isActive = true;
        
        if (visibleContent.includes('<DATI_COMPLETI>')) {
          visibleContent = visibleContent.replace(/<DATI_COMPLETI>[\s\S]*?<\/DATI_COMPLETI>/g, '').trim();
          isActive = false;
          
          // Extract collected data if this is the final chunk
          if (isComplete) {
            try {
              const regex = /<DATI_COMPLETI>([\s\S]*?)<\/DATI_COMPLETI>/;
              const match = fullContent.match(regex);
              
              if (match && match[1]) {
                collectedData = JSON.parse(match[1].trim());
              }
            } catch (error) {
              console.error('Errore nell\'estrazione dei dati:', error);
            }
          }
        }
        
        // Send the chunk as an event - proper SSE format
        const eventData = JSON.stringify({
          requestId: streamRequestId,
          chunk,
          message: visibleContent,
          isComplete,
          conversationStep,
          isActive,
          ...(collectedData && { collectedData })
        });
        
        res.write(`data: ${eventData}\n\n`);
        
        // Add debug logging for final message
        if (isComplete) {
          console.log(`Invio messaggio finale: isComplete=${isComplete}, conversationStep=${conversationStep}, isActive=${isActive}, hasData=${!!collectedData}`);
          
          // Pulisci il timeout
          clearTimeout(responseTimeout);
          
          // Chiudi la risposta SSE
          res.end();
          
          // Rimuovi la connessione dai registri
          conversation.activeStreams.delete(requestId);
          activeStreamConnections.delete(requestId);
        }
        
        // Force flush to ensure chunk is sent immediately
        res.flush && res.flush();
      };
      
      // Memorizza una reference alla risposta per poterla chiudere se necessario
      sendStreamChunk.res = res;
      
      try {
        // Start the streaming conversation
        await conversation.addMessage(message, sendStreamChunk, requestId);
      } catch (error) {
        console.error(`Errore durante lo streaming per ${requestId}:`, error);
        
        // Invia un messaggio di errore al client
        if (!res.finished) {
          const errorData = JSON.stringify({
            error: 'Errore nella generazione della risposta',
            errorMessage: process.env.NODE_ENV === 'development' ? error.message : null,
            isComplete: true
          });
          
          res.write(`data: ${errorData}\n\n`);
          res.end();
        }
        
        // Rimuovi dai registri
        clearTimeout(responseTimeout);
        conversation.activeStreams.delete(requestId);
        activeStreamConnections.delete(requestId);
      }
    } else {
      // Non-streaming response (traditional API)
      const response = await conversation.addMessage(message);
      
      // Estrai solo il contenuto visibile all'utente (senza il tag DATI_COMPLETI)
      let visibleContent = response.content;
      if (!response.isActive) {
        visibleContent = visibleContent.replace(/<DATI_COMPLETI>[\s\S]*?<\/DATI_COMPLETI>/g, '').trim();
      }
      
      res.json({
        message: visibleContent,
        conversationStep: response.conversationStep,
        isActive: response.isActive,
        ...(response.collectedData && { collectedData: response.collectedData })
      });
    }
  } catch (error) {
    console.error('Errore nella comunicazione con Claude:', error);
    res.status(500).json({ 
      error: req.t('error.connectionError'),
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

// API: Ottieni stato conversazione
app.get('/api/conversation/state', csrfProtection, (req, res) => {
  const sessionId = req.session.id;
  const conversation = conversations.get(sessionId);
  const isMobile = req.clientInfo.isMobile;
  
  console.log(`Richiesta stato conversazione da ${isMobile ? 'mobile' : 'desktop'}, sessionId: ${sessionId.substring(0, 8)}...`);
  
  // Ripristiniamo qualsiasi conversazione esistente, anche se incompleta
  if (!conversation) {
    console.log(`Conversazione non trovata per sessione ${sessionId.substring(0, 8)}. Iniziando nuova conversazione.`);
    return res.json({
      exists: false,
      isActive: true,
      conversationStep: 0,
      messages: []
    });
  }
  
  // Ripristiniamo la conversazione corrente
  const state = conversation.getState();
  
  // Aggiungiamo informazioni di debug
  console.log(`Ripristino conversazione: ${state.messages.length} messaggi, step: ${state.conversationStep}`);
  
  res.json({
    exists: true,
    ...state,
    conversationUUID: conversation.id,
    _debug: {
      sessionId: sessionId.substring(0, 8),
      isMobile: isMobile,
      timestamp: new Date().toISOString()
    }
  });
});

// API: Endpoint per l'invio dei dati finali
app.post('/api/submit', apiLimiter, csrfProtection, [
  body('userData').notEmpty().withMessage('Dati utente mancanti'),
  body('userData.email').isEmail().withMessage('Email non valida'),
  // Altri validatori possono essere aggiunti qui
], async (req, res) => {
  // Validazione
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  try {
    const { userData, conversationData } = req.body;
    const sessionId = req.session.id;
    
    // Recupera la conversazione
    const conversation = conversations.get(sessionId);
    
    if (conversation) {
      // Chiudi tutte le connessioni streaming attive
      conversation.closeAllStreams();
    }
    
    // Preparazione del payload
    const payload = {
      userData,
      conversationData,
      sessionInfo: {
        language: req.language,
        timestamp: new Date().toISOString(),
        clientInfo: req.clientInfo
      }
    };
    
    // Invio dei dati all'endpoint esterno (configura questo nel .env)
    const externalEndpoint = process.env.EXTERNAL_API_ENDPOINT;
    if (externalEndpoint) {
      try {
        console.log(`Invio dati all'endpoint esterno: ${externalEndpoint}`);
        await axios.post(externalEndpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.EXTERNAL_API_KEY || ''}`
          }
        });
        console.log('Dati inviati con successo all\'endpoint esterno');
      } catch (error) {
        console.error('Errore nell\'invio dei dati all\'endpoint esterno:', error.message);
        // Continuiamo comunque, non blocchiamo l'esperienza utente
      }
    } else {
      console.log('Nessun endpoint esterno configurato. Saltando invio dati a servizi esterni.');
    }
    
    // Reset della conversazione
    conversations.delete(sessionId);
    
    res.json({ success: true, message: req.t('submission.success') });
  } catch (error) {
    console.error('Errore nell\'invio dei dati:', error);
    res.status(500).json({ 
      error: req.t('submission.error'),
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

// Pulizia delle conversazioni inattive e delle connessioni streaming
setInterval(() => {
  const now = Date.now();
  const INACTIVE_THRESHOLD = 3 * 24 * 60 * 60 * 1000; // 3 giorni
  const STREAM_TIMEOUT = 5 * 60 * 1000; // 5 minuti
  
  // Pulizia connessioni streaming
  for (const [id, connection] of activeStreamConnections.entries()) {
    const streamAge = now - connection.timestamp;
    if (streamAge > STREAM_TIMEOUT) {
      console.log(`Chiusura connessione streaming ${id} per timeout`);
      try {
        if (connection.res && !connection.res.finished) {
          connection.res.write(`data: {"isComplete":true,"forceClose":true,"reason":"timeout"}\n\n`);
          connection.res.end();
        }
      } catch (e) {
        console.error(`Errore nella chiusura della connessione: ${e.message}`);
      }
      
      // Rimuovi dai registri
      activeStreamConnections.delete(id);
      
      // Rimuovi anche dal registro della conversazione se esiste
      if (connection.conversationId) {
        const conversation = [...conversations.values()].find(c => c.id === connection.conversationId);
        if (conversation) {
          conversation.activeStreams.delete(id);
        }
      }
    }
  }
  
  // Pulizia conversazioni inattive
  for (const [id, conversation] of conversations.entries()) {
    const inactiveTime = now - conversation.lastInteraction;
    if (inactiveTime > INACTIVE_THRESHOLD) {
      // Chiudi tutte le connessioni streaming
      conversation.closeAllStreams();
      
      // Rimuovi la conversazione
      conversations.delete(id);
      console.log(`Conversazione ${id} rimossa per inattività`);
    }
  }
  
  // Log statistiche
  console.log(`Statistiche pulizia: ${conversations.size} conversazioni, ${activeStreamConnections.size} connessioni streaming`);
}, 15 * 60 * 1000); // Controlla ogni 15 minuti

// Avvio del server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server in esecuzione sulla porta ${PORT}`);
  console.log(`App disponibile all'indirizzo: http://localhost:${PORT}`);
});

module.exports = app; // Per i test