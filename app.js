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
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const socketIo = require('socket.io');

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
      connectSrc: ["'self'", "https://www.google-analytics.com", "https://region1.google-analytics.com", "https://connect.facebook.net", "wss://*", "ws://*"] // Aggiunto supporto per WebSockets
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
    this.conversationStep = 1;
    this.lastInteraction = Date.now();
    this.collectedData = null;
    this.id = uuidv4(); // Identificatore unico della conversazione
  }
  
  /**
   * Ottiene il prompt di sistema in base alla lingua
   */
  getSystemPrompt() {
    // Prompt di sistema per la raccolta dati nutrizionali
    return `
    # Assistente Nutrizionale

    Sei Joe, un assistente nutrizionale esperto che aiuta a creare piani alimentari personalizzati. In questa conversazione, devi raccogliere informazioni dettagliate sulle esigenze nutrizionali dell'utente.

    ## Conversazione
    La conversazione sarà strutturata nelle seguenti fasi:
    1. Richiedi il nome utente
    2. Raccolta dati demografici (età, genere, altezza, peso)
    3. Raccolta livello di attività fisica (sedentario, moderatamente attivo, molto attivo)
    4. Raccolta obiettivi di salute (perdita peso, mantenimento, massa muscolare, salute generale)
    5. Raccolta informazioni su eventuali condizioni mediche o allergie
    6. Raccolta preferenze alimentari e restrizioni
    7. Raccolta informazioni su pasti e programma alimentare attuali
    8. Richiesta email per invio del piano
    
    ## Comportamento
    - Sii conciso per la massima semplicità di lettura anche su mobile ma amichevole
    - Non inviare tutti i punti in una volta, procedi gradualmente
    - Fai una domanda alla volta per non sovraccaricare l'utente
    - Esprimi empatia verso situazioni di salute complesse
    - Chiedi chiarimenti se le informazioni fornite sono incomplete o poco chiare
    - Non dare consigli nutrizionali specifici in questa fase
    - Adatta il tono in base alle risposte dell'utente
    - Mantieni un tono professionale ma accessibile
    
    ## Logica della conversazione
    - Conferma e ripeti le informazioni importanti
    - Non saltare passaggi
    - Segui una progressione logica
    - Adatta le domande successive in base alle risposte precedenti
    - Per preferenze alimentari, chiedi cibi preferiti e non graditi
    - Per condizioni mediche, sii specifico (diabete, celiachia, ipertensione, etc.)
    - Per l'email, richiedi un indirizzo valido
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
        "abitudini": {
          "pastiGiornalieri": value,
          "orariPasti": ["value1", "value2"] or [],
          "snack": boolean
        },
        "email": "value"
      }
      </DATI_COMPLETI>

      This tag will not be shown to the user but will be processed by our system. Make sure all data is collected and validated before sending this tag. The only message to the user should be a thank you and confirmation.
    `;
  }
  
  /**
   * Aggiunge un messaggio alla conversazione e ottiene la risposta di Claude
   * @param {string} content - Contenuto del messaggio utente
   * @param {function} progressCallback - Callback per lo streaming
   * @returns {Promise<object>} Risposta con il messaggio e lo stato
   */
  async addMessage(content, progressCallback = null) {
    this.messages.push({
      role: 'user',
      content
    });
    
    this.lastInteraction = Date.now();
    
    // Prepara i messaggi per Claude
    const messagesForClaude = [...this.claudeMessages];
    
    // Aggiungi il nuovo messaggio utente
    messagesForClaude.push({
      role: 'user',
      content
    });
    
    try {
      if (progressCallback) {
        // Approccio STREAMING usando il nuovo client API
        const stream = await anthropic.messages.stream({
          model: 'claude-3-7-sonnet-20250219',
          system: this.systemPrompt,
          messages: messagesForClaude,
          max_tokens: 1500,
          temperature: 0.7
        });
        
        let fullContent = '';
        let contentComplete = false;
        
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta') {
            const chunkText = chunk.delta.text;
            fullContent += chunkText;
            
            // Chiama il callback con l'aggiornamento
            progressCallback({
              chunk: chunkText,
              fullContent,
              isComplete: false,
              conversationStep: this.conversationStep
            });
          }
          
          if (chunk.type === 'message_delta' && chunk.delta.stop_reason) {
            contentComplete = true;
          }
        }
        
        // Chiama il callback una volta completo
        progressCallback({
          chunk: '',
          fullContent,
          isComplete: true,
          conversationStep: this.conversationStep
        });
        
        // Elabora la risposta
        const assistantMessage = { role: 'assistant', content: fullContent };
        this.messages.push(assistantMessage);
        this.claudeMessages.push(assistantMessage);
        this.processResponseInfo(fullContent);
        
      } else {
        // Approccio NON-STREAMING
        const response = await anthropic.messages.create({
          model: 'claude-3-7-sonnet-20250219',
          system: this.systemPrompt,
          messages: messagesForClaude,
          max_tokens: 1500,
          temperature: 0.7
        });
        
        const assistantMessage = { role: 'assistant', content: response.content[0].text };
        
        // Aggiorna i messaggi della conversazione
        this.messages.push(assistantMessage);
        this.claudeMessages.push(assistantMessage);
        
        // Elabora la risposta
        this.processResponseInfo(assistantMessage.content);
        
        return {
          content: assistantMessage.content,
          conversationStep: this.conversationStep,
          isActive: this.active,
          collectedData: this.collectedData
        };
      }
    } catch (error) {
      console.error('Errore nella chiamata a Claude:', error);
      throw error;
    }
  }
  
  /**
   * Elabora le informazioni dalla risposta
   * @param {string} content - Contenuto della risposta
   */
  processResponseInfo(content) {
    // Aggiorna lo step della conversazione
    this.conversationStep = Math.min(this.conversationStep + 1, 8);
    
    // Estrai i dati raccolti se presenti
    if (content.includes('<DATI_COMPLETI>')) {
      try {
        const regex = /<DATI_COMPLETI>([\s\S]*?)<\/DATI_COMPLETI>/;
        const match = content.match(regex);
        
        if (match && match[1]) {
          this.collectedData = JSON.parse(match[1].trim());
          this.active = false;
          console.log(`Dati raccolti per conversazione ${this.id}`);
          
          // Aggiorna step al massimo quando la conversazione è completata
          this.conversationStep = Math.max(8, this.conversationStep);
        }
      } catch (error) {
        console.error('Errore nell\'estrazione dei dati:', error);
      }
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
      }),
      conversationId: this.id
    };
  }
}

// ROUTING

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', version: process.env.npm_package_version || '1.0.0' });
});

// Home page
app.get('/', csrfProtection, (req, res) => {
  res.render('index-modern', { 
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
app.get('/changelanguage/:lang', (req, res) => {
  const lang = req.params.lang;
  const redirectUrl = req.query.redirect || '/';
  
  // Verifica che la lingua richiesta sia supportata
  if (i18next.languages.includes(lang)) {
    res.cookie('i18next', lang, { 
      maxAge: 1000 * 60 * 60 * 24 * 365, 
      httpOnly: true,
      secure: isSecure(),
      sameSite: 'lax'
    });
  }
  
  res.redirect(redirectUrl);
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
    return res.status(400).json({ 
      error: req.t('submission.validation'),
      details: errors.array() 
    });
  }
  
  try {
    const { userData, conversationData } = req.body;
    const conversationId = req.session.id;
    
    console.log(`Dati inviati per sessione ${conversationId}`);
    
    // Preparazione del payload per l'endpoint esterno
    const payload = {
      userData,
      metadata: {
        submittedAt: new Date().toISOString(),
        clientInfo: req.clientInfo,
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
    const conversation = conversations.get(conversationId);
    if (conversation) {
      conversations.delete(conversationId);
    }
    
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
  const INACTIVE_THRESHOLD = 3 * 24 * 60 * 60 * 1000; // 3 giorni
  
  for (const [id, conversation] of conversations.entries()) {
    const inactiveTime = now - conversation.lastInteraction;
    if (inactiveTime > INACTIVE_THRESHOLD) {
      conversations.delete(id);
      console.log(`Conversazione ${id} rimossa per inattività`);
    }
  }
  
  console.log(`Statistiche pulizia: ${conversations.size} conversazioni attive`);
}, 60 * 60 * 1000); // Controlla ogni ora

// Creazione del server HTTP per Socket.io
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : "*", // Abilita CORS in sviluppo
    methods: ["GET", "POST"]
  }
});

// Socket.io handling
io.on('connection', (socket) => {
  console.log(`Nuovo client connesso: ${socket.id}`);
  
  // Associa socket alla sessione utente
  let sessionId = null;
  
  // Autenticazione con ID sessione
  socket.on('authenticate', (data) => {
    sessionId = data.sessionId;
    console.log(`Socket ${socket.id} autenticato con sessionId: ${sessionId}`);
    
    // Invia lo stato iniziale della conversazione
    const conversation = conversations.get(sessionId);
    if (conversation) {
      const state = conversation.getState();
      socket.emit('conversation_state', {
        exists: true,
        ...state
      });
      console.log(`Stato conversazione inviato al client per sessione ${sessionId}`);
    } else {
      socket.emit('conversation_state', {
        exists: false,
        isActive: true,
        conversationStep: 0,
        messages: []
      });
      console.log(`Nessuna conversazione trovata per sessione ${sessionId}`);
    }
  });
  
  // Inizia una nuova conversazione
  socket.on('start_conversation', (data) => {
    if (!sessionId) {
      console.error('Tentativo di iniziare conversazione senza autenticazione');
      socket.emit('error', { message: 'Non autenticato' });
      return;
    }
    
    // Crea nuova conversazione
    const language = data.language || 'it';
    const conversation = new NutritionalConversation(language);
    conversations.set(sessionId, conversation);
    
    // Aggiorna lo stato iniziale
    const welcomeMessage = getWelcomeMessage(language);
    conversation.messages.push({
      role: 'assistant',
      content: welcomeMessage
    });
    
    // Invia messaggio di benvenuto
    socket.emit('conversation_state', {
      exists: true,
      isActive: true,
      conversationStep: 1,
      messages: [{ role: 'assistant', content: welcomeMessage }],
      conversationId: conversation.id
    });
    
    console.log(`Nuova conversazione iniziata per sessione ${sessionId}`);
  });
  
  // Gestione messaggi utente
  socket.on('user_message', async (data) => {
    try {
      if (!sessionId) {
        console.error('Tentativo di invio messaggio senza autenticazione');
        socket.emit('error', { message: 'Non autenticato' });
        return;
      }
      
      console.log(`Ricevuto messaggio da ${sessionId}: ${data.message.substring(0, 30)}...`);
      
      // Ottieni o crea conversazione
      let conversation = conversations.get(sessionId);
      if (!conversation) {
        conversation = new NutritionalConversation(data.language || 'it');
        conversations.set(sessionId, conversation);
        console.log(`Creata nuova conversazione per sessione ${sessionId}`);
      }
      
      // Callback per i chunk di risposta in tempo reale
      const sendChunk = (chunkData) => {
        const { chunk, fullContent, isComplete, conversationStep } = chunkData;
        
        // Prepara contenuto visibile (rimuovi DATI_COMPLETI tag se presente)
        let visibleContent = fullContent;
        let collectedData = null;
        let isActive = true;
        
        if (visibleContent.includes('<DATI_COMPLETI>')) {
          visibleContent = visibleContent.replace(/<DATI_COMPLETI>[\s\S]*?<\/DATI_COMPLETI>/g, '').trim();
          isActive = false;
          
          // Estrai dati raccolti se è l'ultimo chunk
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
        
        // Invia chunk all'utente
        socket.emit('assistant_chunk', {
          chunk,
          message: visibleContent,
          isComplete,
          conversationStep,
          isActive,
          ...(collectedData && { collectedData })
        });
        
        // Log per chunk finale
        if (isComplete) {
          console.log(`Invio messaggio finale a ${sessionId}: isComplete=${isComplete}, conversationStep=${conversationStep}, isActive=${isActive}`);
        }
      };
      
      // Elabora il messaggio con Claude
      await conversation.addMessage(data.message, sendChunk);
      
      // Invia lo stato aggiornato della conversazione
      const state = conversation.getState();
      socket.emit('conversation_updated', state);
      console.log(`Stato conversazione aggiornato per ${sessionId}: ${state.messages.length} messaggi`);
      
    } catch (error) {
      console.error('Errore nell\'elaborazione del messaggio:', error);
      socket.emit('error', { 
        message: 'Errore nell\'elaborazione del messaggio',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });
  
  // Gestione disconnessione
  socket.on('disconnect', () => {
    console.log(`Client disconnesso: ${socket.id}, sessionId: ${sessionId || 'non autenticato'}`);
  });
});

// Helper per ottenere il messaggio di benvenuto in base alla lingua
function getWelcomeMessage(language) {
  switch(language) {
    case 'en':
      return "Hi! I'm Joe, your nutrition assistant. I'll help you create a personalized meal plan. What's your name?";
    case 'fr':
      return "Bonjour ! Je suis Joe, votre assistant nutritionnel. Je vais vous aider à créer un plan alimentaire personnalisé. Comment vous appelez-vous ?";
    case 'es':
      return "¡Hola! Soy Joe, tu asistente nutricional. Te ayudaré a crear un plan de alimentación personalizado. ¿Cómo te llamas?";
    case 'de':
      return "Hallo! Ich bin Joe, Ihr Ernährungsassistent. Ich helfe Ihnen, einen persönlichen Ernährungsplan zu erstellen. Wie heißen Sie?";
    case 'pt':
      return "Olá! Sou o Joe, seu assistente nutricional. Vou ajudá-lo a criar um plano alimentar personalizado. Qual é o seu nome?";
    default:
      return "Ciao! Sono Joe, il tuo assistente nutrizionale. Ti aiuterò a creare un piano alimentare personalizzato. Come ti chiami?";
  }
}

// Avvio del server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server in esecuzione sulla porta ${PORT}`);
  console.log(`App disponibile all'indirizzo: http://localhost:${PORT}`);
});

module.exports = app; // Per i test