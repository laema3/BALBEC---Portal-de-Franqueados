import { Order, StoreInfo } from '../store/useStore';

export interface SlotAvailability {
  slot: string;
  bookedCount: number;
  availableCount: number;
  isFull: boolean;
  isPast: boolean;
  isDisabled: boolean;
  orders: Order[];
}

/**
 * Converte "HH:MM" para minutos a partir da meia-noite
 */
export function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Converte minutos para string "HH:MM"
 */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Retorna os minutos atuais decorridos a partir da meia-noite no fuso horário do Brasil
 */
export function getCurrentTimeMinutes(): number {
  const now = new Date();
  try {
    const brazilDateStr = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
    const bd = new Date(brazilDateStr);
    return bd.getHours() * 60 + bd.getMinutes();
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

/**
 * Retorna o horário atual como string "HH:MM" no fuso horário do Brasil
 */
export function getCurrentTimeString(): string {
  return minutesToTime(getCurrentTimeMinutes());
}

/**
 * Verifica se um determinado horário (slot) já foi ultrapassado pelo relógio hoje
 */
export function isSlotPast(
  slot: string,
  targetDateStr?: string,
  currentMinutes?: number
): boolean {
  const todayStr = getLocalDateString();
  const dateStr = targetDateStr || todayStr;

  // Se a data já for de um dia anterior, todos os horários são passados
  if (dateStr < todayStr) return true;
  // Se for uma data futura (ex: agendamento de amanhã), nenhum horário passou ainda
  if (dateStr > todayStr) return false;

  // Se for o dia de hoje, compara com o relógio atual
  const nowMin = currentMinutes !== undefined ? currentMinutes : getCurrentTimeMinutes();
  const slotMin = timeToMinutes(slot);

  // Assim que o relógio atingir ou passar do horário, fica inabilitado
  return nowMin >= slotMin;
}

/**
 * Gera todos os horários entre o início e o fim no intervalo configurado.
 * Ex: De '09:00' até '20:30' de 30 em 30 min -> ['09:00', '09:30', ..., '20:30']
 */
export function generateTimeSlots(
  startTime = '09:00',
  endTime = '20:30',
  intervalMinutes = 30
): string[] {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const interval = Math.max(5, intervalMinutes || 30);
  const slots: string[] = [];

  for (let current = start; current <= end; current += interval) {
    slots.push(minutesToTime(current));
  }

  return slots;
}

/**
 * Retorna a data no formato YYYY-MM-DD local (fuso de Brasília)
 */
export function getLocalDateString(timestamp: number = Date.now()): string {
  const d = new Date(timestamp);
  try {
    const brazilDateStr = d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
    const bd = new Date(brazilDateStr);
    const year = bd.getFullYear();
    const month = String(bd.getMonth() + 1).padStart(2, '0');
    const day = String(bd.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

/**
 * Retorna a disponibilidade de um slot específico
 */
export function getSlotAvailability(
  slot: string,
  orders: Order[],
  maxPerSlot = 4,
  targetDateStr?: string,
  currentMinutes?: number
): SlotAvailability {
  const todayStr = getLocalDateString();
  const dateStr = targetDateStr || todayStr;
  const cap = Math.max(1, maxPerSlot || 4);

  // Filtra pedidos não cancelados que foram agendados para este slot nesta data
  const bookedOrders = (orders || []).filter(o => {
    if (!o || o.status === 'cancelled') return false;
    
    // Se o pedido tiver scheduledDate, confere a data
    if (o.scheduledDate) {
      if (o.scheduledDate !== dateStr) return false;
    } else {
      // Se não tiver scheduledDate explicitado, checa a data de criação
      const orderDate = getLocalDateString(o.createdAt);
      if (orderDate !== dateStr) return false;
    }

    return o.scheduledTime === slot;
  });

  const bookedCount = bookedOrders.length;
  const availableCount = Math.max(0, cap - bookedCount);
  const isFull = bookedCount >= cap;
  const isPast = isSlotPast(slot, dateStr, currentMinutes);
  const isDisabled = isFull || isPast;

  return {
    slot,
    bookedCount,
    availableCount,
    isFull,
    isPast,
    isDisabled,
    orders: bookedOrders,
  };
}

/**
 * Retorna a disponibilidade de todos os slots gerados
 */
export function getAllSlotsAvailability(
  storeInfo: StoreInfo,
  orders: Order[],
  targetDateStr?: string,
  currentMinutes?: number
): SlotAvailability[] {
  const startTime = storeInfo.schedulingStartTime || '09:00';
  const endTime = storeInfo.schedulingEndTime || '20:30';
  const interval = storeInfo.schedulingIntervalMinutes || 30;
  const maxPerSlot = storeInfo.schedulingMaxOrdersPerSlot || 4;

  const slots = generateTimeSlots(startTime, endTime, interval);
  return slots.map(s => getSlotAvailability(s, orders, maxPerSlot, targetDateStr, currentMinutes));
}

/**
 * Verifica se o módulo de agendamento está ativo nas configurações
 */
export function isSchedulingEnabled(storeInfo?: StoreInfo | null): boolean {
  if (!storeInfo) return false;
  if (storeInfo.schedulingEnabled === true) return true;
  
  if (storeInfo.modulesConfig) {
    let mod: any = storeInfo.modulesConfig;
    if (typeof mod === 'string') {
      try { mod = JSON.parse(mod); } catch {}
    }
    if (mod && mod.scheduling === true) return true;
  }

  return false;
}

export interface CountdownResult {
  formatted: string; // "00:42:15"
  shortText: string; // "Faltam 42m" ou "Horário atingido"
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
  isPastOrDue: boolean;
}

/**
 * Calcula a contagem regressiva em tempo real até o horário agendado
 */
export function calculateScheduledCountdown(
  scheduledTime?: string,
  scheduledDate?: string
): CountdownResult | null {
  if (!scheduledTime) return null;

  const now = new Date();
  
  // Data e hora do agendamento
  const dateStr = scheduledDate || getLocalDateString();
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = scheduledTime.split(':').map(Number);

  const targetDate = new Date(year, (month || 1) - 1, day, hours, minutes, 0, 0);
  const diffMs = targetDate.getTime() - now.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  const isPastOrDue = diffSec <= 0;
  const absSec = Math.abs(diffSec);

  const h = Math.floor(absSec / 3600);
  const m = Math.floor((absSec % 3600) / 60);
  const s = absSec % 60;

  const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  
  let shortText = '';
  if (diffSec > 0) {
    if (h > 0) {
      shortText = `Faltam ${h}h ${m}m`;
    } else if (m > 0) {
      shortText = `Faltam ${m}m ${s}s`;
    } else {
      shortText = `Faltam ${s}s`;
    }
  } else if (diffSec >= -180) {
    shortText = 'Horário Chegou!';
  } else {
    shortText = `Passou há ${m}m`;
  }

  return {
    formatted,
    shortText,
    hours: h,
    minutes: m,
    seconds: s,
    totalSeconds: diffSec,
    isPastOrDue,
  };
}
