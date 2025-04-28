// chat-app.js - Implementazione semplificata e modulare per DietingWithJoe
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
    const DEBUG = true;
    
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
  
    // EventBus - Pattern Observer per comunicazione tra moduli
    const eventBus = (function() {
      const events = {};
      
      function subscribe(event, callback) {
        if (!events[event]) {
          events[event] = [];
        }
        events[event].push(callback);
        
        // Restituisci una funzione per annullare la sottoscrizione
        return function unsubscribe() {
          events[event] = events[event].filter(
            function(cb) {
              return cb !== callback;
            }
          );
        };
      }
      
      function publish(event, data) {
        if (!events[event]) {
          return;
        }
        events[event].forEach(function(callback) {
          callback(data);
        });
      }
      
      return {
        subscribe: subscribe,
        publish: publish
      };
    })();
  
    // State - Stato dell'applicazione
    const state = {
      isActive: false,
      isConversationStarted: false,
      hasUserInteracted: false,
      preventAutoActivation: true,
      conversation: {
        exists: false,
        isActive: true,
        conversationStep: 0,
        messages: [],
        collectedData: null,
        conversationUUID: null
      },
      connection: {
        isConnected: false,
        isReconnecting: false
      },
      isSubmitting: false,
      retryCount: 0
    };
  
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
    let elements = {};
    
    // Timer di inattività
    let inactivityTimer = null;
    
    // Socket.io connection
    let socket = null;
    
    /**
     * Funzione di inizializzazione principale dell'applicazione
     */
    function init() {
      debugLog('Inizializzazione app...');
      
      // Impostiamo un piccolo ritardo prima di inizializzare
      // per assicurarci che tutti gli elementi della pagina siano caricati
      setTimeout(function() {
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
        
        // Configura gestori per tastiera mobile
        if (APP_CONFIG.IS_MOBILE) {
          setupMobileKeyboardHandlers();
        }
        
        // Configura auto-resize dell'input
        setupInputAutoResize();
        
        // Inizializza menu a icona
        setupMenuDropdown();
        
        debugLog('Inizializzazione completata, in attesa di interazione utente');
      }, 100);
    }
    
    /**
     * Caricamento elementi DOM
     */
    function loadDOMElements() {
      elements = {
        body: document.body,
        marketingSection: document.getElementById('marketing-section'),
        chatContainer: document.getElementById('chat-container'),
        chatMessages: document.getElementById('chat-messages'),
        chatForm: document.getElementById('chat-form'),
        chatInput: document.getElementById('chat-input'),
        sendButton: document.getElementById('send-button'),
        typingIndicator: document.getElementById('typing-indicator'),
        thankYouScreen: document.getElementById('thank-you-screen'),
        newConversationBtn: document.getElementById('new-conversation'),
        cookieConsent: document.getElementById('cookie-consent'),
        acceptCookiesBtn: document.getElementById('accept-cookies'),
        rejectCookiesBtn: document.getElementById('reject-cookies'),
        languageBtn: document.getElementById('language-btn'),
        languageDropdown: document.querySelector('.language-dropdown'),
        csrfToken: document.getElementById('csrf-token'),
        connectionStatus: document.getElementById('connection-status'),
        connectionMessage: document.getElementById('connection-message'),
        reconnectButton: document.getElementById('reconnect-button'),
        startInstruction: document.getElementById('start-instruction'),
        menuBtn: document.getElementById('menu-btn'),
        menuDropdown: document.getElementById('menu-dropdown')
      };
      
      // Log per verificare lo stato degli elementi di marketing
      if (elements.marketingSection) {
        debugLog(`Sezione marketing trovata, classe: ${elements.marketingSection.className}`);
      } else {
        debugLog('ERRORE: Sezione marketing non trovata nel DOM');
      }
    }

    const startButton = document.getElementById('start-chat-button');
    if (startButton) {
      startButton.addEventListener('click', () => {
        if (!window.dietingWithJoe.getState().isActive) {
          window.dietingWithJoe.debug?.markUserInteracted();
          window.dietingWithJoe.startConversation();
        }
      });
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
     * Inizializza il menu a icona
     */
    function setupMenuDropdown() {
      const menuBtn = elements.menuBtn;
      const menuDropdown = elements.menuDropdown;
      
      if (menuBtn && menuDropdown) {
        debugLog('Menu a icona configurato');
        
        menuBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          menuDropdown.classList.toggle('hidden');
        });
        
        // Chiudi menu quando si clicca altrove
        document.addEventListener('click', function(e) {
          if (!menuDropdown.contains(e.target) && !menuBtn.contains(e.target)) {
            menuDropdown.classList.add('hidden');
          }
        });
      } else {
        debugLog('ATTENZIONE: Elementi menu a icona non trovati');
      }
    }
    
    /**
     * Configura l'auto-resize dell'input
     */
    function setupInputAutoResize() {
      if (!elements.chatInput) return;
      
      // Imposta la funzione di auto-resize
      const resizeInput = function() {
        elements.chatInput.style.height = 'auto'; // Reset altezza
        
        // Calcola l'altezza in base al contenuto
        const newHeight = Math.min(elements.chatInput.scrollHeight, 120); // Max 120px
        elements.chatInput.style.height = `${newHeight}px`;
        
        // Se ci troviamo su mobile, aggiusta lo scroll
        if (APP_CONFIG.IS_MOBILE && newHeight >= 80) {
          smoothScrollToBottom();
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
        if (!APP_CONFIG.IS_MOBILE) return;
      
        debugLog('Setup gestione tastiera mobile...');
      
        const safeAdjustLayout = () => {
          if (!elements.chatMessages || !elements.chatInput) return;
      
          const visibleHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
          const inputHeight = elements.chatInput.offsetHeight + 24;
          const newHeight = visibleHeight - 60 - inputHeight;
      
          debugLog(`viewport height: ${visibleHeight}px, input: ${inputHeight}px, new: ${newHeight}px`);
      
          // Applica l'altezza alla chat
          elements.chatMessages.style.height = `${Math.max(200, newHeight)}px`;
      
          // Scrolla in fondo
          smoothScrollToBottom(true);
        };
      
        // Usa VisualViewport se disponibile
        if (window.visualViewport) {
          window.visualViewport.addEventListener('resize', safeAdjustLayout);
          window.visualViewport.addEventListener('scroll', safeAdjustLayout);
          debugLog('VisualViewport handler attivato');
        } else {
          // Fallback per dispositivi senza VisualViewport
          window.addEventListener('resize', safeAdjustLayout);
          debugLog('Fallback resize handler attivato');
        }
      
        // Quando l'input riceve focus, assicurati che sia visibile
        if (elements.chatInput) {
          elements.chatInput.addEventListener('focus', () => {
            setTimeout(() => {
              safeAdjustLayout();
              smoothScrollToBottom(true);
            }, 300);
          });
        }
      }
      
      
    
    /**
     * Gestisce il resize del viewport quando la tastiera mobile appare
     */
    function handleVisualViewportResize() {
      if (!elements.chatContainer || !elements.chatMessages || !elements.chatInput || !window.visualViewport) return;
      
      // Utilizza l'API visualViewport per rilevare la dimensione effettiva
      const viewportHeight = window.visualViewport.height;
      const windowHeight = window.innerHeight;
      
      // Rileva se la tastiera è aperta
      const keyboardOpen = viewportHeight < windowHeight * 0.8;
      
      if (keyboardOpen) {
        debugLog(`Tastiera rilevata: viewport ${viewportHeight}px vs window ${windowHeight}px`);
        
        // Adatta i componenti all'apertura della tastiera
        const inputHeight = elements.chatInput.offsetHeight + 40; // Spazio aggiuntivo
        const availableHeight = viewportHeight - inputHeight;
        
        // Regola altezza chat
        elements.chatMessages.style.height = `${availableHeight}px`;
        
        // Scorri per assicurarti che l'input sia visibile
        smoothScrollToBottom(true);
      } else {
        // Quando la tastiera è chiusa, ripristina le altezze normali
        adjustChatLayout();
      }
    }
    
    /**
     * Fallback per gestire la tastiera su dispositivi più vecchi
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
        
        if (elements.chatContainer) {
          const inputHeight = elements.chatInput ? elements.chatInput.offsetHeight + 40 : 70;
          const availableHeight = viewportHeight - inputHeight - 20;
          
          // Regola altezza chat
          if (elements.chatMessages) {
            elements.chatMessages.style.height = `${availableHeight}px`;
          }
        }
        // Scorri in fondo per vedere i messaggi più recenti
        smoothScrollToBottom(true);
      } else {
        // Tastiera chiusa
        adjustChatLayout();
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
      window.addEventListener('resize', function() {
        // Throttle per non sovraccaricare
        if (!window.resizeThrottle) {
          window.resizeThrottle = setTimeout(function() {
            adjustChatLayout();
            window.resizeThrottle = null;
          }, 200);
        }
      });
      
      debugLog('Layout chat inizializzato');
    }
    
    /**
     * Adatta il layout della chat in base alle dimensioni della finestra
     */
    function adjustChatLayout() {
        if (!elements.chatContainer) return;
      
        const viewportHeight = window.innerHeight;
        let headerHeight = 60;
      
        const inputHeight = elements.chatInput ? 
          (elements.chatInput.offsetHeight + 24) : 70;
      
             
        const messagesHeight = viewportHeight - headerHeight - inputHeight - 40;
      
        if (elements.chatMessages) {
          elements.chatMessages.style.height = `${Math.max(200, messagesHeight)}px`;
        }
      
        debugLog(`Layout chat adattato - altezza messaggi: ${messagesHeight}px`);
      }
    
    /**
     * Ripristino stato da localStorage
     */
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
        elements.chatInput.addEventListener('input', function(e) {
          if (!state.hasUserInteracted && e.target.value.trim().length > 0) {
            debugLog('Utente ha iniziato a digitare, attivo chat');
            markUserInteraction();
            activateChatAndStartConversation();
          }
        });
        
        elements.chatInput.addEventListener('keydown', function(e) {
          // Invia messaggio con Enter (ma non con Shift+Enter)
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            
            // Segna l'interazione utente
            markUserInteraction();
            
            if (elements.chatForm) {
              elements.chatForm.dispatchEvent(new Event('submit'));
            }
          }
          
          // Con Shift+Enter aggiungi una nuova riga
          if (e.key === 'Enter' && e.shiftKey) {
            // Nessuna azione speciale, il comportamento predefinito aggiungerà una nuova riga
            setTimeout(function() {
              // Applica l'auto-resize dell'input dopo l'aggiunta della nuova riga
              elements.chatInput.style.height = 'auto';
              elements.chatInput.style.height = `${Math.min(elements.chatInput.scrollHeight, 120)}px`;
            }, 0);
          }
        });
        
        // Click sull'input attiva la chat se non è già attiva
        elements.chatInput.addEventListener('focus', function() {
          debugLog('Utente ha cliccato sull\'input, segnalo interazione');
          
          // Segnala che l'utente ha interagito
          markUserInteraction();
          
          // Se la chat non è attiva, attivala
          if (!state.isActive) {
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
      if (elements.languageBtn) {
        elements.languageBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          if (elements.languageDropdown) {
            elements.languageDropdown.classList.toggle('hidden');
          }
        });
        
        // Chiudi dropdown quando si clicca altrove
        document.addEventListener('click', function(e) {
          if (elements.languageDropdown && !e.target.closest('.language-menu')) {
            elements.languageDropdown.classList.add('hidden');
          }
        });
      }
      
      // Gestione della visibilità della pagina
      document.addEventListener('visibilitychange', handleVisibilityChange);
  
      // Gestione della chiusura finestra/tab
      window.addEventListener('beforeunload', function() {
        // Chiudi esplicitamente la connessione WebSocket
        if (socket && state.connection.isConnected) {
          socket.disconnect();
        }
      });
      
      // Event listener per messaggi e scorrimento - migliore UX
      if (elements.chatMessages) {
        elements.chatMessages.addEventListener('scroll', function() {
          // Salva la posizione di scorrimento per ripristinarla se necessario
          window.lastScrollPosition = elements.chatMessages.scrollTop;
        });
      }
      
      // Pulsante di riconnessione
      if (elements.reconnectButton) {
        elements.reconnectButton.addEventListener('click', function() {
          if (socket) {
            debugLog('Tentativo di riconnessione manuale');
            socket.connect();
          } else {
            initSocketConnection();
          }
        });
      }
      
      debugLog('Tutti gli event listener configurati');
    }
    
    /**
     * Segna che l'utente ha interagito con la pagina
     */
    function markUserInteraction() {
      if (!state.hasUserInteracted) {
        debugLog('Prima interazione utente rilevata');
        state.hasUserInteracted = true;
        
        // Disabilita la prevenzione dell'attivazione automatica
        state.preventAutoActivation = false;
        
        // Salva l'altezza iniziale della finestra per calcoli tastiera
        if (typeof window.initialWindowHeight === 'undefined') {
          window.initialWindowHeight = window.innerHeight;
          debugLog(`Altezza iniziale finestra salvata: ${window.initialWindowHeight}px`);
        }
        
        // Pubblica evento interazione utente
        eventBus.publish('user-interaction', {
          type: 'first-interaction'
        });
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
     * Attiva la modalità chat
     */
    function activateChat() {
      if (state.isActive) return;
      
      debugLog('Attivazione modalità chat');
      
      // Imposta flag
      state.isActive = true;
      
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
        setTimeout(function() {
          elements.marketingSection.classList.add('hidden');
          debugLog('Sezione marketing completamente nascosta');
          
          // Regola layout dopo che marketing è nascosto
          adjustChatLayout();
        }, 350); // Tempo ottimizzato per la transizione
      } else {
        debugLog('ERRORE: Impossibile trovare sezione marketing');
      }
      
      // Nascondi il testo di istruzione
      if (elements.startInstruction) {
        elements.startInstruction.classList.add('fade-out');
        
        // Dopo l'animazione, nascondi completamente
        setTimeout(function() {
          elements.startInstruction.classList.add('hidden');
        }, 350);
      }

      // Nascondi il bottone "Parla con Joe"
const startButton = document.getElementById('start-chat-button');
if (startButton) {
  startButton.classList.add('fade-out');
  setTimeout(() => {
    startButton.classList.add('hidden');
  }, 350);
}

      
      // Mostra la chat
      if (elements.chatContainer) {
        elements.chatContainer.classList.add('active');
      }
      
      // Salva lo stato in localStorage
      try {
        localStorage.setItem(APP_CONFIG.STORAGE_KEY, JSON.stringify({
          isChatActive: true
        }));
      } catch (e) {
        debugLog(`Errore nel salvare lo stato: ${e.message}`);
      }
      
      // Focus sull'input con timing ottimizzato
      if (elements.chatInput) {
        setTimeout(function() {
          elements.chatInput.focus();
          
          // Fornisci feedback tattile su dispositivi che lo supportano
          if (window.navigator && window.navigator.vibrate) {
            try {
              window.navigator.vibrate(50); // Vibrazione sottile
            } catch (e) {
              // Ignora errori, la vibrazione è solo un miglioramento
            }
          }
        }, 450); // Tempo aumentato per sincronizzarsi meglio con le animazioni
      }
      
      // Pubblica evento chat attivata
      eventBus.publish('chat-activated', null);
    }
    
    /**
     * Attiva la chat e avvia la conversazione
     */
    function activateChatAndStartConversation() {

        debugLog('Funzione activateChatAndStartConversation chiamata');

      // Verifica che l'utente abbia interagito
      if (!state.hasUserInteracted) {
        debugLog('BLOCCO: Tentativo di attivare chat senza interazione utente');
        return;
      }
      
      debugLog('Attivazione chat e avvio conversazione in seguito a interazione utente');
      
      // Attiva la UI della chat
      activateChat();
      
      // Se la conversazione non è già stata avviata, avviala
      if (!state.isConversationStarted) {
        state.isConversationStarted = true;
        
        debugLog('Prima attivazione della conversazione');
        
        // Se abbiamo già i dati di una conversazione dal server, mostriamoli
        if (state.conversation.exists && state.conversation.messages.length > 0) {
          debugLog(`Ripristino conversazione esistente con ${state.conversation.messages.length} messaggi`);
          
          // Mostra messaggi esistenti senza animazione
          state.conversation.messages.forEach(function(msg) {
            if (msg.role === 'user') {
              addUserMessage(msg.content);
            } else if (msg.role === 'assistant') {
              addAssistantMessage(msg.content, false); // false = non animare i messaggi caricati
            }
          });
          
          // Se la conversazione è terminata, mostra il pulsante di conferma
          if (!state.conversation.isActive && state.conversation.collectedData) {
            addConfirmationButton();
          }
          
          // Scorrimento automatico in fondo
          smoothScrollToBottom();
        } else {
          // Altrimenti avvia una nuova conversazione
          debugLog('Nessuna conversazione esistente, ne avvio una nuova');
          startConversation();
        }
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
      
        // Mostra stato connessione
        if (elements.connectionStatus) {
          elements.connectionStatus.classList.remove('hidden');
          if (elements.connectionMessage) {
            elements.connectionMessage.textContent = translations.messages.connecting || 'Connessione in corso...';
          }
        }
      
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
      
        // 👇 Espone il socket nella console per debug
        window.socket = socket;
      }
      

/**
* Imposta i listener per gli eventi WebSocket
*/
function setupSocketListeners() {
if (!socket) return;

// Evento di connessione
socket.on('connect', function() {
  debugLog(`Socket connesso: ${socket.id}`);
  state.connection.isConnected = true;
  state.connection.isReconnecting = false;
  
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
  
  // Pubblica evento
  eventBus.publish('socket-connected', null);
});

// Evento di disconnessione
socket.on('disconnect', function(reason) {
  debugLog(`Socket disconnesso: ${reason}`);
  state.connection.isConnected = false;
  
  // Mostra avviso di disconnessione solo se non siamo già in fase di riconnessione
  if (!state.connection.isReconnecting) {
    state.connection.isReconnecting = true;
    
    if (elements.connectionStatus) {
      elements.connectionStatus.classList.remove('hidden');
      if (elements.connectionMessage) {
        elements.connectionMessage.textContent = translations.error.connection || 'Connessione persa';
      }
    }
  }
  
  // Pubblica evento
  eventBus.publish('socket-disconnected', { reason });
});

// Evento di riconnessione
socket.on('reconnect_attempt', function(attemptNumber) {
  debugLog(`Tentativo di riconnessione socket #${attemptNumber}`);
  state.connection.isReconnecting = true;
  
  if (elements.connectionStatus) {
    elements.connectionStatus.classList.remove('hidden');
    if (elements.connectionMessage) {
      elements.connectionMessage.textContent = `${translations.messages.retry || 'Riconnessione in corso...'} (${attemptNumber})`;
    }
  }
});

// Evento di fallimento riconnessione
socket.on('reconnect_failed', function() {
  debugLog('Riconnessione socket fallita dopo tutti i tentativi');
  state.connection.isReconnecting = false;
  
  if (elements.connectionStatus) {
    elements.connectionStatus.classList.remove('hidden');
    if (elements.connectionMessage) {
      elements.connectionMessage.textContent = translations.error.reconnect || 'Impossibile riconnettersi';
    }
  }
});

// Evento di errore
socket.on('error', function(error) {
  debugLog(`Errore socket: ${error.message || 'errore generico'}`);
});

// Messaggi di risposta dal server

// Messaggi di risposta dal server
socket.on('conversation_state', function(data) {
    debugLog(`Ricevuto stato conversazione dal server: ${JSON.stringify(data)}`);
    
    // Chiama sempre handleConversationState, che ha già la logica per distinguere i casi
    handleConversationState(data);
  });
/*  
socket.on('conversation_state', function(data) {
  debugLog(`Ricevuto stato conversazione dal server: ${JSON.stringify(data)}`);
  
  // IMPORTANTE: Ignoriamo completamente qualsiasi stato dal server
  // a meno che non sia stato l'utente a iniziare la conversazione
  if (data.exists && state.isConversationStarted && state.hasUserInteracted) {
    debugLog('L\'utente ha interagito, gestisco lo stato della conversazione');
    handleConversationState(data);
  } else if (data.exists && !state.hasUserInteracted) {
    // Salviamo lo stato ma NON mostriamo nulla e NON attiviamo la chat
    debugLog('Conversazione esistente sul server, ma l\'utente non ha interagito. Ignoro.');
    
    // Salva stato per utilizzo futuro, ma NON attivare la chat
    state.conversation = {
      ...data,
      exists: true
    };
  } else {
    debugLog('Stato conversazione non rilevante, ignoro');
  }
});*/

// Ricezione dei chunk di risposta dell'assistente - Migliorata per esperienza ChatGPT
socket.on('assistant_chunk', function(data) {
  // Mostriamo i chunk solo se la conversazione è stata avviata esplicitamente dall'utente
  if (state.isConversationStarted && state.hasUserInteracted) {
    debugLog('Ricevuto chunk di risposta dall\'assistente');
    handleAssistantChunk(data);
  } else {
    debugLog('Ricevuto chunk ma l\'utente non ha interagito, ignoro');
  }
});

// Aggiornamento dello stato della conversazione
socket.on('conversation_updated', function(data) {
  debugLog(`Ricevuto aggiornamento stato conversazione: ${JSON.stringify(data)}`);
  
  // Aggiorna stato solo se l'utente ha interagito
  if (data && state.isConversationStarted && state.hasUserInteracted) {
    state.conversation.isActive = data.isActive;
    state.conversation.conversationStep = data.conversationStep;
    
    if (data.conversationId) {
      state.conversation.conversationUUID = data.conversationId;
    }
    
    if (data.collectedData) {
      state.conversation.collectedData = data.collectedData;
    }
    
    // Se la conversazione è terminata, mostra il pulsante di conferma
    if (!data.isActive && data.collectedData) {
      addConfirmationButton();
    }
  }
});
}

/**
* Gestisce l'elaborazione dello stato conversazione ricevuto dal server
*/
function handleConversationState(data) {
if (!data) return;

// Se sul server la conversazione esiste ed è più aggiornata
if (data.exists && state.hasUserInteracted &&
   (!state.conversation.exists || data.messages.length > state.conversation.messages.length)) {
  
  debugLog(`Aggiornamento stato conversazione: ${data.messages.length} messaggi`);
  
  // Aggiorna lo stato della conversazione
  state.conversation = data;
  
  // Salviamo l'UUID della conversazione se presente
  if (data.conversationId) {
    state.conversation.conversationUUID = data.conversationId;
  }
  
  // Reset UI per assicurarci di non duplicare messaggi
  if (elements.chatMessages) {
    elements.chatMessages.innerHTML = '';
  }
  
  // Attiva la chat se ci sono messaggi e l'utente ha interagito
  if (data.messages.length > 0 && state.hasUserInteracted) {
    activateChat();
  }
  
  // Visualizza i messaggi
  if (state.hasUserInteracted) {
    data.messages.forEach(function(msg) {
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
    smoothScrollToBottom();
  }
} else if (!data.exists && state.isConversationStarted && state.hasUserInteracted) {
  // Se non esiste ancora una conversazione ma l'utente ha interagito, iniziane una nuova
  debugLog('Nessuna conversazione sul server, ma l\'utente ha interagito. Avvio nuova conversazione.');
  startConversation();
}
}

/**
* Gestisce i chunk di risposta dell'assistente - Migliorata per stile ChatGPT
*/
function handleAssistantChunk(data) {
if (!data || !state.hasUserInteracted) return;

// Attiva la chat se è la prima risposta e l'utente ha interagito
if (!state.isActive && state.hasUserInteracted) {
  activateChat();
}

// Se è il primo chunk, crea un messaggio placeholder
let messageElement = document.querySelector('.message-assistant:last-child');
let messageTextElement;

if (!messageElement) {
  // Nascondi l'indicatore di digitazione quando viene creato il messaggio
  hideTypingIndicator();
  
  messageElement = createMessageElement('assistant', '');
  messageElement.classList.add('message-new'); // Classe per evidenziare nuovi messaggi
  
  if (elements.chatMessages) {
    // Aggiungi l'elemento al DOM
    elements.chatMessages.appendChild(messageElement);
    
    // Piccolo ritardo per garantire che l'animazione di entrata sia fluida
    setTimeout(function() {
      messageElement.classList.add('visible');
    }, 10);
  }
}

// Ottieni l'elemento di testo
messageTextElement = messageElement.querySelector('.message-text');

// Se c'è un chunk da aggiungere
if (data.chunk) {
  // Aggiorna il contenuto del messaggio - Stile ChatGPT character by character
  if (messageTextElement) {
    if (data.message) {
      // Se c'è un messaggio completo, usalo direttamente
      const currentContent = messageTextElement.innerHTML;
      messageTextElement.innerHTML = formatMessage(data.message);
      
      // Evidenzia le parti nuove
      highlightNewContent(messageTextElement, currentContent, data.message);
    } else {
      // Se è HTML formattato, aggiorniamo l'interno HTML
      const currentContent = messageTextElement.innerHTML;
      const newContent = formatMessage(currentContent + data.chunk);
      messageTextElement.innerHTML = newContent;
      
      // Scorrimento fluido mentre il messaggio cresce
      if (isScrolledToBottom(20)) { // 20px threshold
        smoothScrollToBottom();
      }
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
  const messageContent = data.message || (messageTextElement ? messageTextElement.textContent : '');
  
  // Aggiorna lo stato della conversazione
  state.conversation.messages.push({ role: 'assistant', content: messageContent });
  state.conversation.conversationStep = data.conversationStep || state.conversation.conversationStep;
  state.conversation.isActive = data.isActive;
  
  if (data.collectedData) {
    state.conversation.collectedData = data.collectedData;
    
    // Se la conversazione è terminata, mostra il pulsante di conferma
    if (!data.isActive) {
      addConfirmationButton();
    }
  }
  
  // Nascondi l'indicatore di digitazione
  hideTypingIndicator();
  
  // Termina la sottomissione
  state.isSubmitting = false;
  
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
  state.retryCount = 0;
  
  // Scrolling automatico al completamento
  smoothScrollToBottom();
  
  // Traccia evento
  trackEvent('message_received');
}
}

/**
* Evidenzia le nuove parti del contenuto
*/
function highlightNewContent(element, oldContent, newContent) {
if (!element || !oldContent || !newContent) return;

// Implementazione semplice: evidenzia solo se il contenuto è significativamente diverso
if (newContent.length - oldContent.length > 10) {
  element.classList.add('highlight-new');
  setTimeout(function() {
    element.classList.remove('highlight-new');
  }, 800);
}
}

/**
* Avvio della conversazione
*/
function startConversation() {
    debugLog('Funzione startConversation() chiamata');
try {
  // Verifica che l'utente abbia interagito
  if (!state.hasUserInteracted) {
    debugLog('BLOCCO: Tentativo di avviare conversazione senza interazione utente');
    return;
  }
  
  // Imposta flag che la conversazione è stata avviata
  state.isConversationStarted = true;
  
  debugLog('Avvio conversazione...');
  
  // Verifica che il socket sia connesso
  if (!socket || !state.connection.isConnected) {
    debugLog('Socket non connesso, riconnessione...');
    initSocketConnection();
    
    // Aggiungiamo un listener temporaneo per avviare la conversazione dopo la connessione
    const onConnect = function() {
      socket.off('connect', onConnect);
      // Avvia conversazione dopo un breve delay per assicurarsi che l'autenticazione sia completa
      setTimeout(function() {
        if (state.hasUserInteracted) {
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
  if (state.hasUserInteracted) {
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
if (!state.hasUserInteracted) {
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
state.conversation = {
  exists: true,
  isActive: true,
  conversationStep: 0,
  messages: [],
  collectedData: null,
  conversationUUID: null
};

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
if (!userInput || state.isSubmitting) return;

debugLog(`Tentativo di invio messaggio: "${userInput.substring(0, 20)}..."`);

// Segna che l'utente ha interagito
markUserInteraction();

// Se la conversazione non è stata avviata, avviala prima di inviare il messaggio
if (!state.isConversationStarted) {
  debugLog('Messaggio inviato prima di avviare la conversazione, avvio conversazione');
  activateChatAndStartConversation();
  
  // In questo caso, salviamo il messaggio per inviarlo dopo che la conversazione è stata avviata
  // Aggiungiamo un breve ritardo per assicurarci che il server abbia tempo di elaborare la richiesta
  setTimeout(function() {
    elements.chatInput.value = userInput;
    if (elements.chatForm) {
      elements.chatForm.dispatchEvent(new Event('submit'));
    }
  }, 800);
  
  return;
}

// Verifica che il socket sia connesso
if (!socket || !state.connection.isConnected) {
  debugLog('Socket non connesso, riconnessione...');
  
  // Salva temporaneamente il messaggio
  const messageToSend = userInput;
  
  // Reconnect
  initSocketConnection();
  
  // Aggiungi un listener temporaneo per inviare il messaggio dopo la connessione
  const onConnect = function() {
    socket.off('connect', onConnect);
    
    // Invia il messaggio dopo un breve delay per assicurarsi che l'autenticazione sia completa
    setTimeout(function() {
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
state.conversation.messages.push({ role: 'user', content: userInput });

// Flag per evitare invii multipli
state.isSubmitting = true;

// Disabilita input e pulsante durante la comunicazione
if (elements.chatInput) {
  elements.chatInput.disabled = true;
}

if (elements.sendButton) {
  elements.sendButton.disabled = true;
  
  // Animazione pulsante invio migliorata
  elements.sendButton.classList.add('sending');
  setTimeout(function() {
    elements.sendButton.classList.remove('sending');
  }, 300);
}

// Piccolo ritardo per una migliore esperienza visiva
setTimeout(function() {
  // Mostra l'indicatore di digitazione
  showTypingIndicator();
}, 150);

try {
  // Invia il messaggio tramite socket
  socket.emit('user_message', {
    message: userInput,
    language: currentLang
  });
  
  debugLog(`Messaggio utente inviato: ${userInput.substring(0, 30)}${userInput.length > 30 ? '...' : ''}`);
  
  // Traccia evento
  trackEvent('message_sent');
  
  // Assicurati che la vista sia posizionata correttamente
  setTimeout(function() {
    smoothScrollToBottom();
  }, 100);
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
  state.isSubmitting = false;
  smoothScrollToBottom();
}
}

/**
* Gestione errori di comunicazione
*/
function handleCommunicationError() {
state.retryCount++;

if (state.retryCount <= APP_CONFIG.MAX_RETRIES) {
  addAssistantMessage(`${translations.error.connection} ${translations.messages.retry} (${state.retryCount}/${APP_CONFIG.MAX_RETRIES})`, true);
} else {
  addAssistantMessage(translations.error.generic, true);
  state.retryCount = 0;
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
smoothScrollToBottom();

// Aggiungi una piccola animazione per attirare l'attenzione
setTimeout(function() {
  confirmButton.classList.add('animate-pulse');
  setTimeout(function() {
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

if (!state.conversation.collectedData) {
  debugLog("ERRORE: Dati raccolti mancanti");
  addAssistantMessage(translations.error.generic, true);
  return;
}

debugLog('Invio finale dei dati raccolti');

// Mostra feedback visivo di elaborazione
const confirmButton = document.querySelector('.confirm-button');
if (confirmButton) {
  confirmButton.disabled = true;
  confirmButton.classList.add('processing');
  
  // Aggiungi lo spinner
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  confirmButton.innerHTML = '';
  confirmButton.appendChild(spinner);
  confirmButton.appendChild(document.createTextNode(' Invio in corso...'));
}

try {
  // Preparazione del payload
  const payload = {
    userData: state.conversation.collectedData,
    conversationData: {
      messages: state.conversation.messages,
      language: currentLang,
      conversationUUID: state.conversation.conversationUUID
    }
  };
  
  debugLog(`Payload preparato: ${JSON.stringify(payload).substring(0, 100)}...`);
  
  // Usiamo fetch per l'invio finale
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
    
    // Feedback di successo visivo
    if (confirmButton) {
      confirmButton.classList.remove('processing');
      confirmButton.classList.add('success');
      
      // Aggiungi l'icona di spunta
      const checkIcon = document.createElement('span');
      checkIcon.className = 'check-icon';
      confirmButton.innerHTML = '';
      confirmButton.appendChild(checkIcon);
      confirmButton.appendChild(document.createTextNode(' Completato!'));
    }
    
    // Ritardo per apprezzare l'animazione di successo
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Transizione alla schermata di ringraziamento con scomparsa elegante
    if (elements.chatContainer) {
      elements.chatContainer.classList.remove('active');
      
      setTimeout(function() {
        if (elements.thankYouScreen) {
          // Preparazione per l'entrata animata
          elements.chatContainer.classList.add('thank-you-visible');
          elements.thankYouScreen.classList.remove('hidden');
          elements.thankYouScreen.classList.add('fade-in');

          document.querySelector('.app-container').classList.add('center-thankyou');

          
          // Animazione del checkmark di successo
          const successIcon = elements.thankYouScreen.querySelector('.success-icon');
          if (successIcon) {
            successIcon.classList.add('completion-success');
          }
          
          // Traccia evento di conversione
          trackEvent('plan_requested');
        }
      }, 400);
    }
  } else {
    throw new Error(data.error || translations.error.generic);
  }
} catch (error) {
  debugLog(`Errore nell'invio dei dati finali: ${error.message}`);
  
  // Reimposta il pulsante
  if (confirmButton) {
    confirmButton.disabled = false;
    confirmButton.classList.remove('processing');
    confirmButton.textContent = translations.messages.confirmation;
  }
  
  // Mostra messaggio di errore
  addAssistantMessage(`${translations.error.generic} ${error.message}`, true);
}
}

/**
* Mostra l'indicatore di digitazione - stile ChatGPT
*/
function showTypingIndicator() {
if (!elements.typingIndicator) return;
if (elements.chatMessages && elements.typingIndicator) {
    elements.chatMessages.appendChild(elements.typingIndicator);
  }

elements.typingIndicator.classList.remove('hidden');

smoothScrollToBottom(true);
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

// Log di debug
debugLog("Aggiungendo messaggio utente");

// Crea l'elemento messaggio
const messageElement = createMessageElement('user', message);

// Aggiungi al container con effetto di comparsa
elements.chatMessages.appendChild(messageElement);

// Aggiungi enfasi visiva per mostrare che è un messaggio nuovo
setTimeout(function() {
  messageElement.classList.add('visible');
  smoothScrollToBottom();
  
  // Effetto sonoro sottile (opzionale)
  if (window.navigator && window.navigator.vibrate && APP_CONFIG.IS_MOBILE) {
    try {
      window.navigator.vibrate(20); // Vibrazione molto leggera
    } catch (e) {
      // Ignora errori
    }
  }
}, 10);
}

/**
* Aggiunta messaggio assistente - con opzione animazione
* @param {string} message - Testo del messaggio
* @param {boolean} animate - Se true, anima il messaggio
*/
function addAssistantMessage(message, animate = true) {
if (!elements.chatMessages) return;

const messageElement = createMessageElement('assistant', message);
elements.chatMessages.appendChild(messageElement);

if (animate) {
  // Animazione con enfasi visiva
  setTimeout(function() {
    messageElement.classList.add('visible');
  }, 10);
} else {
  // Senza animazione
  messageElement.classList.add('visible');
}

smoothScrollToBottom();
return messageElement; 
}

/**
* Creazione elemento messaggio - Stile ChatGPT migliorato
*/
function createMessageElement(role, content) {
const messageDiv = document.createElement('div');
messageDiv.classList.add('message', `message-${role}`);

// Aggiungi avatar se è un messaggio dell'assistente
if (role === 'assistant') {
  const avatarDiv = document.createElement('div');
  avatarDiv.classList.add('assistant-avatar');
  avatarDiv.textContent = 'J';
  messageDiv.appendChild(avatarDiv);
}

// Contenuto del messaggio
const contentDiv = document.createElement('div');
contentDiv.classList.add('message-content');

const textDiv = document.createElement('div');
textDiv.classList.add('message-text');
textDiv.innerHTML = formatMessage(content); // Formatta il messaggio per una migliore leggibilità

contentDiv.appendChild(textDiv);
messageDiv.appendChild(contentDiv);

return messageDiv;
}

/**
* Formattazione messaggio (markdown semplice) - Migliorata per leggibilità
*/
function formatMessage(message) {
if (!message) return '';

// Sostituzione newline con <br>
let formatted = message.replace(/\n/g, '<br>');

// Formattazione bold
formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

// Formattazione italic
formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');

// Link inline con stile migliorato
formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 
  '<a href="$2" target="_blank" rel="noopener noreferrer" class="message-link">$1</a>');

// Code inline con stile migliorato
formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

// Liste numerate
formatted = formatted.replace(/^\d+\.\s+(.*?)$/gm, '<li>$1</li>');

// Liste puntate
formatted = formatted.replace(/^\s*-\s+(.*?)$/gm, '<li>$1</li>');

// Raggruppa le liste
let inList = false;
const lines = formatted.split('<br>');
formatted = lines.map(function(line) {
  if (line.startsWith('<li>')) {
    if (!inList) {
      inList = true;
      return '<ul class="message-list">' + line;
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
formatted = formatted.replace(/<br><ul/g, '<ul');
formatted = formatted.replace(/<\/ul><br>/g, '</ul>');

return formatted;
}

/**
* Configura l'observer per lo scrolling automatico
*/
function setupScrollObserver() {
if (elements.chatMessages && !window.chatScrollObserver) {
  try {
    // Configura l'observer per monitorare aggiunte di nodi (nuovi messaggi)
    window.chatScrollObserver = new MutationObserver(function(mutations) {
      let shouldScroll = false;
      
      // Siamo vicini al fondo se siamo oltre il 90% di scorrimento
      const isNearBottom = isScrolledToBottom(40);
      
      // Verifica se sono stati aggiunti nuovi messaggi
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Controlla se i nuovi nodi sono messaggi o il pulsante di conferma
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
        smoothScrollToBottom(true); // smooth scroll
      }
    });
    
    // Osserva modifiche al DOM
    window.chatScrollObserver.observe(elements.chatMessages, {
      childList: true,
      subtree: false,
      characterData: false
    });
  } catch (e) {
    // Fallback per browser che non supportano MutationObserver
    debugLog(`Errore nel configurare MutationObserver: ${e.message}`);
  }
}
}

/**
* Verifica se siamo già scrollati in fondo
*/
function isScrolledToBottom(threshold = 40) {
if (!elements.chatMessages) return true;

const containerHeight = elements.chatMessages.clientHeight;
const containerScrollHeight = elements.chatMessages.scrollHeight;
const currentScrollPosition = elements.chatMessages.scrollTop;

// Considerato "al fondo" se mancano meno di 'threshold' pixels
return containerScrollHeight - currentScrollPosition - containerHeight < threshold;
}

/**
* Handler per lo scroll manuale dell'utente
*/
function setupManualScrollHandler() {
if (elements.chatMessages && !window.manualScrollHandlerSet) {
  let userScrolling = false;
  let scrollTimeout;
  
  elements.chatMessages.addEventListener('scroll', function() {
    userScrolling = true;
    
    // Resetta il flag dopo un breve periodo di inattività
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(function() {
      userScrolling = false;
    }, 1000);
  });
  
  // Salva il flag per evitare di impostare nuovamente il listener
  window.manualScrollHandlerSet = true;
}
}

/**
* Scorri fluido alla parte inferiore della chat
* @param {boolean} smooth - Se true, usa animazione fluida
*/
function smoothScrollToBottom(smooth = false) {
if (!elements.chatMessages) return;

// Usa requestAnimationFrame per fluidità se disponibile
if (window.requestAnimationFrame) {
  requestAnimationFrame(function() {
    const behavior = smooth && !APP_CONFIG.IS_MOBILE ? 'smooth' : 'auto';
    elements.chatMessages.scrollTo({
      top: elements.chatMessages.scrollHeight,
      behavior: behavior
    });
  });
} else {
  // Fallback per browser più vecchi
  scrollToBottom(smooth);
}
}

/**
* Scorrimento in fondo alla chat - Fallback tradizionale
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
try {
  lastElement.scrollIntoView({ 
    behavior: behavior, 
    block: 'end' 
  });
} catch (e) {
  // Fallback per browser più vecchi
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
inactivityTimer = setTimeout(function() {
  handleInactivity();
}, APP_CONFIG.INACTIVITY_TIMEOUT);
}

/**
* Gestione inattività
*/
function handleInactivity() {
// Mostra messaggio di timeout se la conversazione è in corso
if (state.conversation.exists && state.conversation.isActive && 
    state.isActive && state.isConversationStarted && state.hasUserInteracted) {
  addAssistantMessage(translations.messages.timeout, true);
}
}

/**
* Gestione visibilità della pagina
*/
function handleVisibilityChange() {
if (document.visibilityState === 'visible') {
  debugLog('Pagina tornata visibile');
  
  // Reset del timer quando la pagina torna visibile
  resetInactivityTimer();
  
  // Se il socket è disconnesso, tenta la riconnessione
  if (socket && !state.connection.isConnected) {
    debugLog('Tentativo di riconnessione del socket');
    socket.connect();
  }
} else if (document.visibilityState === 'hidden') {
  debugLog('Pagina nascosta');
  
  // Impostiamo solo un timer lungo per risparmiare batteria se la pagina resta nascosta molto tempo
  setTimeout(function() {
    if (document.visibilityState === 'hidden') {
      debugLog('Pagina nascosta per periodo prolungato, disconnessione socket');
      // Non chiudiamo la connessione ma mettiamo in attesa
      if (socket && state.connection.isConnected) {
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

if (elements.chatContainer) {
  elements.chatContainer.classList.add('active');
}

if (elements.thankYouScreen) {
    elements.chatContainer.classList.remove('thank-you-visible');

  elements.thankYouScreen.classList.add('hidden');
  elements.thankYouScreen.classList.remove('fade-in');
}

// Reset dello stato
state.conversation = {
  exists: false,
  isActive: true,
  conversationStep: 0,
  messages: [],
  collectedData: null,
  conversationUUID: null
};

// Reset flag conversazione
state.isConversationStarted = true;
state.hasUserInteracted = true; // Considerata come interazione esplicita

// Rimuovi i dati dal localStorage
try {
  localStorage.removeItem(APP_CONFIG.STORAGE_KEY);
} catch (e) {
  debugLog(`Impossibile rimuovere lo stato da localStorage: ${e.message}`);
}

// Riattiva la chat
activateChat();

// Verifica che il socket sia connesso
if (!socket || !state.connection.isConnected) {
  debugLog('Socket non connesso, riconnessione prima di avviare nuova conversazione');
  initSocketConnection();
  
  // Aggiungiamo un listener temporaneo per avviare la conversazione dopo la connessione
  const onConnect = function() {
    socket.off('connect', onConnect);
    // Avvia conversazione dopo un breve delay per assicurarsi che l'autenticazione sia completa
    setTimeout(function() {
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
  setTimeout(function() {
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
getState: function() {
  return {
    isActive: state.isActive,
    hasUserInteracted: state.hasUserInteracted,
    conversation: state.conversation,
    connection: {
      isConnected: state.connection.isConnected,
      isReconnecting: state.connection.isReconnecting
    }
  };
},
activateChat: activateChat,
startConversation: activateChatAndStartConversation,
debug: DEBUG ? {
  state: function() {
    return state;
  },
  log: debugLog,
  markUserInteracted: markUserInteraction,
  elements: () => elements,
    addMessage: addAssistantMessage
} : null
};

if (DEBUG) {
    window.addAssistantMessage = addAssistantMessage;
  }
// Inizializzazione automatica quando il DOM è pronto
document.addEventListener('DOMContentLoaded', init);
})();