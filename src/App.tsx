import { useEffect, useState } from 'react';
import { ChatDashboard } from './components/ChatDashboard';
import { LoginView } from './components/LoginView';
import { RegisterView } from './components/RegisterView';
import { authService } from './services/authService';
import type { AuthSession } from './types/chat';

type RoutePath = '/login' | '/register' | '/chat';

function normalizeRoute(pathname: string): RoutePath {
  if (pathname === '/register') return '/register';
  if (pathname === '/chat') return '/chat';
  return '/login';
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(() => authService.getSession());
  const [route, setRoute] = useState<RoutePath>(() => {
    const requested = normalizeRoute(window.location.pathname);
    const hasSession = authService.isAuthenticated();
    if (hasSession) return '/chat';
    return requested === '/register' ? '/register' : '/login';
  });
  const [guardNotice, setGuardNotice] = useState<string | null>(() => {
    const requested = window.location.pathname;
    if (!authService.isAuthenticated() && requested === '/chat') {
      return 'Authentication required. Please sign in to access the chat workspace.';
    }
    return null;
  });
  const [verifying, setVerifying] = useState<boolean>(() => authService.isAuthenticated());

  const navigate = (nextRoute: RoutePath, replace = false) => {
    if (window.location.pathname !== nextRoute) {
      if (replace) {
        window.history.replaceState(null, '', nextRoute);
      } else {
        window.history.pushState(null, '', nextRoute);
      }
    }
    setRoute(nextRoute);
  };

  useEffect(() => {
    const unsub = authService.subscribe((nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setRoute((prev) => (prev === '/register' ? '/register' : '/login'));
        if (window.location.pathname === '/chat') {
          window.history.replaceState(null, '', '/login');
        }
      }
    });

    const handlePopState = () => {
      const target = normalizeRoute(window.location.pathname);
      if (!authService.isAuthenticated() && target === '/chat') {
        setGuardNotice('Authentication required. Please sign in to access the chat workspace.');
        navigate('/login', true);
        return;
      }
      if (authService.isAuthenticated() && (target === '/login' || target === '/register')) {
        navigate('/chat', true);
        return;
      }
      setRoute(target);
    };

    window.addEventListener('popstate', handlePopState);

    // Enforce initial URL alignment with route guard
    if (!authService.isAuthenticated() && window.location.pathname === '/chat') {
      window.history.replaceState(null, '', '/login');
    } else if (authService.isAuthenticated() && window.location.pathname !== '/chat') {
      window.history.replaceState(null, '', '/chat');
    }

    if (authService.isAuthenticated()) {
      authService
        .validateSession()
        .finally(() => {
          setVerifying(false);
        });
    } else {
      setVerifying(false);
    }

    return () => {
      unsub();
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  if (verifying) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm text-slate-600">Verifying session...</div>
      </div>
    );
  }

  if (!session || route !== '/chat') {
    if (route === '/register') {
      return (
        <RegisterView
          onNavigateLogin={() => {
            setGuardNotice(null);
            navigate('/login');
          }}
          onSuccess={() => {
            setGuardNotice(null);
            navigate('/chat');
          }}
        />
      );
    }

    return (
      <LoginView
        guardNotice={guardNotice}
        onNavigateRegister={() => {
          setGuardNotice(null);
          navigate('/register');
        }}
        onSuccess={() => {
          setGuardNotice(null);
          navigate('/chat');
        }}
      />
    );
  }

  return (
    <ChatDashboard
      currentUser={session.user}
      onLogout={() => {
        authService.clearSession();
        setGuardNotice(null);
        navigate('/login');
      }}
    />
  );
}
