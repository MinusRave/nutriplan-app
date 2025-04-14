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
    collectedData: null
  };
  
  // Non ripristiniamo più conversazioni incomplete dal localStorage
  // Solo le conversazioni completate verranno salvate per scopi analitici

  let inactivityTimer = null;
  let retryCount = 0;
  let isSubmitting = false;

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
    
    // Debug elements
    elements.debug = {};
    if (document.getElementById('debug-panel')) {
      elements.debug.panel = document.getElementById('debug-panel');
      elements.debug.toggle = document.getElementById('debug-toggle');
      elements.debug.content = document.getElementById('debug-content');
      elements.debug.conversationLog = document.getElementById('conversation-log');
      elements.debug.clientInfoDisplay = document.getElementById('client-info');
    }
  }
  
  // Inizia il processo di conversazione
  async function initConversation() {
    try {
      // Controlla se esiste già una conversazione
      const conversationExists = await checkExistingConversation();
      
      // Se non esiste una conversazione, iniziane una nuova
      if (!conversationExists) {
        startConversation();
      }
    } catch (error) {
      console.error('Errore nell\'inizializzazione della conversazione:', error);
      // Prova comunque a iniziare una nuova conversazione
      startConversation();
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
   */
  async function checkExistingConversation() {
    try {
      // Verifichiamo solo sul server - non usiamo più il localStorage per conversazioni incomplete
      return await fetchServerState();
    } catch (error) {
      console.error('Errore nel controllo della conversazione:', error);
      return false;
    }
  }
  
  // Funzione separata per recuperare lo stato dal server
  async function fetchServerState() {
    try {
      if (!elements.csrfToken || !elements.csrfToken.value) {
        console.error("CSRF token mancante");
        return false;
      }
      
      const response = await fetch('/api/conversation/state', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': elements.csrfToken.value
        }
      });
      
      if (!response.ok) {
        throw new Error('Errore nella richiesta di stato');
      }
      
      const data = await response.json();
      
      // Se sul server la conversazione esiste ed è più aggiornata del localStorage
      if (data.exists && 
         (!conversationState.exists || data.messages.length > conversationState.messages.length)) {
        
        // Aggiorna lo stato della conversazione
        conversationState = data;
        
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
        
        // Non salviamo più lo stato durante la conversazione
      }
      
      return data.exists;
    } catch (error) {
      console.error('Errore nel controllo della conversazione dal server:', error);
      return conversationState.exists || false;
    }
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
  async function startConversation() {
    try {
      if (!elements.csrfToken || !elements.csrfToken.value) {
        console.error("CSRF token mancante");
        addAssistantMessage(translations.error.generic);
        return;
      }
      
      // Richiedi l'inizio di una nuova conversazione
      const response = await fetch('/api/conversation/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': elements.csrfToken.value
        }
      });
      
      if (!response.ok) {
        throw new Error('Errore nell\'avvio della conversazione');
      }
      
      const data = await response.json();
      
      // Aggiorna lo stato
      conversationState.exists = true;
      conversationState.conversationStep = data.conversationStep || 1;
      conversationState.messages = [
        { role: 'assistant', content: data.message }
      ];
      
      // Aggiungi il messaggio di benvenuto
      addAssistantMessage(data.message);
      
      // Focus sull'input
      if (elements.chatInput) {
        elements.chatInput.focus();
      }
      
      // Traccia evento
      trackEvent('conversation_start');
    } catch (error) {
      console.error('Errore nell\'avvio della conversazione:', error);
      addAssistantMessage(translations.error.generic);
    }
  }

  /**
   * Invio messaggio utente
   */
  async function handleSubmitMessage(e) {
    e.preventDefault();
    
    if (!elements.chatInput) return;
    
    const userInput = elements.chatInput.value.trim();
    if (!userInput || isSubmitting) return;
    
    // Reset del timer di inattività
    resetInactivityTimer();
    
    // Aggiunta del messaggio dell'utente all'interfaccia
    addUserMessage(userInput);
    
    // Pulizia dell'input
    elements.chatInput.value = '';
    
    // Aggiornamento dei dati della conversazione
    conversationState.messages.push({ role: 'user', content: userInput });
    
    // Non salviamo più lo stato durante la conversazione
    
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
      if (!elements.csrfToken || !elements.csrfToken.value) {
        throw new Error("CSRF token mancante");
      }

      // Crea assistant message placeholder per lo streaming
      const assistantMessageElement = createMessageElement('assistant', '');
      if (elements.chatMessages) {
        elements.chatMessages.appendChild(assistantMessageElement);
      }
      
      const messageTextElement = assistantMessageElement.querySelector('.message-text');
      
      // Enable streaming for real-time responses
      const supportsSSE = true;
      
      if (supportsSSE) {
        // STREAMING APPROACH
        // Imposta un timeout per il fallback
        const streamTimeoutId = setTimeout(() => {
          console.warn('Stream timeout, falling back to traditional request');
          handleTraditionalRequest(userInput);
        }, APP_CONFIG.RESPONSE_TIMEOUT);
        
        try {
          // Crea un EventSource per lo streaming (SSE)
          const eventUrl = `/api/conversation/message`;
          
          // Prepara per la richiesta streaming
          
          // Usa fetch per iniziare lo streaming
          const response = await fetch(eventUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': elements.csrfToken.value
            },
            body: JSON.stringify({ message: userInput, stream: true })
          });
          
          if (!response.ok) {
            throw new Error('Errore nella comunicazione con il server');
          }
          
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let fullMessage = '';
          let conversationStep = conversationState.conversationStep;
          let isActive = true;
          let collectedData = null;
          
          // Funzione per processare i chunk
          async function readChunks() {
            try {
              // Aggiungiamo un flag per tracciare se la risposta è stata completata
              let messageCompleted = false;
              
              while (true) {
                // Se abbiamo già completato il messaggio, usciamo dal loop
                if (messageCompleted) {
                  console.log('Messaggio completato, interrompo processamento ulteriori chunks');
                  break;
                }
                
                const { value, done } = await reader.read();
                
                if (done) {
                  console.log('Stream terminato dal server');
                  break;
                }
                
                // Decode the chunk and add to buffer
                buffer += decoder.decode(value, { stream: true });
                
                // Process complete SSE messages
                // Split by standard SSE message separator
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || ''; // Keep the last incomplete chunk in buffer
                
                for (const line of lines) {
                  if (!line.trim()) continue;
                  
                  // Extract the data part (handle different SSE formats)
                  let dataContent = line;
                  
                  // Normalize SSE format - handle different server implementations
                  if (line.startsWith('data: ')) {
                    dataContent = line.replace(/^data: /, '');
                  } else if (line.includes('\ndata: ')) {
                    // Match multiline SSE data format
                    const matches = line.match(/data: (.*?)(?:\n|$)/g);
                    if (matches && matches.length) {
                      // Concatenate multiple data lines if present
                      dataContent = matches
                        .map(m => m.replace(/^data: /, '').trim())
                        .join('');
                    }
                  }
                  
                  try {
                    // Remove any unexpected characters that might be causing JSON parse errors
                    const cleanedData = dataContent.trim().replace(/^data:\s*/, '');
                    // Tronchiamo il log per evitare output eccessivo
                    const logPreview = cleanedData.length > 50 ? cleanedData.substring(0, 50) + '...' : cleanedData;
                    console.log('Processing SSE data chunk:', logPreview);
                    
                    const eventData = JSON.parse(cleanedData);
                    
                    if (eventData.chunk) {
                      fullMessage += eventData.chunk;
                      if (messageTextElement) {
                        messageTextElement.innerHTML = formatMessage(fullMessage);
                        scrollToBottom();
                      }
                    }
                    
                    if (eventData.isComplete) {
                      console.log('Ricevuto segnale di completamento messaggio');
                      // Marchiamo il messaggio come completato per evitare ulteriori processamenti
                      messageCompleted = true;
                      
                      // Final update
                      conversationStep = eventData.conversationStep || conversationStep;
                      isActive = eventData.isActive;
                      if (eventData.collectedData) {
                        collectedData = eventData.collectedData;
                      }
                      
                      // Finalizziamo immediatamente lo stato quando riceviamo il segnale di completamento
                      console.log('Aggiornamento stato conversazione con messaggio completo');
                      // Salvataggio sicuro del messaggio assistente - previene duplicazioni
                      const lastMessage = conversationState.messages[conversationState.messages.length - 1];
                      if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content === fullMessage) {
                        console.log('Messaggio già presente nello stato, evito duplicazione');
                      } else {
                        conversationState.messages.push({ role: 'assistant', content: fullMessage });
                      }
                      conversationState.conversationStep = conversationStep;
                      conversationState.isActive = isActive;
                      
                      if (collectedData) {
                        conversationState.collectedData = collectedData;
                        
                        // Se la conversazione è terminata, mostra il pulsante di conferma
                        if (!isActive) {
                          addConfirmationButton();
                        }
                      }
                      
                      // Interrompiamo il loop una volta che abbiamo finalizzato
                      break;
                    }
                  } catch (err) {
                    console.error('Error parsing SSE data:', err, 'Raw content:', dataContent);
                  }
                }
              }
              
              clearTimeout(streamTimeoutId);
              
              // Finalizziamo lo stato solo se non è già stato finalizzato all'interno del loop
              if (!messageCompleted) {
                console.log('Stream terminato senza ricevere isComplete=true, finalizzando stato');
                
                // Salvataggio sicuro del messaggio assistente - previene duplicazioni
                const lastMessage = conversationState.messages[conversationState.messages.length - 1];
                if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content === fullMessage) {
                  console.log('Messaggio già presente nello stato, evito duplicazione');
                } else {
                  conversationState.messages.push({ role: 'assistant', content: fullMessage });
                }
                conversationState.conversationStep = conversationStep;
                conversationState.isActive = isActive;
                
                if (collectedData) {
                  conversationState.collectedData = collectedData;
                  
                  // Se la conversazione è terminata, mostra il pulsante di conferma
                  if (!isActive) {
                    addConfirmationButton();
                  }
                }
              } else {
                console.log('Stato già finalizzato durante il processamento dello stream');
              }
              
              // Non salviamo più lo stato durante la conversazione
              
              // Aggiornamento debug panel
              updateDebugPanel();
              
              // Reset del contatore di tentativi
              retryCount = 0;
              
              // Traccia evento
              trackEvent('message_sent');
            } catch (err) {
              console.error('Error reading stream:', err);
              handleCommunicationError();
            } finally {
              // Cleanup
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
              
              scrollToBottom();
            }
          }
          
          // Start processing the stream
          readChunks();
          
        } catch (streamError) {
          console.error('Stream error, falling back to traditional request:', streamError);
          clearTimeout(streamTimeoutId);
          
          // Elimina il messaggio placeholder creato per lo streaming
          if (assistantMessageElement && elements.chatMessages) {
            elements.chatMessages.removeChild(assistantMessageElement);
          }
          
          // Fallback to traditional request
          await handleTraditionalRequest(userInput);
        }
      } else {
        // NON-STREAMING FALLBACK
        // Elimina il messaggio placeholder creato per lo streaming
        if (assistantMessageElement && elements.chatMessages) {
          elements.chatMessages.removeChild(assistantMessageElement);
        }
        
        await handleTraditionalRequest(userInput);
      }
    } catch (error) {
      console.error('Errore nella comunicazione con il server:', error);
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
   * Gestisce la richiesta tradizionale (non streaming)
   */
  async function handleTraditionalRequest(userInput) {
    try {
      // Invia il messaggio al server
      const response = await fetch('/api/conversation/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': elements.csrfToken.value
        },
        body: JSON.stringify({ message: userInput })
      });
      
      if (!response.ok) {
        throw new Error('Errore nella comunicazione con il server');
      }
      
      const data = await response.json();
      
      // Aggiunta della risposta all'interfaccia
      addAssistantMessage(data.message);
      
      // Aggiornamento dei dati della conversazione
      conversationState.messages.push({ role: 'assistant', content: data.message });
      conversationState.conversationStep = data.conversationStep || conversationState.conversationStep;
      conversationState.isActive = data.isActive;
      
      if (data.collectedData) {
        conversationState.collectedData = data.collectedData;
      }
      
      // Se la conversazione è terminata, mostra il pulsante di conferma
      if (!data.isActive && data.collectedData) {
        addConfirmationButton();
      }
      
      // Non salviamo più lo stato durante la conversazione
      
      // Aggiornamento debug panel
      updateDebugPanel();
      
      // Reset del contatore di tentativi
      retryCount = 0;
      
      // Traccia evento
      trackEvent('message_sent');
    } catch (error) {
      console.error('Errore nella comunicazione con il server:', error);
      handleCommunicationError();
    } finally {
      // Nascondi l'indicatore di digitazione
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
          language: currentLang
        }
      };
      
      // Invio dei dati
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
            // Qui andrebbe la logica di cancellazione
            hideTypingIndicator();
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
      collectedData: null
    };
    
    // Rimuovi i dati dal localStorage
    try {
      localStorage.removeItem(APP_CONFIG.STORAGE_KEY);
    } catch (e) {
      console.warn('Impossibile rimuovere lo stato da localStorage:', e);
    }
    
    // Avvio nuova conversazione
    startConversation();
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
