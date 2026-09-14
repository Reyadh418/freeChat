const BASE_URL = '';

let authToken = localStorage.getItem('freeChat_token') || null;

export function setAuthToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem('freeChat_token', token);
  } else {
    localStorage.removeItem('freeChat_token');
  }
}

export function getAuthToken() {
  return authToken;
}

async function request(endpoint, options = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json'
  };

  if (authToken) {
    defaultHeaders['Authorization'] = `Bearer ${authToken}`;
  }

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers
    }
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, config);
  const data = await response.json();

  if (!response.ok) {
    // If unauthorized or token expired, trigger an event or handle it
    if (response.status === 401 && endpoint !== '/api/auth/login' && endpoint !== '/api/auth/register') {
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    throw new Error(data.error || 'Network request failed');
  }

  return data;
}

export const API = {
  // Token Helpers
  setToken: setAuthToken,
  getToken: getAuthToken,
  clearToken: () => setAuthToken(null),

  // Auth
  async register(userData) {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
    if (res.token) {
      setAuthToken(res.token);
    }
    return res;
  },

  async preLogin(username) {
    return request('/api/auth/pre-login', {
      method: 'POST',
      body: JSON.stringify({ username })
    });
  },

  async login(username, authVerifier) {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, auth_verifier: authVerifier })
    });
    if (res.token) {
      setAuthToken(res.token);
    }
    return res;
  },

  async getMe() {
    return request('/api/auth/me');
  },

  async getUser(username) {
    return request(`/api/auth/user/${encodeURIComponent(username)}`);
  },

  // Chat
  async searchUsers(query) {
    const params = new URLSearchParams({ q: query });
    return request(`/api/chat/users/search?${params.toString()}`);
  },

  async getConversations() {
    return request('/api/chat/conversations');
  },

  async createDirectConversation(targetUsername) {
    return request('/api/chat/conversations/direct', {
      method: 'POST',
      body: JSON.stringify({ targetUsername })
    });
  },

  async getMessages(convId, limit = 100) {
    return request(`/api/chat/conversations/${encodeURIComponent(convId)}/messages?limit=${limit}`);
  }
};
