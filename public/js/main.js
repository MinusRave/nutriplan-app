// main.js - Script client principale
(function() {
  'use strict';
  
  // Verifica se lo script è già stato caricato
  if (window.dietingWithJoeInitialized) {
    console.warn('Script già inizializzato. Evitato caricamento duplicato.');
    return;
  }
  
  // Segnala che lo script è stato inizializzato
  window.dietingWithJoeInitialized = true;
  
  // Configurazione globale - visibile solo in questo scope
  const APP_CONFIG = {
    // Timeout di inattività in millisecondi (30 minuti)
    INACTIVITY_TIMEOUT: 30 * 60 * 1000,
    // Numero massimo di tentativi di invio messaggi
    MAX_RETRIES: 3,
    // Timeout per la risposta in millisecondi (60 secondi)
    RESPONSE_TIMEOUT: 60 * 1000,
    // Timeout per la riconnessione websocket (3 secondi)
    RECONNECT_TIMEOUT: 3000,
    // Nome dei dati in localStorage (solo per ripristino UI, non per dati sensibili)
    STORAGE_KEY: 'dietingwithjoeConversationState',
    // Debug mode
    DEBUG: false,
    // Rilevazione mobile
    IS_MOBILE: /mobile|android|iphone|ipad|ipod/i.test(navigator.userAgent.toLowerCase())
  };
  
  // Stampa info di debug
  console.log(`App inizializzata: ${APP_CONFIG.IS_MOBILE ? 'mobile' : 'desktop'}`);
  console.log(`User agent: ${navigator.userAgent}`);
  

  // Ottieni la lingua corrente o usa l'italiano come fallback
  let currentLang = 'it';
  try {
    if (window.currentLanguage) {
      currentLang = window.currentLanguage;
    }
  } catch (e) {
    console.warn('Variabile currentLanguage non disponibile, utilizzo fallback');
  }

  // Variabili locali
  let conversationState = {
    exists: false,
    isActive: true,
    conversationStep: 0,
    messages: [],
    collectedData: null,
    conversationUUID: null // Aggiungiamo l'UUID univoco della conversazione
  };
  
  // Non ripristiniamo più conversazioni incomplete dal localStorage
  // Solo le conversazioni completate verranno salvate per scopi analitici

  let inactivityTimer = null;
  let retryCount = 0;
  let isSubmitting = false;
  // Socket.io connection
  let socket = null;
  let socketConnected = false;
  let socketReconnecting = false;

  // Traduzioni - utilizza quelle fornite dal server o le predefinite
  const defaultTranslations = {
    error: {
      generic: "Si è verificato un errore. Riprova più tardi.",
      connection: "Errore di connessione con l'assistente.",
      timeout: "L'operazione ha impiegato troppo tempo.",
      validation: "Alcuni dati non sono validi, controlla e riprova."
    },
    messages: {
      timeout: "Sembra che la conversazione sia inattiva. Sei ancora lì?",
      retry: "Sto provando a riconnettermi...",
      confirmation: "Conferma e Invia"
    }
  };

  // Utilizziamo appTranslations dalla variabile globale
  const translations = (window.appTranslations || defaultTranslations);

  // Elementi DOM
  const elements = {};
  
  // Funzione di inizializzazione principale
  function init() {
    loadDOMElements();
    
    // Verifica che gli elementi essenziali esistano
    if (!elementsExist()) {
      console.error('Elementi DOM essenziali mancanti, impossibile inizializzare l\'app');
      return;
    }

    // Inizializzazione del cookie consent
    initCookieConsent();
    
    // Impostazione degli event listener
    setupEventListeners();
    
    // Impostazione del timer di inattività
    resetInactivityTimer();
    
    // Inizializzazione debug mode (se disponibile)
    initDebugMode();
    
    // Avvia il processo di conversazione
    initConversation();
  }
  
  // Caricamento elementi DOM
  function loadDOMElements() {
    elements.chatContainer = document.getElementById('chat-container');
    elements.chatMessages = document.getElementById('chat-messages');
    elements.chatForm = document.getElementById('chat-form');
    elements.chatInput = document.getElementById('chat-input');
    elements.sendButton = document.getElementById('send-button');
    elements.typingIndicator = document.getElementById('typing-indicator');
    elements.thankYouScreen = document.getElementById('thank-you-screen');
    elements.newConversationBtn = document.getElementById('new-conversation');
    elements.cookieConsent = document.getElementById('cookie-consent');
    elements.acceptCookiesBtn = document.getElementById('accept-cookies');
    elements.rejectCookiesBtn = document.getElementById('reject-cookies');
    elements.languageToggle = document.querySelector('.language-toggle');
    elements.languageDropdown = document.querySelector('.language-dropdown');
    elements.csrfToken = document.getElementById('csrf-token');
    elements.connectionStatus = document.getElementById('connection-status');
    elements.connectionMessage = document.getElementById('connection-message');
    elements.reconnectButton = document.getElementById('reconnect-button');
    
    // Debug elements
    elements.debug = {};
    if (document.getElementById('debug-panel')) {
      elements.debug.panel = document.getElementById('debug-panel');
      elements.debug.toggle = document.getElementById('debug-toggle');
      elements.debug.content = document.getElementById('debug-content');
      elements.debug.conversationLog = document.getElementById('conversation-log');
      elements.debug.clientInfoDisplay = document.getElementById('client-info');
      elements.debug.socketStatus = document.getElementById('socket-status');
    }
  }
  
  /**
   * Inizializza la connessione WebSocket
   */
  function initSocketConnection() {
    // Se c'è già una connessione attiva, non fare nulla
    if (socket && socket.connected) return;
    
    // Crea una nuova connessione socket
    socket = io({
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: APP_CONFIG.RECONNECT_TIMEOUT,
      timeout: APP_CONFIG.RESPONSE_TIMEOUT,
      query: { 
        lang: currentLang
      }
    });
    
    // Gestione eventi socket
    setupSocketListeners();
    
    // Autentica la connessione con il sessionId
    const sessionId = window.clientInfo && window.clientInfo.sessionId;
    if (sessionId) {
      socket.emit('authenticate', { 
        sessionId: sessionId,
        csrfToken: elements.csrfToken ? elements.csrfToken.value : null
      });
      
      log(`Tentativo di autenticazione socket con sessionId: ${sessionId}`);
    } else {
      log('Impossibile autenticare socket: sessionId mancante');
      
      if (elements.connectionStatus) {
        elements.connectionStatus.classList.remove('hidden');
        if (elements.connectionMessage) {
          elements.connectionMessage.textContent = translations.error.auth || 'Errore di autenticazione';
        }
      }
    }
  }
  
  /**
   * Imposta i listener per gli eventi WebSocket
   */
  function setupSocketListeners() {
    if (!socket) return;
    
    // Evento di connessione
    socket.on('connect', () => {
      log(`Socket connesso: ${socket.id}`);
      socketConnected = true;
      socketReconnecting = false;
      
      if (elements.connectionStatus) {
        elements.connectionStatus.classList.add('hidden');
      }
      
      if (elements.debug && elements.debug.socketStatus) {
        elements.debug.socketStatus.textContent = `Socket: Connesso (${socket.id})`;
      }
      
      // Autentica la connessione ogni volta che ci connettiamo o riconnettiamo
      const sessionId = window.clientInfo && window.clientInfo.sessionId;
      if (sessionId) {
        socket.emit('authenticate', { 
          sessionId: sessionId,
          csrfToken: elements.csrfToken ? elements.csrfToken.value : null
        });
      }
    });
    
    // Evento di disconnessione
    socket.on('disconnect', (reason) => {
      log(`Socket disconnesso: ${reason}`);
      socketConnected = false;
      
      if (elements.debug && elements.debug.socketStatus) {
        elements.debug.socketStatus.textContent = `Socket: Disconnesso (${reason})`;
      }
      
      // Mostra avviso di disconnessione solo se non siamo già in fase di riconnessione
      if (!socketReconnecting) {
        socketReconnecting = true;
        
        if (elements.connectionStatus) {
          elements.connectionStatus.classList.remove('hidden');
          if (elements.connectionMessage) {
            elements.connectionMessage.textContent = translations.error.connection || 'Connessione persa';
          }
        }
      }
    });
    
    // Evento di riconnessione
    socket.on('reconnect_attempt', (attemptNumber) => {
      log(`Tentativo di riconnessione socket #${attemptNumber}`);
      socketReconnecting = true;
      
      if (elements.connectionStatus) {
        elements.connectionStatus.classList.remove('hidden');
        if (elements.connectionMessage) {
          elements.connectionMessage.textContent = `${translations.messages.retry || 'Riconnessione in corso...'} (${attemptNumber})`;
        }
      }
      
      if (elements.debug && elements.debug.socketStatus) {
        elements.debug.socketStatus.textContent = `Socket: Riconnessione #${attemptNumber}`;
      }
    });
    
    // Evento di fallimento riconnessione
    socket.on('reconnect_failed', () => {
      log('Riconnessione socket fallita dopo tutti i tentativi');
      socketReconnecting = false;
      
      if (elements.connectionStatus) {
        elements.connectionStatus.classList.remove('hidden');
        if (elements.connectionMessage) {
          elements.connectionMessage.textContent = translations.error.reconnect || 'Impossibile riconnettersi';
        }
      }
      
      if (elements.debug && elements.debug.socketStatus) {
        elements.debug.socketStatus.textContent = 'Socket: Riconnessione fallita';
      }
    });
    
    // Evento di errore
    socket.on('error', (error) => {
      console.error('Errore socket:', error);
      
      if (elements.debug && elements.debug.socketStatus) {
        elements.debug.socketStatus.textContent = `Socket: Errore (${error.message || 'sconosciuto'})`;
      }
    });
    
    // Messaggi di risposta dal server
    socket.on('conversation_state', (data) => {
      log('Ricevuto stato conversazione dal server');
      
      handleConversationState(data);
    });
    
    // Ricezione dei chunk di risposta dell'assistente
    socket.on('assistant_chunk', (data) => {
      handleAssistantChunk(data);
    });
    
    // Aggiornamento dello stato della conversazione
    socket.on('conversation_updated', (data) => {
      log('Ricevuto aggiornamento stato conversazione');
      
      // Aggiorna stato
      if (data) {
        conversationState.isActive = data.isActive;
        conversationState.conversationStep = data.conversationStep;
        
        if (data.conversationId) {
          conversationState.conversationUUID = data.conversationId;
        }
        
        if (data.collectedData) {
          conversationState.collectedData = data.collectedData;
        }
        
        // Se la conversazione è terminata, mostra il pulsante di conferma
        if (!data.isActive && data.collectedData) {
          addConfirmationButton();
        }
      }
      
      // Aggiorna debug panel
      updateDebugPanel();
    });
    
    // Pulsante di riconnessione manuale
    if (elements.reconnectButton) {
      elements.reconnectButton.addEventListener('click', () => {
        if (socket) {
          log('Tentativo di riconnessione manuale');
          socket.connect();
        } else {
          initSocketConnection();
        }
      });
    }
  }
  
  /**
   * Gestisce l'elaborazione dello stato conversazione ricevuto dal server
   */
  function handleConversationState(data) {
    if (!data) return;
    
    // Se sul server la conversazione esiste ed è più aggiornata
    if (data.exists && 
       (!conversationState.exists || data.messages.length > conversationState.messages.length)) {
      
      // Aggiorna lo stato della conversazione
      conversationState = data;
      
      // Salviamo l'UUID della conversazione se presente
      if (data.conversationId) {
        conversationState.conversationUUID = data.conversationId;
      }
      
      // Reset UI per assicurarci di non duplicare messaggi
      if (elements.chatMessages) {
        elements.chatMessages.innerHTML = '';
      }
      
      // Visualizza i messaggi
      data.messages.forEach(msg => {
        if (msg.role === 'user') {
          addUserMessage(msg.content);
        } else if (msg.role === 'assistant') {
          addAssistantMessage(msg.content);
        }
      });
      
      // Se la conversazione è terminata, mostra il pulsante di conferma
      if (!data.isActive && data.collectedData) {
        addConfirmationButton();
      }
      
      // Scorrimento automatico in fondo
      scrollToBottom();
      
      // Aggiorna debug panel
      updateDebugPanel();
    } else if (!data.exists) {
      // Se non esiste ancora una conversazione, iniziane una nuova
      startConversation();
    }
  }
  
  /**
   * Gestisce i chunk di risposta dell'assistente
   */
  function handleAssistantChunk(data) {
    if (!data) return;
    
    // Se è il primo chunk, crea un messaggio placeholder
    let messageElement = document.querySelector('.message-assistant:last-child');
    let messageTextElement;
    
    if (!messageElement) {
      messageElement = createMessageElement('assistant', '');
      if (elements.chatMessages) {
        elements.chatMessages.appendChild(messageElement);
      }
    }
    
    // Ottieni l'elemento di testo
    messageTextElement = messageElement.querySelector('.message-text');
    
    // Se c'è un chunk da aggiungere
    if (data.chunk) {
      // Aggiorna il contenuto del messaggio
      if (messageTextElement) {
        if (data.message) {
          // Se c'è un messaggio completo, usalo direttamente
          messageTextElement.innerHTML = formatMessage(data.message);
        } else {
          // Altrimenti aggiungi solo il chunk
          const currentContent = messageTextElement.innerHTML;
          const newContent = formatMessage(currentContent + data.chunk);
          messageTextElement.innerHTML = newContent;
        }
        scrollToBottom();
      }
    }
    
    // Gestione della completezza del messaggio
    if (data.isComplete) {
      // Final update
      if (messageTextElement && data.message) {
        messageTextElement.innerHTML = formatMessage(data.message);
      }
      
      // Mantieni traccia del messaggio completo
      const messageContent = data.message || messageTextElement.textContent;
      
      // Aggiorna lo stato della conversazione
      conversationState.messages.push({ role: 'assistant', content: messageContent });
      conversationState.conversationStep = data.conversationStep || conversationState.conversationStep;
      conversationState.isActive = data.isActive;
      
      if (data.collectedData) {
        conversationState.collectedData = data.collectedData;
        
        // Se la conversazione è terminata, mostra il pulsante di conferma
        if (!data.isActive) {
          addConfirmationButton();
        }
      }
      
      // Nascondi l'indicatore di digitazione
      hideTypingIndicator();
      
      // Termina la sottomissione
      isSubmitting = false;
      
      // Riabilita input e pulsante
      if (elements.chatInput) {
        elements.chatInput.disabled = false;
        elements.chatInput.classList.remove('disabled');
        elements.chatInput.focus();
      }
      
      if (elements.sendButton) {
        elements.sendButton.disabled = false;
        elements.sendButton.classList.remove('disabled');
      }
      
      // Aggiorna debug panel
      updateDebugPanel();
      
      // Reset del contatore di tentativi
      retryCount = 0;
      
      // Traccia evento
      trackEvent('message_received');
    }
  }
  
  // Inizia il processo di conversazione
  async function initConversation() {
    try {
      // Inizializza la connessione WebSocket
      initSocketConnection();
      
      // Lo stato iniziale verrà ricevuto attraverso l'evento conversation_state
      // dopo l'autenticazione della connessione WebSocket
    } catch (error) {
      console.error('Errore nell\'inizializzazione della conversazione:', error);
      // Mostra messaggio di errore all'utente
      addAssistantMessage(translations.error.generic);
    }
  }

  /**
   * Verifica che gli elementi DOM essenziali esistano
   */
  function elementsExist() {
    return elements.chatContainer && 
           elements.chatMessages && 
           elements.chatForm && 
           elements.chatInput;
  }

  /**
   * Controlla se esiste già una conversazione sul server
   * Con WebSocket, questa verifica viene fatta automaticamente durante l'autenticazione
   * Questa funzione rimane per compatibilità con il codice esistente
   */
  async function checkExistingConversation() {
    // Con WebSocket, lo stato viene recuperato automaticamente durante la connessione
    // dopo l'evento 'authenticate'
    return conversationState.exists;
  }

  /**
   * Impostazione degli event listener
   */
  function setupEventListeners() {
    // Form di invio messaggio
    if (elements.chatForm) {
      elements.chatForm.addEventListener('submit', handleSubmitMessage);
    }
    
    // Input del messaggio
    if (elements.chatInput) {
      elements.chatInput.addEventListener('input', resetInactivityTimer);
      
      elements.chatInput.addEventListener('keydown', (e) => {
        // Invia messaggio con Enter (ma non con Shift+Enter)
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (elements.chatForm) {
            elements.chatForm.dispatchEvent(new Event('submit'));
          }
        }
      });
    }
    
    // Bottone nuova conversazione
    if (elements.newConversationBtn) {
      elements.newConversationBtn.addEventListener('click', startNewConversation);
    }
    
    // Cookie consent
    if (elements.acceptCookiesBtn) {
      elements.acceptCookiesBtn.addEventListener('click', acceptCookies);
    }
    
    if (elements.rejectCookiesBtn) {
      elements.rejectCookiesBtn.addEventListener('click', rejectCookies);
    }
    
    // Selezione lingua
    if (elements.languageToggle) {
      elements.languageToggle.addEventListener('click', toggleLanguageDropdown);
    }
    
    // Click fuori dal dropdown delle lingue
    document.addEventListener('click', (e) => {
      if (elements.languageDropdown && !e.target.closest('.language-selector')) {
        elements.languageDropdown.classList.add('hidden');
        elements.languageToggle.setAttribute('aria-expanded', 'false');
      }
    });
    
    // Gestione della visibilità della pagina
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Gestione della chiusura finestra/tab
    window.addEventListener('beforeunload', function() {
      // Chiudi esplicitamente la connessione WebSocket
      if (socket && socketConnected) {
        socket.disconnect();
      }
    });
  }

  /**
   * Inizializzazione del cookie consent
   */
  function initCookieConsent() {
    if (!elements.cookieConsent) return;
    
    const cookiesAccepted = localStorage.getItem('cookiesAccepted');
    if (cookiesAccepted === null) {
      // Mostra il banner se non è stata fatta una scelta
      elements.cookieConsent.classList.remove('hidden');
    } else if (cookiesAccepted === 'true') {
      // Se i cookie sono già stati accettati, inizializza analytics
      initAnalytics();
    }
  }

  /**
   * Accettazione cookies
   */
  function acceptCookies() {
    localStorage.setItem('cookiesAccepted', 'true');
    if (elements.cookieConsent) {
      elements.cookieConsent.classList.add('hidden');
    }
    
    // Attivazione di analytics e tracking
    initAnalytics();
    
    // Traccia evento
    trackEvent('accept_cookies');
  }

  /**
   * Rifiuto cookies
   */
  function rejectCookies() {
    localStorage.setItem('cookiesAccepted', 'false');
    if (elements.cookieConsent) {
      elements.cookieConsent.classList.add('hidden');
    }
  }

  /**
   * Toggle del dropdown delle lingue
   */
  function toggleLanguageDropdown() {
    if (elements.languageDropdown) {
      const isHidden = elements.languageDropdown.classList.toggle('hidden');
      elements.languageToggle.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
    }
  }

  /**
   * Inizializzazione debug mode
   */
  function initDebugMode() {
    const debug = elements.debug;
    if (!debug.toggle) return;
    
    debug.toggle.addEventListener('change', (e) => {
      APP_CONFIG.DEBUG = e.target.checked;
      debug.content.classList.toggle('hidden', !APP_CONFIG.DEBUG);
      
      if (APP_CONFIG.DEBUG) {
        updateDebugPanel();
      }
    });
  }

  /**
   * Aggiornamento del pannello di debug
   */
  function updateDebugPanel() {
    if (!APP_CONFIG.DEBUG) return;
    
    const debug = elements.debug;
    
    if (debug.conversationLog) {
      debug.conversationLog.textContent = JSON.stringify(conversationState, null, 2);
    }
    
    if (debug.clientInfoDisplay && window.clientInfo) {
      debug.clientInfoDisplay.textContent = JSON.stringify(window.clientInfo, null, 2);
    }
  }

  /**
   * Avvio della conversazione
   */
  function startConversation() {
    try {
      // Verifica che il socket sia connesso
      if (!socket || !socketConnected) {
        log('Socket non connesso, riconnessione...');
        initSocketConnection();
        
        // Aggiungiamo un listener temporaneo per avviare la conversazione dopo la connessione
        const onConnect = () => {
          socket.off('connect', onConnect);
          // Avvia conversazione dopo un breve delay per assicurarsi che l'autenticazione sia completa
          setTimeout(() => {
            emitStartConversation();
          }, 500);
        };
        
        socket.on('connect', onConnect);
        return;
      }
      
      // Se già connesso, emetti direttamente
      emitStartConversation();
    } catch (error) {
      console.error('Errore nell\'avvio della conversazione:', error);
      addAssistantMessage(translations.error.generic);
    }
  }
  
  /**
   * Invia richiesta di avvio conversazione tramite WebSocket
   */
  function emitStartConversation() {
    // Mostra l'indicatore di digitazione
    showTypingIndicator();
    
    // Emetti evento di inizio conversazione
    socket.emit('start_conversation', {
      language: currentLang
    });
    
    log('Richiesta avvio conversazione inviata');
    
    // Reset dello stato conversazione
    conversationState.exists = true;
    conversationState.isActive = true;
    conversationState.conversationStep = 0;
    conversationState.messages = [];
    conversationState.collectedData = null;
    
    // I messaggi e altri dati arriveranno attraverso l'evento conversation_state
    
    // Traccia evento
    trackEvent('conversation_start');
  }

  /**
   * Invio messaggio utente
   */
  function handleSubmitMessage(e) {
    e.preventDefault();
    
    if (!elements.chatInput) return;
    
    const userInput = elements.chatInput.value.trim();
    if (!userInput || isSubmitting) return;
    
    // Verifica che il socket sia connesso
    if (!socket || !socketConnected) {
      log('Socket non connesso, riconnessione...');
      
      // Salva temporaneamente il messaggio
      const messageToSend = userInput;
      
      // Reconnect
      initSocketConnection();
      
      // Aggiungi un listener temporaneo per inviare il messaggio dopo la connessione
      const onConnect = () => {
        socket.off('connect', onConnect);
        
        // Invia il messaggio dopo un breve delay per assicurarsi che l'autenticazione sia completa
        setTimeout(() => {
          // Ripristina il valore dell'input e triggera l'invio
          elements.chatInput.value = messageToSend;
          if (elements.chatForm) {
            elements.chatForm.dispatchEvent(new Event('submit'));
          }
        }, 1000);
      };
      
      socket.on('connect', onConnect);
      return;
    }
    
    // Reset del timer di inattività
    resetInactivityTimer();
    
    // Aggiunta del messaggio dell'utente all'interfaccia
    addUserMessage(userInput);
    
    // Pulizia dell'input
    elements.chatInput.value = '';
    
    // Aggiornamento dei dati della conversazione
    conversationState.messages.push({ role: 'user', content: userInput });
    
    // Flag per evitare invii multipli
    isSubmitting = true;
    
    // Disabilita input e pulsante durante la comunicazione
    if (elements.chatInput) {
      elements.chatInput.disabled = true;
      elements.chatInput.classList.add('disabled');
    }
    
    if (elements.sendButton) {
      elements.sendButton.disabled = true;
      elements.sendButton.classList.add('disabled');
    }
    
    // Mostra l'indicatore di digitazione avanzato
    showTypingIndicator(true); // true = modalità avanzata
    
    try {
      // Invia il messaggio tramite socket
      socket.emit('user_message', {
        message: userInput,
        language: currentLang
      });
      
      log(`Messaggio utente inviato: ${userInput.substring(0, 30)}${userInput.length > 30 ? '...' : ''}`);
      
      // Il messaggio e la risposta dell'assistente verranno gestiti tramite 
      // gli eventi 'assistant_chunk' e 'conversation_updated'
      
      // L'indicatore di digitazione e la riabilitazione degli input verranno gestiti
      // nell'evento 'assistant_chunk' quando isComplete=true
      
      // Traccia evento
      trackEvent('message_sent');
    } catch (error) {
      console.error('Errore nell\'invio del messaggio:', error);
      handleCommunicationError();
      
      // Riabilita input e pulsante
      if (elements.chatInput) {
        elements.chatInput.disabled = false;
        elements.chatInput.classList.remove('disabled');
      }
      
      if (elements.sendButton) {
        elements.sendButton.disabled = false;
        elements.sendButton.classList.remove('disabled');
      }
      
      // Nascondi l'indicatore di digitazione
      hideTypingIndicator();
      isSubmitting = false;
      scrollToBottom();
    }
  }

  /**
   * Gestione errori di comunicazione
   */
  function handleCommunicationError() {
    retryCount++;
    
    if (retryCount <= APP_CONFIG.MAX_RETRIES) {
      addAssistantMessage(`${translations.error.connection} ${translations.messages.retry} (${retryCount}/${APP_CONFIG.MAX_RETRIES})`);
    } else {
      addAssistantMessage(translations.error.generic);
      retryCount = 0;
    }
  }

  /**
   * Aggiunta bottone di conferma
   */
  function addConfirmationButton() {
    if (!elements.chatMessages) return;
    
    // Verifica se esiste già un bottone di conferma
    if (document.querySelector('.confirm-button')) {
      return; // Bottone già presente
    }
    
    const confirmButton = document.createElement('button');
    confirmButton.classList.add('btn', 'btn-primary', 'confirm-button');
    confirmButton.textContent = translations.messages.confirmation;
    confirmButton.setAttribute('aria-label', translations.messages.confirmation);
    confirmButton.addEventListener('click', handleFinalSubmission);
    
    const buttonContainer = document.createElement('div');
    buttonContainer.classList.add('confirmation-container');
    buttonContainer.appendChild(confirmButton);
    
    elements.chatMessages.appendChild(buttonContainer);
  }

  /**
   * Gestione dell'invio finale
   */
  async function handleFinalSubmission() {
    if (!elements.csrfToken || !elements.csrfToken.value) {
      console.error("Token CSRF mancante");
      addAssistantMessage(translations.error.generic);
      return;
    }
    
    if (!conversationState.collectedData) {
      console.error("Dati raccolti mancanti");
      addAssistantMessage(translations.error.generic);
      return;
    }
    
    // Mostra indicatore di caricamento
    showTypingIndicator();
    
    try {
      // Preparazione del payload
      const payload = {
        userData: conversationState.collectedData,
        conversationData: {
          messages: conversationState.messages,
          language: currentLang,
          conversationUUID: conversationState.conversationUUID
        }
      };
      
      // Usiamo ancora fetch per l'invio finale, perché è un'operazione una tantum
      // che non richiede la reattività di WebSocket
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': elements.csrfToken.value
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error('Errore nell\'invio dei dati finali');
      }
      
      const data = await response.json();
      
      if (data.success) {
        // Nascondi l'indicatore di digitazione
        hideTypingIndicator();
        
        // Dopo un breve ritardo, mostra la schermata di ringraziamento
        setTimeout(() => {
          if (elements.chatContainer && elements.thankYouScreen) {
            elements.chatContainer.classList.add('hidden');
            elements.thankYouScreen.classList.remove('hidden');
            
            // Traccia evento di conversione
            trackEvent('plan_requested');
          }
        }, 500);
      } else {
        throw new Error(data.error || translations.error.generic);
      }
    } catch (error) {
      console.error('Errore nell\'invio dei dati finali:', error);
      hideTypingIndicator();
      addAssistantMessage(`${translations.error.generic} ${error.message}`);
    }
  }

  /**
   * Mostra l'indicatore di digitazione
   * @param {boolean} advanced - Se true, mostra un indicatore più dettagliato
   */
  function showTypingIndicator(advanced = false) {
    if (!elements.typingIndicator) return;
    
    elements.typingIndicator.classList.remove('hidden');
    
    if (advanced) {
      // Aggiunge classe per stile avanzato
      elements.typingIndicator.classList.add('advanced');
      
      // Aggiungi ulteriori elementi all'indicatore
      if (!elements.typingIndicator.querySelector('.typing-status')) {
        const statusElement = document.createElement('span');
        statusElement.className = 'typing-status';
        statusElement.textContent = translations.messages.typing || 'Digitando...';
        elements.typingIndicator.appendChild(statusElement);
        
        // Aggiungi pulsante cancella se non c'è già
        if (!elements.typingIndicator.querySelector('.cancel-button')) {
          const cancelButton = document.createElement('button');
          cancelButton.className = 'cancel-button';
          cancelButton.setAttribute('aria-label', 'Annulla generazione');
          cancelButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          `;
          elements.typingIndicator.appendChild(cancelButton);
          
          // Implementa cancellazione (in una versione futura)
          cancelButton.addEventListener('click', () => {
            // Chiudi eventuali connessioni streaming attive
            if (pendingStreamConnection && pendingStreamConnection.readyState !== 2) {
              console.log("Annullamento della richiesta in corso");
              pendingStreamConnection.close();
              pendingStreamConnection = null;
              currentStreamId = null;
            }
            
            hideTypingIndicator();
            isSubmitting = false;
            
            // Riabilita input e pulsante
            if (elements.chatInput) {
              elements.chatInput.disabled = false;
              elements.chatInput.classList.remove('disabled');
              elements.chatInput.focus();
            }
            
            if (elements.sendButton) {
              elements.sendButton.disabled = false;
              elements.sendButton.classList.remove('disabled');
            }
          });
        }
      }
      
      // Avvia animazione pulsante
      const dots = elements.typingIndicator.querySelectorAll('.typing-dot');
      dots.forEach((dot, i) => {
        dot.style.animationDuration = '1.4s';
        dot.style.animationDelay = `${i * 0.2}s`;
      });
    } else {
      // Stile base
      elements.typingIndicator.classList.remove('advanced');
      
      // Rimuovi elementi aggiuntivi se presenti
      const statusElement = elements.typingIndicator.querySelector('.typing-status');
      if (statusElement) {
        elements.typingIndicator.removeChild(statusElement);
      }
      
      const cancelButton = elements.typingIndicator.querySelector('.cancel-button');
      if (cancelButton) {
        elements.typingIndicator.removeChild(cancelButton);
      }
    }
  }

  /**
   * Nascondi l'indicatore di digitazione
   */
  function hideTypingIndicator() {
    if (!elements.typingIndicator) return;
    
    elements.typingIndicator.classList.add('hidden');
    elements.typingIndicator.classList.remove('advanced');
    
    // Rimuovi elementi aggiuntivi
    const statusElement = elements.typingIndicator.querySelector('.typing-status');
    if (statusElement) {
      elements.typingIndicator.removeChild(statusElement);
    }
    
    const cancelButton = elements.typingIndicator.querySelector('.cancel-button');
    if (cancelButton) {
      elements.typingIndicator.removeChild(cancelButton);
    }
  }

  /**
   * Aggiunta messaggio utente
   */
  function addUserMessage(message) {
    if (!elements.chatMessages) return;
    
    const messageElement = createMessageElement('user', message);
    elements.chatMessages.appendChild(messageElement);
    scrollToBottom();
  }

  /**
   * Aggiunta messaggio assistente
   */
  function addAssistantMessage(message) {
    if (!elements.chatMessages) return;
    
    const messageElement = createMessageElement('assistant', message);
    elements.chatMessages.appendChild(messageElement);
    scrollToBottom();
  }

  /**
   * Creazione elemento messaggio
   */
  function createMessageElement(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `message-${role}`);
    messageDiv.setAttribute('role', 'listitem');
    
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    
    // Avatar diverso in base al ruolo
    if (role === 'user') {
      avatarDiv.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="avatar-icon">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      `;
    } else {
      avatarDiv.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="avatar-icon">
          <text x="12" y="16" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="currentColor" text-anchor="middle">J</text>
        </svg>
      `;
    }
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    const textDiv = document.createElement('div');
    textDiv.classList.add('message-text');
    textDiv.innerHTML = formatMessage(content);
    
    // Aggiungi label ARIA per i lettori di schermo (accessibilità)
    const roleLabel = role === 'user' ? 'Tu' : 'Assistente';
    const srOnly = document.createElement('span');
    srOnly.classList.add('sr-only');
    srOnly.textContent = `${roleLabel}: `;
    
    contentDiv.appendChild(srOnly);
    contentDiv.appendChild(textDiv);
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(contentDiv);
    
    return messageDiv;
  }

  /**
   * Formattazione messaggio (markdown semplice)
   */
  function formatMessage(message) {
    if (!message) return '';
    
    // Sostituzione newline con <br>
    let formatted = message.replace(/\n/g, '<br>');
    
    // Formattazione bold
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Formattazione italic
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Liste numerate
    formatted = formatted.replace(/^\d+\.\s+(.*?)$/gm, '<li>$1</li>');
    
    // Liste puntate
    formatted = formatted.replace(/^\s*-\s+(.*?)$/gm, '<li>$1</li>');
    
    // Raggruppa le liste
    let inList = false;
    const lines = formatted.split('<br>');
    formatted = lines.map(line => {
      if (line.startsWith('<li>')) {
        if (!inList) {
          inList = true;
          return '<ul>' + line;
        }
        return line;
      } else if (inList) {
        inList = false;
        return '</ul><br>' + line;
      } else {
        return line;
      }
    }).join('<br>');
    
    // Chiudi l'ultima lista se è aperta
    if (inList) {
      formatted += '</ul>';
    }
    
    // Rimuovi <br> extra prima e dopo le liste
    formatted = formatted.replace(/<br><ul>/g, '<ul>');
    formatted = formatted.replace(/<\/ul><br>/g, '</ul>');
    
    return formatted;
  }

  /**
   * Scorrimento in fondo alla chat
   */
  function scrollToBottom() {
    if (elements.chatMessages) {
      elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }
  }

  /**
   * Timer di inattività
   */
  function resetInactivityTimer() {
    // Cancella il timer esistente
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
    }
    
    // Imposta un nuovo timer
    inactivityTimer = setTimeout(() => {
      handleInactivity();
    }, APP_CONFIG.INACTIVITY_TIMEOUT);
  }

  /**
   * Gestione inattività
   */
  function handleInactivity() {
    // Mostra messaggio di timeout se la conversazione è in corso
    if (conversationState.exists && conversationState.isActive &&
        elements.chatContainer && 
        !elements.chatContainer.classList.contains('hidden')) {
      addAssistantMessage(translations.messages.timeout);
    }
  }

  /**
   * Gestione visibilità pagina
   */
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      // Reset del timer quando la pagina torna visibile
      resetInactivityTimer();
      
      // Se il socket è disconnesso, tenta la riconnessione
      if (socket && !socketConnected) {
        log('Pagina tornata visibile, tentativo di riconnessione del socket');
        socket.connect();
      }
    } else if (document.visibilityState === 'hidden') {
      log('Pagina nascosta, mantenimento socket WebSocket');
      
      // Con WebSocket, manteniamo la connessione attiva anche con pagina nascosta
      // per evitare problemi di riconnessione, soprattutto su mobile
      
      // Impostiamo solo un timer lungo per risparmiare batteria se la pagina resta nascosta molto tempo
      setTimeout(() => {
        if (document.visibilityState === 'hidden') {
          log('Pagina nascosta per periodo prolungato, disconnessione socket per risparmiare risorse');
          // Non chiudiamo la connessione ma mettiamo in attesa
          if (socket && socketConnected) {
            socket.disconnect();
          }
        }
      }, 15 * 60 * 1000); // 15 minuti con pagina nascosta
    }
  }

  /**
   * Nuova conversazione
   */
  function startNewConversation() {
    // Reset degli elementi UI
    if (elements.chatMessages) {
      elements.chatMessages.innerHTML = '';
    }
    
    if (elements.chatContainer) {
      elements.chatContainer.classList.remove('hidden');
    }
    
    if (elements.thankYouScreen) {
      elements.thankYouScreen.classList.add('hidden');
    }
    
    // Reset dello stato
    conversationState = {
      exists: false,
      isActive: true,
      conversationStep: 0,
      messages: [],
      collectedData: null,
      conversationUUID: null
    };
    
    // Rimuovi i dati dal localStorage
    try {
      localStorage.removeItem(APP_CONFIG.STORAGE_KEY);
    } catch (e) {
      console.warn('Impossibile rimuovere lo stato da localStorage:', e);
    }
    
    // Verifica che il socket sia connesso
    if (!socket || !socketConnected) {
      log('Socket non connesso, riconnessione prima di avviare nuova conversazione');
      initSocketConnection();
      
      // Aggiungiamo un listener temporaneo per avviare la conversazione dopo la connessione
      const onConnect = () => {
        socket.off('connect', onConnect);
        // Avvia conversazione dopo un breve delay per assicurarsi che l'autenticazione sia completa
        setTimeout(() => {
          startConversation();
        }, 500);
      };
      
      socket.on('connect', onConnect);
    } else {
      // Avvio nuova conversazione
      startConversation();
    }
  }

  /**
   * Analytics
   */
  function initAnalytics() {
    const cookiesAccepted = localStorage.getItem('cookiesAccepted');
    if (cookiesAccepted !== 'true') return;
    
    // Attivazione di Google Analytics
    if (typeof window.gtag === 'function') {
      log('Google Analytics attivato');
    }
    
    // Attivazione di Meta Pixel
    if (typeof window.fbq === 'function') {
      log('Meta Pixel attivato');
    }
  }

  /**
   * Logging
   */
  function log(message) {
    if (APP_CONFIG.DEBUG) {
      console.log(`[DietingWithJoe] ${message}`);
      updateDebugPanel();
    }
  }

  /**
   * Registrazione di eventi per analytics
   */
  function trackEvent(eventName, params = {}) {
    const cookiesAccepted = localStorage.getItem('cookiesAccepted');
    if (cookiesAccepted !== 'true') return;
    
    // Google Analytics
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params);
      log(`Evento tracciato con GA: ${eventName}`);
    }
    
    // Meta Pixel
    if (typeof window.fbq === 'function') {
      window.fbq('track', eventName, params);
      log(`Evento tracciato con Meta Pixel: ${eventName}`);
    }
  }

  // Esponi funzioni pubbliche tramite l'API globale
  window.dietingWithJoe = {
    init: init,
    resetConversation: startNewConversation,
    getState: () => conversationState
  };
  
  // Inizializzazione automatica quando il DOM è pronto
  document.addEventListener('DOMContentLoaded', init);
})();