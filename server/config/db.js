import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isSupabaseConfigured = Boolean(
  process.env.SUPABASE_URL && 
  process.env.SUPABASE_KEY && 
  !process.env.SUPABASE_URL.includes('your-project-id')
);

let supabase = null;

// Local fallback store
const dbDir = path.join(__dirname, '../../database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const localDbPath = path.join(dbDir, 'local_db.json');

function loadLocalData() {
  if (!fs.existsSync(localDbPath)) {
    const initial = {
      users: [],
      conversations: [],
      conversation_participants: [],
      messages: []
    };
    fs.writeFileSync(localDbPath, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(localDbPath, 'utf-8'));
  } catch {
    return { users: [], conversations: [], conversation_participants: [], messages: [] };
  }
}

function saveLocalData(data) {
  fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), 'utf-8');
}

if (isSupabaseConfigured) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

export const db = {
  isSupabase: isSupabaseConfigured,
  
  // Users
  async getUserByUsername(username) {
    const cleanUsername = username.toLowerCase().trim();
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', cleanUsername)
        .maybeSingle();
      if (error) throw error;
      return data;
    } else {
      const data = loadLocalData();
      return data.users.find(u => u.username.toLowerCase() === cleanUsername) || null;
    }
  },

  async getUserById(id) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, public_key, avatar_color, status_message, last_seen, created_at')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    } else {
      const data = loadLocalData();
      const user = data.users.find(u => u.id === id);
      if (!user) return null;
      return {
        id: user.id,
        username: user.username,
        public_key: user.public_key,
        avatar_color: user.avatar_color,
        status_message: user.status_message,
        last_seen: user.last_seen,
        created_at: user.created_at
      };
    }
  },

  async searchUsers(query, excludeUserId = null) {
    const q = query.toLowerCase().trim();
    if (isSupabaseConfigured) {
      let req = supabase
        .from('users')
        .select('id, username, public_key, avatar_color, status_message, last_seen')
        .ilike('username', `%${query}%`)
        .limit(15);
      if (excludeUserId) {
        req = req.neq('id', excludeUserId);
      }
      const { data, error } = await req;
      if (error) throw error;
      return data || [];
    } else {
      const data = loadLocalData();
      return data.users
        .filter(u => u.username.toLowerCase().includes(q) && (!excludeUserId || u.id !== excludeUserId))
        .slice(0, 15)
        .map(u => ({
          id: u.id,
          username: u.username,
          public_key: u.public_key,
          avatar_color: u.avatar_color,
          status_message: u.status_message,
          last_seen: u.last_seen
        }));
    }
  },

  async createUser({ username, auth_verifier, public_key, encrypted_priv_key, salt, iv, avatar_color }) {
    const id = crypto.randomUUID();
    const cleanUsername = username.toLowerCase().trim();
    const now = new Date().toISOString();

    const newUser = {
      id,
      username: cleanUsername,
      auth_verifier,
      public_key,
      encrypted_priv_key,
      salt,
      iv,
      avatar_color: avatar_color || '#007AFF',
      status_message: 'Hey there! I am using freeChat.',
      last_seen: now,
      created_at: now
    };

    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('users')
        .insert([newUser])
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const data = loadLocalData();
      data.users.push(newUser);
      saveLocalData(data);
      return newUser;
    }
  },

  // Conversations
  async findDirectConversation(user1Id, user2Id) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id')
        .in('user_id', [user1Id, user2Id]);
      if (error) throw error;

      const counts = {};
      data?.forEach(p => {
        counts[p.conversation_id] = (counts[p.conversation_id] || 0) + 1;
      });

      for (const convId of Object.keys(counts)) {
        if (counts[convId] === 2) {
          const { data: conv } = await supabase
            .from('conversations')
            .select('*')
            .eq('id', convId)
            .eq('type', 'direct')
            .maybeSingle();
          if (conv) return conv;
        }
      }
      return null;
    } else {
      const data = loadLocalData();
      const directConvs = data.conversations.filter(c => c.type === 'direct');
      for (const conv of directConvs) {
        const p1 = data.conversation_participants.some(p => p.conversation_id === conv.id && p.user_id === user1Id);
        const p2 = data.conversation_participants.some(p => p.conversation_id === conv.id && p.user_id === user2Id);
        if (p1 && p2) return conv;
      }
      return null;
    }
  },

  async createConversation({ type = 'direct', title = null, created_by, participantIds = [] }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const newConv = {
      id,
      type,
      title,
      created_by,
      created_at: now,
      updated_at: now
    };

    if (isSupabaseConfigured) {
      const { data: conv, error: convError } = await supabase
        .from('conversations')
        .insert([newConv])
        .select()
        .single();
      if (convError) throw convError;

      const participants = participantIds.map(uid => ({
        conversation_id: id,
        user_id: uid,
        role: uid === created_by ? 'owner' : 'member',
        joined_at: now
      }));

      const { error: partError } = await supabase
        .from('conversation_participants')
        .insert(participants);
      if (partError) throw partError;

      return conv;
    } else {
      const data = loadLocalData();
      data.conversations.push(newConv);
      for (const uid of participantIds) {
        data.conversation_participants.push({
          conversation_id: id,
          user_id: uid,
          role: uid === created_by ? 'owner' : 'member',
          joined_at: now
        });
      }
      saveLocalData(data);
      return newConv;
    }
  },

  async getUserConversations(userId) {
    if (isSupabaseConfigured) {
      const { data: partData, error: partError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', userId);
      if (partError) throw partError;
      if (!partData || partData.length === 0) return [];

      const convIds = partData.map(p => p.conversation_id);
      const { data: convs, error: convError } = await supabase
        .from('conversations')
        .select(`
          id, type, title, created_at, updated_at,
          conversation_participants(user_id, role, users(id, username, public_key, avatar_color, status_message, last_seen))
        `)
        .in('id', convIds)
        .order('updated_at', { ascending: false });
      if (convError) throw convError;
      return convs || [];
    } else {
      const data = loadLocalData();
      const myConvIds = data.conversation_participants
        .filter(p => p.user_id === userId)
        .map(p => p.conversation_id);

      const convs = data.conversations
        .filter(c => myConvIds.includes(c.id))
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

      return convs.map(conv => {
        const parts = data.conversation_participants.filter(p => p.conversation_id === conv.id);
        const hydratedParticipants = parts.map(p => {
          const user = data.users.find(u => u.id === p.user_id);
          return {
            user_id: p.user_id,
            role: p.role,
            users: user ? {
              id: user.id,
              username: user.username,
              public_key: user.public_key,
              avatar_color: user.avatar_color,
              status_message: user.status_message,
              last_seen: user.last_seen
            } : null
          };
        });

        return {
          ...conv,
          conversation_participants: hydratedParticipants
        };
      });
    }
  },

  async getConversationParticipants(convId) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('conversation_participants')
        .select('user_id, role, users(id, username, public_key, avatar_color, last_seen)')
        .eq('conversation_id', convId);
      if (error) throw error;
      return data || [];
    } else {
      const data = loadLocalData();
      const parts = data.conversation_participants.filter(p => p.conversation_id === convId);
      return parts.map(p => {
        const user = data.users.find(u => u.id === p.user_id);
        return {
          user_id: p.user_id,
          role: p.role,
          users: user ? {
            id: user.id,
            username: user.username,
            public_key: user.public_key,
            avatar_color: user.avatar_color,
            last_seen: user.last_seen
          } : null
        };
      });
    }
  },

  // Messages
  async saveMessage({ conversation_id, sender_id, ciphertext, iv, sender_public_key = null, media_url = null, media_type = null }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const newMsg = {
      id,
      conversation_id,
      sender_id,
      ciphertext,
      iv,
      sender_public_key,
      media_url,
      media_type,
      created_at: now
    };

    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('messages')
        .insert([newMsg])
        .select()
        .single();
      if (error) throw error;

      await supabase
        .from('conversations')
        .update({ updated_at: now })
        .eq('id', conversation_id);

      return data;
    } else {
      const data = loadLocalData();
      data.messages.push(newMsg);
      const conv = data.conversations.find(c => c.id === conversation_id);
      if (conv) {
        conv.updated_at = now;
      }
      saveLocalData(data);
      return newMsg;
    }
  },

  async getConversationMessages(conversation_id, limit = 100) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation_id)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return data || [];
    } else {
      const data = loadLocalData();
      return data.messages
        .filter(m => m.conversation_id === conversation_id)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .slice(-limit);
    }
  },

  async updateLastSeen(userId) {
    const now = new Date().toISOString();
    if (isSupabaseConfigured) {
      await supabase.from('users').update({ last_seen: now }).eq('id', userId);
    } else {
      const data = loadLocalData();
      const user = data.users.find(u => u.id === userId);
      if (user) {
        user.last_seen = now;
        saveLocalData(data);
      }
    }
  }
};
