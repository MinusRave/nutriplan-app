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
app.use(session({
  secret: process.env.SESSION_SECRET || 'nutriplan_secret_key',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true, // Protegge contro attacchi XSS
    maxAge: 1000 * 60 * 60 // 60 minuti
  }
}));

// CSRF protection
const csrfProtection = csurf({ cookie: { httpOnly: true, sameSite: 'strict' } });

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
  const parser = new UAParser(req.headers['user-agent']);
  req.clientInfo = {
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    browser: parser.getBrowser(),
    os: parser.getOS(),
    device: parser.getDevice(),
    language: req.language || 'it',
    timezone: req.headers['x-timezone'] || 'UTC',
    referrer: req.headers.referer || '',
    sessionId: req.session.id
  };
  next();
});

// GESTIONE CONVERSAZIONI

// Map per memorizzare le conversazioni attive
const conversations = new Map();

/**
 * Classe per gestire una conversazione con Claude
 */
class NutritionalConversation {
  constructor(language) {
    this.language = language || 'it';
    this.systemPrompt = this.getSystemPrompt();
    this.messages = [];
    this.claudeMessages = [];
    this.active = true;
    this.collectedData = null;
    this.lastInteraction = Date.now();
    this.conversationStep = 1;
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
   */
  async addMessage(content) {
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
      // Chiamata a Claude
      const response = await anthropic.messages.create({
        model: 'claude-3-7-sonnet-20250219',
        system: this.systemPrompt,
        messages: messagesForClaude,
        max_tokens: 1500,
        temperature: 0.7
      });

      const responseContent = response.content[0].text;

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
}

// ROUTING

// Home page
app.get('/', csrfProtection, (req, res) => {
  res.render('index', { 
    csrfToken: req.csrfToken(),
    clientInfo: req.clientInfo,
    currentLang: req.language
  });
});

// Cambio lingua
app.get('/changelanguage/:lng', (req, res) => {
  const supportedLangs = ['it', 'en', 'fr', 'es', 'de', 'pt'];
  const lng = req.params.lng;
  
  if (supportedLangs.includes(lng)) {
    res.cookie('i18next', lng);
    req.language = lng;
  }
  
  res.redirect('back');
});

// API: Inizia una nuova conversazione
app.post('/api/conversation/start', apiLimiter, csrfProtection, (req, res) => {
  try {
    const conversationId = req.session.id;
    const language = req.language || 'it';
    
    // Crea una nuova conversazione
    const conversation = new NutritionalConversation(language);
    
    // Salvala nella mappa
    conversations.set(conversationId, conversation);
    
    // Prepara il messaggio di benvenuto (specifico per lingua)
    let welcomeMessage;
    
    switch(language) {
      case 'en':
        welcomeMessage = "Hi! I'm Joe, your nutrition assistant. I'll help you create a personalized meal plan. To get started, could you tell me some basic information like your age, gender, height, weight, and physical activity level?";
        break;
      case 'fr':
        welcomeMessage = "Bonjour ! Je suis Joe, votre assistant nutritionnel. Je vais vous aider à créer un plan alimentaire personnalisé. Pour commencer, pourriez-vous me donner quelques informations de base comme votre âge, genre, taille, poids et niveau d'activité physique ?";
        break;
      case 'es':
        welcomeMessage = "¡Hola! Soy Joe, tu asistente nutricional. Te ayudaré a crear un plan de alimentación personalizado. Para empezar, ¿podrías proporcionarme información básica como tu edad, género, altura, peso y nivel de actividad física?";
        break;
      case 'de':
        welcomeMessage = "Hallo! Ich bin Joe, Ihr Ernährungsassistent. Ich helfe Ihnen, einen persönlichen Ernährungsplan zu erstellen. Um zu beginnen, könnten Sie mir einige grundlegende Informationen wie Alter, Geschlecht, Größe, Gewicht und körperliches Aktivitätsniveau mitteilen?";
        break;
      case 'pt':
        welcomeMessage = "Olá! Sou o Joe, seu assistente nutricional. Vou ajudá-lo a criar um plano alimentar personalizado. Para começar, poderia me fornecer algumas informações básicas como idade, gênero, altura, peso e nível de atividade física?";
        break;
      default:
        welcomeMessage = "Ciao! Sono Joe, il tuo assistente nutrizionale. Ti aiuterò a creare un piano alimentare personalizzato. Per iniziare, potresti dirmi alcune informazioni di base come età, genere, altezza, peso e livello di attività fisica?";
    }
    
    // Aggiungi il messaggio di benvenuto
    conversation.messages.push({
      role: 'assistant',
      content: welcomeMessage
    });
    
    res.json({
      conversationId,
      message: welcomeMessage,
      conversationStep: 1
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
    const { message } = req.body;
    const conversationId = req.session.id;
    
    if (!message) {
      return res.status(400).json({ error: req.t('error.invalidMessage') });
    }
    
    // Ottieni la conversazione corrente o creane una nuova
    let conversation = conversations.get(conversationId);
    if (!conversation) {
      conversation = new NutritionalConversation(req.language);
      conversations.set(conversationId, conversation);
    }
    
    // Aggiungi il messaggio e ottieni risposta
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
  const conversationId = req.session.id;
  const conversation = conversations.get(conversationId);
  
  if (!conversation) {
    return res.json({
      exists: false,
      isActive: true,
      conversationStep: 0,
      messages: []
    });
  }
  
  const state = conversation.getState();
  
  res.json({
    exists: true,
    ...state
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
        await axios.post(externalEndpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.EXTERNAL_API_KEY || ''}`
          }
        });
        console.log('Dati inviati con successo all\'endpoint esterno');
      } catch (error) {
        console.error('Errore nell\'invio dei dati all\'endpoint esterno:', error);
        // Continuiamo comunque, non blocchiamo l'esperienza utente
      }
    }
    
    // Reset della conversazione
    const conversationId = req.session.id;
    conversations.delete(conversationId);
    
    res.json({ success: true, message: req.t('submission.success') });
  } catch (error) {
    console.error('Errore nell\'invio dei dati:', error);
    res.status(500).json({ 
      error: req.t('submission.error'),
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

// Pulizia delle conversazioni inattive
setInterval(() => {
  const now = Date.now();
  const INACTIVE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 ore
  
  for (const [id, conversation] of conversations.entries()) {
    const inactiveTime = now - conversation.lastInteraction;
    if (inactiveTime > INACTIVE_THRESHOLD) {
      conversations.delete(id);
      console.log(`Conversazione ${id} rimossa per inattività`);
    }
  }
}, 60 * 60 * 1000); // Controlla ogni ora

// Avvio del server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server in esecuzione sulla porta ${PORT}`);
  console.log(`App disponibile all'indirizzo: http://localhost:${PORT}`);
});

module.exports = app; // Per i test
