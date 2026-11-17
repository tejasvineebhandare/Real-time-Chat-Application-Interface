import type { AuthSession, UserProfile } from '../types/chat';

const SESSION_KEY = 'relaychat_auth_session';

type Listener = (session: AuthSession | null) => void;

class AuthService {
  private session: AuthSession | null = null;
  private listeners = new Set<Listener>();

  constructor() {
    this.session = this.loadFromStorage();
  }

  private loadFromStorage(): AuthSession | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AuthSession;
      if (!parsed?.token || !parsed?.user?.id) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private persist(session: AuthSession | null): void {
    this.session = session;
    try {
      if (session) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch {
      // Ignore storage quota errors
    }
    this.listeners.forEach((listener) => listener(this.session));
  }

  getSession(): AuthSession | null {
    return this.session;
  }

  getToken(): string | null {
    return this.session?.token ?? null;
  }

  getCurrentUser(): UserProfile | null {
    return this.session?.user ?? null;
  }

  isAuthenticated(): boolean {
    return Boolean(this.session?.token);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Unable to sign in.');
    }
    const nextSession: AuthSession = { token: data.token, user: data.user };
    this.persist(nextSession);
    return nextSession;
  }

  async register(name: string, email: string, password: string, role?: string): Promise<AuthSession> {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Unable to create account.');
    }
    const nextSession: AuthSession = { token: data.token, user: data.user };
    this.persist(nextSession);
    return nextSession;
  }

  async validateSession(): Promise<UserProfile | null> {
    const token = this.getToken();
    if (!token) return null;

    const response = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      this.clearSession();
      return null;
    }

    const data = await response.json();
    if (this.session) {
      this.persist({ token: this.session.token, user: data.user });
    }
    return data.user as UserProfile;
  }

  clearSession(): void {
    this.persist(null);
  }
}

export const authService = new AuthService();
