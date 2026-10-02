import React, { useState, useMemo } from 'react';
import { 
  CalendarClock, Clock, CheckCircle2, AlertCircle, Save, 
  Users, ShoppingBag, Eye, RefreshCw, Filter, ShieldCheck, 
  Calendar, Check, X
} from 'lucide-react';
import { useStore, StoreInfo, Order } from '../store/useStore';
import { getAllSlotsAvailability, getLocalDateString, isSchedulingEnabled, SlotAvailability } from '../utils/scheduling';

interface SchedulingManagerTabProps {
  onViewOrder?: (order: Order) => void;
}

export const SchedulingManagerTab: React.FC<SchedulingManagerTabProps> = ({ onViewOrder }) => {
  const { storeInfo, updateStoreInfo, orders, fetchData } = useStore();

  const isEnabled = isSchedulingEnabled(storeInfo);

  const [schedulingEnabled, setSchedulingEnabled] = useState<boolean>(isEnabled);
  const [startTime, setStartTime] = useState<string>(storeInfo.schedulingStartTime || '09:00');
  const [endTime, setEndTime] = useState<string>(storeInfo.schedulingEndTime || '20:30');
  const [intervalMinutes, setIntervalMinutes] = useState<number>(storeInfo.schedulingIntervalMinutes || 30);
  const [maxOrdersPerSlot, setMaxOrdersPerSlot] = useState<number>(storeInfo.schedulingMaxOrdersPerSlot || 4);

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [selectedSlotDetails, setSelectedSlotDetails] = useState<SlotAvailability | null>(null);

  // Sync state when storeInfo updates
  React.useEffect(() => {
    setSchedulingEnabled(isSchedulingEnabled(storeInfo));
    if (storeInfo.schedulingStartTime) setStartTime(storeInfo.schedulingStartTime);
    if (storeInfo.schedulingEndTime) setEndTime(storeInfo.schedulingEndTime);
    if (storeInfo.schedulingIntervalMinutes) setIntervalMinutes(storeInfo.schedulingIntervalMinutes);
    if (storeInfo.schedulingMaxOrdersPerSlot) setMaxOrdersPerSlot(storeInfo.schedulingMaxOrdersPerSlot);
  }, [storeInfo]);

  const handleToggleModule = async (newVal: boolean) => {
    setSchedulingEnabled(newVal);
    let mod: any = {};
    if (typeof storeInfo.modulesConfig === 'string') {
      try { mod = JSON.parse(storeInfo.modulesConfig); } catch {}
    } else if (typeof storeInfo.modulesConfig === 'object' && storeInfo.modulesConfig !== null) {
      mod = { ...storeInfo.modulesConfig };
    }
    mod.scheduling = newVal;

    try {
      await updateStoreInfo({
        schedulingEnabled: newVal,
        modulesConfig: mod,
      });
    } catch (e) {
      console.error('Erro ao atualizar agendamento:', e);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    let mod: any = {};
    if (typeof storeInfo.modulesConfig === 'string') {
      try { mod = JSON.parse(storeInfo.modulesConfig); } catch {}
    } else if (typeof storeInfo.modulesConfig === 'object' && storeInfo.modulesConfig !== null) {
      mod = { ...storeInfo.modulesConfig };
    }
    mod.scheduling = schedulingEnabled;

    try {
      await updateStoreInfo({
        schedulingEnabled,
        schedulingStartTime: startTime,
        schedulingEndTime: endTime,
        schedulingIntervalMinutes: Number(intervalMinutes) || 30,
        schedulingMaxOrdersPerSlot: Number(maxOrdersPerSlot) || 4,
        modulesConfig: mod,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Erro ao salvar agendamento:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const todayStr = useMemo(() => getLocalDateString(), []);
  const slotsAvailability = useMemo(() => {
    return getAllSlotsAvailability(storeInfo, orders, todayStr);
  }, [storeInfo, orders, todayStr]);

  const totalSlots = slotsAvailability.length;
  const totalCapacity = totalSlots * (storeInfo.schedulingMaxOrdersPerSlot || 4);
  const totalBookedOrders = useMemo(() => {
    return slotsAvailability.reduce((sum, s) => sum + s.bookedCount, 0);
  }, [slotsAvailability]);
  const fullSlotsCount = useMemo(() => {
    return slotsAvailability.filter(s => s.isFull).length;
  }, [slotsAvailability]);

  return (
    <div className="space-y-6">
      {/* Top Banner / Card */}
      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-stone-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0 shadow-xs">
            <CalendarClock className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black text-stone-900">
                Módulo de Agendamento
              </h1>
              <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                schedulingEnabled 
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                  : 'bg-stone-200 text-stone-600'
              }`}>
                {schedulingEnabled ? 'Módulo Ativo' : 'Módulo Desativado'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-stone-500 mt-0.5">
              Permite que os clientes agendem um horário específico para retirada com vagas limitadas por faixa de horário.
            </p>
          </div>
        </div>

        {/* Big Switch Toggle */}
        <div className="flex items-center gap-3 bg-stone-50 p-2.5 rounded-2xl border border-stone-200/80 self-start md:self-auto">
          <span className="text-xs font-bold text-stone-700">
            {schedulingEnabled ? 'Habilitado no Cardápio' : 'Desabilitado no Cardápio'}
          </span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              checked={schedulingEnabled}
              onChange={(e) => handleToggleModule(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-12 h-7 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5.5 after:w-5.5 after:transition-all peer-checked:bg-orange-600"></div>
          </label>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Horários Configurados</span>
            <Clock className="w-4 h-4 text-orange-500" />
          </div>
          <div className="text-2xl font-black text-stone-900 font-mono">
            {totalSlots}
          </div>
          <span className="text-[11px] text-stone-400">
            {startTime} até {endTime} ({intervalMinutes} min)
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Vagas Totais do Dia</span>
            <Users className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black text-stone-900 font-mono">
            {totalCapacity}
          </div>
          <span className="text-[11px] text-stone-400">
            {maxOrdersPerSlot} vagas por horário
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Pedidos Agendados Hoje</span>
            <ShoppingBag className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-stone-900 font-mono">
            {totalBookedOrders}
          </div>
          <span className="text-[11px] text-stone-400">
            {Math.max(0, totalCapacity - totalBookedOrders)} vagas restantes
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Horários Esgotados</span>
            <AlertCircle className="w-4 h-4 text-red-500" />
          </div>
          <div className={`text-2xl font-black font-mono ${fullSlotsCount > 0 ? 'text-red-600' : 'text-stone-900'}`}>
            {fullSlotsCount}
          </div>
          <span className="text-[11px] text-stone-400">
            {totalSlots - fullSlotsCount} horários com vagas
          </span>
        </div>
      </div>

      {/* Configuration Form Card */}
      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-stone-200 shadow-xs">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-stone-100">
          <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-orange-600" /> Parâmetros do Agendamento
          </h2>
          {saveSuccess && (
            <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-xl animate-in fade-in">
              <Check className="w-3.5 h-3.5" /> Salvo com sucesso!
            </span>
          )}
        </div>

        <form onSubmit={handleSaveConfig} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold text-stone-700 mb-1">
              Horário Inicial
            </label>
            <input 
              type="time" 
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full p-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-semibold text-stone-800 focus:ring-2 focus:ring-orange-500 outline-none"
              required
            />
            <span className="text-[10px] text-stone-400">Padrão: 09:00</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 mb-1">
              Horário Final
            </label>
            <input 
              type="time" 
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full p-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-semibold text-stone-800 focus:ring-2 focus:ring-orange-500 outline-none"
              required
            />
            <span className="text-[10px] text-stone-400">Padrão: 20:30</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 mb-1">
              Intervalo entre Horários
            </label>
            <select
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              className="w-full p-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-semibold text-stone-800 focus:ring-2 focus:ring-orange-500 outline-none cursor-pointer"
            >
              <option value={15}>15 minutos</option>
              <option value={20}>20 minutos</option>
              <option value={30}>30 minutos (Padrão)</option>
              <option value={45}>45 minutos</option>
              <option value={60}>60 minutos (1 hora)</option>
            </select>
            <span className="text-[10px] text-stone-400">Gera slots de 30 em 30 min</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 mb-1">
              Vagas por Horário (Limite)
            </label>
            <input 
              type="number" 
              min={1}
              max={50}
              value={maxOrdersPerSlot}
              onChange={(e) => setMaxOrdersPerSlot(Number(e.target.value))}
              className="w-full p-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-semibold text-stone-800 focus:ring-2 focus:ring-orange-500 outline-none"
              required
            />
            <span className="text-[10px] text-stone-400">Padrão: 4 pedidos por horário</span>
          </div>

          <div className="sm:col-span-2 lg:col-span-4 flex justify-end mt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Salvando...' : 'Salvar Parâmetros de Agendamento'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Live Slots Capacity Monitor */}
      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-stone-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-stone-100">
          <div>
            <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-orange-600" /> Grade de Horários e Ocupação de Vagas
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Clique em qualquer horário para inspecionar os pedidos agendados correspondentes.
            </p>
          </div>

          <button
            type="button"
            onClick={() => fetchData()}
            className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 rounded-xl text-xs font-semibold text-stone-700 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Atualizar Grade</span>
          </button>
        </div>

        {/* Grid of Slots */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {slotsAvailability.map((slotInfo) => {
            const isFull = slotInfo.isFull;
            const maxCap = storeInfo.schedulingMaxOrdersPerSlot || 4;
            const pct = Math.min(100, (slotInfo.bookedCount / maxCap) * 100);

            return (
              <div 
                key={slotInfo.slot}
                onClick={() => setSelectedSlotDetails(slotInfo)}
                className={`
                  p-3 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between
                  ${isFull
                    ? 'bg-red-50/50 border-red-200 hover:border-red-300'
                    : slotInfo.bookedCount > 0
                    ? 'bg-amber-50/40 border-amber-200 hover:border-amber-300'
                    : 'bg-stone-50/60 border-stone-200 hover:border-orange-300 hover:bg-orange-50/30'
                  }
                `}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono font-black text-sm text-stone-900">
                    {slotInfo.slot}
                  </span>
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${
                    isFull
                      ? 'bg-red-600 text-white'
                      : slotInfo.bookedCount > 0
                      ? 'bg-amber-200 text-amber-900'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {slotInfo.bookedCount}/{maxCap}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-stone-200 rounded-full h-1.5 mb-2 overflow-hidden">
                  <div 
                    className={`h-full transition-all rounded-full ${
                      isFull ? 'bg-red-600' : slotInfo.bookedCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px]">
                  <span className={isFull ? 'text-red-600 font-bold' : 'text-stone-500'}>
                    {isFull ? 'Esgotado' : `${slotInfo.availableCount} vagas livres`}
                  </span>
                  {slotInfo.bookedCount > 0 && (
                    <span className="text-orange-600 font-bold hover:underline">
                      Ver ({slotInfo.bookedCount})
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal for Slot Order Details */}
      {selectedSlotDetails && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-stone-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100 mb-4">
              <div>
                <h3 className="text-base sm:text-lg font-black text-stone-900 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-orange-600" />
                  Horário: {selectedSlotDetails.slot}
                </h3>
                <p className="text-xs text-stone-500">
                  {selectedSlotDetails.bookedCount} de {storeInfo.schedulingMaxOrdersPerSlot || 4} vagas preenchidas
                </p>
              </div>
              <button 
                type="button" 
                onClick={() => setSelectedSlotDetails(null)}
                className="p-1.5 rounded-xl hover:bg-stone-100 text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {selectedSlotDetails.orders.length === 0 ? (
              <div className="py-8 text-center text-stone-400">
                <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-medium">Nenhum pedido agendado para este horário ainda.</p>
                <p className="text-xs text-stone-400 mt-1">Este horário tem {selectedSlotDetails.availableCount} vagas disponíveis.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                {selectedSlotDetails.orders.map((o) => (
                  <div 
                    key={o.id}
                    className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-black text-sm text-stone-900">#{o.id}</span>
                        <span className="font-bold text-xs text-stone-700">{o.customerName || 'Cliente'}</span>
                      </div>
                      <div className="text-[11px] text-stone-500 mt-0.5">
                        {o.items?.length || 0} itens • R$ {Number(o.total || 0).toFixed(2).replace('.', ',')}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        o.status === 'completed' 
                          ? 'bg-emerald-100 text-emerald-800' 
                          : o.status === 'ready' 
                          ? 'bg-blue-100 text-blue-800' 
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {o.status === 'completed' ? 'Concluído' : o.status === 'ready' ? 'Pronto' : 'Em Preparo'}
                      </span>

                      {onViewOrder && (
                        <button
                          type="button"
                          onClick={() => {
                            onViewOrder(o);
                            setSelectedSlotDetails(null);
                          }}
                          className="p-1.5 bg-stone-200 hover:bg-stone-300 rounded-lg text-stone-700 cursor-pointer"
                          title="Ver Pedido"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 pt-3 border-t border-stone-100 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedSlotDetails(null)}
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
