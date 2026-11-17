export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  lastSeen: number;
  online?: boolean;
}

export interface ConversationPeer extends UserProfile {
  online: boolean;
  unreadCount: number;
  lastMessage: {
    id: string;
    content: string;
    senderId: string;
    createdAt: number;
    hasAttachment: boolean;
  } | null;
}

export interface Attachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  downloadUrl: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  attachment: Attachment | null;
  createdAt: number;
  readAt: number | null;
  clientMessageId?: string;
}

export interface AuthSession {
  token: string;
  user: UserProfile;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface PresenceUpdateEvent {
  userId: string;
  online: boolean;
  lastSeen: number;
}

export interface TypingUpdateEvent {
  userId: string;
  isTyping: boolean;
}

export interface ReadReceiptEvent {
  peerId: string;
  readAt: number;
}
