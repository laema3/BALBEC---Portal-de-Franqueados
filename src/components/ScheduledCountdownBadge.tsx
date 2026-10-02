import React, { useState, useEffect } from 'react';
import { Clock, Timer, CheckCircle2, AlertTriangle } from 'lucide-react';
import { calculateScheduledCountdown, CountdownResult } from '../utils/scheduling';

interface ScheduledCountdownBadgeProps {
  scheduledTime?: string;
  scheduledDate?: string;
  className?: string;
  variant?: 'badge' | 'card' | 'tv' | 'compact';
  showIcon?: boolean;
  dark?: boolean;
}

export const ScheduledCountdownBadge: React.FC<ScheduledCountdownBadgeProps> = ({
  scheduledTime,
  scheduledDate,
  className = '',
  variant = 'badge',
  showIcon = true,
  dark = false,
}) => {
  const [countdown, setCountdown] = useState<CountdownResult | null>(() => 
    calculateScheduledCountdown(scheduledTime, scheduledDate)
  );

  useEffect(() => {
    if (!scheduledTime) return;

    // Atualiza o cronômetro a cada 1 segundo
    const update = () => {
      setCountdown(calculateScheduledCountdown(scheduledTime, scheduledDate));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [scheduledTime, scheduledDate]);

  if (!scheduledTime || !countdown) return null;

  const isDue = countdown.isPastOrDue;
  const isClose = !isDue && countdown.totalSeconds <= 600; // Menos de 10 minutos

  // Variante CARD (para tela de confirmação de pedido do cliente ou banner da TV)
  if (variant === 'card') {
    if (dark) {
      return (
        <div className={`p-4 rounded-2xl border-2 transition-all ${
          isDue 
            ? 'bg-emerald-950/80 border-emerald-500 text-white' 
            : isClose
            ? 'bg-amber-950/80 border-amber-400 text-white animate-pulse'
            : 'bg-stone-900/90 border-amber-400/80 text-white'
        } ${className}`}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2.5">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                isDue ? 'bg-emerald-500/30 text-emerald-400' : 'bg-amber-500/30 text-amber-400'
              }`}>
                <Timer className="w-5 h-5 animate-spin" style={{ animationDuration: '4s' }} />
              </div>
              <div className="text-left">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-300 block">
                  Horário de Retirada
                </span>
                <strong className="text-lg font-black font-mono text-white">
                  {scheduledTime}
                </strong>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">
                {isDue ? 'Status' : 'Tempo Restante'}
              </span>
              <div className={`text-xl sm:text-2xl font-black font-mono tracking-wider ${
                isDue ? 'text-emerald-400' : isClose ? 'text-amber-300' : 'text-amber-400'
              }`}>
                {isDue ? 'No Horário!' : countdown.formatted}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs font-semibold">
            <span className="flex items-center gap-1.5 text-stone-200">
              {isDue ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Horário atingido! O pedido já pode ser retirado.</span>
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Contagem regressiva: <strong className="text-amber-300">{countdown.shortText}</strong></span>
                </>
              )}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div className={`p-4 rounded-2xl border-2 transition-all ${
        isDue 
          ? 'bg-emerald-50 border-emerald-300 text-emerald-950' 
          : isClose
          ? 'bg-amber-50 border-amber-300 text-amber-950 animate-pulse'
          : 'bg-orange-50 border-orange-200 text-orange-950'
      } ${className}`}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
              isDue ? 'bg-emerald-200 text-emerald-800' : 'bg-orange-200 text-orange-800'
            }`}>
              <Timer className="w-4 h-4 animate-spin" style={{ animationDuration: '4s' }} />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-stone-500 block">
                Horário de Retirada
              </span>
              <strong className="text-base font-black font-mono">
                {scheduledTime}
              </strong>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
              {isDue ? 'Status' : 'Tempo Restante'}
            </span>
            <div className={`text-xl sm:text-2xl font-black font-mono tracking-wider ${
              isDue ? 'text-emerald-700' : isClose ? 'text-amber-700' : 'text-orange-600'
            }`}>
              {isDue ? 'No Horário!' : countdown.formatted}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-stone-200/60 text-xs font-semibold">
          <span className="flex items-center gap-1.5">
            {isDue ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Horário atingido! Seu pedido está sendo chamado.</span>
              </>
            ) : (
              <>
                <Clock className="w-3.5 h-3.5 text-orange-600" />
                <span>Contagem regressiva em tempo real: <strong>{countdown.shortText}</strong></span>
              </>
            )}
          </span>
        </div>
      </div>
    );
  }

  // Variante TV (para exibição na tela da Smart TV)
  if (variant === 'tv') {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-bold shadow-xs ${
        isDue
          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
          : isClose
          ? 'bg-amber-500/25 text-amber-300 border border-amber-400/50 animate-pulse'
          : 'bg-orange-500/20 text-orange-300 border border-orange-400/40'
      } ${className}`}>
        {showIcon && <Clock className="w-3 h-3 text-amber-400 shrink-0" />}
        <span>{scheduledTime}</span>
        <span className="text-stone-400">•</span>
        <span className={isDue ? 'text-emerald-300' : 'text-white'}>
          {isDue ? 'No Horário' : countdown.formatted}
        </span>
      </div>
    );
  }

  // Variante COMPACT (para cabeçalhos e listas compactas)
  if (variant === 'compact') {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-black ${
        isDue 
          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
          : 'bg-orange-100 text-orange-900 border border-orange-300'
      } ${className}`}>
        {showIcon && <Timer className="w-3 h-3" />}
        <span>{scheduledTime}</span>
        <span>({isDue ? 'Chegou' : countdown.formatted})</span>
      </span>
    );
  }

  // Variante PADRÃO (Badge com contador regressivo)
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono font-bold border shadow-xs ${
      isDue
        ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
        : isClose
        ? 'bg-amber-50 text-amber-900 border-amber-300 animate-pulse'
        : 'bg-orange-50 text-orange-900 border-orange-200'
    } ${className}`}>
      {showIcon && (
        <Timer className={`w-3.5 h-3.5 ${
          isDue ? 'text-emerald-600' : isClose ? 'text-amber-600' : 'text-orange-600'
        }`} />
      )}
      <span className="font-bold">
        {scheduledTime}
      </span>
      <span className="text-stone-300 font-sans">•</span>
      <span className={`font-black ${
        isDue ? 'text-emerald-700' : isClose ? 'text-amber-700' : 'text-orange-700'
      }`}>
        {isDue ? 'Horário Chegou!' : `${countdown.formatted} restantes`}
      </span>
    </div>
  );
};
