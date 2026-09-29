import React, { useMemo, useState } from 'react';
import { Order, StoreInfo } from '../store/useStore';
import { getFullReceiptHTML, printViaRawBT, getRawBTIntentUrl, getActiveOrderPrinter, resolveItemCode, resolveAddonCode } from '../utils/printer';
import { Printer, X, Copy, Check, ExternalLink, Loader2 } from 'lucide-react';

interface ReceiptModalProps {
  order: Order | null;
  storeInfo: StoreInfo;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ order, storeInfo, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  if (!order) return null;

  const activePrinter = getActiveOrderPrinter(storeInfo);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
  };

  const customerNameStr = order.customerName ? order.customerName.trim().toUpperCase() : 'CLIENTE';
  const orderNumber = order.id ? String(order.id).slice(-4).padStart(4, '0') : '0001';
  const storeName = (storeInfo?.name || 'PÃO MANIA').toUpperCase();
  const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');
  const items = Array.isArray(order.items) ? order.items : [];

  const rawbtIntentUrl = useMemo(() => {
    if (!order) return '';
    return getRawBTIntentUrl(order, storeInfo);
  }, [order, storeInfo]);

  const receiptBlobUrl = useMemo(() => {
    const html = getFullReceiptHTML(order, storeInfo, true);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    return URL.createObjectURL(blob);
  }, [order, storeInfo]);

  const handlePrint = () => {
    setIsPrinting(true);
    try {
      printViaRawBT(order, storeInfo, false);
    } catch (e) {
      console.warn('Erro ao disparar RawBT:', e);
    } finally {
      setTimeout(() => setIsPrinting(false), 1200);
    }
  };

  const handleCopyText = () => {
    const text = `
*${storeName}*
------------------------------
*CLIENTE:* ${customerNameStr}
*PEDIDO #${orderNumber}*
${order.customerPhone ? `Tel: ${order.customerPhone}` : ''}
${order.deliveryAddress ? `End: ${order.deliveryAddress}` : ''}
Data: ${orderDate}
Tipo: ${order.type === 'kiosk' ? 'Quiosque' : (order.deliveryType === 'delivery' ? 'Entrega' : 'Retirada')}
------------------------------
${items.map(item => {
  const itemCode = resolveItemCode(item);
  const codeStr = itemCode ? ` [CÓD: ${itemCode}]` : '';
  const descStr = item.description ? `\n   ${item.description}` : '';
  const flavorCode = resolveAddonCode(item.flavor);
  const flavorStr = item.flavor ? `\n   • Sabor: ${item.flavor.name}${flavorCode ? ` [CÓD: ${flavorCode}]` : ''}` : '';
  const addonsStr = item.addons && item.addons.length > 0 
    ? '\n   ' + item.addons.map(a => {
        const aCode = resolveAddonCode(a);
        return `+ ${a.name}${aCode ? ` [CÓD: ${aCode}]` : ''}`;
      }).join('\n   ')
    : '';
  return `${item.quantity || 1}x ${item.name}${codeStr} - ${formatCurrency(((item.price || 0) + (item.flavor?.price || 0) + (item.addons?.reduce((s, a) => s + (a.price || 0), 0) || 0)) * (item.quantity || 1))}${descStr}${flavorStr}${addonsStr}`;
}).join('\n')}
------------------------------
*TOTAL : ${formatCurrency(order.total || 0)}*
Pagamento: ${order.paymentMethod || 'Não informado'}
------------------------------
    `.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header do Modal */}
        <div className="p-4 bg-stone-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm sm:text-base">
            <Printer className="w-5 h-5 text-orange-400" />
            <span>Cupom do Pedido #{orderNumber}</span>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-white p-1 rounded-lg hover:bg-stone-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Indicador de Impressora Configurada no Sistema */}
        <div className="bg-amber-50 px-4 py-2.5 border-b border-amber-200/80 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Printer className="w-4 h-4 text-orange-600 shrink-0" />
            <span className="text-stone-700 font-medium truncate">
              Impressora: <strong className="text-stone-900 font-bold">{activePrinter.name}</strong>
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border border-blue-200">
              RawBT
            </span>
            <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border border-amber-200">
              Windows
            </span>
          </div>
        </div>

        {/* Visualização de Uma Via Exata e Limpa */}
        <div className="p-4 overflow-y-auto bg-stone-100 flex justify-center">
          <div className="bg-white p-4 shadow-sm border border-stone-200 w-full max-w-[280px] font-mono text-xs text-stone-900 leading-relaxed rounded-sm">
            <div className="text-center font-bold text-sm tracking-wide mb-1">{storeName}</div>
            
            <div className="bg-black text-white p-2 my-2 text-center rounded-sm">
              {order.type !== 'kiosk' && order.customerName && order.customerName.trim() !== '' && order.customerName.trim().toUpperCase() !== 'CLIENTE' && (
                <div className="font-black text-xs uppercase tracking-wide break-words mb-0.5">
                  CLIENTE: {customerNameStr}
                </div>
              )}
              <div className="font-black text-sm tracking-wider">
                PEDIDO #{orderNumber}
              </div>
            </div>

            {order.customerPhone && <div className="text-center text-[11px]">Tel: {order.customerPhone}</div>}
            {order.deliveryAddress && <div className="text-center text-[11px] break-words">End: {order.deliveryAddress}</div>}
            
            <div className="text-center text-[11px] mt-1">{orderDate}</div>
            <div className="text-center text-[11px] font-bold mt-0.5">
              {order.type === 'kiosk' ? 'Tipo: Retirada no Balcão (Totem)' : (order.deliveryType === 'delivery' ? 'Tipo: Entrega em Domicílio' : 'Tipo: Retirada no Balcão')}
            </div>

            <div className="border-t border-dashed border-black my-2"></div>

            <div className="space-y-1.5">
              {items.map((item, idx) => {
                const itemCode = resolveItemCode(item);
                return (
                <div key={idx}>
                  <div className="flex justify-between items-start font-bold">
                    <span className="break-words pr-2">{item.quantity || 1}x {item.name}</span>
                    <span className="whitespace-nowrap">{formatCurrency(((item.price || 0) + (item.flavor?.price || 0) + (item.addons?.reduce((s, a) => s + (a.price || 0), 0) || 0)) * (item.quantity || 1))}</span>
                  </div>
                  {itemCode && (
                    <div className="text-[11px] pl-2 my-1">
                      <span className="bg-black text-white px-1.5 py-0.5 rounded font-mono font-bold text-[10px]">
                        CÓD: {itemCode}
                      </span>
                    </div>
                  )}
                  {item.description && (
                    <div className="text-[10px] pl-2 text-stone-600 font-light italic leading-tight mt-0.5">
                      {item.description}
                    </div>
                  )}
                  {item.flavor && (
                    <div className="text-[10px] pl-2 text-stone-700">
                      • Sabor: <span className="font-semibold">{item.flavor.name}</span>
                      {resolveAddonCode(item.flavor) && (
                        <span className="font-mono font-bold text-white bg-black px-1 py-0.5 rounded text-[9px] ml-1">
                          CÓD: {resolveAddonCode(item.flavor)}
                        </span>
                      )}
                    </div>
                  )}
                  {item.addons && item.addons.length > 0 && (
                    <div className="text-[10px] pl-2 text-stone-700 space-y-0.5 mt-0.5">
                      {item.addons.map((a, aIdx) => {
                        const aCode = resolveAddonCode(a);
                        return (
                          <div key={aIdx}>
                            + <span>{a.name}</span>
                            {aCode && (
                              <span className="font-mono font-bold text-white bg-black px-1 py-0.5 rounded text-[9px] ml-1">
                                CÓD: {aCode}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
              })}
            </div>

            <div className="border-t border-dashed border-black my-2"></div>

            <div className="flex justify-between items-center font-bold text-sm">
              <span>TOTAL :</span>
              <span>{formatCurrency(order.total || 0)}</span>
            </div>

            <div className="text-center text-[11px] font-bold mt-1">
              Pagamento: {order.paymentMethod || 'Não informado'}
            </div>

            <div className="border-t-2 border-black my-2"></div>
            <div className="text-center font-bold text-[10px]">*** OBRIGADO PELA PREFERÊNCIA ***</div>
            
            <div className="mt-3 pt-2 border-t border-dashed border-black text-left">
              <div className="font-bold text-[11px] tracking-wide uppercase">OUTROS PRODUTOS</div>
              <div className="h-[5cm] min-h-[5cm]"></div>
            </div>

            <div className="text-center font-bold text-xs mt-1 text-stone-500">
              ✂ - - - - - - - - - - - - ✂
            </div>
          </div>
        </div>

        {/* Rodapé e Ações */}
        <div className="p-3 bg-white border-t border-stone-200 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyText}
            className="bg-stone-100 text-stone-700 hover:bg-stone-200 py-2.5 px-3 rounded-xl font-medium text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            title="Copiar texto do pedido para colar no WhatsApp"
          >
            {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Copiado!' : 'Copiar'}</span>
          </button>
          
          <a
            href={rawbtIntentUrl}
            onClick={handlePrint}
            className="flex-1 bg-orange-600 hover:bg-orange-700 active:scale-[0.98] text-white py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer select-none"
            title="Imprimir Cupom via RawBT"
          >
            {isPrinting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            <span>{isPrinting ? 'Enviando ao RawBT...' : 'Imprimir Cupom (RawBT)'}</span>
          </a>

          <a
            href={receiptBlobUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-stone-100 hover:bg-stone-200 text-stone-600 p-2.5 rounded-xl flex items-center justify-center transition-colors cursor-pointer"
            title="Abrir em Nova Aba"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
};
