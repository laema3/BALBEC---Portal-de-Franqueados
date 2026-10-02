import { Order, StoreInfo } from '../store/useStore';

export interface SlotAvailability {
  slot: string;
  bookedCount: number;
  availableCount: number;
  isFull: boolean;
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
 * Retorna a data no formato YYYY-MM-DD local
 */
export function getLocalDateString(timestamp: number = Date.now()): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Retorna a disponibilidade de um slot específico
 */
export function getSlotAvailability(
  slot: string,
  orders: Order[],
  maxPerSlot = 4,
  targetDateStr?: string
): SlotAvailability {
  const dateStr = targetDateStr || getLocalDateString();
  const cap = Math.max(1, maxPerSlot || 4);

  // Filtra pedidos não cancelados que foram agendados para este slot hoje
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

  return {
    slot,
    bookedCount,
    availableCount,
    isFull,
    orders: bookedOrders,
  };
}

/**
 * Retorna a disponibilidade de todos os slots gerados
 */
export function getAllSlotsAvailability(
  storeInfo: StoreInfo,
  orders: Order[],
  targetDateStr?: string
): SlotAvailability[] {
  const startTime = storeInfo.schedulingStartTime || '09:00';
  const endTime = storeInfo.schedulingEndTime || '20:30';
  const interval = storeInfo.schedulingIntervalMinutes || 30;
  const maxPerSlot = storeInfo.schedulingMaxOrdersPerSlot || 4;

  const slots = generateTimeSlots(startTime, endTime, interval);
  return slots.map(s => getSlotAvailability(s, orders, maxPerSlot, targetDateStr));
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
