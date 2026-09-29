export interface DaySchedule {
  dayOfWeek: number; // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
  dayName: string;
  shortName: string;
  isOpen: boolean;
  openTime: string; // "HH:MM" e.g. "06:00"
  closeTime: string; // "HH:MM" e.g. "20:00"
  hasBreak?: boolean;
  breakStart?: string;
  breakEnd?: string;
}

export const DEFAULT_WEEKLY_SCHEDULE: DaySchedule[] = [
  { dayOfWeek: 0, dayName: 'Domingo', shortName: 'Dom', isOpen: true, openTime: '07:00', closeTime: '13:00' },
  { dayOfWeek: 1, dayName: 'Segunda-feira', shortName: 'Seg', isOpen: true, openTime: '06:00', closeTime: '20:00' },
  { dayOfWeek: 2, dayName: 'Terça-feira', shortName: 'Ter', isOpen: true, openTime: '06:00', closeTime: '20:00' },
  { dayOfWeek: 3, dayName: 'Quarta-feira', shortName: 'Qua', isOpen: true, openTime: '06:00', closeTime: '20:00' },
  { dayOfWeek: 4, dayName: 'Quinta-feira', shortName: 'Qui', isOpen: true, openTime: '06:00', closeTime: '20:00' },
  { dayOfWeek: 5, dayName: 'Sexta-feira', shortName: 'Sex', isOpen: true, openTime: '06:00', closeTime: '20:00' },
  { dayOfWeek: 6, dayName: 'Sábado', shortName: 'Sáb', isOpen: true, openTime: '06:00', closeTime: '20:00' },
];

export function parseWeeklySchedule(raw: any): DaySchedule[] {
  if (!raw) return DEFAULT_WEEKLY_SCHEDULE;
  
  let scheduleArray: any = raw;
  if (typeof raw === 'string') {
    try {
      scheduleArray = JSON.parse(raw);
    } catch {
      return DEFAULT_WEEKLY_SCHEDULE;
    }
  }

  if (!Array.isArray(scheduleArray) || scheduleArray.length === 0) {
    return DEFAULT_WEEKLY_SCHEDULE;
  }

  // Ensure all 7 days are present and properly structured
  return DEFAULT_WEEKLY_SCHEDULE.map((defaultDay) => {
    const found = scheduleArray.find((d: any) => d.dayOfWeek === defaultDay.dayOfWeek);
    if (!found) return defaultDay;
    return {
      dayOfWeek: defaultDay.dayOfWeek,
      dayName: defaultDay.dayName,
      shortName: defaultDay.shortName,
      isOpen: found.isOpen !== false,
      openTime: found.openTime || defaultDay.openTime,
      closeTime: found.closeTime || defaultDay.closeTime,
      hasBreak: !!found.hasBreak,
      breakStart: found.breakStart || '',
      breakEnd: found.breakEnd || '',
    };
  });
}

export function formatWeeklyScheduleSummary(schedule: DaySchedule[]): string {
  if (!schedule || schedule.length === 0) return '';

  const openDays = schedule.filter(d => d.isOpen);
  if (openDays.length === 0) return 'Temporariamente Fechado';

  // Group days with identical hours
  const groups: { days: string[]; hours: string }[] = [];

  schedule.forEach((day) => {
    const hours = day.isOpen ? `${day.openTime} às ${day.closeTime}` : 'Fechado';
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.hours === hours) {
      lastGroup.days.push(day.shortName);
    } else {
      groups.push({ days: [day.shortName], hours });
    }
  });

  return groups.map(g => {
    const dayLabel = g.days.length === 1 
      ? g.days[0] 
      : `${g.days[0]} a ${g.days[g.days.length - 1]}`;
    return `${dayLabel}: ${g.hours}`;
  }).join(' • ');
}

export interface StoreCurrentStatus {
  isOpenNow: boolean;
  isWithinSchedule: boolean;
  isManualOverride?: boolean;
  manualOverrideType?: 'open' | 'closed';
  statusBadge: string;
  details: string;
  todaySchedule: DaySchedule;
  currentTimeString: string;
  nextChangeText?: string;
}

export function isWithinOperatingHours(weeklyScheduleRaw: any): boolean {
  const schedule = parseWeeklySchedule(weeklyScheduleRaw);
  const now = new Date();
  
  let currentDayOfWeek = 1;
  let currentHour = 12;
  let currentMinute = 0;

  try {
    const brazilDateStr = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
    const brazilDate = new Date(brazilDateStr);
    currentDayOfWeek = brazilDate.getDay();
    currentHour = brazilDate.getHours();
    currentMinute = brazilDate.getMinutes();
  } catch {
    currentDayOfWeek = now.getDay();
    currentHour = now.getHours();
    currentMinute = now.getMinutes();
  }

  const currentMinutesFromMidnight = currentHour * 60 + currentMinute;
  const today = schedule.find(d => d.dayOfWeek === currentDayOfWeek) || schedule[0];

  if (!today || !today.isOpen) return false;

  const [openH, openM] = today.openTime.split(':').map(Number);
  const [closeH, closeM] = today.closeTime.split(':').map(Number);
  const openMinutes = (openH || 0) * 60 + (openM || 0);
  const closeMinutes = (closeH || 0) * 60 + (closeM || 0);

  let isOpenByTime = currentMinutesFromMidnight >= openMinutes && currentMinutesFromMidnight < closeMinutes;

  if (isOpenByTime && today.hasBreak && today.breakStart && today.breakEnd) {
    const [bStartH, bStartM] = today.breakStart.split(':').map(Number);
    const [bEndH, bEndM] = today.breakEnd.split(':').map(Number);
    const bStartMin = (bStartH || 0) * 60 + (bStartM || 0);
    const bEndMin = (bEndH || 0) * 60 + (bEndM || 0);
    if (currentMinutesFromMidnight >= bStartMin && currentMinutesFromMidnight < bEndMin) {
      isOpenByTime = false;
    }
  }

  return isOpenByTime;
}

export function getStoreCurrentStatus(
  weeklyScheduleRaw: any, 
  manualIsOpen: boolean = true, 
  autoOpenClose: boolean = true,
  forceOpen: boolean = false
): StoreCurrentStatus {
  const schedule = parseWeeklySchedule(weeklyScheduleRaw);

  // Get current date/time in Brazilian timezone (America/Sao_Paulo / UTC-3)
  const now = new Date();
  
  // Calculate day of week and current time in Brazil (America/Sao_Paulo)
  let currentDayOfWeek = 1;
  let currentHour = 12;
  let currentMinute = 0;

  try {
    const brazilDateStr = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
    const brazilDate = new Date(brazilDateStr);
    currentDayOfWeek = brazilDate.getDay(); // 0 = Dom, 1 = Seg, ...
    currentHour = brazilDate.getHours();
    currentMinute = brazilDate.getMinutes();
  } catch {
    // Fallback to local time if timezone is not supported
    currentDayOfWeek = now.getDay();
    currentHour = now.getHours();
    currentMinute = now.getMinutes();
  }

  const currentMinutesFromMidnight = currentHour * 60 + currentMinute;
  const currentTimeString = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

  const today = schedule.find(d => d.dayOfWeek === currentDayOfWeek) || schedule[0];

  // Calculate strict time-based schedule availability
  let isWithinSchedule = false;
  if (today && today.isOpen) {
    const [openH, openM] = today.openTime.split(':').map(Number);
    const [closeH, closeM] = today.closeTime.split(':').map(Number);
    const openMinutes = (openH || 0) * 60 + (openM || 0);
    const closeMinutes = (closeH || 0) * 60 + (closeM || 0);

    isWithinSchedule = currentMinutesFromMidnight >= openMinutes && currentMinutesFromMidnight < closeMinutes;

    if (isWithinSchedule && today.hasBreak && today.breakStart && today.breakEnd) {
      const [bStartH, bStartM] = today.breakStart.split(':').map(Number);
      const [bEndH, bEndM] = today.breakEnd.split(':').map(Number);
      const bStartMin = (bStartH || 0) * 60 + (bStartM || 0);
      const bEndMin = (bEndH || 0) * 60 + (bEndM || 0);
      if (currentMinutesFromMidnight >= bStartMin && currentMinutesFromMidnight < bEndMin) {
        isWithinSchedule = false;
      }
    }
  }

  // 1. If manual open is set to false, it is always closed by owner
  if (manualIsOpen === false) {
    return {
      isOpenNow: false,
      isWithinSchedule,
      isManualOverride: true,
      manualOverrideType: 'closed',
      statusBadge: 'Fechado',
      details: 'Loja fechada temporariamente no painel de controle (apenas visualização)',
      todaySchedule: today,
      currentTimeString,
    };
  }

  // 2. If forceOpen is active, store is manually open even outside scheduled hours
  if (forceOpen === true) {
    return {
      isOpenNow: true,
      isWithinSchedule,
      isManualOverride: true,
      manualOverrideType: 'open',
      statusBadge: 'Aberto Manualmente',
      details: isWithinSchedule
        ? `Aberto (Escala normal ${today.openTime} às ${today.closeTime})`
        : 'Abertura manual ativa no painel (recebendo pedidos fora do horário programado)',
      todaySchedule: today,
      currentTimeString,
    };
  }

  // 3. If automatic schedule enforcement is disabled, trust manualIsOpen
  if (autoOpenClose === false) {
    return {
      isOpenNow: manualIsOpen,
      isWithinSchedule,
      isManualOverride: true,
      manualOverrideType: manualIsOpen ? 'open' : 'closed',
      statusBadge: manualIsOpen ? 'Aberto Agora' : 'Fechado',
      details: manualIsOpen 
        ? (today.isOpen ? `Hoje até às ${today.closeTime}` : 'Atendimento manual ativo')
        : 'Loja marcada como fechada no painel',
      todaySchedule: today,
      currentTimeString,
    };
  }

  // 4. Automatic calculation based on schedule
  if (!today.isOpen) {
    // Find next open day
    let nextDayIndex = (currentDayOfWeek + 1) % 7;
    let nextDay = schedule.find(d => d.dayOfWeek === nextDayIndex);
    let daysAhead = 1;
    while (nextDay && !nextDay.isOpen && daysAhead < 7) {
      nextDayIndex = (nextDayIndex + 1) % 7;
      nextDay = schedule.find(d => d.dayOfWeek === nextDayIndex);
      daysAhead++;
    }

    return {
      isOpenNow: false,
      isWithinSchedule: false,
      isManualOverride: false,
      statusBadge: 'Fechado Hoje',
      details: `Fechado aos ${today.dayName}s.${nextDay ? ` Abre ${daysAhead === 1 ? 'amanhã' : nextDay.dayName} às ${nextDay.openTime}` : ''}`,
      todaySchedule: today,
      currentTimeString,
      nextChangeText: nextDay ? `Abre ${daysAhead === 1 ? 'amanhã' : nextDay.dayName} às ${nextDay.openTime}` : 'Consulte os horários da semana',
    };
  }

  const [openH, openM] = today.openTime.split(':').map(Number);
  const openMinutes = (openH || 0) * 60 + (openM || 0);

  const isOpenNow = isWithinSchedule && manualIsOpen;

  let statusBadge = 'Fechado';
  let details = '';

  if (isOpenNow) {
    statusBadge = 'Aberto Agora';
    details = `Aberto hoje das ${today.openTime} às ${today.closeTime}`;
  } else if (currentMinutesFromMidnight < openMinutes) {
    statusBadge = 'Fechado Agora';
    details = `Fora do horário de atendimento. Abre hoje às ${today.openTime}`;
  } else {
    // Find next open day
    let nextDayIndex = (currentDayOfWeek + 1) % 7;
    let nextDay = schedule.find(d => d.dayOfWeek === nextDayIndex);
    let daysAhead = 1;
    while (nextDay && !nextDay.isOpen && daysAhead < 7) {
      nextDayIndex = (nextDayIndex + 1) % 7;
      nextDay = schedule.find(d => d.dayOfWeek === nextDayIndex);
      daysAhead++;
    }
    statusBadge = 'Fechado Agora';
    details = nextDay 
      ? `Fora do horário de atendimento. Abre ${daysAhead === 1 ? 'amanhã' : nextDay.dayName} às ${nextDay.openTime}` 
      : 'Fora do horário de atendimento. Cardápio disponível para visualização.';
  }

  return {
    isOpenNow,
    isWithinSchedule,
    isManualOverride: false,
    statusBadge,
    details,
    todaySchedule: today,
    currentTimeString,
  };
}
