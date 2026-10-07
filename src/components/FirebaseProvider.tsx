import React, { useEffect, useState, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { useStore } from '../store/useStore';
import { BakeryLoader } from './BakeryLoader';

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const { fetchData, fetchOrdersOnly, setIsOnline, isOnline } = useStore();
  const [isReady, setIsReady] = useState(true);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveFailuresRef = useRef<number>(0);

  useEffect(() => {
    console.log('FirebaseProvider mounted');

    fetchData().catch((err) => {
      console.error('Initial data fetch error:', err);
    });

    // Setup Server-Sent Events (SSE) for instant real-time sync across desktop & mobile
    let eventSource: EventSource | null = null;
    let sseTimeout: ReturnType<typeof setTimeout> | null = null;

    const connectSSE = () => {
      if (eventSource) {
        eventSource.close();
      }
      try {
        eventSource = new EventSource('/api/events');
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'sync' || data.type === 'connected') {
              console.log('[SSE] Received sync event, refreshing data...');
              consecutiveFailuresRef.current = 0;
              setIsOnline(true);
              fetchData().catch(() => {});
              fetchOrdersOnly().catch(() => {});
            }
          } catch (e) {
            // ignore
          }
        };
        eventSource.onerror = () => {
          eventSource?.close();
          // Try reconnecting rapidly
          if (sseTimeout) clearTimeout(sseTimeout);
          sseTimeout = setTimeout(connectSSE, 2000);
        };
      } catch (e) {
        console.warn('SSE not supported or failed:', e);
      }
    };
    connectSSE();

    // Polling inteligente e econômico para Pedidos no Caixa / Balcão (apenas quando a tela estiver visível)
    const pathname = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : '';
    const isAdminOrStaff = pathname.includes('/admin') || pathname.includes('/tv');

    let ordersInterval: ReturnType<typeof setInterval> | null = null;

    const pollWithAutoRecovery = async () => {
      // Economia de recursos: não executa chamadas quando a aba estiver em segundo plano ou tela desligada
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      try {
        await fetchOrdersOnly();
        consecutiveFailuresRef.current = 0;
      } catch {
        consecutiveFailuresRef.current++;
        if (consecutiveFailuresRef.current >= 6) {
          console.warn('[AutoRecovery] Conexão paralisada no smartphone. Reconectando...');
          consecutiveFailuresRef.current = 0;
          if (typeof window !== 'undefined' && document.visibilityState === 'visible') {
            connectSSE();
          }
        }
      }
    };

    if (isAdminOrStaff) {
      // Intervalo otimizado de 12 segundos (o SSE entrega pedidos instantaneamente em tempo real)
      ordersInterval = setInterval(pollWithAutoRecovery, 12000);
    }

    const fullCatalogInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchData().catch(() => {});
      }
    }, 45000);

    // Auto sync e reconexão imediata ao desbloquear celular ou reconectar Wi-Fi
    const handleSyncTrigger = () => {
      if (document.visibilityState === 'visible' || navigator.onLine) {
        console.log('[AutoSync] Tela visível ou rede ativa. Forçando sincronização...');
        connectSSE();
        fetchData().catch(() => {});
        fetchOrdersOnly().catch(() => {});
      }
    };

    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        console.log('[PageShow] Restored from bfcache, refreshing data...');
        connectSSE();
        fetchData().catch(() => {});
        fetchOrdersOnly().catch(() => {});
      }
    };

    window.addEventListener('focus', handleSyncTrigger);
    document.addEventListener('visibilitychange', handleSyncTrigger);
    window.addEventListener('online', handleSyncTrigger);
    window.addEventListener('pageshow', handlePageShow);

    // Auth state listener
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      console.log('Auth state changed:', user ? `User: ${user.email}` : 'No user');
      setIsOnline(true);
    });

    return () => {
      if (eventSource) eventSource.close();
      if (sseTimeout) clearTimeout(sseTimeout);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      if (ordersInterval) clearInterval(ordersInterval);
      clearInterval(fullCatalogInterval);
      window.removeEventListener('focus', handleSyncTrigger);
      document.removeEventListener('visibilitychange', handleSyncTrigger);
      window.removeEventListener('online', handleSyncTrigger);
      window.removeEventListener('pageshow', handlePageShow);
      unsubAuth();
    };
  }, [fetchData, fetchOrdersOnly, setIsOnline]);

  if (!isReady) {
    return <BakeryLoader isLoading={true} />;
  }

  return <>{children}</>;
}
