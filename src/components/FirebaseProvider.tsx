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

    // Polling contínuo de alta velocidade para Pedidos no Caixa / Balcão:
    const pathname = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : '';
    const isAdminOrStaff = pathname.includes('/admin') || pathname.includes('/tv');

    let ordersInterval: ReturnType<typeof setInterval> | null = null;
    let backgroundWorker: Worker | null = null;

    const pollWithAutoRecovery = async () => {
      try {
        await fetchOrdersOnly();
        consecutiveFailuresRef.current = 0;
      } catch {
        consecutiveFailuresRef.current++;
        if (consecutiveFailuresRef.current >= 12) { // ~20-25s de falha contínua no celular
          console.warn('[AutoRecovery] Conexão paralisada no smartphone. Reiniciando serviço...');
          consecutiveFailuresRef.current = 0;
          // Auto-recarrega a página para recuperar a conexão de rede perdida
          if (typeof window !== 'undefined' && document.visibilityState === 'visible') {
            window.location.reload();
          }
        }
      }
    };

    if (isAdminOrStaff) {
      ordersInterval = setInterval(pollWithAutoRecovery, 2000);

      try {
        const blob = new Blob([
          `setInterval(function() { postMessage('order_poll_tick'); }, 1800);`
        ], { type: 'application/javascript' });
        backgroundWorker = new Worker(URL.createObjectURL(blob));
        backgroundWorker.onmessage = () => {
          pollWithAutoRecovery();
        };
      } catch (e) {
        console.warn('Web Worker background timer fallback:', e);
      }
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
      backgroundWorker?.terminate();
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
