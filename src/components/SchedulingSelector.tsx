import React from 'react';
import { CalendarClock, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { getAllSlotsAvailability, isSchedulingEnabled, SlotAvailability } from '../utils/scheduling';

interface SchedulingSelectorProps {
  selectedSlot: string | null;
  onSelectSlot: (slot: string) => void;
  className?: string;
  isCompact?: boolean;
}

export const SchedulingSelector: React.FC<SchedulingSelectorProps> = ({
  selectedSlot,
  onSelectSlot,
  className = '',
  isCompact = false,
}) => {
  const storeInfo = useStore(state => state.storeInfo);
  const orders = useStore(state => state.orders);

  const enabled = isSchedulingEnabled(storeInfo);

  if (!enabled) {
    return null;
  }

  const slotsAvailability = getAllSlotsAvailability(storeInfo, orders);
  const totalSlots = slotsAvailability.length;
  const fullSlotsCount = slotsAvailability.filter(s => s.isFull).length;
  const availableSlotsCount = totalSlots - fullSlotsCount;

  const maxOrders = storeInfo.schedulingMaxOrdersPerSlot || 4;

  return (
    <div className={`bg-white rounded-2xl sm:rounded-3xl border-2 border-orange-500/20 shadow-md p-3.5 sm:p-5 transition-all ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-stone-100">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0 shadow-xs">
            <CalendarClock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-black text-stone-900 tracking-tight">
                Agendamento de Pedidos
              </h2>
              <span className="bg-orange-600 text-white text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider">
                Obrigatório
              </span>
            </div>
            <p className="text-xs text-stone-500">
              Escolha o horário para retirada. Cada horário tem limite de <strong>{maxOrders} pedidos</strong>.
            </p>
          </div>
        </div>

        {/* Selected Slot Feedback */}
        {selectedSlot ? (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 animate-in fade-in duration-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Agendado para: <strong className="font-mono text-sm">{selectedSlot}</strong></span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Selecione um horário abaixo</span>
          </div>
        )}
      </div>

      {/* Slots grid / horizontal scroll */}
      <div className="mt-3.5">
        <div className="flex items-center justify-between text-[11px] text-stone-500 mb-2 font-medium">
          <span>Horários disponíveis hoje ({availableSlotsCount} abertos de {totalSlots}):</span>
          <span className="text-stone-400">Intervalo de {storeInfo.schedulingIntervalMinutes || 30} min</span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 max-h-56 overflow-y-auto p-1 scrollbar-thin">
          {slotsAvailability.map((slotInfo: SlotAvailability) => {
            const isSelected = selectedSlot === slotInfo.slot;
            const isFull = slotInfo.isFull;

            return (
              <button
                key={slotInfo.slot}
                type="button"
                disabled={isFull}
                onClick={() => {
                  if (!isFull) {
                    onSelectSlot(slotInfo.slot);
                  }
                }}
                className={`
                  relative flex flex-col items-center justify-center py-2 px-2 rounded-xl text-center transition-all cursor-pointer border
                  ${isSelected
                    ? 'bg-orange-600 text-white border-orange-600 shadow-md ring-2 ring-orange-400/50 scale-[1.03] z-10'
                    : isFull
                    ? 'bg-stone-100 text-stone-400 border-stone-200/80 cursor-not-allowed opacity-60'
                    : 'bg-stone-50 hover:bg-orange-50 text-stone-800 border-stone-200 hover:border-orange-300'
                  }
                `}
              >
                <div className="flex items-center gap-1 text-xs sm:text-sm font-black font-mono">
                  <Clock className={`w-3 h-3 ${isSelected ? 'text-white' : isFull ? 'text-stone-400' : 'text-orange-500'}`} />
                  <span>{slotInfo.slot}</span>
                </div>

                <div className="mt-1">
                  {isFull ? (
                    <span className="text-[9px] font-bold uppercase tracking-wider text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.2 rounded-md">
                      Esgotado
                    </span>
                  ) : (
                    <span className={`text-[9px] font-bold tracking-tight ${
                      isSelected 
                        ? 'text-orange-100' 
                        : slotInfo.availableCount === 1 
                        ? 'text-amber-700 bg-amber-100/80 px-1 py-0.2 rounded-md' 
                        : 'text-stone-500'
                    }`}>
                      {slotInfo.availableCount} {slotInfo.availableCount === 1 ? 'vaga' : 'vagas'}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
