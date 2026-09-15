import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveMasterKey,
  deriveAuthVerifier,
  encryptPrivateKeyBackup,
  decryptPrivateKeyBackup,
  getSharedSecretKey,
  encryptMessage,
  decryptMessage,
  generateRandomBytes,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  clearSharedKeyCache,
  KeyStore
} from './crypto.js';

import { API } from './api.js';
import { Realtime } from './socket.js';
import {
  showToast,
  renderConversationItem,
  renderMessageBubble,
  renderTypingIndicator,
  renderDateDivider,
  formatDateDivider,
  scrollToBottom,
  escapeHtml
} from './ui.js';

// State
const state = {
  currentUser: null,
  localPrivateKey: null,
  localPublicKey: null,
  conversations: [],
  activeConversation: null,
  activeTargetUser: null,
  activeSharedKey: null,
  onlineUsers: new Set(),
  searchQuery: '',
  isTypingTimer: null,
  isTyping: false
};

// Elements
const elements = {
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  themeColorMeta: document.getElementById('theme-color-meta'),
  newChatBtn: document.getElementById('new-chat-btn'),
  searchConvInput: document.getElementById('search-conv-input'),
  conversationsList: document.getElementById('conversations-list'),
  sidebarUsername: document.getElementById('sidebar-username'),
  sidebarAvatar: document.getElementById('sidebar-avatar'),
  logoutBtn: document.getElementById('logout-btn'),

  // Chat pane
  chatPane: document.getElementById('chat-pane'),
  emptyChatState: document.getElementById('empty-chat-state'),
  emptyChatStartBtn: document.getElementById('empty-chat-start-btn'),
  activeChatView: document.getElementById('active-chat-view'),
  chatHeaderAvatar: document.getElementById('chat-header-avatar'),
  chatHeaderName: document.getElementById('chat-header-name'),
  chatHeaderSubtitle: document.getElementById('chat-header-subtitle'),
  messagesContainer: document.getElementById('messages-container'),
  composerInput: document.getElementById('composer-input'),
  sendBtn: document.getElementById('send-btn'),
  btnBack: document.getElementById('btn-back'),

  // Status banner
  connectionStatusBar: document.getElementById('connection-status-bar'),
  connectionStatusText: document.getElementById('connection-status-text'),

  // Auth modal
  authModal: document.getElementById('auth-modal'),
  authForm: document.getElementById('auth-form'),
  authTitle: document.getElementById('auth-title'),
  authSubtitle: document.getElementById('auth-subtitle'),
  authUsernameInput: document.getElementById('auth-username'),
  authPasswordInput: document.getElementById('auth-password'),
  authSubmitBtn: document.getElementById('auth-submit-btn'),
  authCryptoStatus: document.getElementById('auth-crypto-status'),
  tabLogin: document.getElementById('tab-login'),
  tabRegister: document.getElementById('tab-register'),

  // Search modal
  newChatModal: document.getElementById('new-chat-modal'),
  closeNewChatBtn: document.getElementById('close-new-chat-btn'),
  userSearchInput: document.getElementById('user-search-input'),
  searchResultsList: document.getElementById('search-results-list')
};

let currentAuthMode = 'login';

// Initialize
async function initApp() {
  initTheme();
  setupEventListeners();

  window.addEventListener('auth:expired', () => {
    showToast('Session expired. Please log in again.');
    handleLogout(false);
  });

  const savedUserJson = localStorage.getItem('freeChat_user');
  const token = API.getToken();

  if (savedUserJson && token) {
    try {
      const user = JSON.parse(savedUserJson);
      // Validate token with backend
      const meRes = await API.getMe();
      const keys = await KeyStore.getUserKeys(user.id);

      if (keys?.privateKey && meRes.user) {
        state.currentUser = user;
        state.localPrivateKey = keys.privateKey;
        state.localPublicKey = keys.publicKey;
        onAuthSuccess();
        return;
      }
    } catch (err) {
      console.warn('[Init] Session invalid or expired:', err);
      API.clearToken();
      localStorage.removeItem('freeChat_user');
    }
  }

  showAuthModal('login');
}

// Theme
function initTheme() {
  const savedTheme = localStorage.getItem('freeChat_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeColor(savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('freeChat_theme', next);
  updateThemeColor(next);
  updateThemeIcon(next);
}

function updateThemeColor(theme) {
  const meta = elements.themeColorMeta || document.getElementById('theme-color-meta');
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#000000' : '#f2f2f7');
  }
}

function updateThemeIcon(theme) {
  if (!elements.themeToggleBtn) return;
  elements.themeToggleBtn.innerHTML = theme === 'dark' 
    ? `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41s-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41s-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>`
    : `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>`;
}

// Auth modal
function showAuthModal(mode = 'login') {
  currentAuthMode = mode;
  elements.authModal.classList.add('active');
  elements.authCryptoStatus.textContent = '🔒 Zero-Knowledge Security Active';
  
  if (mode === 'login') {
    elements.tabLogin.classList.add('active');
    elements.tabLogin.setAttribute('aria-selected', 'true');
    elements.tabRegister.classList.remove('active');
    elements.tabRegister.setAttribute('aria-selected', 'false');
    elements.authTitle.textContent = 'Welcome Back';
    elements.authSubtitle.textContent = 'Sign in with your private credentials';
    elements.authSubmitBtn.textContent = 'Sign In';
  } else {
    elements.tabRegister.classList.add('active');
    elements.tabRegister.setAttribute('aria-selected', 'true');
    elements.tabLogin.classList.remove('active');
    elements.tabLogin.setAttribute('aria-selected', 'false');
    elements.authTitle.textContent = 'Create Identity';
    elements.authSubtitle.textContent = 'Generate your local E2EE keys';
    elements.authSubmitBtn.textContent = 'Create Account & Keys';
  }
  elements.authUsernameInput.focus();
}

function hideAuthModal() {
  elements.authModal.classList.remove('active');
  elements.authForm.reset();
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const username = elements.authUsernameInput.value.trim().toLowerCase();
  const password = elements.authPasswordInput.value;

  if (!username || !password) {
    showToast('Please enter both username and password.');
    return;
  }

  elements.authSubmitBtn.disabled = true;

  try {
    if (currentAuthMode === 'register') {
      elements.authCryptoStatus.textContent = '🔑 Generating ECDH P-256 Key Pair...';
      const keyPair = await generateKeyPair();
      const publicKeyJwk = await exportPublicKey(keyPair.publicKey);

      elements.authCryptoStatus.textContent = '🛡️ Deriving Master Key...';
      const salt = generateRandomBytes(16);
      const saltBase64 = arrayBufferToBase64(salt);
      const masterKey = await deriveMasterKey(password, salt);
      const authVerifier = await deriveAuthVerifier(password, saltBase64);

      elements.authCryptoStatus.textContent = '🔒 Encrypting Key Backup...';
      const encryptedBackup = await encryptPrivateKeyBackup(keyPair.privateKey, masterKey);

      const colors = ['#007AFF', '#FF2D55', '#5856D6', '#AF52DE', '#FF9500', '#34C759'];
      const avatarColor = colors[Math.floor(Math.random() * colors.length)];

      elements.authCryptoStatus.textContent = '☁️ Creating Account...';
      const res = await API.register({
        username,
        auth_verifier: authVerifier,
        public_key: publicKeyJwk,
        encrypted_priv_key: encryptedBackup.encryptedPrivateKey,
        salt: saltBase64,
        iv: encryptedBackup.iv,
        avatar_color: avatarColor
      });

      await KeyStore.saveUserKeys(res.user.id, keyPair.privateKey, keyPair.publicKey);

      state.currentUser = res.user;
      state.localPrivateKey = keyPair.privateKey;
      state.localPublicKey = keyPair.publicKey;

      localStorage.setItem('freeChat_user', JSON.stringify(res.user));
      hideAuthModal();
      onAuthSuccess();
      showToast(`Welcome @${username}! Keys generated safely.`);
    } else {
      elements.authCryptoStatus.textContent = '🔍 Fetching parameters...';
      const preLogin = await API.preLogin(username);

      elements.authCryptoStatus.textContent = '🛡️ Deriving Key & Verifier...';
      const saltBuffer = base64ToArrayBuffer(preLogin.salt);
      const masterKey = await deriveMasterKey(password, saltBuffer);
      const authVerifier = await deriveAuthVerifier(password, preLogin.salt);

      elements.authCryptoStatus.textContent = '🔓 Decrypting Private Key...';
      const privateKey = await decryptPrivateKeyBackup(
        preLogin.encrypted_priv_key,
        preLogin.iv,
        masterKey
      );

      const loginRes = await API.login(username, authVerifier);
      const publicKey = await importPublicKey(loginRes.user.public_key);
      await KeyStore.saveUserKeys(loginRes.user.id, privateKey, publicKey);

      state.currentUser = loginRes.user;
      state.localPrivateKey = privateKey;
      state.localPublicKey = publicKey;

      localStorage.setItem('freeChat_user', JSON.stringify(loginRes.user));
      hideAuthModal();
      onAuthSuccess();
      showToast(`Welcome back, @${username}!`);
    }
  } catch (err) {
    console.error('[Auth Error]:', err);
    elements.authCryptoStatus.textContent = '❌ Authentication failed';
    showToast(err.message || 'Authentication error');
  } finally {
    elements.authSubmitBtn.disabled = false;
  }
}

function handleLogout(showConfirmation = true) {
  if (!showConfirmation || confirm('Are you sure you want to log out? Your keys remain securely encrypted.')) {
    if (state.currentUser) {
      KeyStore.clearUserKeys(state.currentUser.id);
    }
    clearSharedKeyCache();
    API.clearToken();
    localStorage.removeItem('freeChat_user');
    Realtime.disconnect();
    state.currentUser = null;
    state.localPrivateKey = null;
    state.localPublicKey = null;
    state.activeConversation = null;
    state.activeTargetUser = null;
    state.activeSharedKey = null;
    state.onlineUsers.clear();
    location.reload();
  }
}

function setConnectionStatus(status, text) {
  const bar = elements.connectionStatusBar || document.getElementById('connection-status-bar');
  const label = elements.connectionStatusText || document.getElementById('connection-status-text');
  if (!bar || !label) return;

  if (status === 'connected') {
    bar.className = 'connection-status-bar online';
    label.textContent = text || 'Connected to secure network';
    setTimeout(() => {
      bar.classList.add('hidden');
    }, 1500);
  } else if (status === 'connecting' || status === 'reconnecting') {
    bar.className = 'connection-status-bar';
    label.textContent = text || 'Connecting to real-time network...';
    bar.classList.remove('hidden');
  } else if (status === 'offline') {
    bar.className = 'connection-status-bar';
    label.textContent = text || 'Offline. Waiting for network...';
    bar.classList.remove('hidden');
  }
}

// Post-auth
async function onAuthSuccess() {
  elements.sidebarUsername.textContent = `@${state.currentUser.username}`;
  elements.sidebarAvatar.textContent = (state.currentUser.username || '?')[0].toUpperCase();
  elements.sidebarAvatar.style.backgroundColor = state.currentUser.avatar_color || '#007AFF';

  Realtime.connect({
    token: API.getToken(),
    onConnect: () => {
      setConnectionStatus('connected', 'Secure real-time network active');
    },
    onDisconnect: () => {
      setConnectionStatus('reconnecting', 'Connection lost. Reconnecting...');
    },
    onReconnectAttempt: () => {
      setConnectionStatus('reconnecting', 'Reconnecting to real-time network...');
    },
    onOnlineUsersList: (userIds) => {
      state.onlineUsers = new Set(userIds);
      renderConversationsList();
      updateChatHeaderPresence();
    },
    onMessageReceived: handleIncomingMessage,
    onTypingChange: handleTypingChange,
    onStatusChange: handleUserStatusChange,
    onConversationUpdated: () => loadConversations(),
    onConnectError: (err) => {
      console.warn('[Socket Connection Error]:', err.message);
      setConnectionStatus('reconnecting', 'Connection issue. Reconnecting...');
      if (err.message.includes('Authentication error') || err.message.includes('token')) {
        showToast('Realtime session expired. Please log in again.');
        handleLogout(false);
      }
    }
  });

  await loadConversations();
}

// Conversations
async function loadConversations() {
  try {
    const convs = await API.getConversations();
    state.conversations = convs;
    renderConversationsList();
  } catch (err) {
    console.error('[Conversations Error]:', err);
  }
}

function renderConversationsList() {
  elements.conversationsList.innerHTML = '';

  const q = state.searchQuery.toLowerCase().trim();
  const filteredConvs = q ? state.conversations.filter(c => {
    const otherParticipant = c.conversation_participants?.find(
      p => (p.user_id || p.users?.id) !== state.currentUser.id
    )?.users;
    return otherParticipant?.username?.toLowerCase().includes(q) || c.title?.toLowerCase().includes(q);
  }) : state.conversations;

  if (filteredConvs.length === 0) {
    elements.conversationsList.innerHTML = `
      <div style="padding: 24px 16px; text-align: center; color: var(--text-secondary); font-size: 14px;">
        ${q ? `No conversations matching "${escapeHtml(q)}"` : 'No conversations yet.<br>Click <strong>+</strong> to start an E2EE chat!'}
      </div>
    `;
    return;
  }

  filteredConvs.forEach(conv => {
    const isActive = state.activeConversation?.id === conv.id;
    const item = renderConversationItem(conv, state.currentUser.id, isActive, state.onlineUsers);
    
    item.addEventListener('click', (e) => {
      e.preventDefault();
      selectConversation(conv);
    });

    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectConversation(conv);
      }
    });

    elements.conversationsList.appendChild(item);

    // Decrypt last message snippet
    if (conv.last_message && state.localPrivateKey) {
      const otherParticipant = conv.conversation_participants?.find(
        p => (p.user_id || p.users?.id) !== state.currentUser.id
      )?.users;

      if (otherParticipant?.public_key) {
        getSharedSecretKey(state.localPrivateKey, otherParticipant.public_key, otherParticipant.id)
          .then(sharedKey => decryptMessage(conv.last_message.ciphertext, conv.last_message.iv, sharedKey))
          .then(plain => {
            const previewEl = document.getElementById(`conv-preview-${conv.id}`);
            if (previewEl && plain && !plain.startsWith('🔒')) {
              const prefix = conv.last_message.sender_id === state.currentUser.id ? 'You: ' : '';
              previewEl.textContent = `${prefix}${plain}`;
            }
          })
          .catch(() => {});
      }
    }
  });
}

function updateChatHeaderPresence() {
  if (!state.activeTargetUser) return;
  const isOnline = state.onlineUsers.has(state.activeTargetUser.id);
  elements.chatHeaderSubtitle.innerHTML = isOnline
    ? `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:var(--status-online); margin-right:4px;"></span> Online • E2EE 🔒`
    : `<svg class="e2e-lock-icon" viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg> freeChat • End-to-End Encrypted`;
}

async function selectConversation(conv) {
  // Always bring UI into view immediately
  document.body.classList.add('chat-active');
  elements.emptyChatState.style.display = 'none';
  elements.activeChatView.style.display = 'flex';

  const isAlreadyActive = state.activeConversation?.id === conv.id;

  if (isAlreadyActive) {
    elements.composerInput.focus();
    scrollToBottom(elements.messagesContainer, true);
    return;
  }

  // Leave previous room
  if (state.activeConversation) {
    Realtime.leaveConversation(state.activeConversation.id);
  }

  state.activeConversation = conv;
  Realtime.joinConversation(conv.id);

  // Target user
  const otherParticipant = conv.conversation_participants?.find(
    p => (p.user_id || p.users?.id) !== state.currentUser.id
  )?.users;

  state.activeTargetUser = otherParticipant;

  // Key exchange
  try {
    if (otherParticipant?.public_key) {
      state.activeSharedKey = await getSharedSecretKey(
        state.localPrivateKey,
        otherParticipant.public_key,
        otherParticipant.id
      );
    }
  } catch (err) {
    console.error('[Key Exchange Error]:', err);
    showToast('Failed to establish E2EE key exchange.');
  }

  const targetName = otherParticipant?.username || 'Chat';
  elements.chatHeaderName.textContent = targetName;
  elements.chatHeaderAvatar.textContent = targetName[0].toUpperCase();
  elements.chatHeaderAvatar.style.backgroundColor = otherParticipant?.avatar_color || '#007AFF';
  updateChatHeaderPresence();

  renderConversationsList();
  await loadMessages(conv.id);
  elements.composerInput.focus();
}

async function loadMessages(convId) {
  elements.messagesContainer.innerHTML = `
    <div style="text-align:center; padding: 20px; color: var(--text-secondary); font-size: 13px;">
      🔒 Messages are end-to-end encrypted. No one outside of this chat can read them.
    </div>
  `;

  try {
    const messages = await API.getMessages(convId);
    if (state.activeConversation?.id !== convId) return;

    let lastDateStr = null;

    for (const msg of messages) {
      const msgDate = new Date(msg.created_at).toDateString();
      if (msgDate !== lastDateStr) {
        lastDateStr = msgDate;
        elements.messagesContainer.appendChild(renderDateDivider(formatDateDivider(msg.created_at)));
      }

      const isMine = msg.sender_id === state.currentUser.id;
      let plainText = '🔒 [Encrypted Message]';

      if (state.activeSharedKey) {
        plainText = await decryptMessage(msg.ciphertext, msg.iv, state.activeSharedKey);
      }

      const bubble = renderMessageBubble({
        id: msg.id,
        isMine,
        plainText,
        createdAt: msg.created_at
      });
      elements.messagesContainer.appendChild(bubble);
    }

    scrollToBottom(elements.messagesContainer, false);
  } catch (err) {
    console.error('[Messages Error]:', err);
  }
}

// Send message
async function handleSendMessage() {
  const text = elements.composerInput.value.trim();
  if (!text || !state.activeConversation || !state.activeSharedKey) return;

  elements.composerInput.value = '';
  elements.composerInput.style.height = 'auto';
  updateSendButtonState();

  try {
    const { ciphertext, iv } = await encryptMessage(text, state.activeSharedKey);

    const savedMsg = await Realtime.sendMessage({
      conversationId: state.activeConversation.id,
      senderId: state.currentUser.id,
      ciphertext,
      iv
    });

    const bubble = renderMessageBubble({
      id: savedMsg.id,
      isMine: true,
      plainText: text,
      createdAt: savedMsg.created_at
    });
    elements.messagesContainer.appendChild(bubble);
    scrollToBottom(elements.messagesContainer, true);

    // Update conversation in sidebar
    state.activeConversation.last_message = savedMsg;
    state.activeConversation.updated_at = savedMsg.created_at;
    state.conversations.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    renderConversationsList();

    Realtime.sendTypingStop(state.activeConversation.id);
  } catch (err) {
    console.error('[Send Error]:', err);
    showToast('Failed to send encrypted message.');
  }
}

// Receive message
async function handleIncomingMessage(msg) {
  if (state.activeConversation && msg.conversation_id === state.activeConversation.id) {
    if (msg.sender_id !== state.currentUser.id) {
      let plainText = '🔒 [Encrypted Message]';
      if (state.activeSharedKey) {
        plainText = await decryptMessage(msg.ciphertext, msg.iv, state.activeSharedKey);
      }

      const existingTyping = document.getElementById('active-typing-indicator');
      if (existingTyping) existingTyping.remove();

      const bubble = renderMessageBubble({
        id: msg.id,
        isMine: false,
        plainText,
        createdAt: msg.created_at
      });
      elements.messagesContainer.appendChild(bubble);
      scrollToBottom(elements.messagesContainer, true);
    }
  }

  loadConversations();
}

// Typing indicators
function handleTypingInput() {
  // Auto-resize composer textarea
  elements.composerInput.style.height = 'auto';
  elements.composerInput.style.height = Math.min(elements.composerInput.scrollHeight, 120) + 'px';

  updateSendButtonState();

  if (!state.activeConversation) return;

  if (!state.isTyping) {
    state.isTyping = true;
    Realtime.sendTypingStart(state.activeConversation.id);
  }

  clearTimeout(state.isTypingTimer);
  state.isTypingTimer = setTimeout(() => {
    state.isTyping = false;
    Realtime.sendTypingStop(state.activeConversation.id);
  }, 2000);
}

function handleTypingChange({ conversationId, username, isTyping }) {
  if (state.activeConversation?.id !== conversationId) return;

  const existing = document.getElementById('active-typing-indicator');

  if (isTyping && !existing) {
    const typingBubble = renderTypingIndicator(username);
    elements.messagesContainer.appendChild(typingBubble);
    scrollToBottom(elements.messagesContainer, true);
  } else if (!isTyping && existing) {
    existing.remove();
  }
}

function handleUserStatusChange({ userId, status }) {
  if (status === 'online') {
    state.onlineUsers.add(userId);
  } else {
    state.onlineUsers.delete(userId);
  }

  const badge = document.getElementById(`status-badge-${userId}`);
  if (badge) {
    if (status === 'online') {
      badge.classList.remove('offline');
    } else {
      badge.classList.add('offline');
    }
  }

  updateChatHeaderPresence();
}

function updateSendButtonState() {
  const hasText = elements.composerInput.value.trim().length > 0;
  if (hasText) {
    elements.sendBtn.classList.add('active');
  } else {
    elements.sendBtn.classList.remove('active');
  }
}

// Modal focus trap helper
function trapModalFocus(modalEl, e) {
  if (e.key !== 'Tab') return;
  const focusables = modalEl.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables || focusables.length === 0) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

let lastFocusedElementBeforeModal = null;

// User search
function openNewChatModal() {
  lastFocusedElementBeforeModal = document.activeElement;
  elements.newChatModal.classList.add('active');
  elements.userSearchInput.value = '';
  elements.searchResultsList.innerHTML = '';
  elements.userSearchInput.focus();
}

function closeNewChatModal() {
  elements.newChatModal.classList.remove('active');
  if (lastFocusedElementBeforeModal && typeof lastFocusedElementBeforeModal.focus === 'function') {
    lastFocusedElementBeforeModal.focus();
  }
}

let searchDebounceTimer = null;
async function handleUserSearch() {
  const query = elements.userSearchInput.value.trim();
  clearTimeout(searchDebounceTimer);

  if (query.length < 1) {
    elements.searchResultsList.innerHTML = '';
    return;
  }

  searchDebounceTimer = setTimeout(async () => {
    try {
      const results = await API.searchUsers(query);
      elements.searchResultsList.innerHTML = '';

      if (results.length === 0) {
        elements.searchResultsList.innerHTML = `
          <div style="padding: 16px; text-align: center; color: var(--text-secondary); font-size: 13px;">
            No users found matching "${escapeHtml(query)}"
          </div>
        `;
        return;
      }

      results.forEach(user => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        const initial = escapeHtml((user.username || '?')[0].toUpperCase());
        const rawColor = user.avatar_color || '#007AFF';
        const avatarColor = /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor : '#007AFF';

        item.innerHTML = `
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="avatar" style="background-color: ${avatarColor}; width: 36px; height: 36px; font-size: 14px;">
              ${initial}
            </div>
            <div>
              <div style="font-weight: 600; font-size: 15px;">@${escapeHtml(user.username)}</div>
              <div style="font-size: 12px; color: var(--text-secondary);">E2EE Public Key Ready 🔒</div>
            </div>
          </div>
          <button class="glass-btn glass-btn-primary" style="padding: 6px 14px; font-size: 13px;">Chat</button>
        `;

        item.addEventListener('click', () => startDirectChatWith(user.username));
        elements.searchResultsList.appendChild(item);
      });
    } catch (err) {
      console.error('[Search Error]:', err);
    }
  }, 250);
}

async function startDirectChatWith(targetUsername) {
  closeNewChatModal();
  try {
    const conv = await API.createDirectConversation(targetUsername);
    await loadConversations();
    selectConversation(conv);
  } catch (err) {
    console.error('[Chat Error]:', err);
    showToast(err.message || 'Failed to start conversation.');
  }
}

// Event listeners
function setupEventListeners() {
  elements.themeToggleBtn.addEventListener('click', toggleTheme);

  elements.tabLogin.addEventListener('click', () => showAuthModal('login'));
  elements.tabRegister.addEventListener('click', () => showAuthModal('register'));
  elements.authForm.addEventListener('submit', handleAuthSubmit);
  elements.logoutBtn.addEventListener('click', handleLogout);

  elements.newChatBtn.addEventListener('click', openNewChatModal);
  if (elements.emptyChatStartBtn) {
    elements.emptyChatStartBtn.addEventListener('click', openNewChatModal);
  }
  elements.closeNewChatBtn.addEventListener('click', closeNewChatModal);
  elements.userSearchInput.addEventListener('input', handleUserSearch);

  // Network offline and online detection
  window.addEventListener('online', () => {
    setConnectionStatus('connecting', 'Network restored. Connecting...');
  });
  window.addEventListener('offline', () => {
    setConnectionStatus('offline', 'No internet connection. Waiting for network...');
  });

  if (elements.searchConvInput) {
    elements.searchConvInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderConversationsList();
    });
  }

  // Backdrop click modal close
  elements.newChatModal.addEventListener('click', (e) => {
    if (e.target === elements.newChatModal) {
      closeNewChatModal();
    }
  });

  // Modal keyboard handling (focus trap & Escape)
  document.addEventListener('keydown', (e) => {
    if (elements.newChatModal.classList.contains('active')) {
      if (e.key === 'Escape') {
        closeNewChatModal();
        return;
      }
      trapModalFocus(elements.newChatModal, e);
    } else if (elements.authModal.classList.contains('active')) {
      trapModalFocus(elements.authModal, e);
    }
  });

  elements.composerInput.addEventListener('input', handleTypingInput);
  elements.composerInput.addEventListener('keydown', (e) => {
    const isMobileViewport = window.matchMedia('(max-width: 768px)').matches;
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isMobileViewport) {
        // On mobile keyboards, allow Return to create a newline
        return;
      }
      e.preventDefault();
      handleSendMessage();
    }
  });
  elements.sendBtn.addEventListener('click', handleSendMessage);

  elements.btnBack.addEventListener('click', () => {
    document.body.classList.remove('chat-active');
  });
}

// Init
window.addEventListener('DOMContentLoaded', initApp);
