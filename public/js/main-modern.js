// main-modern.js - Improved script with mobile optimizations
(function() {
    'use strict';
    
    // Verifica se lo script è già stato caricato
    if (window.dietingWithJoeInitialized) {
      console.warn('Script già inizializzato. Evitato caricamento duplicato.');
      return;
    }
    
    // Segnala che lo script è stato inizializzato
    window.dietingWithJoeInitialized = true;
    
    // Debug mode per diagnosticare eventuali problemi
    const DEBUG = false;
    
    // Log di debug
    function debugLog(message) {
      if (DEBUG) {
        const timestamp = new Date().toISOString().substr(11, 12);
        console.log(`[${timestamp}] [DietingWithJoe] ${message}`);
      }
    }
    
    debugLog('Script caricato');
    
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
      DEBUG: DEBUG,
      // Rilevazione mobile (migliore rilevamento, include tablet)
      IS_MOBILE: /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                (('ontouchstart' in window) && window.innerWidth <= 1024)
    };
    
    // Stampa info di debug
    debugLog(`App inizializzata: ${APP_CONFIG.IS_MOBILE ? 'mobile' : 'desktop'}`);
    debugLog(`User agent: ${navigator.userAgent}`);
    
    // Ottieni la lingua corrente o usa l'italiano come fallback
    let currentLang = 'it';
    try {
      if (window.currentLanguage) {
        currentLang = window.currentLanguage;
        debugLog(`Lingua rilevata: ${currentLang}`);
      }
    } catch (e) {
      debugLog('Variabile currentLanguage non disponibile, utilizzo fallback');
    }
  
    // Variabili locali
    let conversationState = {
      exists: false,
      isActive: true,
      conversationStep: 0,
      messages: [],
      collectedData: null,
      conversationUUID: null
    };
    
    let inactivityTimer = null;
    let retryCount = 0;
    let isSubmitting = false;
    // Socket.io connection
    let socket = null;
    let socketConnected = false;
    let socketReconnecting = false;
    
    // Flag per controllare l'attivazione della chat
    let isChatActive = false;
    let isConversationStarted = false;
    let hasUserInteracted = false;
    
    // Controllo esplicito per prevenire l'attivazione automatica
    let preventAutoActivation = true;
  
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
      debugLog('Inizializzazione app...');
      
      // Impostiamo un piccolo ritardo prima di inizializzare
      // per assicurarci che tutti gli elementi della pagina siano caricati
      setTimeout(() => {
        loadDOMElements();
        
        // Verifica che gli elementi essenziali esistano
        if (!elementsExist()) {
          console.error('Elementi DOM essenziali mancanti, impossibile inizializzare l\'app');
          return;
        }
  
        debugLog('Elementi DOM caricati');
  
        // Inizializza il layout della chat
        initChatLayout();
  
        // Inizializzazione del cookie consent
        initCookieConsent();
        
        // Impostazione degli event listener
        setupEventListeners();
        
        // Impostazione del timer di inattività
        resetInactivityTimer();
        
        // Ripristino stato da localStorage (se disponibile)
        restoreFromStorage();
        
        // Inizializza la connessione WebSocket
        // NON avviare automaticamente la conversazione
        initSocketConnection();
        
        // Configura gestori per tastiera mobile
        if (APP_CONFIG.IS_MOBILE) {
          setupMobileKeyboardHandlers();
        }
        
        // Configura auto-resize dell'input
        setupInputAutoResize();
        
        debugLog('Inizializzazione completata, in attesa di interazione utente');
      }, 100);
    }
    
    /**
     * Configura l'auto-resize dell'input (stile ChatGPT)
     */
    function setupInputAutoResize() {
      if (!elements.chatInput) return;
      
      // Imposta la funzione di auto-resize
      const resizeInput = () => {
        elements.chatInput.style.height = 'auto'; // Reset altezza
        
        // Calcola l'altezza in base al contenuto
        const newHeight = Math.min(elements.chatInput.scrollHeight, 120); // Max 120px
        elements.chatInput.style.height = `${newHeight}px`;
        
        // Se ci troviamo su mobile, aggiusta lo scroll
        if (APP_CONFIG.IS_MOBILE && newHeight >= 80) {
          setTimeout(scrollToBottom, 10);
        }
      };
      
      // Aggiungi gli event listener
      elements.chatInput.addEventListener('input', resizeInput);
      elements.chatInput.addEventListener('focus', resizeInput);
      
      // Initial resize
      setTimeout(resizeInput, 100);
    }
    
    /**
     * Gestori specifici per la tastiera mobile
     */
    function setupMobileKeyboardHandlers() {
      // Usa la VisualViewport API se disponibile (iOS 13+, Android recenti)
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleVisualViewportResize);
        window.visualViewport.addEventListener('scroll', handleVisualViewportResize);
        debugLog('VisualViewport API disponibile, configurata');
      } else {
        // Fallback per browser più vecchi
        window.addEventListener('resize', handleMobileResize);
        debugLog('Usando fallback resize per tastiera mobile');
      }
      
      // Per Safari iOS: il focus su input dovrebbe scrollare la pagina
      if (elements.chatInput) {
        elements.chatInput.addEventListener('focus', () => {
          // Piccolo delay per dare tempo al keyboard di apparire
          setTimeout(() => {
            scrollToBottom(true);
            
            // Assicurati che l'input sia visibile
            elements.chatInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 300);
        });
      }
    }
    
    /**
     * Inizializza il layout e le funzionalità di scrolling della chat
     */
    function initChatLayout() {
      debugLog('Inizializzazione layout chat...');
      
      // Configura l'observer per lo scrolling automatico
      setupScrollObserver();
      
      // Configura handler per lo scroll manuale
      setupManualScrollHandler();
      
      // Verifica dimensioni iniziali e adatta il layout
      adjustChatLayout();
      
      // Aggiungi listener per adattare il layout quando la finestra cambia dimensione
      window.addEventListener('resize', () => {
        // Throttle per non sovraccaricare
        if (!window.resizeThrottle) {
          window.resizeThrottle = setTimeout(() => {
            adjustChatLayout();
            window.resizeThrottle = null;
          }, 200);
        }
      });
      
      debugLog('Layout chat inizializzato');
    }
  
    /**
     * Adatta il layout della chat in base alle dimensioni della finestra
     * Versione migliorata con supporto per notch e home indicators
     */
    function adjustChatLayout() {
      if (!elements.chatWrapper) return;
      
      // Ottieni altezza della viewport considerando le safe areas
      const viewportHeight = window.innerHeight;
      
      // Determina altezza di header e footer
      let headerHeight = 0;
      const header = document.querySelector('header');
      if (header) {
        headerHeight = header.offsetHeight;
      }
      
      let footerHeight = 0;
      const footer = document.querySelector('footer');
      if (footer) {
        footerHeight = footer.offsetHeight;
      }
      
      // Determina altezza input
      const inputHeight = elements.chatInput ? 
        (elements.chatInput.offsetHeight + 24) : 70;
      
      // Calcola l'altezza del contenitore messaggi
      const messagesHeight = viewportHeight - headerHeight - footerHeight - inputHeight;
      
      // Imposta l'altezza dei messaggi
      if (elements.chatMessages) {
        elements.chatMessages.style.height = `${Math.max(300, messagesHeight)}px`;
      }
      
      debugLog(`Layout chat adattato - altezza messaggi: ${messagesHeight}px`);
    }
    
    // Ripristino stato da localStorage
    function restoreFromStorage() {
      try {
        const savedState = localStorage.getItem(APP_CONFIG.STORAGE_KEY);
        if (savedState) {
          const parsedState = JSON.parse(savedState);
          
          debugLog(`Stato ripristinato da localStorage: ${JSON.stringify(parsedState)}`);
          
          // NON attiviamo automaticamente la chat anche se era attiva in precedenza
          // In questo modo assicuriamo che gli elementi di marketing siano sempre visibili all'inizio
          
          // Segnaliamo solo che c'era uno stato precedente
          if (parsedState.isChatActive) {
            debugLog('Chat era attiva in precedenza, ma non viene attivata automaticamente');
          }
        }
      } catch (e) {
        debugLog(`Errore nel ripristinare lo stato: ${e.message}`);
      }
    }
    
    // Caricamento elementi DOM
    function loadDOMElements() {
      elements.body = document.body;
      elements.marketingSection = document.getElementById('marketing-section');
      elements.chatWrapper = document.querySelector('.chat-wrapper');
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
      elements.startInstruction = document.querySelector('.start-instruction');
      
      // Log per verificare lo stato degli elementi di marketing
      if (elements.marketingSection) {
        debugLog(`Sezione marketing trovata, classe: ${elements.marketingSection.className}`);
      } else {
        debugLog('ERRORE: Sezione marketing non trovata nel DOM');
      }
    }
    
    /**
     * Inizializza la connessione WebSocket
     */
    function initSocketConnection() {
      // Se c'è già una connessione attiva, non fare nulla
      if (socket && socket.connected) {
        debugLog('Socket già connesso, nessuna azione richiesta');
        return;
      }
      
      debugLog('Inizializzazione connessione WebSocket...');
      
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
        
        debugLog(`Tentativo di autenticazione socket con sessionId: ${sessionId}`);
      } else {
        debugLog('Impossibile autenticare socket: sessionId mancante');
        
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
        debugLog(`Socket connesso: ${socket.id}`);
        socketConnected = true;
        socketReconnecting = false;
        
        if (elements.connectionStatus) {
          elements.connectionStatus.classList.add('hidden');
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
        debugLog(`Socket disconnesso: ${reason}`);
        socketConnected = false;
        
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
        debugLog(`Tentativo di riconnessione socket #${attemptNumber}`);
        socketReconnecting = true;
        
        if (elements.connectionStatus) {
          elements.connectionStatus.classList.remove('hidden');
          if (elements.connectionMessage) {
            elements.connectionMessage.textContent = `${translations.messages.retry || 'Riconnessione in corso...'} (${attemptNumber})`;
          }
        }
      });
      
      // Evento di fallimento riconnessione
      socket.on('reconnect_failed', () => {
        debugLog('Riconnessione socket fallita dopo tutti i tentativi');
        socketReconnecting = false;
        
        if (elements.connectionStatus) {
          elements.connectionStatus.classList.remove('hidden');
          if (elements.connectionMessage) {
            elements.connectionMessage.textContent = translations.error.reconnect || 'Impossibile riconnettersi';
          }
        }
      });
      
      // Evento di errore
      socket.on('error', (error) => {
        debugLog(`Errore socket: ${error.message || 'errore generico'}`);
      });
      
      // Messaggi di risposta dal server
      socket.on('conversation_state', (data) => {
        debugLog(`Ricevuto stato conversazione dal server: ${JSON.stringify(data)}`);
        
        // IMPORTANTE: Ignoriamo completamente qualsiasi stato dal server
        // a meno che non sia stato l'utente a iniziare la conversazione
        if (data.exists && isConversationStarted && hasUserInteracted) {
          debugLog('L\'utente ha interagito, gestisco lo stato della conversazione');
          handleConversationState(data);
        } else if (data.exists && !hasUserInteracted) {
          // Salviamo lo stato ma NON mostriamo nulla e NON attiviamo la chat
          debugLog('Conversazione esistente sul server, ma l\'utente non ha interagito. Ignoro.');
          
          // Salva stato per utilizzo futuro, ma NON attivare la chat
          conversationState = {
            ...data,
            exists: true
          };
        } else {
          debugLog('Stato conversazione non rilevante, ignoro');
        }
      });
      
      // Ricezione dei chunk di risposta dell'assistente - Migliorata per esperienza ChatGPT
      socket.on('assistant_chunk', (data) => {
        // Mostriamo i chunk solo se la conversazione è stata avviata esplicitamente dall'utente
        if (isConversationStarted && hasUserInteracted) {
          debugLog('Ricevuto chunk di risposta dall\'assistente');
          handleAssistantChunk(data);
        } else {
          debugLog('Ricevuto chunk ma l\'utente non ha interagito, ignoro');
        }
      });
      
      // Aggiornamento dello stato della conversazione
      socket.on('conversation_updated', (data) => {
        debugLog(`Ricevuto aggiornamento stato conversazione: ${JSON.stringify(data)}`);
        
        // Aggiorna stato solo se l'utente ha interagito
        if (data && isConversationStarted && hasUserInteracted) {
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
      });
      
      // Pulsante di riconnessione manuale
      if (elements.reconnectButton) {
        elements.reconnectButton.addEventListener('click', () => {
          if (socket) {
            debugLog('Tentativo di riconnessione manuale');
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
      if (data.exists && hasUserInteracted &&
         (!conversationState.exists || data.messages.length > conversationState.messages.length)) {
        
        debugLog(`Aggiornamento stato conversazione: ${data.messages.length} messaggi`);
        
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
        
        // Attiva la chat se ci sono messaggi e l'utente ha interagito
        if (data.messages.length > 0 && hasUserInteracted) {
          activateChat();
        }
        
        // Visualizza i messaggi
        if (hasUserInteracted) {
          data.messages.forEach(msg => {
            if (msg.role === 'user') {
              addUserMessage(msg.content);
            } else if (msg.role === 'assistant') {
              addAssistantMessage(msg.content, false); // false = non animare messaggi caricati
            }
          });
          
          // Se la conversazione è terminata, mostra il pulsante di conferma
          if (!data.isActive && data.collectedData) {
            addConfirmationButton();
          }
          
          // Scorrimento automatico in fondo
          scrollToBottom();
        }
      } else if (!data.exists && isConversationStarted && hasUserInteracted) {
        // Se non esiste ancora una conversazione ma l'utente ha interagito, iniziane una nuova
        debugLog('Nessuna conversazione sul server, ma l\'utente ha interagito. Avvio nuova conversazione.');
        startConversation();
      }
    }
    
    /**
     * Gestisce i chunk di risposta dell'assistente - Migliorata per stile ChatGPT
     */
    function handleAssistantChunk(data) {
      if (!data || !hasUserInteracted) return;
      
      // Attiva la chat se è la prima risposta e l'utente ha interagito
      if (!isChatActive && hasUserInteracted) {
        activateChat();
      }
      
      // Se è il primo chunk, crea un messaggio placeholder
      let messageElement = document.querySelector('.message-assistant:last-child');
      let messageTextElement;
      
      if (!messageElement) {
        messageElement = createMessageElement('assistant', '');
        messageElement.classList.add('message-new'); // Classe per evidenziare nuovi messaggi
        if (elements.chatMessages) {
          elements.chatMessages.appendChild(messageElement);
        }
      }
      
      // Ottieni l'elemento di testo
      messageTextElement = messageElement.querySelector('.message-text');
      
      // Se c'è un chunk da aggiungere
      if (data.chunk) {
        // Nascondi l'indicatore di digitazione quando iniziamo a ricevere contenuto
        if (messageTextElement && messageTextElement.innerHTML === '') {
          hideTypingIndicator();
        }
        
        // Aggiorna il contenuto del messaggio - Stile ChatGPT character by character
        if (messageTextElement) {
          if (data.message) {
            // Se c'è un messaggio completo, usalo direttamente
            messageTextElement.innerHTML = formatMessage(data.message);
          } else {
            // Altrimenti aggiungi solo il chunk con effetto digitazione
            const currentContent = messageTextElement.innerHTML;
            const newContent = formatMessage(currentContent + data.chunk);
            messageTextElement.innerHTML = newContent;
            
            // Evidenzia l'ultimo carattere aggiunto (effetto ChatGPT)
            const tempSpan = document.createElement('span');
            tempSpan.className = 'highlight-text';
            tempSpan.textContent = data.chunk.charAt(data.chunk.length - 1);
            
            // Rimuovi eventuali span residui (cleanup)
            const oldHighlights = messageTextElement.querySelectorAll('.highlight-text');
            oldHighlights.forEach(el => {
              el.outerHTML = el.textContent;
            });
          }
          
          // Scorrimento fluido mentre il messaggio cresce
          if (isScrolledToBottom()) {
            scrollToBottom(true); // true = smooth scrolling
          }
        }
      }
      
      // Gestione della completezza del messaggio
      if (data.isComplete) {
        debugLog('Risposta assistente completata');
        
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
          elements.chatInput.focus();
          
          // Reimposta l'altezza dell'input
          elements.chatInput.style.height = 'auto';
        }
        
        if (elements.sendButton) {
          elements.sendButton.disabled = false;
        }
        
        // Reset del contatore di tentativi
        retryCount = 0;
        
        // Scrolling automatico al completamento
        scrollToBottom();
        
        // Traccia evento
        trackEvent('message_received');
      }
    }
  
    /**
     * Verifica che gli elementi DOM essenziali esistano
     */
    function elementsExist() {
      const exists = elements.chatMessages && 
             elements.chatForm && 
             elements.chatInput;
      
      if (!exists) {
        debugLog('ERRORE: Elementi DOM essenziali mancanti');
      }
      
      return exists;
    }
  
    /**
     * Impostazione degli event listener
     */
    function setupEventListeners() {
      debugLog('Configurazione event listener...');
      
      // Form di invio messaggio
      if (elements.chatForm) {
        elements.chatForm.addEventListener('submit', handleSubmitMessage);
        debugLog('Event listener per form impostato');
      }
      
      // Input del messaggio
      if (elements.chatInput) {
        elements.chatInput.addEventListener('input', resetInactivityTimer);
        
        // Attiva la chat quando l'utente inizia a digitare
        elements.chatInput.addEventListener('input', (e) => {
          if (!hasUserInteracted && e.target.value.trim().length > 0) {
            debugLog('Utente ha iniziato a digitare, attivo chat');
            markUserInteraction();
            activateChatAndStartConversation();
          }
        });
        
        elements.chatInput.addEventListener('keydown', (e) => {
          // Invia messaggio con Enter (ma non con Shift+Enter)
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            
            // Segna l'interazione utente
            markUserInteraction();
            
            if (elements.chatForm) {
              elements.chatForm.dispatchEvent(new Event('submit'));
            }
          }
          
          // Con Shift+Enter aggiungi una nuova riga (come in ChatGPT)
          if (e.key === 'Enter' && e.shiftKey) {
            // Nessuna azione speciale, il comportamento predefinito aggiungerà una nuova riga
            setTimeout(() => {
              // Applica l'auto-resize dell'input dopo l'aggiunta della nuova riga
              elements.chatInput.style.height = 'auto';
              elements.chatInput.style.height = `${Math.min(elements.chatInput.scrollHeight, 120)}px`;
            }, 0);
          }
        });
        
        // Click sull'input attiva la chat se non è già attiva
        elements.chatInput.addEventListener('focus', () => {
          debugLog('Utente ha cliccato sull\'input, segnalo interazione');
          
          // Segnala che l'utente ha interagito
          markUserInteraction();
          
          // Se la chat non è attiva, attivala
          if (!isChatActive) {
            activateChatAndStartConversation();
          }
        });
        
        debugLog('Event listener per input impostati');
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
          if (elements.languageToggle) {
            elements.languageToggle.setAttribute('aria-expanded', 'false');
          }
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
      
      // Event listener per messaggi e scorrimento - migliore UX
      if (elements.chatMessages) {
        elements.chatMessages.addEventListener('scroll', () => {
          // Salva la posizione di scorrimento per ripristinarla se necessario
          window.lastScrollPosition = elements.chatMessages.scrollTop;
        });
      }
      
      debugLog('Tutti gli event listener configurati');
    }
    
    /**
     * Funzione per gestire il viewport visibile (versione migliorata)
     */
    function handleVisualViewportResize() {
      if (!elements.chatWrapper || !elements.chatMessages || !elements.chatInput) return;
      
      // Utilizza l'API visualViewport per rilevare accuratamente la dimensione dello schermo con tastiera
      const viewportHeight = window.visualViewport.height;
      const windowHeight = window.innerHeight;
      
      // Rileva se la tastiera è aperta (dinamicamente rispetto alle dimensioni del dispositivo)
      // Consideriamo che se la viewport è ridotta di >20%, probabilmente la tastiera è aperta
      const keyboardOpen = viewportHeight < windowHeight * 0.8;
      
      if (keyboardOpen) {
        debugLog(`Tastiera rilevata: viewport ${viewportHeight}px vs window ${windowHeight}px`);
        
        // Adatta i componenti all'apertura della tastiera
        const inputHeight = elements.chatInput.offsetHeight + 40; // Spazio aggiuntivo per il container
        const availableHeight = viewportHeight - inputHeight;
        
        // Regola altezza chat e scorri per mostrare input
        elements.chatMessages.style.height = `${availableHeight}px`;
        
        // Scorri per assicurarti che l'input sia visibile
        window.scrollTo(0, window.visualViewport.offsetTop);
        
        // Verifica se l'input è sullo schermo, altrimenti scorri
        const inputRect = elements.chatInput.getBoundingClientRect();
        if (inputRect.bottom > viewportHeight) {
          window.scrollTo({
            top: window.scrollY + (inputRect.bottom - viewportHeight) + 20,
            behavior: 'smooth'
          });
        }
      } else {
        // Quando la tastiera è chiusa, ripristina le altezze normali
        adjustChatLayout();
      }
    }
    
    /**
     * Gestione della tastiera mobile fallback per browser più vecchi
     */
    function handleMobileResize() {
      if (!APP_CONFIG.IS_MOBILE) return;
      
      const viewportHeight = window.innerHeight;
      const initialHeight = window.initialWindowHeight || window.innerHeight;
      
      // Calcola una soglia dinamica basata sull'altezza iniziale della finestra
      const thresholdRatio = 0.75; // 75% dell'altezza originale
      const keyboardThreshold = initialHeight * thresholdRatio;
      
      if (viewportHeight < keyboardThreshold) {
        // Tastiera probabile
        debugLog(`Tastiera rilevata (fallback): ${viewportHeight}px vs ${initialHeight}px threshold`);
        
        if (elements.chatWrapper) {
          const inputHeight = elements.chatInput ? elements.chatInput.offsetHeight + 40 : 70;
          const availableHeight = viewportHeight - inputHeight - 20;
          
          // Regola altezza chat
          if (elements.chatMessages) {
            elements.chatMessages.style.height = `${availableHeight}px`;
          }
        }
        // Scorri in fondo per vedere i messaggi più recenti
        scrollToBottom(true);
      } else {
        // Tastiera chiusa
        adjustChatLayout();
      }
    }
    
    /**
     * Segna che l'utente ha interagito con la pagina
     */
    function markUserInteraction() {
      if (!hasUserInteracted) {
        debugLog('Prima interazione utente rilevata');
        hasUserInteracted = true;
        
        // Disabilita la prevenzione dell'attivazione automatica
        preventAutoActivation = false;
        
        // Salva l'altezza iniziale della finestra per calcoli tastiera
        if (typeof window.initialWindowHeight === 'undefined') {
          window.initialWindowHeight = window.innerHeight;
          debugLog(`Altezza iniziale finestra salvata: ${window.initialWindowHeight}px`);
        }
      }
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
        debugLog('Banner cookie consent mostrato');
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
      
      debugLog('Cookie accettati');
    }
  
    /**
     * Rifiuto cookies
     */
    function rejectCookies() {
      localStorage.setItem('cookiesAccepted', 'false');
      if (elements.cookieConsent) {
        elements.cookieConsent.classList.add('hidden');
      }
      
      debugLog('Cookie rifiutati');
    }
  
    /**
     * Toggle del dropdown delle lingue
     */
    function toggleLanguageDropdown() {
      if (elements.languageDropdown) {
        const isHidden = elements.languageDropdown.classList.toggle('hidden');
        if (elements.languageToggle) {
          elements.languageToggle.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
        }
      }
    }
  
    /**
     * Attiva la modalità chat
     */
    function activateChat() {
      if (isChatActive) return;
      
      debugLog('Attivazione modalità chat');
      
      // Imposta flag
      isChatActive = true;
      
      // Aggiunge classe al body
      if (elements.body) {
        elements.body.classList.remove('chat-inactive');
        elements.body.classList.add('chat-active');
      }
      
      // Nascondi la sezione di marketing con una transizione fluida
      if (elements.marketingSection) {
        debugLog('Nascondo sezione marketing con transizione');
        elements.marketingSection.classList.add('fade-out');
        
        // Dopo l'animazione, nascondi completamente
        setTimeout(() => {
          elements.marketingSection.classList.add('hidden');
          debugLog('Sezione marketing completamente nascosta');
          
          // Regola layout dopo che marketing è nascosto
          adjustChatLayout();
        }, 300); // Tempo ridotto per una transizione più veloce
      } else {
        debugLog('ERRORE: Impossibile trovare sezione marketing');
      }
      
      // Nascondi il testo di istruzione
      if (elements.startInstruction) {
        elements.startInstruction.classList.add('fade-out');
        
        // Dopo l'animazione, nascondi completamente
        setTimeout(() => {
          elements.startInstruction.classList.add('hidden');
        }, 300);
      }
      
      // Salva lo stato in localStorage
      try {
        localStorage.setItem(APP_CONFIG.STORAGE_KEY, JSON.stringify({
          isChatActive: true
        }));
      } catch (e) {
        debugLog(`Errore nel salvare lo stato: ${e.message}`);
      }
      
      // Focus sull'input
      if (elements.chatInput) {
        setTimeout(() => {
          elements.chatInput.focus();
          
          // Fornisci feedback tattile su dispositivi che lo supportano
          if (window.navigator && window.navigator.vibrate) {
            try {
              window.navigator.vibrate(50); // Vibrazione sottile
            } catch (e) {
              // Ignora errori, la vibrazione è solo un miglioramento
            }
          }
        }, 400); // Tempo aumentato per consentire il completamento dell'animazione
      }
    }
    
    /**
     * Attiva la chat e avvia la conversazione
     */
    function activateChatAndStartConversation() {
      // Verifica che l'utente abbia interagito
      if (!hasUserInteracted) {
        debugLog('BLOCCO: Tentativo di attivare chat senza interazione utente');
        return;
      }
      
      debugLog('Attivazione chat e avvio conversazione in seguito a interazione utente');
      
      // Attiva la UI della chat
      activateChat();
      
      // Se la conversazione non è già stata avviata, avviala
      if (!isConversationStarted) {
        isConversationStarted = true;
        
        debugLog('Prima attivazione della conversazione');
        
        // Se abbiamo già i dati di una conversazione dal server, mostriamoli
        if (conversationState.exists && conversationState.messages.length > 0) {
          debugLog(`Ripristino conversazione esistente con ${conversationState.messages.length} messaggi`);
          
          // Mostra messaggi esistenti senza animazione
          conversationState.messages.forEach(msg => {
            if (msg.role === 'user') {
              addUserMessage(msg.content);
            } else if (msg.role === 'assistant') {
              addAssistantMessage(msg.content, false); // false = non animare i messaggi caricati
            }
          });
          
          // Se la conversazione è terminata, mostra il pulsante di conferma
          if (!conversationState.isActive && conversationState.collectedData) {
            addConfirmationButton();
          }
          
          // Scorrimento automatico in fondo
          scrollToBottom();
        } else {
          // Altrimenti avvia una nuova conversazione
          debugLog('Nessuna conversazione esistente, ne avvio una nuova');
          startConversation();
        }
      }
    }
  
    /**
     * Avvio della conversazione
     */
    function startConversation() {
      try {
        // Verifica che l'utente abbia interagito
        if (!hasUserInteracted) {
          debugLog('BLOCCO: Tentativo di avviare conversazione senza interazione utente');
          return;
        }
        
        // Imposta flag che la conversazione è stata avviata
        isConversationStarted = true;
        
        debugLog('Avvio conversazione...');
        
        // Verifica che il socket sia connesso
        if (!socket || !socketConnected) {
          debugLog('Socket non connesso, riconnessione...');
          initSocketConnection();
          
          // Aggiungiamo un listener temporaneo per avviare la conversazione dopo la connessione
          const onConnect = () => {
            socket.off('connect', onConnect);
            // Avvia conversazione dopo un breve delay per assicurarsi che l'autenticazione sia completa
            setTimeout(() => {
              if (hasUserInteracted) {
                emitStartConversation();
              } else {
                debugLog('BLOCCO: Utente non ha interagito, non avvio la conversazione');
              }
            }, 500);
          };
          
          socket.on('connect', onConnect);
          return;
        }
        
        // Se già connesso, emetti direttamente
        if (hasUserInteracted) {
          emitStartConversation();
        } else {
          debugLog('BLOCCO: Utente non ha interagito, non avvio la conversazione');
        }
      } catch (error) {
        debugLog(`Errore nell'avvio della conversazione: ${error.message}`);
        addAssistantMessage(translations.error.generic, true);
      }
    }
    
    /**
     * Invia richiesta di avvio conversazione tramite WebSocket
     */
    function emitStartConversation() {
      // Verifica finale che l'utente abbia interagito
      if (!hasUserInteracted) {
        debugLog('BLOCCO: Tentativo di emettere start_conversation senza interazione utente');
        return;
      }
      
      // Mostra l'indicatore di digitazione
      showTypingIndicator();
      
      debugLog('Emetto evento start_conversation');
      
      // Emetti evento di inizio conversazione
      socket.emit('start_conversation', {
        language: currentLang
      });
      
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
     * Invio messaggio utente - migliorato stile ChatGPT
     */
    function handleSubmitMessage(e) {
      e.preventDefault();
      
      if (!elements.chatInput) return;
      
      const userInput = elements.chatInput.value.trim();
      if (!userInput || isSubmitting) return;
      
      debugLog(`Tentativo di invio messaggio: "${userInput.substring(0, 20)}..."`);
      
      // Segna che l'utente ha interagito
      markUserInteraction();
      
      // Se la conversazione non è stata avviata, avviala prima di inviare il messaggio
      if (!isConversationStarted) {
        debugLog('Messaggio inviato prima di avviare la conversazione, avvio conversazione');
        activateChatAndStartConversation();
        
        // In questo caso, salviamo il messaggio per inviarlo dopo che la conversazione è stata avviata
        // Aggiungiamo un breve ritardo per assicurarci che il server abbia tempo di elaborare la richiesta
        setTimeout(() => {
          elements.chatInput.value = userInput;
          if (elements.chatForm) {
            elements.chatForm.dispatchEvent(new Event('submit'));
          }
        }, 800);
        
        return;
      }
      
      // Verifica che il socket sia connesso
      if (!socket || !socketConnected) {
        debugLog('Socket non connesso, riconnessione...');
        
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
          }, 800);
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
      
      // Reimposta l'altezza dell'input dopo la pulizia
      elements.chatInput.style.height = 'auto';
      
      // Aggiornamento dei dati della conversazione
      conversationState.messages.push({ role: 'user', content: userInput });
      
      // Flag per evitare invii multipli
      isSubmitting = true;
      
      // Disabilita input e pulsante durante la comunicazione
      if (elements.chatInput) {
        elements.chatInput.disabled = true;
      }
      
      if (elements.sendButton) {
        elements.sendButton.disabled = true;
        
        // Animazione pulsante invio
        elements.sendButton.classList.add('sending');
        setTimeout(() => {
          elements.sendButton.classList.remove('sending');
        }, 300);
      }
      
      // Mostra l'indicatore di digitazione
      showTypingIndicator();
      
      try {
        // Invia il messaggio tramite socket
        socket.emit('user_message', {
          message: userInput,
          language: currentLang
        });
        
        debugLog(`Messaggio utente inviato: ${userInput.substring(0, 30)}${userInput.length > 30 ? '...' : ''}`);
        
        // Traccia evento
        trackEvent('message_sent');
        
        // Su mobile, assicurati che la vista sia posizionata correttamente
        if (APP_CONFIG.IS_MOBILE) {
          // Piccolo ritardo per dare tempo di aggiornare il DOM
          setTimeout(() => {
            scrollToBottom(true); // smooth scrolling
          }, 100);
        }
      } catch (error) {
        debugLog(`Errore nell'invio del messaggio: ${error.message}`);
        handleCommunicationError();
        
        // Riabilita input e pulsante
        if (elements.chatInput) {
          elements.chatInput.disabled = false;
        }
        
        if (elements.sendButton) {
          elements.sendButton.disabled = false;
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
        addAssistantMessage(`${translations.error.connection} ${translations.messages.retry} (${retryCount}/${APP_CONFIG.MAX_RETRIES})`, true);
      } else {
        addAssistantMessage(translations.error.generic, true);
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
      
      debugLog('Aggiungo bottone di conferma');
      
      const confirmButton = document.createElement('button');
      confirmButton.classList.add('btn', 'btn-primary', 'confirm-button');
      confirmButton.textContent = translations.messages.confirmation;
      confirmButton.setAttribute('aria-label', translations.messages.confirmation);
      confirmButton.addEventListener('click', handleFinalSubmission);
      
      const buttonContainer = document.createElement('div');
      buttonContainer.classList.add('confirmation-container');
      buttonContainer.appendChild(confirmButton);
      
      elements.chatMessages.appendChild(buttonContainer);
      
      // Assicurati che il bottone sia visibile scrollando in fondo
      scrollToBottom();
      
      // Aggiungi una piccola animazione per attirare l'attenzione
      setTimeout(() => {
        confirmButton.classList.add('animate-pulse');
        setTimeout(() => {
          confirmButton.classList.remove('animate-pulse');
        }, 1500);
      }, 500);
    }
  
    /**
     * Gestione dell'invio finale
     */
    async function handleFinalSubmission() {
      if (!elements.csrfToken || !elements.csrfToken.value) {
        debugLog("ERRORE: Token CSRF mancante");
        addAssistantMessage(translations.error.generic, true);
        return;
      }
      
      if (!conversationState.collectedData) {
        debugLog("ERRORE: Dati raccolti mancanti");
        addAssistantMessage(translations.error.generic, true);
        return;
      }
      
      debugLog('Invio finale dei dati raccolti');
      
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
        
        debugLog(`Payload preparato: ${JSON.stringify(payload).substring(0, 100)}...`);
        
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
          debugLog('Dati inviati con successo');
          
          // Nascondi l'indicatore di digitazione
          hideTypingIndicator();
          
          // Dopo un breve ritardo, mostra la schermata di ringraziamento con transizione fluida
          setTimeout(() => {
            if (elements.chatWrapper) {
              elements.chatWrapper.classList.add('fade-out');
              
              setTimeout(() => {
                elements.chatWrapper.classList.add('hidden');
                if (elements.thankYouScreen) {
                  elements.thankYouScreen.classList.add('fade-in');
                  elements.thankYouScreen.classList.remove('hidden');
                  
                  // Traccia evento di conversione
                  trackEvent('plan_requested');
                }
              }, 300);
            }
          }, 300);
        } else {
          throw new Error(data.error || translations.error.generic);
        }
      } catch (error) {
        debugLog(`Errore nell'invio dei dati finali: ${error.message}`);
        hideTypingIndicator();
        addAssistantMessage(`${translations.error.generic} ${error.message}`, true);
      }
    }
  
    /**
     * Mostra l'indicatore di digitazione - stile ChatGPT
     */
    function showTypingIndicator() {
      if (!elements.typingIndicator) return;
      
      elements.typingIndicator.classList.remove('hidden');
      scrollToBottom(true);
    }
  
    /**
     * Nascondi l'indicatore di digitazione
     */
    function hideTypingIndicator() {
      if (!elements.typingIndicator) return;
      
      elements.typingIndicator.classList.add('hidden');
    }
  
    /**
     * Aggiunta messaggio utente - Stile ChatGPT
     */
    function addUserMessage(message) {
        if (!elements.chatMessages) return;
        
        // Assicurati che i messaggi siano visibili in console per debug
        console.log("Aggiungendo messaggio utente:", message);
        
        // Crea l'elemento con la struttura corretta
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', 'message-user');
        
        // Contenuto del messaggio - semplificato per debug
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-content');
        contentDiv.style.backgroundColor =  '#5b7fff'; // Use the hex code directly
        contentDiv.style.color = 'white';
        
        const textDiv = document.createElement('div');
        textDiv.classList.add('message-text');
        textDiv.textContent = message; // Usa textContent per sicurezza
        
        // Monta la struttura DOM
        contentDiv.appendChild(textDiv);
        messageDiv.appendChild(contentDiv);
        
        // Aggiungi al container
        elements.chatMessages.appendChild(messageDiv);
        scrollToBottom();
      }
  
    /**
     * Aggiunta messaggio assistente - con opzione animazione
     * @param {string} message - Testo del messaggio
     * @param {boolean} animate - Se true, anima il messaggio
     */
    function addAssistantMessage(message, animate = true) {
      if (!elements.chatMessages) return;
      
      const messageElement = createMessageElement('assistant', message);
      messageElement.classList.add('message-new');
      elements.chatMessages.appendChild(messageElement);
      
      if (animate) {
        // Aggiungi classe temporanea per evidenziare il nuovo messaggio
        messageElement.classList.add('message-highlight');
        setTimeout(() => {
          messageElement.classList.remove('message-highlight');
        }, 1000);
      }
      
      scrollToBottom();
    }
  
    /**
     * Creazione elemento messaggio - Stile ChatGPT
     */
    // Replace the createMessageElement function with this version
function createMessageElement(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `message-${role}`);
    
    // Basic bubble-style message
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    const textDiv = document.createElement('div');
    textDiv.classList.add('message-text');
    textDiv.innerHTML = content; // Don't format to troubleshoot
    
    contentDiv.appendChild(textDiv);
    messageDiv.appendChild(contentDiv);
    
    return messageDiv;
  }
  
    /**
     * Formattazione messaggio (markdown semplice) - Migliorata
     */
    function formatMessage(message) {
      if (!message) return '';
      
      // Sostituzione newline con <br>
      let formatted = message.replace(/\n/g, '<br>');
      
      // Formattazione bold
      formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      
      // Formattazione italic
      formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
      
      // Link inline
      formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      
      // Code inline
      formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
      
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
     * Configura l'observer per lo scrolling automatico
     */
    function setupScrollObserver() {
      if (elements.chatMessages && !window.chatScrollObserver) {
        // Configura l'observer per monitorare aggiunte di nodi (nuovi messaggi)
        window.chatScrollObserver = new MutationObserver((mutations) => {
          let shouldScroll = false;
          const containerHeight = elements.chatMessages.clientHeight;
          const containerScrollHeight = elements.chatMessages.scrollHeight;
          const currentScrollPosition = elements.chatMessages.scrollTop;
          
          // Più intelligente: calcola percentuale di scorrimento
          const scrollPercentage = (currentScrollPosition + containerHeight) / containerScrollHeight;
          
          // Siamo vicini al fondo se siamo oltre il 90% di scorrimento
          const isNearBottom = scrollPercentage > 0.9;
          
          // Verifica se sono stati aggiunti nuovi messaggi
          for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
              // Controlla se i nuovi nodi sono messaggi dell'utente o dell'assistente
              for (const node of mutation.addedNodes) {
                if (node.classList && (
                    node.classList.contains('message-user') || 
                    (node.classList.contains('message-assistant') && isNearBottom) ||
                    node.classList.contains('confirmation-container')
                   )) {
                  shouldScroll = true;
                  break;
                }
              }
            }
          }
          
          // Scorri solo se necessario
          if (shouldScroll) {
            scrollToBottom(true); // smooth scroll
          }
        });
        
        // Osserva modifiche al DOM
        window.chatScrollObserver.observe(elements.chatMessages, {
          childList: true,
          subtree: false,
          characterData: false
        });
        
        // Aggiungi anche un listener per il resize della finestra
        window.addEventListener('resize', () => {
          if (isScrolledToBottom()) {
            scrollToBottom();
          }
        });
      }
    }
  
    /**
     * Verifica se siamo già scrollati in fondo
     */
    function isScrolledToBottom() {
      if (!elements.chatMessages) return true;
      
      const containerHeight = elements.chatMessages.clientHeight;
      const containerScrollHeight = elements.chatMessages.scrollHeight;
      const currentScrollPosition = elements.chatMessages.scrollTop;
      
      // Vicini al fondo se siamo a meno di 100px o 95% scrollati
      const pixelThreshold = 100;
      const percentageThreshold = 0.95;
      
      const pixelToBottom = containerScrollHeight - currentScrollPosition - containerHeight;
      const scrollPercentage = (currentScrollPosition + containerHeight) / containerScrollHeight;
      
      return pixelToBottom < pixelThreshold || scrollPercentage > percentageThreshold;
    }
  
    /**
     * Handler per lo scroll manuale dell'utente
     */
    function setupManualScrollHandler() {
      if (elements.chatMessages && !window.manualScrollHandlerSet) {
        let userScrolling = false;
        let scrollTimeout;
        
        elements.chatMessages.addEventListener('scroll', () => {
          userScrolling = true;
          
          // Resetta il flag dopo un breve periodo di inattività
          clearTimeout(scrollTimeout);
          scrollTimeout = setTimeout(() => {
            userScrolling = false;
          }, 1000);
        });
        
        // Salva il flag per evitare di impostare nuovamente il listener
        window.manualScrollHandlerSet = true;
      }
    }
  
    /**
     * Scorrimento in fondo alla chat - ChatGPT-style scrolling
     * @param {boolean} smooth - Se true, usa animazione fluida
     */
    function scrollToBottom(smooth = false) {
      if (!elements.chatMessages) return;
      
      const behavior = smooth && !APP_CONFIG.IS_MOBILE ? 'smooth' : 'auto';
      
      // Trova l'ultimo messaggio o elemento nella chat
      const messages = elements.chatMessages.children;
      if (messages.length === 0) return;
      
      const lastElement = messages[messages.length - 1];
      
      // Scorri all'ultimo elemento con la behavior specificata
      lastElement.scrollIntoView({ 
        behavior: behavior, 
        block: 'end' 
      });
      
      // Assicura che lo scroll raggiunga effettivamente il fondo
      // Utile soprattutto su Safari iOS
      
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
      
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
      if (conversationState.exists && conversationState.isActive && isChatActive && isConversationStarted && hasUserInteracted) {
        addAssistantMessage(translations.messages.timeout, true);
      }
    }
  
    /**
     * Gestione visibilità pagina
     */
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        debugLog('Pagina tornata visibile');
        
        // Reset del timer quando la pagina torna visibile
        resetInactivityTimer();
        
        // Se il socket è disconnesso, tenta la riconnessione
        if (socket && !socketConnected) {
          debugLog('Tentativo di riconnessione del socket');
          socket.connect();
        }
      } else if (document.visibilityState === 'hidden') {
        debugLog('Pagina nascosta');
        
        // Impostiamo solo un timer lungo per risparmiare batteria se la pagina resta nascosta molto tempo
        setTimeout(() => {
          if (document.visibilityState === 'hidden') {
            debugLog('Pagina nascosta per periodo prolungato, disconnessione socket');
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
      debugLog('Avvio nuova conversazione');
      
      // Reset degli elementi UI
      if (elements.chatMessages) {
        elements.chatMessages.innerHTML = '';
      }
      
      if (elements.chatWrapper) {
        elements.chatWrapper.classList.remove('hidden');
        // Rimuovi eventuali classi di transizione
        elements.chatWrapper.classList.remove('fade-out');
      }
      
      if (elements.thankYouScreen) {
        elements.thankYouScreen.classList.add('hidden');
        elements.thankYouScreen.classList.remove('fade-in');
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
      
      // Reset flag conversazione
      isConversationStarted = true;
      hasUserInteracted = true; // Considerata come interazione esplicita
      
      // Rimuovi i dati dal localStorage
      try {
        localStorage.removeItem(APP_CONFIG.STORAGE_KEY);
      } catch (e) {
        debugLog(`Impossibile rimuovere lo stato da localStorage: ${e.message}`);
      }
      
      // Riattiva la chat
      activateChat();
      
      // Verifica che il socket sia connesso
      if (!socket || !socketConnected) {
        debugLog('Socket non connesso, riconnessione prima di avviare nuova conversazione');
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
      
      // Focus sull'input
      if (elements.chatInput) {
        elements.chatInput.disabled = false;
        setTimeout(() => {
          elements.chatInput.focus();
        }, 300);
      }
      
      // Abilita il pulsante di invio
      if (elements.sendButton) {
        elements.sendButton.disabled = false;
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
        debugLog('Google Analytics attivato');
      }
      
      // Attivazione di Meta Pixel
      if (typeof window.fbq === 'function') {
        debugLog('Meta Pixel attivato');
      }
    }
  
    /**
     * Logging
     */
    function log(message) {
      if (APP_CONFIG.DEBUG) {
        debugLog(message);
      }
    }
  
    /**
     * Registrazione di eventi per analytics
     */
    function trackEvent(eventName, params = {}) {
      const cookiesAccepted = localStorage.getItem('cookiesAccepted');
      if (cookiesAccepted !== 'true') return;
      
      debugLog(`Tracking evento: ${eventName}`);
      
      // Google Analytics
      if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, params);
      }
      
      // Meta Pixel
      if (typeof window.fbq === 'function') {
        window.fbq('track', eventName, params);
      }
    }
  
    // Esponi funzioni pubbliche tramite l'API globale
    window.dietingWithJoe = {
      init: init,
      resetConversation: startNewConversation,
      getState: () => conversationState,
      activateChat: activateChat,
      startConversation: activateChatAndStartConversation,
      debug: DEBUG ? {
        state: () => ({
          isChatActive,
          isConversationStarted,
          hasUserInteracted,
          preventAutoActivation,
          socketConnected
        }),
        log: debugLog,
        markUserInteracted: markUserInteraction
      } : null
    };
    
    // Inizializzazione automatica quando il DOM è pronto
    document.addEventListener('DOMContentLoaded', init);
  })();