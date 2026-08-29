/**
 * freeChat: Socket.io Realtime Client
 */

let socket = null;

export const Realtime = {
  connect({
    userId,
    onMessageReceived,
    onTypingChange,
    onStatusChange,
    onConversationUpdated
  }) {
    if (socket) {
      socket.disconnect();
    }

    // Connect to host Socket.io
    // @ts-ignore
    socket = window.io();

    socket.on('connect', () => {
      console.log('[Realtime] Connected to live messaging relay');
      socket.emit('user_connected', userId);
    });

    socket.on('new_message', (msg) => {
      if (typeof onMessageReceived === 'function') {
        onMessageReceived(msg);
      }
    });

    socket.on('user_typing', (data) => {
      if (typeof onTypingChange === 'function') {
        onTypingChange(data);
      }
    });

    socket.on('user_status_change', (data) => {
      if (typeof onStatusChange === 'function') {
        onStatusChange(data);
      }
    });

    socket.on('conversation_updated', (data) => {
      if (typeof onConversationUpdated === 'function') {
        onConversationUpdated(data);
      }
    });

    socket.on('disconnect', () => {
      console.log('[Realtime] Disconnected from relay');
    });

    return socket;
  },

  joinConversation(conversationId) {
    if (socket && conversationId) {
      socket.emit('join_conversation', conversationId);
    }
  },

  leaveConversation(conversationId) {
    if (socket && conversationId) {
      socket.emit('leave_conversation', conversationId);
    }
  },

  sendMessage(messageData) {
    return new Promise((resolve, reject) => {
      if (!socket) return reject(new Error('Socket not connected'));

      socket.emit('send_message', messageData, (response) => {
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response?.message);
        }
      });
    });
  },

  sendTypingStart(conversationId, userId, username) {
    if (socket) {
      socket.emit('typing_start', { conversationId, userId, username });
    }
  },

  sendTypingStop(conversationId, userId, username) {
    if (socket) {
      socket.emit('typing_stop', { conversationId, userId, username });
    }
  },

  disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }
};

