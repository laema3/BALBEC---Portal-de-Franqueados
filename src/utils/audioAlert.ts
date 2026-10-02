/**
 * Utilitários de Alerta Sonoro e Notificações Web para Atualizações de Pedidos
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  } catch (e) {
    console.warn('[Audio Alert] AudioContext não suportado:', e);
    return null;
  }
}

/**
 * Toca sino/chime de notificação agradável
 */
export function playOrderChime(type: 'preparing' | 'ready' | 'chime' = 'chime') {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    if (type === 'ready') {
      // 3 notas alegres ascendentes (D5 -> F#5 -> A5 -> D6) celebrando pedido pronto
      const notes = [
        { freq: 587.33, start: 0, dur: 0.25 },
        { freq: 739.99, start: 0.2, dur: 0.25 },
        { freq: 880.00, start: 0.4, dur: 0.35 },
        { freq: 1174.66, start: 0.65, dur: 0.8 },
      ];

      notes.forEach(({ freq, start, dur }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + start);
        gain.gain.setValueAtTime(0.35, now + start);
        gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + dur);
      });
    } else {
      // Chime suave de 2 notas para preparação / recebimento (A5 -> D5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.exponentialRampToValueAtTime(440, now + 0.5);
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.5);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(587.33, now + 0.25);
      osc2.frequency.exponentialRampToValueAtTime(293.66, now + 0.9);
      gain2.gain.setValueAtTime(0.35, now + 0.25);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.25);
      osc2.stop(now + 0.9);
    }
  } catch (err) {
    console.warn('[Audio Alert] Erro ao tocar som:', err);
  }
}

/**
 * Sintetizador de voz em português
 */
export function speakClientOrderAlert(orderNumber: string, status: string, customerName?: string) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    let text = '';
    const cleanNum = String(orderNumber).replace('#', '');
    const clientStr = customerName && customerName.toLowerCase() !== 'cliente' ? customerName : '';

    if (status === 'ready') {
      text = `Atenção: Senha número ${cleanNum}${clientStr ? `, ${clientStr}` : ''}, seu pedido está pronto para retirada no balcão!`;
    } else if (status === 'preparing') {
      text = `Atenção: Senha número ${cleanNum}, seu pedido começou a ser preparado na cozinha.`;
    }

    if (!text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.98;
    utterance.pitch = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn('[Voice Alert] Erro na síntese:', e);
  }
}

/**
 * Solicita permissão para notificações Web Push no navegador do cliente
 */
export async function requestBrowserNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  } catch {
    return false;
  }
}

/**
 * Exibe notificação no sistema operacional / celular do cliente
 */
export function showBrowserNotification(title: string, body: string, icon?: string) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const notif = new Notification(title, {
      body,
      icon: icon || '/logo.svg',
      badge: '/logo.svg',
      tag: 'order-status-update',
      requireInteraction: true
    });

    notif.onclick = () => {
      window.focus();
      notif.close();
    };
  } catch (err) {
    console.warn('[Notification API] Erro ao disparar notificação:', err);
  }
}

/**
 * Vibra o aparelho do cliente (em smartphones compatíveis)
 */
export function vibrateDevice(pattern: number[] = [300, 150, 300]) {
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {}
}
