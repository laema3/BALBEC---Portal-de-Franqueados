import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useStore, OrderItem, Order } from '../store/useStore';
import { formatCurrency, formatCapitalized, expandAbbreviations } from '../lib/utils';
import { ShoppingCart, Plus, Minus, Trash2, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Settings, Droplets, Search, X, Printer, User as UserIcon, RefreshCw, Store, Tv, BellRing, Clock, MapPin, KeyRound, ShieldAlert, ShieldCheck, LocateFixed, AlertTriangle, Navigation, UtensilsCrossed, QrCode, Scissors, UserCheck } from 'lucide-react';
import { getCurrentPosition, calculateDistanceMeters, formatDistance } from '../utils/geolocation';
import { ProductImage } from '../components/ProductImage';
import { Link } from 'react-router-dom';
import { BakeryLoader } from '../components/BakeryLoader';
import { MaintenancePage } from '../components/MaintenancePage';
import { shouldExcludeProduct, isExcludedCategory, isAddonCategory, isAddonItem, EXCLUDED_CATEGORIES, normalizeText, cleanProductDescription, formatProductDescriptionWithCode } from '../constants';
import { getSmartProductImage } from '../utils/imageHelper';
import { printReceipt, printViaRawBT, printViaNetworkIp, getNetworkPrinterConfig, getRawBTIntentUrl, resolveItemCode, resolveAddonCode } from '../utils/printer';
import { sendNtfyNotification } from '../utils/ntfy';
import { safeStorage } from '../utils/storage';
import { AiAssistantFloatingButton } from '../components/AiAssistantFloatingButton';
import { getStoreCurrentStatus, parseWeeklySchedule, formatWeeklyScheduleSummary } from '../utils/scheduleHelper';

export default function Menu() {
  const { categories, products, tables, storeInfo, placeOrder, saveCustomer, isInitialized, fetchData } = useStore();
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    fetchData();
    const es = new EventSource('/api/events');
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && (data.type === 'update' || data.type === 'ping' || data.time)) {
          fetchData();
        }
      } catch {}
    };
    return () => {
      es.close();
    };
  }, [fetchData]);

  // Controle de Mesas / Consumo na Loja
  const [selectedTableNumber, setSelectedTableNumber] = useState<number | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTable = params.get('mesa') || params.get('table') || params.get('mesa_num');
      if (urlTable && !isNaN(parseInt(urlTable, 10))) {
        return parseInt(urlTable, 10);
      }
      const saved = safeStorage.getSession('paomania_selected_table');
      if (saved && !isNaN(parseInt(saved, 10))) {
        return parseInt(saved, 10);
      }
    } catch {}
    return null;
  });
  const [showTableSelectModal, setShowTableSelectModal] = useState(false);

  const handleManualSync = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await fetchData();
    } catch (e) {
      console.error('Error refreshing data:', e);
    } finally {
      setIsRefreshing(false);
    }
  };
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const isTotemPath = typeof window !== 'undefined' && (
    window.location.pathname.toLowerCase().startsWith('/totem') || 
    window.location.pathname.toLowerCase().startsWith('/kiosk') ||
    window.location.search.toLowerCase().includes('totem') ||
    window.location.search.toLowerCase().includes('kiosk') ||
    window.location.search.toLowerCase().includes('autoatendimento')
  );

  const [hasName, setHasName] = useState<boolean>(() => {
    try {
      const pathname = window.location.pathname.toLowerCase();
      if (pathname.startsWith('/totem') || pathname.startsWith('/kiosk')) return true;
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode') || params.get('channel') || params.get('tipo');
      if (mode === 'kiosk' || mode === 'totem' || mode === 'autoatendimento') return true;
    } catch {}
    return false;
  });
  const [salesChannel, setSalesChannel] = useState<'delivery' | 'instore' | 'kiosk'>(() => {
    try {
      const pathname = window.location.pathname.toLowerCase();
      if (pathname.startsWith('/totem') || pathname.startsWith('/kiosk')) return 'kiosk';
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode') || params.get('channel') || params.get('tipo');
      if (mode === 'kiosk' || mode === 'totem' || mode === 'autoatendimento') return 'kiosk';
      if (mode === 'delivery' || mode === 'entrega') return 'delivery';
      if (mode === 'instore' || mode === 'loja' || mode === 'presencial') return 'instore';
    } catch {}
    return 'instore';
  });
  const [lastPlacedOrder, setLastPlacedOrder] = useState<Order | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isCheckout, setIsCheckout] = useState(false);
  const [successCountdown, setSuccessCountdown] = useState<number>(15);

  const channelCategoryCounts = useMemo(() => {
    const allCats = Array.isArray(categories) ? categories : [];
    const allProds = Array.isArray(products) ? products : [];

    const getValidCategoriesCount = (channel: 'delivery' | 'instore' | 'kiosk') => {
      return allCats.filter(c => {
        if (!c || !c.id || typeof c.name !== 'string') return false;
        if (c.isVisible === false) return false;
        if (isExcludedCategory(c.name) || isAddonCategory(c.name)) return false;

        const catMatches = 
          channel === 'delivery' ? c.availableForDelivery !== false :
          channel === 'kiosk' ? true :
          c.availableInStore !== false;
        if (!catMatches) return false;

        // Se já houver produtos carregados, garante que a categoria possui itens válidos e ativos (não adicionais ou sabores)
        if (allProds.length > 0) {
          return allProds.some(p => 
            p && p.categoryId === c.id &&
            p.isActive &&
            !p.isFlavor &&
            !p.isAddon &&
            !isAddonItem(p, allCats) &&
            !shouldExcludeProduct(p, allCats)
          );
        }
        return true;
      }).length;
    };

    return {
      delivery: getValidCategoriesCount('delivery'),
      instore: getValidCategoriesCount('instore'),
      kiosk: getValidCategoriesCount('kiosk'),
    };
  }, [categories, products]);

  const hasDeliveryCategories = channelCategoryCounts.delivery > 0;
  const hasInStoreCategories = channelCategoryCounts.instore > 0;
  const hasKioskCategories = channelCategoryCounts.kiosk > 0;

  const currentStatus = getStoreCurrentStatus(
    storeInfo.weeklySchedule,
    storeInfo.isOpen !== false,
    storeInfo.autoOpenClose !== false,
    !!storeInfo.forceOpen
  );

  // Consumo na Loja e Atendimento Totem ficam abertos conforme horário automático ou abertura manual do lojista
  const isPhysicalStoreOpen = currentStatus.isOpenNow;
  const isInStoreActive = isPhysicalStoreOpen && storeInfo.inStoreEnabled !== false;
  const isKioskActive = isPhysicalStoreOpen && storeInfo.kioskEnabled !== false;

  // Delivery fica ativo se estiver habilitado e a loja estiver aberta
  const isDeliveryActive = storeInfo.deliveryEnabled !== false && isPhysicalStoreOpen;

  // Carregar dados do localStorage apenas para pedidos online normais (no Totem, não pede identificação prévia)
  useEffect(() => {
    if (isTotemPath) {
      setCustomerName('');
      setCustomerPhone('');
      setHasName(true);
      return;
    }
    const savedName = safeStorage.getItem('paomania_customer_name');
    const savedPhone = safeStorage.getItem('paomania_customer_phone');
    if (savedName && savedPhone) {
      setCustomerName(savedName);
      setCustomerPhone(savedPhone);
      setHasName(true);
    }
  }, [isTotemPath]);

  // Função central para resetar o totem/aplicativo para o próximo cliente
  const handleResetForNewCustomer = useCallback(() => {
    setIsSuccess(false);
    setIsCheckout(false);
    if (isTotemPath) {
      setHasName(true);
    } else {
      setHasName(false);
    }
    setCustomerName('');
    setCustomerPhone('');
    setLastPlacedOrder(null);
    setCart([]);
    setIsCartOpen(false);
  }, [isTotemPath]);

  // Timer na tela de conclusão / impressão do pedido (15s no totem, 45s no celular para dar tempo do cliente ir ao balcão)
  useEffect(() => {
    if (!isSuccess) return;

    const initialTime = (salesChannel === 'kiosk' || isTotemPath) ? 15 : 45;
    setSuccessCountdown(initialTime);
    const interval = setInterval(() => {
      setSuccessCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleResetForNewCustomer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isSuccess, salesChannel, isTotemPath, handleResetForNewCustomer]);

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    if (numbers.length <= 11) {
      return numbers
        .replace(/^(\d{2})(\d)/g, '($1) $2')
        .replace(/(\d{5})(\d)/, '$1-$2');
    }
    return value;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    if (formatted.length <= 15) {
      setCustomerPhone(formatted);
    }
  };

  // Opções de canais visíveis na seleção pública ao iniciar (só aparecem se tiverem pelo menos 1 categoria ativa)
  const visibleChannels: ('delivery' | 'instore')[] = useMemo(() => {
    const list: ('delivery' | 'instore')[] = [];
    if (hasInStoreCategories) list.push('instore');
    if (hasDeliveryCategories) list.push('delivery');
    return list;
  }, [hasInStoreCategories, hasDeliveryCategories]);

  const activeAvailableChannels: ('delivery' | 'instore')[] = [];
  if (isDeliveryActive) activeAvailableChannels.push('delivery');
  if (isInStoreActive) activeAvailableChannels.push('instore');

  const [hasChosenChannel, setHasChosenChannel] = useState<boolean>(() => {
    try {
      if (!Array.isArray(categories) || categories.length === 0) return true;
      const pathname = window.location.pathname.toLowerCase();
      if (pathname.startsWith('/totem') || pathname.startsWith('/kiosk')) return true;
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode') || params.get('channel') || params.get('tipo');
      if (mode === 'instore' || mode === 'loja' || mode === 'presencial' || mode === 'delivery' || mode === 'entrega') {
        return true;
      }
      if (mode === 'kiosk' || mode === 'totem' || mode === 'autoatendimento') {
        return true;
      }
    } catch {}
    const saved = safeStorage.getSession('selected_sales_channel');
    return saved === 'delivery' || saved === 'instore' || saved === 'kiosk';
  });

  const [isQrValidated, setIsQrValidated] = useState<boolean>(() => {
    try {
      const pathname = window.location.pathname.toLowerCase();
      if (pathname.startsWith('/totem') || pathname.startsWith('/kiosk')) return true;
      const params = new URLSearchParams(window.location.search);
      const tableParam = params.get('mesa') || params.get('table') || params.get('mesa_num');
      const qrParam = params.get('qr') || params.get('src') || params.get('origem') || params.get('source');
      if (tableParam || qrParam === 'true' || qrParam === 'qrcode' || qrParam === 'qr') {
        safeStorage.setSession('paomania_qr_validated', 'true');
        return true;
      }
    } catch {}
    return safeStorage.getSession('paomania_qr_validated') === 'true';
  });

  const isChannelActive = 
    salesChannel === 'delivery' ? isDeliveryActive :
    salesChannel === 'kiosk' ? isKioskActive :
    isInStoreActive;

  // A compra está habilitada se o canal selecionado estiver ativo, a loja aberta e o QR code validado (se exigido)
  const requireQrCode = storeInfo?.requireQrCodeForOrdering !== false;
  const canBuy = isChannelActive && currentStatus.isOpenNow && (!requireQrCode || isQrValidated);

  useEffect(() => {
    let mode: string | null = null;
    let tableParam: string | null = null;
    try {
      const pathname = window.location.pathname.toLowerCase();
      if (pathname.startsWith('/totem') || pathname.startsWith('/kiosk')) {
        setIsQrValidated(true);
        safeStorage.setSession('paomania_qr_validated', 'true');
        setSalesChannel('kiosk');
        setDeliveryType('pickup');
        setHasChosenChannel(true);
        safeStorage.setSession('selected_sales_channel', 'kiosk');
        return;
      }
      const params = new URLSearchParams(window.location.search);
      mode = params.get('mode') || params.get('channel') || params.get('tipo');
      tableParam = params.get('mesa') || params.get('table') || params.get('mesa_num');
      const qrParam = params.get('qr') || params.get('src') || params.get('origem') || params.get('source');
      if (qrParam === 'true' || qrParam === 'qrcode' || qrParam === 'qr') {
        setIsQrValidated(true);
        safeStorage.setSession('paomania_qr_validated', 'true');
      }
    } catch {}
    
    // Se acessou via QR Code da mesa (?mesa=X)
    if (tableParam && !isNaN(parseInt(tableParam, 10))) {
      const tableNum = parseInt(tableParam, 10);
      setSelectedTableNumber(tableNum);
      safeStorage.setSession('paomania_selected_table', String(tableNum));
      setIsQrValidated(true);
      safeStorage.setSession('paomania_qr_validated', 'true');
      setSalesChannel('instore');
      setDeliveryType('pickup');
      setHasChosenChannel(true);
      safeStorage.setSession('selected_sales_channel', 'instore');
      return;
    }

    if (mode === 'kiosk' || mode === 'totem' || mode === 'autoatendimento') {
      setSalesChannel('kiosk');
      setDeliveryType('pickup');
      setHasChosenChannel(true);
      safeStorage.setSession('selected_sales_channel', 'kiosk');
    } else if ((mode === 'delivery' || mode === 'entrega') && hasDeliveryCategories) {
      setSalesChannel('delivery');
      setDeliveryType('delivery');
      setHasChosenChannel(true);
      safeStorage.setSession('selected_sales_channel', 'delivery');
    } else if ((mode === 'instore' || mode === 'loja' || mode === 'presencial') && hasInStoreCategories) {
      setSalesChannel('instore');
      setDeliveryType('pickup');
      setHasChosenChannel(true);
      safeStorage.setSession('selected_sales_channel', 'instore');
    } else {
      const saved = safeStorage.getSession('selected_sales_channel') as 'delivery' | 'instore' | 'kiosk';
      if (saved === 'delivery' && hasDeliveryCategories) {
        setSalesChannel('delivery');
        setDeliveryType('delivery');
      } else if (saved === 'instore' && hasInStoreCategories) {
        setSalesChannel('instore');
        setDeliveryType('pickup');
      } else {
        // Se apenas um possuir categorias ativas, selecionar o ativo por padrão
        if (hasDeliveryCategories && !hasInStoreCategories) {
          setSalesChannel('delivery');
          setDeliveryType('delivery');
        } else if (hasInStoreCategories) {
          setSalesChannel('instore');
          setDeliveryType('pickup');
        }
      }
    }
  }, [storeInfo.deliveryEnabled, storeInfo.inStoreEnabled, storeInfo.kioskEnabled, hasDeliveryCategories, hasInStoreCategories]);

  // Controlar classe totem-mode no documento
  useEffect(() => {
    const isKioskMode = salesChannel === 'kiosk' || isTotemPath;
    if (isKioskMode) {
      document.documentElement.classList.add('totem-mode');
      document.body.classList.add('totem-mode');
    } else {
      document.documentElement.classList.remove('totem-mode');
      document.body.classList.remove('totem-mode');
    }
  }, [salesChannel, isTotemPath]);

  // Se a modalidade selecionada não possuir mais categorias ativas, alternar automaticamente
  useEffect(() => {
    if (isTotemPath || salesChannel === 'kiosk') return;

    if (salesChannel === 'delivery' && !hasDeliveryCategories && hasInStoreCategories) {
      setSalesChannel('instore');
      setDeliveryType('pickup');
      safeStorage.setSession('selected_sales_channel', 'instore');
    } else if (salesChannel === 'instore' && !hasInStoreCategories && hasDeliveryCategories) {
      setSalesChannel('delivery');
      setDeliveryType('delivery');
      safeStorage.setSession('selected_sales_channel', 'delivery');
    }
  }, [salesChannel, hasDeliveryCategories, hasInStoreCategories, isTotemPath]);

  // Se houver apenas 1 opção disponível para o cliente, auto-selecionar sem obrigar modal
  useEffect(() => {
    if (isTotemPath) return;
    if (visibleChannels.length === 1 && !hasChosenChannel) {
      handleSelectChannel(visibleChannels[0]);
    }
  }, [visibleChannels, hasChosenChannel, isTotemPath]);

  const handleSelectChannel = (channel: 'delivery' | 'instore' | 'kiosk') => {
    setSalesChannel(channel);
    setHasChosenChannel(true);
    safeStorage.setSession('selected_sales_channel', channel);
    if (channel === 'delivery') {
      setDeliveryType('delivery');
    } else {
      setDeliveryType('pickup');
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', channel);
      window.history.replaceState({}, '', url.toString());
    } catch {}
  };
  const [cart, setCart] = useState<OrderItem[]>(() => {
    try {
      const saved = safeStorage.getItem('paomania_active_cart');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Erro ao carregar carrinho persistente:', e);
    }
    return [];
  });
  const [isSendingOrder, setIsSendingOrder] = useState(false);

  // Persistir carrinho no localStorage sempre que houver alterações
  useEffect(() => {
    try {
      if (cart.length > 0) {
        safeStorage.setItem('paomania_active_cart', JSON.stringify(cart));
      } else {
        safeStorage.removeItem('paomania_active_cart');
      }
    } catch (e) {
      console.warn('Erro ao salvar carrinho no storage:', e);
    }
  }, [cart]);
  const [paymentMethod, setPaymentMethod] = useState('Cartão de Crédito');
  const [deliveryType, setDeliveryType] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  
  // In-Store Security & Geolocation Validation State
  const [customerPinInput, setCustomerPinInput] = useState('');
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'checking' | 'verified' | 'out_of_range' | 'denied'>('idle');
  const [gpsDistance, setGpsDistance] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const verifyInStoreGps = async (): Promise<boolean> => {
    if (!storeInfo.inStoreGpsValidation) {
      setGpsStatus('verified');
      return true;
    }
    
    setGpsStatus('checking');
    setGpsError(null);
    
    try {
      const position = await getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 });
      const userLat = position.coords.latitude;
      const userLon = position.coords.longitude;
      const storeLat = storeInfo.inStoreLatitude ?? -19.7478;
      const storeLon = storeInfo.inStoreLongitude ?? -47.9392;
      const maxRadius = storeInfo.inStoreMaxRadiusMeters || 150;
      
      const dist = calculateDistanceMeters(userLat, userLon, storeLat, storeLon);
      setGpsDistance(dist);
      
      if (dist <= maxRadius) {
        setGpsStatus('verified');
        return true;
      } else {
        setGpsStatus('out_of_range');
        return false;
      }
    } catch (err: any) {
      console.error('Erro na geolocalização do cliente:', err);
      setGpsStatus('denied');
      setGpsError('Não foi possível obter sua localização via GPS. Verifique se o GPS está ativo e autorize o acesso no seu navegador.');
      return false;
    }
  };
  const [isBakeryLoading, setIsBakeryLoading] = useState(false);
  const [renderedCategoryCount, setRenderedCategoryCount] = useState(4);
  const [showFormSuccess, setShowFormSuccess] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [addonModal, setAddonModal] = useState<{ 
    isOpen: boolean; 
    product: any | null; 
    selectedAddons: any[]; 
    selectedFlavor: any | null;
    availableAddons: any[];
    availableFlavors: any[];
  }>({ 
    isOpen: false, 
    product: null, 
    selectedAddons: [], 
    selectedFlavor: null,
    availableAddons: [],
    availableFlavors: []
  });
  
  const categoryRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const categoryBarRef = useRef<HTMLDivElement | null>(null);
  const categoryButtonRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});
  const isManualScrolling = useRef(false);
  const productsContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollCategoryButtonToCenter = useCallback((categoryId: string) => {
    const container = categoryBarRef.current;
    const button = categoryButtonRefs.current[categoryId];
    if (container && button) {
      const containerWidth = container.clientWidth;
      const buttonLeft = button.offsetLeft;
      const buttonWidth = button.clientWidth;
      const targetScrollLeft = buttonLeft - (containerWidth / 2) + (buttonWidth / 2);
      container.scrollTo({
        left: Math.max(0, targetScrollLeft),
        behavior: 'smooth'
      });
    }
  }, []);

  const scrollToCategory = (categoryId: string) => {
    isManualScrolling.current = true;
    setActiveCategory(categoryId);
    setRenderedCategoryCount(999);
    scrollCategoryButtonToCenter(categoryId);

    // Permitir que o DOM monte a categoria caso ainda estivesse em carregamento progressivo
    setTimeout(() => {
      const container = productsContainerRef.current;
      const element = categoryRefs.current[categoryId];
      if (container && element) {
        const containerTop = container.getBoundingClientRect().top;
        const elementTop = element.getBoundingClientRect().top;
        const currentScrollTop = container.scrollTop;
        const targetScrollTop = currentScrollTop + (elementTop - containerTop) - 12;
        container.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: 'smooth'
        });
      }
    }, 10);

    setTimeout(() => {
      isManualScrolling.current = false;
    }, 800);
  };

  // Carregamento progressivo ultrarrápido: monta os primeiros itens instantaneamente (<50ms)
  // e monta o catálogo completo no próximo ciclo de ociosidade, eliminando o congelamento de 10s.
  useEffect(() => {
    const timer = setTimeout(() => {
      setRenderedCategoryCount(prev => (prev < 999 ? 999 : prev));
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isInitialized) {
      setIsBakeryLoading(false);
    }
    const fallbackTimer = setTimeout(() => {
      setIsBakeryLoading(false);
    }, 2000);
    return () => clearTimeout(fallbackTimer);
  }, [isInitialized]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (Array.isArray(categories) && categories.length > 0 && !activeCategory) {
      const firstValidCategory = [...categories]
        .filter(c => c && c.id && typeof c.name === 'string')
        .filter(c => {
          const isExcluded = isExcludedCategory(c.name) || isAddonCategory(c.name);
          const isVisible = c.isVisible !== false;
          const matchesChannel = salesChannel === 'delivery'
            ? c.availableForDelivery !== false
            : salesChannel === 'kiosk'
              ? c.availableForKiosk !== false
              : c.availableInStore !== false;

          return !isExcluded && 
                 isVisible && 
                 matchesChannel &&
                 Array.isArray(products) && 
                 products.some(p => p.categoryId === c.id && p.isActive && !p.isAddon && !p.isFlavor && !isAddonItem(p, categories));
        })
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }))[0];
      if (firstValidCategory) {
        setActiveCategory(firstValidCategory.id);
      }
    }
  }, [categories, products, activeCategory, salesChannel]);

  const isAddonProduct = useCallback((p: any) => {
    return isAddonItem(p, categories);
  }, [categories]);

  // Final Filter Logic (Otimizado com busca O(1) e pré-processamento de strings)
  const filteredProducts = useMemo(() => {
    if (!Array.isArray(products) || products.length === 0) return [];
    
    const rawTerm = (searchTerm || '').trim();
    const term = rawTerm ? normalizeText(rawTerm) : '';
    const lowerTerm = rawTerm ? rawTerm.toLowerCase() : '';

    const catMap = new Map<string, any>();
    if (Array.isArray(categories)) {
      for (let i = 0; i < categories.length; i++) {
        const c = categories[i];
        if (c && c.id) catMap.set(c.id, c);
      }
    }

    return products.filter(p => {
      if (!p || !p.isActive || p.isFlavor) return false;

      // Ocultar produtos que são adicionais/opcionais da tela inicial (eles aparecem apenas ao clicar no lanche)
      if (isAddonItem(p, categories)) return false;

      if (term) {
        const normName = normalizeText(p.name || '');
        const expandedName = normalizeText(expandAbbreviations(p.name || ''));
        const normDesc = normalizeText(p.description || '');
        const expandedDesc = normalizeText(expandAbbreviations(p.description || ''));
        const rawCode = (p.externalId || '').toString().toLowerCase();

        const matchesSearch = 
          normName.includes(term) || 
          expandedName.includes(term) || 
          normDesc.includes(term) || 
          expandedDesc.includes(term) || 
          rawCode.includes(lowerTerm);

        if (!matchesSearch) return false;
      }

      if (shouldExcludeProduct(p, categories)) return false;

      const prodCat = p.categoryId ? catMap.get(p.categoryId) : undefined;
      const catMatchesChannel = !prodCat || (
        salesChannel === 'delivery'
          ? prodCat.availableForDelivery !== false
          : salesChannel === 'kiosk'
            ? prodCat.availableForKiosk !== false
            : prodCat.availableInStore !== false
      );
      if (!catMatchesChannel) return false;

      const matchesChannel = salesChannel === 'delivery'
        ? p.availableForDelivery !== false
        : salesChannel === 'kiosk'
          ? p.availableForKiosk !== false
          : p.availableInStore !== false;
      if (!matchesChannel) return false;

      if ((p as any).trackStock && ((p as any).stockQuantity ?? 0) <= 0) return false;

      return (p as any).isVisible !== false;
    });
  }, [products, searchTerm, categories, salesChannel]);

  // Agrupamento pré-calculado em um único passo O(N) para indexação instantânea no render
  const { productsByCategory, categoryCountMap } = useMemo(() => {
    const map: Record<string, typeof filteredProducts> = {};
    const counts: Record<string, number> = {};

    for (let i = 0; i < filteredProducts.length; i++) {
      const p = filteredProducts[i];
      const catId = p.categoryId || 'sem-categoria';
      if (!map[catId]) {
        map[catId] = [];
      }
      map[catId].push(p);
    }

    for (const catId in map) {
      map[catId].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }));
      counts[catId] = map[catId].length;
    }

    return { productsByCategory: map, categoryCountMap: counts };
  }, [filteredProducts]);

  const availableCategories = useMemo(() => {
    return [...(Array.isArray(categories) ? categories : [])]
      .filter(c => c && c.id && typeof c.name === 'string')
      .filter(c => {
        const isExcluded = isExcludedCategory(c.name) || isAddonCategory(c.name);
        const isVisible = c.isVisible !== false;
        const matchesChannel = salesChannel === 'delivery'
          ? c.availableForDelivery !== false
          : salesChannel === 'kiosk'
            ? c.availableForKiosk !== false
            : c.availableInStore !== false;

        return !isExcluded && 
               isVisible && 
               matchesChannel &&
               Boolean(categoryCountMap[c.id]);
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }));
  }, [categories, categoryCountMap, salesChannel]);

  const displayedCategories = useMemo(() => {
    if (searchTerm.trim() !== '') {
      return availableCategories;
    }
    return availableCategories.slice(0, renderedCategoryCount);
  }, [availableCategories, searchTerm, renderedCategoryCount]);

  // Auto-select first category if active one disappears after search
  useEffect(() => {
    if (searchTerm && availableCategories.length > 0 && !availableCategories.find(c => c.id === activeCategory)) {
      setActiveCategory(availableCategories[0].id);
    }
  }, [searchTerm, availableCategories, activeCategory]);

  // Center active category button in mobile category bar when activeCategory changes
  useEffect(() => {
    if (activeCategory) {
      scrollCategoryButtonToCenter(activeCategory);
    }
  }, [activeCategory, scrollCategoryButtonToCenter]);

  // Scroll spy to update activeCategory as user scrolls products feed
  useEffect(() => {
    const container = productsContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (isManualScrolling.current) return;

      const containerTop = container.getBoundingClientRect().top;
      let currentCatId = '';

      for (const cat of availableCategories) {
        const el = categoryRefs.current[cat.id];
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top - containerTop <= 120) {
            currentCatId = cat.id;
          }
        }
      }

      if (currentCatId && currentCatId !== activeCategory) {
        setActiveCategory(currentCatId);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [availableCategories, activeCategory]);

  const scroll = (direction: 'left' | 'right') => {
    if (containerRef.current) {
      const { scrollLeft, clientWidth } = containerRef.current;
      const scrollTo = direction === 'left' ? scrollLeft - clientWidth / 2 : scrollLeft + clientWidth / 2;
      containerRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' });
    }
  };

  const addToCart = (product: any, addons: any[] = [], flavor: any = null) => {
    setCart(prev => {
      const existing = prev.find(item => 
        item.productId === product.id && 
        JSON.stringify(item.addons) === JSON.stringify(addons) &&
        JSON.stringify(item.flavor) === JSON.stringify(flavor)
      );
      if (existing) {
        return prev.map(item => 
          (item.productId === product.id && JSON.stringify(item.addons) === JSON.stringify(addons) && JSON.stringify(item.flavor) === JSON.stringify(flavor))
            ? { ...item, quantity: item.quantity + 1 } 
            : item
        );
      }
      const prodCode = (product.externalId || product.code || '').toString().trim();
      const descWithCode = formatProductDescriptionWithCode(product.description, prodCode);

      const enrichedFlavor = flavor ? {
        ...flavor,
        externalId: flavor.externalId || flavor.code || (products.find(p => p.id === flavor.productId)?.externalId) || '',
        code: flavor.code || flavor.externalId || (products.find(p => p.id === flavor.productId)?.externalId) || ''
      } : null;

      const enrichedAddons = (addons || []).map((a: any) => ({
        ...a,
        externalId: a.externalId || a.code || (products.find(p => p.id === a.productId)?.externalId) || '',
        code: a.code || a.externalId || (products.find(p => p.id === a.productId)?.externalId) || ''
      }));

      return [...prev, { 
        productId: product.id, 
        externalId: prodCode, 
        code: prodCode, 
        name: product.name, 
        description: descWithCode, 
        price: product.price, 
        quantity: 1, 
        imageUrl: product.imageUrl, 
        addons: enrichedAddons, 
        flavor: enrichedFlavor 
      }];
    });
    setAddonModal({ isOpen: false, product: null, selectedAddons: [], selectedFlavor: null, availableAddons: [], availableFlavors: [] });
  };

  const initiateAddToCart = (product: any) => {
    if (!canBuy || isAddonProduct(product)) {
      return;
    }

    let availableAddons: any[] = [];
    if (product.addonIds && product.addonIds.length > 0) {
      availableAddons = products.filter(p => {
        const category = categories.find(c => c.id === p.categoryId);
        const isExcluded = category && isExcludedCategory(category.name);
        return p.isActive && product.addonIds.includes(p.id) && !isExcluded;
      });
    } else {
      const category = categories.find(c => c.id === product.categoryId);
      const catName = normalizeText(category?.name || '');
      const prodName = normalizeText(product?.name || '');
      const isEligibleForAddons = 
        catName.includes('especiais na chapa') || 
        catName.includes('tradicionais na chapa') ||
        catName.includes('chapa') ||
        catName.includes('lanches') ||
        catName.includes('lanche') ||
        catName.includes('sanduiche') ||
        catName.includes('sanduiches') ||
        catName.includes('hamburguer') ||
        catName.includes('hamburguers') ||
        catName.includes('baguete') ||
        catName.includes('baguetes') ||
        catName.includes('tostex') ||
        catName.includes('misto') ||
        prodName.includes('misto') ||
        prodName.includes('sanduiche') ||
        prodName.includes('lanche') ||
        prodName.includes('chapa') ||
        prodName.includes('pao na chapa') ||
        product.categoryId === 'tesmosw' ||
        product.categoryId === '56fnn1f';

      if (isEligibleForAddons) {
        availableAddons = products.filter(p => {
          const cat = categories.find(c => c.id === p.categoryId);
          const isExcluded = cat && isExcludedCategory(cat.name);
          return isAddonItem(p, categories) && p.isActive && !isExcluded;
        });
      }
    }

    let availableFlavors = [];
    if (product.flavorIds && product.flavorIds.length > 0) {
      availableFlavors = products.filter(p => {
        const category = categories.find(c => c.id === p.categoryId);
        const isExcluded = category && isExcludedCategory(category.name);
        return p.isActive && product.flavorIds.includes(p.id) && !isExcluded;
      });
    } else {
      const category = categories.find(c => c.id === product.categoryId);
      const isJuiceCategory = category && (
        category.name.toLowerCase().includes('suco') || 
        category.name.toLowerCase().includes('polpa')
      );
      if (isJuiceCategory) {
        availableFlavors = products.filter(p => {
          const cat = categories.find(c => c.id === p.categoryId);
          const isExcluded = cat && isExcludedCategory(cat.name);
          return p.isFlavor && p.isActive && !isExcluded;
        });
      }
    }

    if (availableFlavors.length > 0) {
      availableAddons = [];
    }

    if (availableAddons.length > 0 || availableFlavors.length > 0) {
      setAddonModal({ 
        isOpen: true, 
        product, 
        selectedAddons: [], 
        selectedFlavor: null,
        availableAddons,
        availableFlavors
      });
      return;
    }
    
    addToCart(product);
  };

  const updateQuantity = (productId: string, addons: any[] | undefined, flavor: any | undefined, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.productId === productId && JSON.stringify(item.addons) === JSON.stringify(addons) && JSON.stringify(item.flavor) === JSON.stringify(flavor)) {
        const newQuantity = Math.max(0, item.quantity + delta);
        return { ...item, quantity: newQuantity };
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const total = cart.reduce((sum, item) => {
    const addonsTotal = item.addons?.reduce((addonSum, addon) => addonSum + addon.price, 0) || 0;
    const flavorTotal = item.flavor?.price || 0;
    return sum + ((item.price + flavorTotal + addonsTotal) * item.quantity);
  }, 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    
    if (!currentStatus.isOpenNow || !canBuy) {
      if ((salesChannel === 'kiosk' || salesChannel === 'instore') && !currentStatus.isOpenNow) {
        alert(`Desculpe, o atendimento presencial (${salesChannel === 'kiosk' ? 'Totem Autoatendimento' : 'Consumo na Loja'}) está indisponível no momento.\n${currentStatus.details}`);
        return;
      }
      if (salesChannel === 'delivery' && !isDeliveryActive) {
        alert('Desculpe, os pedidos para Delivery estão pausados no momento pelo estabelecimento.');
        return;
      }
      alert(storeInfo.closedMessage || currentStatus.details || 'Desculpe, a loja está fechada ou o canal de atendimento selecionado está indisponível no momento.');
      return;
    }
    
    setIsSendingOrder(true);
    const isKioskMode = salesChannel === 'kiosk' || isTotemPath;
    const isTableOrder = salesChannel === 'instore' && selectedTableNumber !== null;
    
    // Obter o nome de identificação do cliente para imprimir no cupom
    const savedCustomerName = safeStorage.getItem('paomania_customer_name') || '';
    const finalCustomerName = isKioskMode 
      ? '' 
      : (customerName.trim() || savedCustomerName.trim() || 'Cliente');

    const savedCustomerPhone = safeStorage.getItem('paomania_customer_phone') || '';
    const finalCustomerPhone = isKioskMode 
      ? '' 
      : (customerPhone.trim() || savedCustomerPhone.trim());
    
    try {
      const createdOrder = await placeOrder({
        items: cart,
        total,
        type: isKioskMode ? 'kiosk' : salesChannel === 'delivery' ? 'delivery' : (isTableOrder ? 'dine_in' : 'online'),
        paymentMethod: isKioskMode ? 'Balcão' : paymentMethod,
        customerName: finalCustomerName,
        customerPhone: finalCustomerPhone,
        deliveryType: isKioskMode ? 'pickup' : (isTableOrder ? 'dine_in' : deliveryType),
        deliveryAddress: (!isKioskMode && deliveryType === 'delivery') ? deliveryAddress : undefined,
        tableNumber: isTableOrder ? String(selectedTableNumber) : undefined,
        tableId: isTableOrder ? `table-${selectedTableNumber}` : undefined,
      });
      
      if (createdOrder) {
        setLastPlacedOrder(createdOrder);
        setCart([]);
        safeStorage.removeItem('paomania_active_cart');

        // OPÇÃO A: Disparo automático de impressão na impressora térmica da loja (via TCP Socket de Rede)
        // Funciona tanto para pedidos pelo celular do cliente quanto pelo totem ou mesas
        try {
          const netConfig = getNetworkPrinterConfig(storeInfo);
          if (netConfig.ip) {
            console.log(`[Opção A] Disparando impressão direta para impressora de rede (${netConfig.ip}) com o Pedido #${createdOrder.id} e Cliente: ${createdOrder.customerName}...`);
            printViaNetworkIp(createdOrder, storeInfo).then(result => {
              if (result.success) {
                console.log('[Opção A] Pedido impresso com sucesso na impressora térmica da loja:', result.message);
              } else {
                console.log('[Opção A] Status de envio para impressora de rede:', result.message);
              }
            }).catch(printErr => {
              console.warn('[Opção A] Erro ao chamar impressão de rede:', printErr);
            });
          }
        } catch (netErr) {
          console.warn('Erro ao processar impressão direta via rede:', netErr);
        }

        // No totem, dispara a impressão automaticamente ao finalizar o pedido com corte via RawBT
        if (isKioskMode) {
          try {
            printViaRawBT(createdOrder, storeInfo, true);
          } catch (printErr) {
            console.warn('Erro ao disparar impressão automática do totem:', printErr);
          }
        }

        // Enviar notificação de Novo Pedido no NTFY
        try {
          const itemsSummary = createdOrder.items.map(it => `${it.quantity}x ${it.name}`).join(', ');
          const typeLabel = isTableOrder 
            ? `🍽️ Consumo no Local (Mesa ${selectedTableNumber})` 
            : (createdOrder.deliveryType === 'delivery' ? '🛵 Entrega (Delivery)' : '🥡 Retirada/Balcão');

          sendNtfyNotification({
            enabled: storeInfo.ntfyEnabled !== false,
            topic: storeInfo.ntfyTopic || 'paomania_pedidos',
            title: `🔔 Novo Pedido #${String(createdOrder.id).slice(-4).padStart(4, '0')}${isTableOrder ? ` (Mesa ${selectedTableNumber})` : isKioskMode ? ' (Totem - Entregue)' : (createdOrder.customerName ? ` (${createdOrder.customerName})` : '')}`,
            message: `Total: ${formatCurrency(createdOrder.total)}\nItens: ${itemsSummary}\nPagamento: ${createdOrder.paymentMethod}\nTipo: ${typeLabel}${isKioskMode ? '\nStatus: Entregue (Totem Autoatendimento)' : ''}${createdOrder.deliveryAddress ? '\nEndereço: ' + createdOrder.deliveryAddress : ''}`,
            priority: 5,
            tags: ['bell', 'shopping_cart', 'moneybag']
          }).catch(e => console.warn('[NTFY] Order error:', e));
        } catch (ntfyOrderErr) {
          console.warn('[NTFY] Order alert error:', ntfyOrderErr);
        }
      }

      setIsSuccess(true);
      setCart([]);
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {}
    } catch (error) {
      console.error('Erro ao finalizar pedido:', error);
      alert('Ocorreu um erro ao enviar seu pedido. Por favor, tente novamente.');
    } finally {
      setIsSendingOrder(false);
    }
  };

  useEffect(() => {
    if (isSuccess) {
      try {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        
        const t1 = setTimeout(() => {
          window.scrollTo(0, 0);
          const banner = document.getElementById('order-attention-banner') || document.getElementById('success-order-screen');
          if (banner) {
            banner.scrollIntoView({ behavior: 'instant', block: 'start' });
          }
        }, 50);

        const t2 = setTimeout(() => {
          window.scrollTo(0, 0);
        }, 200);

        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
        };
      } catch {}
    }
  }, [isSuccess]);

  if (isSuccess) {
    const orderNumber = lastPlacedOrder?.id ? String(lastPlacedOrder.id).slice(-4).padStart(4, '0') : '0001';
    const isKioskMode = salesChannel === 'kiosk' || isTotemPath;
    const clientNameDisplay = (lastPlacedOrder?.customerName || customerName || safeStorage.getItem('paomania_customer_name') || 'CLIENTE').trim().toUpperCase();

    return (
      <div id="success-order-screen" className="min-h-screen bg-stone-900 text-stone-100 flex flex-col items-center justify-start sm:justify-center p-2 sm:p-6 pt-2 sm:pt-6">
        <div className="bg-white text-stone-900 rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden border border-stone-200 animate-in fade-in zoom-in duration-200 my-0 sm:my-auto">
          
          {/* Header de Sucesso */}
          <div className="bg-emerald-600 text-white p-4 sm:p-5 text-center flex flex-col items-center justify-center">
            <CheckCircle2 className="w-12 h-12 sm:w-14 sm:h-14 mb-1.5 animate-bounce" />
            <h2 className="text-xl sm:text-3xl font-black tracking-tight uppercase">PEDIDO REALIZADO!</h2>
            <p className="text-emerald-100 text-xs sm:text-sm font-medium">
              {isKioskMode ? 'Imprima seu comprovante e retire no balcão' : 'Recebemos seu pedido com sucesso!'}
            </p>
          </div>

          {/* Mensagem em destaque no Smartphone: Atenção prezado (CLIENTE). Aguarde ser chamado... */}
          {!isKioskMode && (
            <div id="order-attention-banner" className="p-4 sm:p-5 bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 text-white text-center border-b-2 border-orange-600 shadow-md">
              <div className="inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white text-orange-600 shadow-lg mb-2">
                <UserCheck className="w-7 h-7 sm:w-8 sm:h-8 stroke-[2.5]" />
              </div>
              <h3 className="text-lg sm:text-2xl font-black uppercase tracking-tight text-white drop-shadow-xs">
                Atenção prezado {clientNameDisplay || 'CLIENTE'}
              </h3>
              <div className="mt-2 bg-white/20 backdrop-blur-xs rounded-2xl p-3.5 sm:p-4 border border-white/25">
                <p className="text-sm sm:text-lg font-black text-white leading-snug">
                  Aguarde ser chamado pelo seu nome pelo atendente. O pedido ficará pronto no máximo em 10 minutos.
                </p>
              </div>
              <div className="mt-2.5 inline-flex items-center justify-center gap-1.5 bg-black/25 px-3 py-1 rounded-full text-xs font-bold text-amber-100 border border-white/10">
                <span>🖨️ Pedido #{orderNumber} já impresso no balcão da loja!</span>
              </div>
            </div>
          )}

          {/* Senha e TV Chamada */}
          <div className="p-5 bg-orange-50 border-b border-orange-100">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left bg-white p-4 rounded-2xl border border-orange-200 shadow-xs">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-orange-600">Sua Senha de Chamada</p>
                <p className="text-3xl sm:text-4xl font-black text-stone-900 font-mono tracking-tight">#{orderNumber}</p>
                {lastPlacedOrder?.tableNumber ? (
                  <div className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 bg-amber-100 text-amber-900 rounded-lg text-xs font-black border border-amber-300">
                    <UtensilsCrossed className="w-3.5 h-3.5 text-amber-700" />
                    <span>MESA {lastPlacedOrder.tableNumber}</span>
                  </div>
                ) : null}
                {!isKioskMode && clientNameDisplay && (
                  <p className="text-xs text-stone-500 font-semibold mt-0.5">Cliente: <span className="text-stone-800 font-bold uppercase">{clientNameDisplay}</span></p>
                )}
              </div>
              <div className="flex items-center gap-2 bg-amber-100 text-amber-900 px-3 py-2 rounded-xl text-xs font-bold border border-amber-300/60">
                <Tv className="w-4 h-4 text-amber-700 shrink-0" />
                <span>{lastPlacedOrder?.tableNumber ? 'Entregaremos na sua mesa' : 'Acompanhe na TV da Loja'}</span>
              </div>
            </div>
          </div>

          {/* Visual do Cupom / Comprovante para Impressão */}
          {lastPlacedOrder && (
            <div className="p-4 sm:p-5 bg-stone-100 max-h-[34vh] overflow-y-auto border-b border-stone-200">
              <div className="bg-white p-4 rounded-xl shadow-xs border border-stone-300/70 font-mono text-xs text-stone-900 leading-relaxed max-w-sm mx-auto">
                <div className="text-center font-black text-sm tracking-wide mb-1 uppercase">{storeInfo.name || 'BALBEC'}</div>
                <div className="text-center text-[10px] text-stone-500 mb-2">*** {lastPlacedOrder.tableNumber ? `CONSUMO NO LOCAL - MESA ${lastPlacedOrder.tableNumber}` : isKioskMode ? 'AUTOATENDIMENTO' : 'PEDIDO ONLINE'} ***</div>

                <div className="bg-black text-white p-2 text-center rounded-md my-2">
                  {lastPlacedOrder.tableNumber && (
                    <div className="font-black text-sm tracking-widest text-amber-300 uppercase mb-0.5">
                      🍽️ MESA {lastPlacedOrder.tableNumber}
                    </div>
                  )}
                  {!isKioskMode && lastPlacedOrder.customerName && (
                    <div className="font-black text-xs uppercase mb-0.5">
                      CLIENTE: {lastPlacedOrder.customerName}
                    </div>
                  )}
                  <div className="font-black text-sm tracking-wider">
                    PEDIDO #{orderNumber}
                  </div>
                </div>

                <div className="border-t border-dashed border-stone-400 my-2"></div>

                <div className="space-y-1.5 my-2">
                  {lastPlacedOrder.items.map((item, idx) => {
                    const itemCode = resolveItemCode(item);
                    return (
                      <div key={idx} className="border-b border-stone-100 pb-1.5 last:border-b-0">
                        <div className="flex justify-between items-start text-[11px]">
                          <span className="font-semibold">
                            {item.quantity}x {item.name}
                            {itemCode && (
                              <span className="ml-1.5 text-[10px] font-mono font-bold text-white bg-black px-1.5 py-0.5 rounded">
                                CÓD: {itemCode}
                              </span>
                            )}
                          </span>
                          <span className="font-bold">{formatCurrency(((item.price || 0) + (item.flavor?.price || 0) + (item.addons?.reduce((s, a) => s + (a.price || 0), 0) || 0)) * (item.quantity || 1))}</span>
                        </div>
                        {item.flavor && (
                          <div className="text-[10px] pl-2 text-stone-600">
                            • Sabor: {item.flavor.name}
                            {resolveAddonCode(item.flavor) && (
                              <span className="font-mono font-bold text-white bg-black px-1 py-0.5 rounded text-[9px] ml-1">
                                CÓD: {resolveAddonCode(item.flavor)}
                              </span>
                            )}
                          </div>
                        )}
                        {item.addons && item.addons.length > 0 && (
                          <div className="text-[10px] pl-2 text-stone-600 space-y-0.5 mt-0.5">
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
                        {item.description && (
                          <div className="text-[10px] pl-2 text-stone-500 font-light italic leading-tight mt-0.5">
                            {item.description}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-dashed border-stone-400 my-2"></div>

                <div className="flex justify-between items-center font-black text-xs sm:text-sm">
                  <span>TOTAL :</span>
                  <span>{formatCurrency(lastPlacedOrder.total || 0)}</span>
                </div>

                <div className="text-center text-[10px] text-stone-600 mt-1">
                  Pagamento: <span className="font-bold text-stone-900">{lastPlacedOrder.paymentMethod || 'No Balcão'}</span>
                </div>

                <div className="text-center text-[9px] text-stone-400 mt-2">
                  {lastPlacedOrder.createdAt ? new Date(lastPlacedOrder.createdAt).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR')}
                </div>

                <div className="mt-3 pt-2 border-t border-dashed border-stone-400 text-left">
                  <div className="font-black text-[10px] uppercase tracking-wide text-stone-800">OUTROS PRODUTOS</div>
                  <div className="h-[5cm] min-h-[5cm]"></div>
                </div>
              </div>
            </div>
          )}

          {/* Temporizador regressivo */}
          <div className="px-5 pt-4 pb-1 bg-white">
            <div className="bg-amber-50 border border-amber-200/90 p-3 rounded-2xl text-center">
              <div className="flex items-center justify-center gap-2 text-xs font-black text-amber-950 mb-1.5">
                <Clock className="w-4 h-4 text-amber-600 animate-spin" />
                <span>
                  {isKioskMode 
                    ? <>Voltando para a tela inicial em <strong className="text-amber-700 text-sm font-mono">{successCountdown}s</strong> para o próximo cliente</>
                    : <>Retornando ao cardápio em <strong className="text-amber-700 text-sm font-mono">{successCountdown}s</strong></>
                  }
                </span>
              </div>
              <div className="w-full bg-amber-200/70 h-2.5 rounded-full overflow-hidden">
                <div 
                  className="bg-amber-500 h-full transition-all duration-1000 ease-linear rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, (successCountdown / (isKioskMode ? 15 : 45)) * 100))}%` }}
                />
              </div>
            </div>
          </div>

          {/* Botões de Ação: Totem (Imprimir) vs Smartphone/Consumo na Loja (Finalizar Pedido) */}
          <div className="p-5 space-y-3 bg-white">
            {isKioskMode ? (
              <>
                <button 
                  type="button"
                  onClick={() => {
                    if (lastPlacedOrder) {
                      printViaRawBT(lastPlacedOrder, storeInfo);
                    }
                  }}
                  className="w-full py-4 px-5 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-2xl font-black text-base sm:text-lg flex items-center justify-center gap-2.5 shadow-lg shadow-blue-600/30 transition-all cursor-pointer select-none"
                >
                  <Printer className="w-6 h-6" />
                  <span>IMPRIMIR COMPROVANTE</span>
                </button>

                <button 
                  type="button"
                  onClick={handleResetForNewCustomer}
                  className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white active:scale-[0.99] rounded-2xl font-bold text-sm sm:text-base transition-colors shadow-sm cursor-pointer flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Novo Pedido</span>
                </button>
              </>
            ) : (
              <button 
                type="button"
                onClick={handleResetForNewCustomer}
                className="w-full py-4 px-5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 active:scale-[0.98] text-white rounded-2xl font-black text-base sm:text-lg flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-600/30 transition-all cursor-pointer select-none"
              >
                <CheckCircle2 className="w-6 h-6" />
                <span>Entendi / Fazer Novo Pedido</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isCheckout) {
    const isKioskMode = salesChannel === 'kiosk' || isTotemPath;

    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        {isSendingOrder && (
          <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-stone-900/90 text-white p-6 text-center">
            <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-6"></div>
            <h2 className="text-3xl font-bold animate-pulse">
              {isKioskMode ? 'IMPRIMINDO SEU PEDIDO...' : 'ENVIANDO SEU PEDIDO...'}
            </h2>
          </div>
        )}
        <header className="bg-white p-4 shadow-sm flex items-center gap-4">
          <button onClick={() => setIsCheckout(false)} className="p-2 hover:bg-stone-100 rounded-full">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-2xl font-bold">
            {isKioskMode ? 'Confirmar Pedido' : 'Finalizar Pedido'}
          </h1>
        </header>

        <div className="flex-1 max-w-3xl w-full mx-auto p-3.5 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-8">
          <div>
            <h2 className="text-xl font-bold mb-4">Resumo do Pedido</h2>
            <div className="bg-white rounded-xl shadow-sm p-4 space-y-4">
              {cart.map(item => (
                <div key={item.productId + JSON.stringify(item.addons) + JSON.stringify(item.flavor)} className="flex gap-4 items-center">
                  <div className="w-16 h-16 bg-stone-50 rounded-xl overflow-hidden shrink-0 border border-stone-100">
                    <ProductImage 
                      src={item.imageUrl} 
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 flex justify-between items-center">
                    <div>
                      <span className="font-medium">{item.quantity}x</span> <span className="uppercase">{item.name}</span>
                      {item.description && (
                        <div className="text-xs text-red-600 italic font-medium mt-0.5">
                          {formatCapitalized(item.description)}
                        </div>
                      )}
                      {item.flavor && (
                        <div className="text-sm text-stone-500 uppercase">
                          Sabor: {item.flavor.name}
                          {resolveAddonCode(item.flavor) && (
                            <span className="font-mono font-bold text-stone-700 ml-1.5">[CÓD: {resolveAddonCode(item.flavor)}]</span>
                          )}
                        </div>
                      )}
                      {item.addons && item.addons.length > 0 && (
                        <div className="text-sm text-stone-500 uppercase space-y-0.5">
                          {item.addons.map((a, aIdx) => {
                            const aCode = a.externalId || a.code || resolveAddonCode(a);
                            return (
                              <div key={aIdx}>
                                + {a.name}
                                {aCode && (
                                  <span className="font-mono font-bold text-stone-700 ml-1.5">[CÓD: {aCode}]</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="font-medium">{formatCurrency((item.price + (item.flavor?.price || 0) + (item.addons?.reduce((sum, a) => sum + a.price, 0) || 0)) * item.quantity)}</div>
                  </div>
                </div>
              ))}
              <div className="border-t pt-4 flex justify-between items-center text-xl font-bold">
                <span>Total</span>
                <span style={{ color: storeInfo.themeColor }}>{formatCurrency(total)}</span>
              </div>
            </div>
          </div>

          <div>
            {/* Opções de Entrega / Retirada */}
            {isKioskMode ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold mb-3 flex items-center gap-2 text-stone-800">
                    <span>🏪</span> Modalidade do Pedido
                  </h2>
                  <div className="p-4 bg-orange-50 border-2 border-orange-500 rounded-2xl flex items-center gap-3 text-orange-900 shadow-xs">
                    <div className="w-10 h-10 rounded-xl bg-orange-200/70 flex items-center justify-center text-xl shrink-0">
                      🛍️
                    </div>
                    <div>
                      <div className="font-black text-sm uppercase tracking-wide">Retirada no Balcão (Totem)</div>
                      <div className="text-xs text-orange-800">Ao clicar em imprimir, será gerado o seu cupom com o número do pedido.</div>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 text-xs sm:text-sm font-medium">
                  <p className="font-bold text-emerald-950 mb-1 flex items-center gap-1.5">
                    <Printer className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Impressão Direta do Comprovante</span>
                  </p>
                  <span>Retire seu cupom impresso e acompanhe a chamada da sua senha na TV da padaria.</span>
                </div>

                {/* Botão Final Totem: Apenas Imprimir */}
                <button 
                  onClick={() => handleCheckout()}
                  disabled={isSendingOrder}
                  className="w-full py-4.5 px-6 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 active:scale-[0.98] text-white rounded-2xl font-black text-xl transition-all disabled:opacity-50 cursor-pointer shadow-xl shadow-emerald-600/30 flex items-center justify-center gap-3 select-none"
                >
                  <Printer className="w-7 h-7 animate-pulse" />
                  <span>{isSendingOrder ? 'Imprimindo...' : 'Imprimir'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsCheckout(false)}
                  className="w-full py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl font-bold text-sm transition-colors cursor-pointer border border-stone-200 flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4 text-orange-600" />
                  <span>Voltar ao Cardápio e Escolher Mais Itens</span>
                </button>
              </div>
            ) : (
              <div>
                {/* Opções de Entrega */}
                <h2 className="text-xl font-bold mb-4">Opções de Entrega</h2>
                <div className="flex gap-4 mb-6">
                  {isInStoreActive && (
                    <label className={`flex-1 flex items-center justify-center p-4 border rounded-xl cursor-pointer transition-colors ${deliveryType === 'pickup' ? 'border-orange-600 bg-orange-50 text-orange-700 font-bold' : 'border-stone-200 bg-white hover:bg-stone-50 font-medium'}`}>
                      <input type="radio" name="deliveryType" value="pickup" checked={deliveryType === 'pickup'} onChange={() => setDeliveryType('pickup')} className="hidden" />
                      <span>Consumo na Loja / Retirada</span>
                    </label>
                  )}
                  {isDeliveryActive && (
                    <label className={`flex-1 flex items-center justify-center p-4 border rounded-xl cursor-pointer transition-colors ${deliveryType === 'delivery' ? 'border-orange-600 bg-orange-50 text-orange-700 font-bold' : 'border-stone-200 bg-white hover:bg-stone-50 font-medium'}`}>
                      <input type="radio" name="deliveryType" value="delivery" checked={deliveryType === 'delivery'} onChange={() => setDeliveryType('delivery')} className="hidden" />
                      <span>Entrega (Delivery)</span>
                    </label>
                  )}
                </div>

                {/* Bloco de Mesa para Consumo na Loja */}
                {deliveryType === 'pickup' && (
                  <div className="bg-amber-50/80 border-2 border-amber-300 rounded-2xl p-4 sm:p-5 mb-8 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center font-black shadow-sm shrink-0">
                          <UtensilsCrossed className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-sm sm:text-base font-black text-stone-900">
                            {selectedTableNumber ? `Mesa ${selectedTableNumber} Selecionada` : 'Onde você está sentado?'}
                          </h3>
                          <p className="text-xs text-stone-600">
                            {selectedTableNumber 
                              ? 'Seu pedido será entregue diretamente nesta mesa.' 
                              : 'Selecione a sua mesa ou informe se é para retirada no balcão.'}
                          </p>
                        </div>
                      </div>
                      {selectedTableNumber ? (
                        <button
                          type="button"
                          onClick={() => setShowTableSelectModal(true)}
                          className="text-xs font-bold text-amber-900 bg-white px-2.5 py-1.5 rounded-lg border border-amber-300 shadow-2xs hover:bg-amber-100 cursor-pointer shrink-0"
                        >
                          Trocar Mesa
                        </button>
                      ) : null}
                    </div>

                    {selectedTableNumber ? (
                      <div className="flex items-center justify-between gap-2 p-3 bg-white rounded-xl border border-amber-200 text-xs font-bold text-amber-900">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          <span>🍽️ Mesa #{selectedTableNumber} identificada! Os atendentes levarão seu pedido até a mesa.</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTableNumber(null);
                            safeStorage.removeItem('paomania_selected_table');
                          }}
                          className="text-[11px] text-stone-400 hover:text-red-600 underline cursor-pointer"
                        >
                          Retirada no Balcão
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2.5 pt-1">
                        <div className="flex flex-wrap gap-2">
                          {tables && tables.filter(t => t.isActive).length > 0 ? (
                            tables.filter(t => t.isActive).map(tbl => (
                              <button
                                key={tbl.id}
                                type="button"
                                onClick={() => {
                                  setSelectedTableNumber(tbl.number);
                                  safeStorage.setSession('paomania_selected_table', String(tbl.number));
                                }}
                                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer border ${
                                  selectedTableNumber === tbl.number
                                    ? 'bg-amber-600 text-white border-amber-700 shadow-sm'
                                    : 'bg-white text-stone-700 border-stone-200 hover:border-amber-400 hover:bg-amber-50'
                                }`}
                              >
                                Mesa {tbl.number}
                              </button>
                            ))
                          ) : (
                            <div className="flex items-center gap-2 w-full">
                              <input
                                type="number"
                                min="1"
                                max="999"
                                placeholder="Digite o número da mesa (ex: 5)"
                                value={selectedTableNumber || ''}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  setSelectedTableNumber(isNaN(val) ? null : val);
                                  if (!isNaN(val)) safeStorage.setSession('paomania_selected_table', String(val));
                                }}
                                className="w-full sm:w-56 p-2.5 bg-white border border-stone-300 rounded-xl text-sm font-bold text-stone-800"
                              />
                            </div>
                          )}
                        </div>
                        <p className="text-[11px] text-stone-500 italic">
                          💡 Dica: Você também pode escanear o QR Code em cima da sua mesa para identificar automaticamente!
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Validação de Presença para Consumo na Loja (GPS e/ou PIN do Balcão) */}
                {deliveryType === 'pickup' && (storeInfo.inStoreGpsValidation || storeInfo.inStorePinValidation) && (
                  <div className="bg-amber-50/70 border border-amber-300/80 rounded-2xl p-4 sm:p-5 mb-8 space-y-4 shadow-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-amber-200/80 flex items-center justify-center text-amber-900 shrink-0">
                        <ShieldCheck className="w-4 h-4 text-amber-800" />
                      </div>
                      <div>
                        <h3 className="text-sm font-extrabold text-stone-900">
                          Validação de Presença no Local
                        </h3>
                        <p className="text-xs text-stone-600">
                          O consumo na loja é exclusivo para clientes presentes no estabelecimento.
                        </p>
                      </div>
                    </div>

                    {/* Bloco 1: Validação GPS se ativada */}
                    {storeInfo.inStoreGpsValidation && (
                      <div className="bg-white p-3.5 rounded-xl border border-amber-200 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-amber-600 shrink-0" />
                            <span className="text-xs font-bold text-stone-800">
                              Localização / GPS da Loja
                            </span>
                          </div>
                          {gpsStatus === 'verified' && (
                            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Presença Confirmada
                            </span>
                          )}
                        </div>

                        {gpsStatus === 'idle' && (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <p className="text-xs text-stone-500">
                              Verifique sua localização para liberar o pedido de consumo na loja.
                            </p>
                            <button
                              type="button"
                              onClick={() => verifyInStoreGps()}
                              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5 shrink-0 shadow-xs"
                            >
                              <LocateFixed className="w-3.5 h-3.5" />
                              <span>Verificar GPS</span>
                            </button>
                          </div>
                        )}

                        {gpsStatus === 'checking' && (
                          <div className="flex items-center gap-2 text-xs text-amber-800 font-semibold p-2 bg-amber-50 rounded-lg">
                            <RefreshCw className="w-4 h-4 animate-spin text-amber-600" />
                            <span>Consultando GPS e calculando distância até a loja...</span>
                          </div>
                        )}

                        {gpsStatus === 'verified' && gpsDistance !== null && (
                          <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between">
                            <span>
                              📍 Você está a <strong>{formatDistance(gpsDistance)}</strong> da loja (dentro do limite permitido de {formatDistance(storeInfo.inStoreMaxRadiusMeters || 150)}).
                            </span>
                            <button
                              type="button"
                              onClick={() => verifyInStoreGps()}
                              className="text-[11px] text-emerald-700 underline hover:text-emerald-800 font-bold ml-2 shrink-0 cursor-pointer"
                            >
                              Recalcular
                            </button>
                          </div>
                        )}

                        {gpsStatus === 'out_of_range' && gpsDistance !== null && (
                          <div className="p-3 bg-red-50 rounded-xl border border-red-200 text-xs text-red-900 space-y-2">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                              <div>
                                <p className="font-bold">Você está fora do raio da loja ({formatDistance(gpsDistance)})</p>
                                <p className="text-red-700 text-[11px] mt-0.5">
                                  O consumo na loja só é permitido para quem está a até {formatDistance(storeInfo.inStoreMaxRadiusMeters || 150)} do local. Por favor, mude para "Entrega (Delivery)" ou venha até a loja.
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setDeliveryType('delivery')}
                                className="px-3 py-1 bg-red-600 text-white rounded-lg font-bold text-[11px] hover:bg-red-700 transition-colors cursor-pointer"
                              >
                                Mudar para Entrega (Delivery)
                              </button>
                              <button
                                type="button"
                                onClick={() => verifyInStoreGps()}
                                className="px-2.5 py-1 bg-white border border-red-300 text-red-700 rounded-lg font-bold text-[11px] hover:bg-stone-50 transition-colors cursor-pointer"
                              >
                                Tentar GPS Novamente
                              </button>
                            </div>
                          </div>
                        )}

                        {gpsStatus === 'denied' && (
                          <div className="p-3 bg-red-50 rounded-xl border border-red-200 text-xs text-red-900 space-y-2">
                            <div className="flex items-start gap-2">
                              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                              <div>
                                <p className="font-bold">Permissão de GPS necessária</p>
                                <p className="text-red-700 text-[11px] mt-0.5">
                                  {gpsError || 'Não foi possível obter sua localização. Autorize a localização no navegador para confirmar que você está na loja, ou escolha "Entrega (Delivery)".'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => verifyInStoreGps()}
                                className="px-3 py-1.5 bg-amber-600 text-white rounded-lg font-bold text-xs hover:bg-amber-700 transition-colors cursor-pointer flex items-center gap-1"
                              >
                                <LocateFixed className="w-3.5 h-3.5" />
                                <span>Autorizar e Tentar Novamente</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeliveryType('delivery')}
                                className="px-3 py-1.5 bg-white border border-stone-300 text-stone-700 rounded-lg font-bold text-xs hover:bg-stone-50 transition-colors cursor-pointer"
                              >
                                Mudar para Entrega
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Bloco 2: Validação por Código / PIN do Balcão se ativada */}
                    {storeInfo.inStorePinValidation && (
                      <div className="bg-white p-3.5 rounded-xl border border-amber-200 space-y-2.5">
                        <div className="flex items-center gap-2">
                          <KeyRound className="w-4 h-4 text-amber-600 shrink-0" />
                          <span className="text-xs font-bold text-stone-800">
                            Código / PIN do Balcão ou Mesa
                          </span>
                        </div>
                        <p className="text-xs text-stone-500">
                          Informe o código de validação exibido no balcão ou na mesa para confirmar seu pedido no local.
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            maxLength={10}
                            value={customerPinInput}
                            onChange={(e) => setCustomerPinInput(e.target.value.toUpperCase())}
                            placeholder="DIGITE O CÓDIGO (EX: 1234)"
                            className="w-full sm:w-64 p-2.5 bg-stone-50 border border-stone-300 rounded-xl text-center font-mono font-black tracking-widest text-stone-900 focus:bg-white focus:ring-2 focus:ring-amber-500 uppercase text-base"
                          />
                          {customerPinInput.trim() && (
                            <span className="text-xs text-stone-500 font-medium">
                              {customerPinInput.trim().toUpperCase() === (storeInfo.inStorePinCode || '1234').trim().toUpperCase() ? (
                                <span className="text-emerald-700 font-bold flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Código Válido
                                </span>
                              ) : (
                                <span className="text-stone-400">Verifique o código</span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {deliveryType === 'delivery' && (
                  <div className="bg-white rounded-xl shadow-sm p-4 mb-8 border border-orange-200">
                    <label className="block text-sm font-medium text-stone-700 mb-2">Endereço de Entrega Completo</label>
                    <textarea 
                      value={deliveryAddress} 
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      placeholder="Rua, Número, Bairro, Complemento, Ponto de Referência..."
                      rows={3}
                      required
                    />
                  </div>
                )}

                <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-stone-800">
                  <UserIcon className="w-5 h-5 text-orange-600" />
                  Identificação do Cliente (Preparo)
                </h2>
                <div className="bg-orange-50/60 border border-orange-200 rounded-xl shadow-sm p-4 mb-8 space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-stone-800 mb-1">
                      Nome do Cliente <span className="text-xs font-normal text-stone-500">(Identificação para o preparo)</span> *
                    </label>
                    <input 
                      type="text" 
                      value={customerName} 
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 font-semibold text-stone-800 uppercase bg-white"
                      placeholder="Digite o nome de quem irá retirar / receber"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">WhatsApp de Contato *</label>
                    <input 
                      type="tel" 
                      value={customerPhone} 
                      onChange={handlePhoneChange}
                      className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white"
                      placeholder="(00) 00000-0000"
                      required
                    />
                  </div>
                </div>

                <h2 className="text-xl font-bold mb-4">Forma de Pagamento</h2>
                <div className="space-y-3">
                  {['Cartão de Crédito', 'Cartão de Débito', 'Pix', 'Dinheiro'].map(method => (
                    <label 
                      key={method} 
                      className={`flex items-center p-4 border rounded-xl cursor-pointer transition-colors ${
                        paymentMethod === method ? 'border-orange-600 bg-orange-50' : 'border-stone-200 bg-white hover:bg-stone-50'
                      }`}
                    >
                      <input 
                        type="radio" 
                        name="payment" 
                        value={method}
                        checked={paymentMethod === method}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="w-5 h-5 text-orange-600 focus:ring-orange-500"
                      />
                      <span className="ml-3 font-medium">{method}</span>
                    </label>
                  ))}
                </div>

                <button 
                  onClick={async () => {
                    if (!customerName.trim()) {
                      alert('Favor preencher o seu nome.');
                      return;
                    }
                    const phoneDigits = customerPhone.replace(/\D/g, '');
                    if (phoneDigits.length < 10) {
                      alert('Favor preencher um WhatsApp válido com DDD.');
                      return;
                    }
                    if (deliveryType === 'delivery' && !deliveryAddress.trim()) {
                      alert('Por favor, informe o endereço de entrega.');
                      return;
                    }

                    // Validações de presença para Consumo na Loja
                    if (deliveryType === 'pickup') {
                      if (storeInfo.inStoreGpsValidation) {
                        if (gpsStatus !== 'verified') {
                          const isGpsOk = await verifyInStoreGps();
                          if (!isGpsOk) {
                            alert('Não foi possível confirmar sua presença no local pelo GPS. Por favor, autorize sua localização ou selecione a opção "Entrega (Delivery)".');
                            return;
                          }
                        }
                      }

                      if (storeInfo.inStorePinValidation) {
                        const enteredPin = customerPinInput.trim().toUpperCase();
                        const expectedPin = (storeInfo.inStorePinCode || '1234').trim().toUpperCase();
                        if (!enteredPin) {
                          alert('Por favor, digite o Código/PIN do balcão ou da mesa para liberar o pedido de consumo no local.');
                          return;
                        }
                        if (enteredPin !== expectedPin) {
                          alert('Código do balcão incorreto! Por favor, consulte o atendente da padaria ou o código exibido na mesa.');
                          return;
                        }
                      }
                    }

                    handleCheckout();
                  }}
                  disabled={isSendingOrder}
                  className="w-full mt-8 py-4.5 px-6 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-2xl font-black text-xl transition-all disabled:opacity-50 cursor-pointer shadow-xl shadow-emerald-600/30 flex items-center justify-center gap-3 select-none"
                >
                  <CheckCircle2 className="w-6 h-6" />
                  <span>{isSendingOrder ? 'Processando...' : 'Finalizar Pedido'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsCheckout(false)}
                  className="w-full mt-3 py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl font-bold text-sm transition-colors cursor-pointer border border-stone-200 flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4 text-orange-600" />
                  <span>Voltar ao Cardápio e Escolher Mais Itens</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isBakeryLoading) {
    return <BakeryLoader isLoading={true} />;
  }

  // Se a loja estiver configurada em Modo de Manutenção
  const hasBypassMaintenance = typeof window !== 'undefined' && (
    window.location.search.includes('bypass_maintenance=1') || 
    window.location.search.includes('admin_preview=1')
  );

  if (storeInfo.isMaintenance && !hasBypassMaintenance) {
    return <MaintenancePage />;
  }

  if (!hasName && !isTotemPath && salesChannel !== 'kiosk') {
    const isKioskMode = false;

    if (showFormSuccess) {
      return (
        <div className="min-h-screen bg-stone-900 flex flex-col items-center justify-center p-4">
          <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-2xl max-w-md w-full text-center border border-stone-200 animate-in fade-in zoom-in duration-200">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 animate-bounce" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-stone-900 mb-2 uppercase tracking-tight">Tudo Pronto!</h2>
            <p className="text-stone-600 font-medium text-sm sm:text-base">
              Seja bem-vindo(a), <strong className="text-orange-600">{customerName.split(' ')[0]}</strong>!<br />
              Abrindo o cardápio para você...
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-[#f8f7f5] flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="bg-white p-6 sm:p-10 rounded-3xl shadow-xl max-w-md w-full text-center border border-stone-200">
          {storeInfo.logoUrl ? (
            <img 
              src={storeInfo.logoUrl} 
              alt="Logo" 
              className="h-20 sm:h-24 w-auto mx-auto mb-4 object-contain"
              referrerPolicy="no-referrer"
            />
          ) : null}

          {isKioskMode ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-900 rounded-full text-xs font-black uppercase tracking-wider mb-3">
              <span>📱 Autoatendimento (Totem)</span>
            </div>
          ) : null}

          <h2 className="text-2xl sm:text-3xl font-black text-stone-900 mb-1 uppercase tracking-tight">
            {isKioskMode ? 'Inicie seu Pedido' : 'Bem-vindo!'}
          </h2>
          <p className="text-stone-500 mb-6 font-medium text-xs sm:text-sm">
            {isKioskMode 
              ? 'Por favor, digite seu nome e WhatsApp para iniciar:' 
              : (storeInfo.headerPhrase || 'Faça seu pedido com facilidade')}
          </p>
          
          <form 
            onSubmit={async (e) => {
              e.preventDefault();
              const phoneDigits = customerPhone.replace(/\D/g, '');
              
              if (customerName.trim() && phoneDigits.length >= 10) {
                setIsBakeryLoading(true);
                
                // Enviar para o NTFY (Push Notification instantânea)
                try {
                  const nowStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                  await sendNtfyNotification({
                    enabled: storeInfo.ntfyEnabled !== false,
                    topic: storeInfo.ntfyTopic || 'paomania_pedidos',
                    title: `🥖 Novo Cliente no ${isKioskMode ? 'Totem' : 'Cardápio'}!`,
                    message: `Nome: ${customerName.trim()}\nWhatsApp: ${customerPhone.trim()}\nHorário: ${nowStr}\nCanal: ${isKioskMode ? 'Totem Autoatendimento' : salesChannel === 'delivery' ? 'Delivery' : 'Loja Presencial'}`,
                    priority: 4,
                    tags: ['bust_in_silhouette', 'bread', 'new_customer']
                  });
                } catch (ntfyErr) {
                  console.warn('Falha no envio NTFY:', ntfyErr);
                }

                // Enviar para o Formspree (e-mail)
                try {
                  const formData = new FormData();
                  formData.append('name', customerName);
                  formData.append('whatsapp', customerPhone);
                  formData.append('canal', isKioskMode ? 'Totem Autoatendimento' : salesChannel);
                  formData.append('_subject', 'Novo cliente acessou o cardápio - BALBEC');

                  await fetch('https://formspree.io/f/xbdzbeoq', {
                    method: 'POST',
                    body: formData,
                    headers: { 'Accept': 'application/json' }
                  });
                } catch (error) {
                  console.error('Erro ao enviar e-mail de notificação:', error);
                }

                setIsBakeryLoading(false);
                
                // Salvar no localStorage e registrar lead apenas se for cliente de delivery ou consumo na loja (totem NÃO vira lead)
                if (!isKioskMode) {
                  safeStorage.setItem('paomania_customer_name', customerName);
                  safeStorage.setItem('paomania_customer_phone', customerPhone);

                  try {
                    const isDelivery = salesChannel === 'delivery';
                    saveCustomer({
                      name: customerName.trim(),
                      phone: customerPhone.trim(),
                      source: isDelivery ? 'delivery' : 'instore',
                      tags: isDelivery ? ['Lead', 'Delivery'] : ['Lead', 'Consumo Loja']
                    }).catch(e => console.warn('Falha ao registrar lead no app:', e));
                  } catch (leadErr) {}
                }

                if (isKioskMode) {
                  setSalesChannel('kiosk');
                  setHasChosenChannel(true);
                  setHasName(true);
                } else {
                  setShowFormSuccess(true);
                  setTimeout(() => {
                    setShowFormSuccess(false);
                    setHasName(true);
                  }, 1200);
                }
              } else if (!customerName.trim()) {
                alert('Por favor, preencha seu nome.');
              } else {
                alert('Por favor, preencha um WhatsApp válido com DDD (ex: 34 99999-9999).');
              }
            }}
            className="space-y-4"
          >
            <div className="text-left space-y-3.5">
              <div>
                <label className="block text-xs font-black text-stone-700 mb-1.5 uppercase tracking-wider">
                  Qual é o seu nome?
                </label>
                <input 
                  type="text" 
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Digite seu nome completo"
                  className="w-full p-3.5 sm:p-4 bg-stone-50 border-2 border-stone-200 rounded-2xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all text-base sm:text-lg font-bold text-stone-900 placeholder:text-stone-400"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-black text-stone-700 mb-1.5 uppercase tracking-wider">
                  Telefone / WhatsApp
                </label>
                <input 
                  type="tel" 
                  value={customerPhone}
                  onChange={handlePhoneChange}
                  placeholder="(00) 00000-0000"
                  className="w-full p-3.5 sm:p-4 bg-stone-50 border-2 border-stone-200 rounded-2xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all text-base sm:text-lg font-bold text-stone-900 placeholder:text-stone-400 font-mono"
                  required
                />
              </div>
            </div>
            
            <button 
              type="submit"
              className="w-full py-4 text-white rounded-2xl font-black text-base sm:text-lg transition-all hover:scale-[1.01] active:scale-[0.98] shadow-lg shadow-orange-500/25 mt-2 cursor-pointer"
              style={{ backgroundColor: storeInfo.themeColor || '#ea580c' }}
            >
              {isKioskMode ? 'INICIAR PEDIDO 🥖' : 'VER CARDÁPIO'}
            </button>
          </form>
          
          <div className="mt-6 pt-5 border-t border-stone-100 flex flex-col gap-1 items-center">
            <p className="text-xs text-stone-400 uppercase font-bold tracking-widest mb-0.5">{storeInfo.name || 'BALBEC - Portal de Franqueados'}</p>
            {storeInfo.address ? <p className="text-xs text-stone-500 mb-1">{storeInfo.address}</p> : null}
            <div className="text-[10px] text-stone-400 uppercase tracking-wider font-medium">
              <p>Portal Oficial de Franqueados</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-[#f8f7f5] overflow-hidden font-sans">
      {isSendingOrder && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-stone-900/90 text-white p-6 text-center">
          <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-6"></div>
          <h2 className="text-3xl font-bold animate-pulse">ENVIANDO SEU PEDIDO...</h2>
        </div>
      )}
      <BakeryLoader isLoading={isBakeryLoading} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Brown Bar */}
        <div className="h-8 shrink-0 w-full bg-[#5c4033]"></div>

        {/* Modern Header */}
        <header className="bg-white border-b border-stone-200 shrink-0 z-30 pt-2 sm:pt-3 md:pt-4 pb-2 md:pb-3">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 min-h-[3.25rem] md:min-h-[4.5rem] flex items-center justify-between gap-2.5 sm:gap-3 md:gap-4">
            <div className="flex items-center gap-2.5 sm:gap-3 md:gap-4 truncate">
              {storeInfo.logoUrl ? (
                <img 
                  src={storeInfo.logoUrl} 
                  alt="Logo" 
                  className="h-12 sm:h-16 md:h-24 w-auto object-contain shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <div className="block truncate">
                <h1 className="text-xs sm:text-base md:text-lg font-bold text-[#5c4033] truncate leading-tight uppercase tracking-tight">{storeInfo.name}</h1>
                <p className="text-[10px] sm:text-xs text-stone-500 font-medium truncate italic hidden sm:block">{storeInfo.headerPhrase}</p>
              </div>
            </div>

            {/* Search Bar - Center/Right */}
            <div className="flex-1 max-w-md relative group">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 group-focus-within:text-orange-500 transition-colors">
                <Search className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <input 
                type="text"
                placeholder="O que você procura hoje?"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 sm:pl-10 pr-8 sm:pr-10 py-1.5 sm:py-2 md:py-3 bg-stone-100 border-none rounded-xl sm:rounded-2xl focus:ring-2 focus:ring-orange-500 focus:bg-white transition-all text-xs sm:text-sm md:text-base font-medium"
              />
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                >
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              )}
            </div>

            {/* Desktop Cart Button & Status */}
            {!isMobile && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleManualSync}
                  disabled={isRefreshing}
                  title="Atualizar Cardápio Agora"
                  className="flex items-center gap-1.5 px-3.5 py-2.5 bg-stone-100 hover:bg-stone-200 active:scale-95 text-stone-700 font-semibold rounded-xl text-xs transition-all shadow-sm cursor-pointer shrink-0 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 text-stone-600 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span>{isRefreshing ? 'Atualizando...' : 'Atualizar'}</span>
                </button>

                <div className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${storeInfo.isOpen ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {storeInfo.isOpen ? 'Aberto' : 'Fechado'}
                </div>

                <button 
                  onClick={() => setIsCartOpen(prev => !prev)}
                  className="relative flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold rounded-xl shadow transition-all cursor-pointer"
                  title="Ver Carrinho"
                >
                  <ShoppingCart className="w-5 h-5 text-white" />
                  <span className="text-sm">Carrinho</span>
                  {cart.length > 0 && (
                    <span className="ml-1 bg-white text-red-600 text-xs font-black px-2 py-0.5 rounded-full shadow-sm">
                      {cart.reduce((sum, item) => sum + item.quantity, 0)}
                    </span>
                  )}
                </button>
              </div>
            )}
            
            {/* Mobile Header Actions */}
            {isMobile && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleManualSync}
                  disabled={isRefreshing}
                  title="Atualizar Cardápio"
                  className="p-2 bg-stone-100 hover:bg-stone-200 active:scale-95 text-stone-700 rounded-xl transition-all shadow-sm flex items-center justify-center disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 sm:w-5 sm:h-5 text-stone-600 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>

                {cart.length > 0 && (
                  <button 
                    onClick={() => setIsCartOpen(true)}
                    className="relative p-2 bg-red-600 hover:bg-red-700 text-white rounded-xl shadow transition-all"
                  >
                    <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                    <span className="absolute -top-1.5 -right-1.5 bg-stone-900 text-white text-[10px] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center border border-white">
                      {cart.reduce((sum, item) => sum + item.quantity, 0)}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Channel Info Bar (when selected) */}
        {hasChosenChannel && (
          <div className="bg-stone-900 text-stone-100 py-2.5 px-4 shrink-0 z-20 border-b border-stone-800 text-xs font-medium">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-stone-400 font-semibold">Modo de Pedido:</span>
                {salesChannel === 'delivery' ? (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs ${
                    canBuy 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${canBuy ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                    🛵 Delivery {canBuy ? '(Entrega em Domicílio)' : '(Apenas Visualização 👁️)'}
                  </span>
                ) : salesChannel === 'kiosk' ? (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs ${
                    canBuy 
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' 
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${canBuy ? 'bg-blue-400 animate-pulse' : 'bg-amber-400'}`}></span>
                    📱 Autoatendimento {canBuy ? '(Totem / Tablet)' : '(Apenas Visualização 👁️)'}
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs ${
                      canBuy 
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' 
                        : 'bg-stone-500/20 text-stone-300 border border-stone-500/40'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${canBuy ? 'bg-amber-400 animate-pulse' : 'bg-stone-400'}`}></span>
                      🍽️ Consumo na Loja {canBuy ? (selectedTableNumber ? `(Mesa ${selectedTableNumber})` : '(Mesa / Balcão)') : '(Apenas Visualização 👁️)'}
                    </span>
                    {selectedTableNumber ? (
                      <button
                        type="button"
                        onClick={() => setShowTableSelectModal(true)}
                        className="text-[11px] bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 px-2 py-0.5 rounded-md font-bold transition-colors cursor-pointer border border-amber-500/40 flex items-center gap-1"
                      >
                        <UtensilsCrossed className="w-3 h-3" />
                        <span>Mesa {selectedTableNumber}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowTableSelectModal(true)}
                        className="text-[11px] bg-amber-600/30 text-amber-200 hover:bg-amber-600/50 px-2 py-0.5 rounded-md font-bold transition-colors cursor-pointer border border-amber-500/40 flex items-center gap-1"
                      >
                        <QrCode className="w-3 h-3" />
                        <span>Escolher Mesa</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                {!isTotemPath && visibleChannels.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setHasChosenChannel(false)}
                    className="text-[11px] text-stone-400 hover:text-white underline cursor-pointer transition-colors"
                  >
                    Alterar modalidade
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Read-only viewing mode notice banner */}
        {hasChosenChannel && !canBuy && (
          <div className="bg-amber-500 text-stone-950 font-bold text-xs sm:text-sm py-2.5 px-4 text-center flex items-center justify-center gap-2 shadow-sm border-b border-amber-600">
            <span className="text-base">👁️</span>
            <span>
              {!storeInfo.isOpen 
                ? 'A loja está fechada temporariamente no painel de controle. Navegando em modo de apenas visualização.' 
                : !currentStatus.isOpenNow
                  ? (currentStatus.details || 'Fora do horário de atendimento da loja. Navegando em modo de apenas visualização.')
                  : requireQrCode && !isQrValidated
                    ? 'Cardápio em Modo Apenas Visualização. Para fazer um pedido, escaneie o QR Code na mesa do estabelecimento!'
                    : salesChannel === 'delivery' && !isDeliveryActive
                      ? 'O Delivery está pausado temporariamente no painel. Navegando em modo de apenas visualização.'
                      : `A modalidade ${salesChannel === 'delivery' ? 'Delivery' : salesChannel === 'kiosk' ? 'Autoatendimento (Totem)' : 'Consumo na Loja'} está em modo de apenas visualização.`}
            </span>
          </div>
        )}

        {/* Informational banner when store is manually forced open outside schedule */}
        {hasChosenChannel && canBuy && storeInfo.forceOpen && !currentStatus.isWithinSchedule && (
          <div className="bg-emerald-600 text-white font-bold text-xs py-2 px-4 text-center flex items-center justify-center gap-2 shadow-xs border-b border-emerald-700">
            <span>⚡ Abertura manual ativa no painel • Pedidos liberados</span>
          </div>
        )}

        {/* Modal Obrigatório de Seleção de Canal de Venda */}
        {!hasChosenChannel && (
          <div className="fixed inset-0 z-[100] bg-stone-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
            <div className="bg-white rounded-3xl max-w-3xl w-full p-4 sm:p-8 shadow-2xl border border-stone-100 space-y-4 sm:space-y-6 text-center transform transition-all animate-fadeIn my-auto max-h-[95vh] overflow-y-auto">
              
              {/* Icon / Brand Avatar */}
              <div className="mx-auto w-14 h-14 sm:w-16 sm:h-16 bg-orange-100 border border-orange-200 rounded-2xl flex items-center justify-center text-2xl sm:text-3xl shadow-sm">
                🥐
              </div>

              <div className="space-y-1.5 sm:space-y-2">
                <h2 className="text-xl sm:text-3xl font-black text-stone-900 tracking-tight leading-tight">
                  Como deseja fazer seu pedido?
                </h2>
                <p className="text-stone-600 text-xs sm:text-sm font-medium leading-relaxed max-w-lg mx-auto">
                  Selecione onde você está ou como deseja ser atendido hoje:
                </p>
              </div>

              <div className={`grid gap-4 pt-2 ${visibleChannels.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 max-w-md mx-auto'}`}>
                {/* In-Store Option (Consumo na Loja / Mesa / Balcão) */}
                {hasInStoreCategories && (
                  <button
                    type="button"
                    onClick={() => handleSelectChannel('instore')}
                    className="group relative flex flex-col items-center p-6 bg-stone-50 hover:bg-amber-50/80 border-2 border-stone-200 hover:border-amber-500 rounded-2xl transition-all duration-200 text-left cursor-pointer hover:shadow-lg active:scale-98"
                  >
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mb-3 transition-colors shadow-sm ${
                      isInStoreActive && currentStatus.isOpenNow
                        ? 'bg-amber-100 group-hover:bg-amber-600 group-hover:text-white text-amber-800'
                        : 'bg-stone-200 text-stone-600'
                    }`}>
                      🍽️
                    </div>
                    <span className="font-extrabold text-stone-900 group-hover:text-amber-800 text-lg mb-1 text-center">
                      Consumo na Loja
                    </span>
                    <span className="text-xs sm:text-sm text-stone-600 group-hover:text-stone-800 text-center leading-relaxed">
                      {isInStoreActive && currentStatus.isOpenNow
                        ? 'Faça seu pedido diretamente pelo celular para consumir na mesa ou retirar no balcão.'
                        : 'Consulte os preços e itens no celular. Faça seu pedido diretamente com o atendente ou no balcão da loja.'}
                    </span>

                    {isInStoreActive && currentStatus.isOpenNow ? (
                      <div className="mt-4 text-[11px] uppercase font-extrabold tracking-wider px-3 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300/80 rounded-full flex items-center gap-1.5">
                        <span>⚡</span>
                        <span>Pedidos Habilitados</span>
                      </div>
                    ) : (
                      <div className="mt-4 text-[11px] uppercase font-extrabold tracking-wider px-3 py-1 bg-amber-100 text-amber-900 border border-amber-200/80 rounded-full flex items-center gap-1.5">
                        <span>👁️</span>
                        <span>Apenas Visualização</span>
                      </div>
                    )}
                  </button>
                )}

                {/* Delivery Option */}
                {hasDeliveryCategories && (
                  <button
                    type="button"
                    onClick={() => handleSelectChannel('delivery')}
                    className="group relative flex flex-col items-center p-6 bg-stone-50 hover:bg-orange-50/80 border-2 border-stone-200 hover:border-orange-500 rounded-2xl transition-all duration-200 text-left cursor-pointer hover:shadow-lg active:scale-98"
                  >
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mb-3 transition-colors shadow-sm ${
                      isDeliveryActive && currentStatus.isOpenNow
                        ? 'bg-orange-100 group-hover:bg-orange-600 group-hover:text-white text-orange-700'
                        : 'bg-stone-200 text-stone-600'
                    }`}>
                      🛵
                    </div>
                    <span className="font-extrabold text-stone-900 group-hover:text-orange-700 text-lg mb-1 text-center">
                      Entrega / Delivery
                    </span>
                    <span className="text-xs sm:text-sm text-stone-600 group-hover:text-stone-800 text-center leading-relaxed">
                      {isDeliveryActive && currentStatus.isOpenNow ? 'Faça seu pedido online e receba quentinho no conforto da sua casa.' : 'Apenas visualização do cardápio online para entrega.'}
                    </span>
                    
                    {isDeliveryActive && currentStatus.isOpenNow ? (
                      <div className="mt-4 text-[11px] uppercase font-extrabold tracking-wider px-3 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300/80 rounded-full flex items-center gap-1.5">
                        <span>⚡</span>
                        <span>Delivery Ativo</span>
                      </div>
                    ) : (
                      <div className="mt-4 text-[11px] uppercase font-extrabold tracking-wider px-3 py-1 bg-amber-100 text-amber-900 border border-amber-200/80 rounded-full flex items-center gap-1.5">
                        <span>👁️</span>
                        <span>Apenas Visualização</span>
                      </div>
                    )}
                  </button>
                )}

                {visibleChannels.length === 0 && (
                  <div className="p-6 bg-stone-50 border border-stone-200 rounded-2xl text-stone-600 font-medium col-span-full">
                    Nenhuma categoria com produtos ativos disponível no momento.
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-stone-100">
                <p className="text-xs text-stone-600 font-medium leading-relaxed">
                  🥖 Bem-vindo à <strong>{storeInfo.name}</strong>! Escolha como deseja ser atendido hoje.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Categories Bar (Sticky sub-header on Top for All Devices) */}
        <div 
          ref={categoryBarRef}
          className="bg-white border-b border-stone-200 shrink-0 z-20 overflow-x-auto no-scrollbar scroll-smooth shadow-xs py-1.5 sm:py-2 px-2.5 sm:px-6"
        >
          <div className="flex gap-2 sm:gap-3 items-center relative max-w-4xl lg:max-w-7xl mx-auto">
            {availableCategories.map(cat => {
              const count = categoryCountMap[cat.id] || 0;
              return (
                <button
                  key={cat.id}
                  ref={el => { categoryButtonRefs.current[cat.id] = el; }}
                  onClick={() => scrollToCategory(cat.id)}
                  className={`px-3.5 sm:px-5 py-2 sm:py-3 rounded-xl sm:rounded-2xl whitespace-nowrap text-xs sm:text-base font-black transition-all flex items-center gap-1.5 sm:gap-2 shrink-0 cursor-pointer ${
                    activeCategory === cat.id 
                      ? 'text-white shadow-md shadow-orange-500/25 ring-2 ring-orange-500/30' 
                      : 'bg-stone-50 text-stone-700 hover:bg-stone-100 border border-stone-200'
                  }`}
                  style={activeCategory === cat.id ? { backgroundColor: storeInfo.themeColor || '#ea580c' } : {}}
                >
                  <span>{formatCapitalized(cat.name)}</span>
                  <span className={`text-[11px] sm:text-sm px-1.5 sm:px-2 py-0.5 rounded-full font-bold ${
                    activeCategory === cat.id 
                      ? 'bg-black/20 text-white' 
                      : 'bg-stone-200 text-stone-700'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content Body: Product Feed (1 per line on Mobile/Tablet, 2 per line on Desktop) */}
        <div className="flex-1 flex overflow-hidden">
          {/* Product Feed */}
          <main ref={productsContainerRef} className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-8 scroll-smooth" id="product-feed">
            {availableCategories.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-stone-500 p-8 text-center">
                <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center text-3xl mb-4 shadow-sm">
                  🏛️
                </div>
                <h3 className="text-2xl font-black text-stone-900 mb-2">Portal Pronto para Integração</h3>
                <p className="text-sm text-stone-600 max-w-md mb-6 leading-relaxed">
                  O banco de dados foi completamente zerado. Nenhum produto ou categoria cadastrada no momento. Utilize o Painel Administrativo para cadastrar os dados ou realizar sua integração via API.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Link
                    to="/admin"
                    className="px-6 py-3.5 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-black text-sm transition-all shadow-lg shadow-orange-600/30 flex items-center gap-2"
                  >
                    <Settings className="w-4 h-4" />
                    <span>Acessar Painel Administrativo</span>
                  </Link>
                  <button 
                    onClick={() => setSearchTerm('')}
                    className="px-6 py-3.5 bg-white border border-stone-200 rounded-2xl font-bold text-stone-700 hover:bg-stone-50 transition-all shadow-xs"
                  >
                    Limpar Busca
                  </button>
                </div>
              </div>
            ) : (
              displayedCategories.map(category => {
                const categoryProducts = productsByCategory[category.id] || [];
                if (categoryProducts.length === 0) return null;

                return (
                  <div 
                    key={category.id} 
                    ref={el => { categoryRefs.current[category.id] = el; }}
                    className="mb-8 sm:mb-12 max-w-4xl lg:max-w-7xl mx-auto scroll-mt-4 md:scroll-mt-8"
                    style={{ contentVisibility: 'auto', containIntrinsicSize: '0 400px' }}
                  >
                    <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-8">
                      <h2 className="text-base sm:text-xl md:text-2xl font-black text-red-600 tracking-wider">{formatCapitalized(category.name)}</h2>
                      <div className="flex-1 h-px bg-stone-200"></div>
                      <span className="text-xs sm:text-sm font-bold text-stone-400 uppercase tracking-widest">{categoryProducts.length} {categoryProducts.length === 1 ? 'item' : 'itens'}</span>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-6">
                      {categoryProducts.map(product => (
                        <div 
                          key={product.id} 
                          className="bg-white rounded-2xl sm:rounded-3xl border border-stone-200/90 p-3 sm:p-5 md:p-6 lg:p-5 flex gap-3 sm:gap-6 lg:gap-4 hover:shadow-xl hover:shadow-stone-200/50 transition-all group items-center"
                        >
                          <div className="w-22 h-22 sm:w-36 sm:h-36 md:w-44 md:h-44 lg:w-32 lg:h-32 xl:w-36 xl:h-36 shrink-0 bg-stone-50 rounded-xl sm:rounded-2xl overflow-hidden relative flex items-center justify-center border border-stone-100">
                            <ProductImage 
                              src={product.imageUrl} 
                              alt={product.name}
                              className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-500"
                            />
                          </div>

                          <div className="flex-1 flex flex-col justify-between self-stretch min-w-0 py-0.5 sm:py-1">
                            <div>
                              <h3 className="text-sm sm:text-xl md:text-2xl lg:text-lg xl:text-xl font-black text-[#5c4033] leading-snug mb-1 tracking-tight line-clamp-2">
                                {formatCapitalized(product.name)}
                              </h3>
                              {(product.externalId || product.description) && (
                                <p className="text-xs sm:text-base lg:text-xs xl:text-sm text-red-600 line-clamp-2 sm:line-clamp-3 mb-2 leading-relaxed font-medium italic">
                                  {formatCapitalized(formatProductDescriptionWithCode(product.description, product.externalId))}
                                </p>
                              )}
                            </div>
                            
                            <div className="mt-auto pt-1 sm:pt-2 flex items-center justify-between gap-2 sm:gap-3">
                              <span className="text-base sm:text-2xl md:text-3xl lg:text-xl xl:text-2xl font-black text-orange-600">
                                {formatCurrency(product.price)}
                              </span>
                              {isAddonProduct(product) ? (
                                <span className="text-[11px] sm:text-sm font-bold text-amber-800 bg-amber-50 border border-amber-200/80 px-2.5 py-1 sm:px-3 sm:py-2 rounded-xl select-none">
                                  Apenas nos lanches
                                </span>
                              ) : !canBuy ? (
                                <span className="text-[11px] sm:text-sm font-bold text-stone-500 bg-stone-100 border border-stone-200/80 px-2 py-1 sm:px-3 sm:py-2 rounded-xl select-none flex items-center gap-1">
                                  👁️ Apenas visualização
                                </span>
                              ) : (
                                <button 
                                  onClick={() => initiateAddToCart(product)}
                                  disabled={!canBuy}
                                  className="w-10 h-10 sm:w-14 sm:h-14 lg:w-11 lg:h-11 xl:w-12 xl:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center text-white transition-all transform active:scale-95 shadow-md shadow-orange-500/30 cursor-pointer shrink-0"
                                  style={{ backgroundColor: storeInfo.addButtonColor || storeInfo.themeColor }}
                                  title="Adicionar ao pedido"
                                >
                                  <Plus className="w-5 h-5 sm:w-8 sm:h-8 lg:w-6 lg:h-6 xl:w-7 xl:h-7" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}

            {/* Redesigned Footer */}
            <footer className="mt-12 py-12 border-t border-stone-200 flex flex-col items-center text-center">
              {storeInfo.logoUrl ? (
                <img 
                  src={storeInfo.logoUrl} 
                  alt="Logo" 
                  className="h-10 w-auto object-contain opacity-20 mb-6"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <p className="text-stone-400 text-[10px] font-black uppercase tracking-[0.2em] mb-1">
                © {new Date().getFullYear()} {storeInfo.name}
              </p>
              <div className="text-stone-400 text-[10px] font-medium uppercase tracking-wider mb-4 space-y-1">
                <p>CNPJ: 03.162.220/0001-00</p>
                <p>Telefone: (34) 3338-3795</p>
              </div>
              <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
                <Link to="/privacidade" className="text-stone-400 hover:text-amber-600 transition-colors text-xs font-medium">
                  Privacidade & LGPD
                </Link>
                <Link to="/admin" className="text-stone-400 hover:text-orange-500 transition-colors flex items-center gap-1.5 text-xs font-medium">
                  <Settings className="w-4 h-4" />
                  <span>Painel de Controle</span>
                </Link>
                <a 
                  href={`https://wa.me/553433383795`} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-stone-400 hover:text-emerald-600 transition-colors text-xs font-medium"
                >
                  Fale Conosco
                </a>
              </nav>
            </footer>
          </main>
        </div>
      </div>

      {/* Sticky Bottom Red Checkout Bar (For All Screens: Mobile, Tablet & Desktop) */}
      {!isCartOpen && cart.length > 0 && !isCheckout && (
        <div className="fixed bottom-0 left-0 right-0 p-3 sm:p-4 z-[40] max-w-xl mx-auto pointer-events-auto">
          <button
            onClick={() => setIsCartOpen(true)}
            className="w-full h-14 sm:h-16 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-2xl shadow-2xl flex items-center justify-between px-4 sm:px-6 transform active:scale-[0.98] transition-all cursor-pointer border-2 border-red-500/60"
          >
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="bg-red-900/80 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl text-xs sm:text-sm font-black tracking-wide border border-red-400/40">
                {cart.reduce((sum, item) => sum + item.quantity, 0)} {cart.reduce((sum, item) => sum + item.quantity, 0) === 1 ? 'item' : 'itens'}
              </div>
              <span className="font-extrabold text-xs sm:text-base uppercase tracking-tight">Ver Carrinho</span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-base sm:text-xl font-black">{formatCurrency(total)}</span>
              <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </button>
        </div>
      )}

      {/* Cart Drawer Modal Backdrop */}
      {isCartOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 transition-opacity"
          onClick={() => setIsCartOpen(false)}
        />
      )}

      {/* Cart Drawer (Sliding Panel for Desktop, Tablet & Mobile) */}
      <div className={`
        bg-white flex flex-col h-full shrink-0 z-50 fixed inset-y-0 right-0 w-full sm:w-112 md:w-120 shadow-2xl transform transition-transform duration-300 ease-out
        ${isCartOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'}
      `}>
        {/* Top Header: "Voltar às Compras" + Close Button */}
        <div className="p-4 bg-stone-900 text-white border-b border-stone-800 flex items-center justify-between">
          <button 
            onClick={() => setIsCartOpen(false)}
            className="px-3.5 py-2 bg-stone-800 hover:bg-stone-700 text-orange-400 rounded-xl font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar às Compras</span>
          </button>

          <button 
            onClick={() => setIsCartOpen(false)} 
            className="w-8 h-8 rounded-full bg-stone-800 text-stone-300 flex items-center justify-center hover:bg-stone-700 hover:text-white transition-colors cursor-pointer"
            title="Fechar Carrinho"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cart Title Bar */}
        <div className="px-6 py-4 border-b border-stone-100 bg-stone-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShoppingCart className="w-6 h-6" style={{ color: storeInfo.themeColor || '#ea580c' }} />
            <h2 className="text-xl font-black text-stone-900">Seu Pedido ({cart.reduce((sum, item) => sum + item.quantity, 0)})</h2>
          </div>
          {cart.length > 0 && (
            <button
              onClick={() => {
                setCart([]);
                safeStorage.removeItem('paomania_active_cart');
              }}
              className="text-xs text-stone-500 hover:text-red-600 font-bold transition-colors cursor-pointer"
            >
              Limpar Pedido
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-stone-400 p-8 text-center">
              <ShoppingCart className="w-16 h-16 mb-4 opacity-20 text-stone-600" />
              <p className="font-bold text-stone-700 text-base mb-1">Seu carrinho está vazio</p>
              <p className="text-xs text-stone-500 mb-6">Navegue pelo cardápio e adicione seus itens favoritos.</p>
              <button
                onClick={() => setIsCartOpen(false)}
                className="px-5 py-2.5 bg-orange-600 text-white rounded-xl font-bold text-sm hover:bg-orange-700 transition-colors cursor-pointer flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Ver Cardápio</span>
              </button>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.productId + JSON.stringify(item.addons) + JSON.stringify(item.flavor)} className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs flex gap-4 items-center">
                <div className="w-16 h-16 bg-stone-50 rounded-xl overflow-hidden shrink-0 border border-stone-100">
                  <ProductImage 
                    src={item.imageUrl} 
                    alt={item.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between font-bold mb-1">
                    <span className="line-clamp-1 pr-2 text-stone-900">{formatCapitalized(item.name)}</span>
                    <span className="text-orange-600 font-black">{formatCurrency((item.price + (item.flavor?.price || 0) + (item.addons?.reduce((sum, a) => sum + a.price, 0) || 0)) * item.quantity)}</span>
                  </div>
                  {item.description && (
                    <div className="text-xs text-red-600 italic font-medium line-clamp-1 mb-0.5">
                      {formatCapitalized(item.description)}
                    </div>
                  )}
                  {item.flavor && (
                    <div className="text-xs text-stone-500 mb-0.5 truncate">
                      Sabor: {formatCapitalized(item.flavor.name)}
                      {resolveAddonCode(item.flavor) && (
                        <span className="font-mono text-[10px] font-bold text-stone-700 ml-1">[CÓD: {resolveAddonCode(item.flavor)}]</span>
                      )}
                    </div>
                  )}
                  {item.addons && item.addons.length > 0 && (
                    <div className="text-xs text-stone-500 mb-0.5 space-y-0.5">
                      {item.addons.map((a, aIdx) => {
                        const aCode = a.externalId || a.code || resolveAddonCode(a);
                        return (
                          <div key={aIdx} className="truncate">
                            + {formatCapitalized(a.name)}
                            {aCode && (
                              <span className="font-mono text-[10px] font-bold text-stone-700 ml-1">[CÓD: {aCode}]</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-stone-100">
                    <span className="text-xs text-stone-400 font-medium">{formatCurrency(item.price + (item.flavor?.price || 0) + (item.addons?.reduce((sum, a) => sum + a.price, 0) || 0))} un</span>
                    <div className="flex items-center gap-2 bg-stone-100 rounded-xl p-1">
                      <button 
                        onClick={() => updateQuantity(item.productId, item.addons, item.flavor, -1)}
                        className="p-1 hover:bg-white rounded-lg text-stone-600 hover:text-stone-900 transition-colors cursor-pointer"
                        title="Diminuir"
                      >
                        {item.quantity === 1 ? <Trash2 className="w-4 h-4 text-red-500" /> : <Minus className="w-4 h-4" />}
                      </button>
                      <span className="font-black text-sm w-6 text-center text-stone-900">{item.quantity}</span>
                      <button 
                        onClick={() => updateQuantity(item.productId, item.addons, item.flavor, 1)}
                        className="p-1 hover:bg-white rounded-lg text-stone-600 hover:text-stone-900 transition-colors cursor-pointer"
                        title="Aumentar"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {cart.length > 0 && (
          <div className="p-5 border-t border-stone-200 bg-stone-50 space-y-3 shrink-0">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-stone-600">Total do Pedido</span>
              <span className="text-2xl font-black text-stone-900">{formatCurrency(total)}</span>
            </div>

            {/* Primary Finish Button */}
            <button 
              onClick={() => {
                setIsCartOpen(false);
                setIsCheckout(true);
              }}
              disabled={cart.length === 0 || !canBuy}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-stone-300 text-white rounded-2xl font-black text-base transition-all shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 cursor-pointer"
            >
              {!storeInfo.isOpen ? 'Loja Fechada' : !canBuy ? 'Somente Visualização' : (
                <>
                  <span>Finalizar Pedido</span>
                  <ChevronRight className="w-5 h-5" />
                </>
              )}
            </button>

            {/* Secondary "Voltar às Compras" Button */}
            <button
              type="button"
              onClick={() => setIsCartOpen(false)}
              className="w-full py-3 px-4 bg-white hover:bg-stone-100 text-stone-700 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer border border-stone-200"
            >
              <ArrowLeft className="w-4 h-4 text-orange-600" />
              <span>Voltar às Compras e Adicionar Mais Itens</span>
            </button>
          </div>
        )}
      </div>

      {/* Addon Modal */}
      {addonModal.isOpen && addonModal.product && (() => {
        const maxAddons = addonModal.product.maxAddons || 3;
        const { availableAddons, availableFlavors } = addonModal;
        const hasFlavors = availableFlavors.length > 0;
        const hasAddons = availableAddons.length > 0;
        const basePrice = addonModal.product.price || 0;
        const addonsTotal = addonModal.selectedAddons.reduce((sum, a) => sum + (a.price || 0), 0);
        const flavorPrice = addonModal.selectedFlavor?.price || 0;
        const currentTotal = basePrice + addonsTotal + flavorPrice;
        const isFlavorMissing = hasFlavors && !addonModal.selectedFlavor;

        const handleAddWithoutAddons = () => {
          addToCart(addonModal.product, [], addonModal.selectedFlavor);
        };

        const handleCancelOrClose = () => {
          // Se tiver apenas adicionais opcionais (sem sabor obrigatório pendente), adiciona o item normalmente como solicitado pelo usuário
          if (!hasFlavors && hasAddons) {
            addToCart(addonModal.product, [], null);
          } else {
            setAddonModal({ isOpen: false, product: null, selectedAddons: [], selectedFlavor: null, availableAddons: [], availableFlavors: [] });
          }
        };

        return (
        <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 sm:p-7 max-w-lg w-full shadow-2xl border border-stone-100 max-h-[90vh] flex flex-col">
            
            {/* Header */}
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-stone-100">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-stone-900 leading-tight">
                  {hasFlavors && !hasAddons ? 'Escolha o Sabor' : formatCapitalized(addonModal.product.name)}
                </h2>
                {(addonModal.product.externalId || addonModal.product.description) && (
                  <p className="text-xs sm:text-sm text-red-600 font-medium italic mt-1 line-clamp-2">
                    {formatCapitalized(formatProductDescriptionWithCode(addonModal.product.description, addonModal.product.externalId))}
                  </p>
                )}
                <p className="text-xs sm:text-sm text-stone-500 font-medium mt-0.5">
                  {hasFlavors && !hasAddons 
                    ? `Para: ${formatCapitalized(addonModal.product.name)}`
                    : hasAddons 
                      ? `Deseja adicionar algum adicional? (Opcional - até ${maxAddons})`
                      : 'Opções do item'}
                </p>
              </div>

              <button
                type="button"
                onClick={handleCancelOrClose}
                className="p-1.5 hover:bg-stone-100 rounded-full text-stone-400 hover:text-stone-700 transition-colors shrink-0 cursor-pointer"
                title="Fechar e adicionar sem adicionais"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
              
              {/* Sabores (Obrigatórios quando aplicável, ex: sucos/polpas) */}
              {hasFlavors && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black uppercase tracking-wider text-orange-700">1. Sabor (Obrigatório)</span>
                    {addonModal.selectedFlavor && (
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                        {addonModal.selectedFlavor.name}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {availableFlavors.map(flavor => {
                      const flavorCode = (flavor.externalId || (flavor as any).code || '').toString().trim();
                      return (
                      <label 
                        key={flavor.id} 
                        className={`flex items-center justify-between p-3.5 border-2 rounded-2xl cursor-pointer transition-all ${
                          addonModal.selectedFlavor?.productId === flavor.id 
                            ? 'border-orange-500 bg-orange-50/90 text-orange-950 font-bold shadow-xs' 
                            : 'border-stone-200 hover:border-stone-300 hover:bg-stone-50 text-stone-800'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input 
                            type="radio" 
                            name="flavor" 
                            className="w-5 h-5 text-orange-600 focus:ring-orange-500"
                            checked={addonModal.selectedFlavor?.productId === flavor.id}
                            onChange={() => setAddonModal(prev => ({ 
                              ...prev, 
                              selectedFlavor: { 
                                productId: flavor.id, 
                                name: flavor.name, 
                                price: flavor.price,
                                externalId: flavorCode,
                                code: flavorCode
                              } 
                            }))}
                          />
                          <span className="text-sm font-medium">
                            {formatCapitalized(flavor.name)}
                            {flavorCode && (
                              <span className="ml-1.5 text-[10px] font-mono font-bold bg-stone-100 text-stone-700 px-1.5 py-0.5 rounded border border-stone-200">
                                CÓD: {flavorCode}
                              </span>
                            )}
                          </span>
                        </div>
                      </label>
                    );
                    })}
                  </div>
                </div>
              )}

              {/* Adicionais / Complementos (Totalmente Opcionais) */}
              {hasAddons && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black uppercase tracking-wider text-stone-700">
                      Adicionais na Chapa / Lanche (Opcional - até {maxAddons})
                    </span>
                    {addonModal.selectedAddons.length > 0 && (
                      <span className="text-[11px] font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-md">
                        {addonModal.selectedAddons.length} de {maxAddons}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 max-h-[35vh] overflow-y-auto pr-1">
                    {availableAddons.map(addon => {
                      const addonCode = (addon.externalId || (addon as any).code || '').toString().trim();
                      const isSelected = addonModal.selectedAddons.some(a => a.productId === addon.id);
                      const isMaxReached = addonModal.selectedAddons.length >= maxAddons;
                      const isDisabled = !isSelected && isMaxReached;
                      
                      return (
                        <label 
                          key={addon.id} 
                          className={`flex items-center justify-between p-3.5 border-2 rounded-2xl transition-all ${
                            isDisabled 
                              ? 'opacity-40 cursor-not-allowed bg-stone-50 border-stone-200' 
                              : isSelected 
                                ? 'border-orange-500 bg-orange-50/90 cursor-pointer shadow-xs font-bold' 
                                : 'border-stone-200 hover:border-stone-300 hover:bg-stone-50 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input 
                              type="checkbox"
                              className="w-5 h-5 rounded text-orange-600 focus:ring-orange-500 cursor-pointer disabled:cursor-not-allowed"
                              checked={isSelected}
                              disabled={isDisabled}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  if (!isMaxReached) {
                                    setAddonModal(prev => ({ 
                                      ...prev, 
                                      selectedAddons: [
                                        ...prev.selectedAddons, 
                                        { 
                                          productId: addon.id, 
                                          name: addon.name, 
                                          price: addon.price,
                                          externalId: addonCode,
                                          code: addonCode
                                        }
                                      ] 
                                    }));
                                  }
                                } else {
                                  setAddonModal(prev => ({ ...prev, selectedAddons: prev.selectedAddons.filter(a => a.productId !== addon.id) }));
                                }
                              }}
                            />
                            <span className="text-sm text-stone-900">
                              {formatCapitalized(addon.name)}
                              {addonCode && (
                                <span className="ml-1.5 text-[10px] font-mono font-bold bg-stone-100 text-stone-700 px-1.5 py-0.5 rounded border border-stone-200">
                                  CÓD: {addonCode}
                                </span>
                              )}
                            </span>
                          </div>
                          <span className="text-xs sm:text-sm font-black text-orange-700">
                            {addon.price > 0 ? `+ ${formatCurrency(addon.price)}` : 'Grátis'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Actions Footer */}
            <div className="pt-4 border-t border-stone-100 flex flex-col sm:flex-row gap-2.5">
              
              {/* Botão para adicionar sem adicionais / lanche puro */}
              {hasAddons && !hasFlavors && (
                <button 
                  type="button"
                  onClick={handleAddWithoutAddons}
                  className="py-3.5 px-4 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-2xl font-bold text-xs sm:text-sm transition-all border border-stone-300/80 cursor-pointer flex-1 flex items-center justify-center gap-1.5 active:scale-98"
                >
                  <span>Sem Adicionais</span>
                  <span className="text-stone-500">({formatCurrency(basePrice)})</span>
                </button>
              )}

              {/* Botão Cancelar se for sabor */}
              {hasFlavors && (
                <button 
                  type="button"
                  onClick={() => setAddonModal({ isOpen: false, product: null, selectedAddons: [], selectedFlavor: null, availableAddons: [], availableFlavors: [] })} 
                  className="py-3.5 px-4 border-2 border-stone-200 hover:bg-stone-50 text-stone-700 rounded-2xl font-bold text-xs sm:text-sm transition-all cursor-pointer"
                >
                  Cancelar
                </button>
              )}

              {/* Botão Principal de Adicionar */}
              <button 
                type="button"
                onClick={() => addToCart(addonModal.product, addonModal.selectedAddons, addonModal.selectedFlavor)} 
                className={`py-3.5 px-5 text-white rounded-2xl font-extrabold text-sm sm:text-base transition-all shadow-lg flex-1 flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed ${
                  addonModal.selectedAddons.length > 0 ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-600/30' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30'
                }`}
                disabled={!canBuy || isFlavorMissing}
              >
                {!canBuy ? (
                  'Apenas Visualização'
                ) : isFlavorMissing ? (
                  'Selecione um Sabor'
                ) : addonModal.selectedAddons.length > 0 ? (
                  <>
                    <span>Adicionar ({addonModal.selectedAddons.length})</span>
                    <span className="bg-black/20 px-2 py-0.5 rounded-lg text-xs font-black">{formatCurrency(currentTotal)}</span>
                  </>
                ) : (
                  <>
                    <span>Adicionar ao Pedido</span>
                    <span className="bg-black/20 px-2 py-0.5 rounded-lg text-xs font-black">{formatCurrency(basePrice)}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )})()}

      {/* Modal de Seleção de Mesa */}
      {showTableSelectModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-stone-200 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center font-bold">
                  <UtensilsCrossed className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-stone-900 leading-tight">Identifique sua Mesa</h3>
                  <p className="text-xs text-stone-500">Selecione onde você está sentado no momento</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTableSelectModal(false)}
                className="p-2 text-stone-400 hover:text-stone-700 rounded-xl hover:bg-stone-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {tables && tables.filter(t => t.isActive).length > 0 ? (
                <div>
                  <p className="text-xs font-bold text-stone-600 mb-2 uppercase tracking-wider">Mesas Disponíveis:</p>
                  <div className="grid grid-cols-4 gap-2.5 max-h-56 overflow-y-auto p-1">
                    {tables.filter(t => t.isActive).map(tbl => (
                      <button
                        key={tbl.id}
                        type="button"
                        onClick={() => {
                          setSelectedTableNumber(tbl.number);
                          safeStorage.setSession('paomania_selected_table', String(tbl.number));
                          setShowTableSelectModal(false);
                        }}
                        className={`p-3 rounded-2xl flex flex-col items-center justify-center gap-1 border-2 transition-all cursor-pointer ${
                          selectedTableNumber === tbl.number
                            ? 'bg-amber-600 border-amber-700 text-white shadow-md'
                            : 'bg-stone-50 border-stone-200 text-stone-800 hover:border-amber-400 hover:bg-amber-50'
                        }`}
                      >
                        <UtensilsCrossed className="w-4 h-4 opacity-80" />
                        <span className="text-sm font-black">Mesa {tbl.number}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Digitação manual da mesa */}
              <div className="pt-2 border-t border-stone-100">
                <label className="block text-xs font-bold text-stone-700 mb-1">
                  Ou digite o número da sua mesa:
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    max="999"
                    placeholder="Ex: 5"
                    defaultValue={selectedTableNumber || ''}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const target = e.target as HTMLInputElement;
                        const val = parseInt(target.value, 10);
                        if (!isNaN(val) && val > 0) {
                          setSelectedTableNumber(val);
                          safeStorage.setSession('paomania_selected_table', String(val));
                          setShowTableSelectModal(false);
                        }
                      }
                    }}
                    id="manualTableInput"
                    className="flex-1 p-3 bg-stone-50 border-2 border-stone-200 rounded-xl text-base font-bold text-stone-900 focus:bg-white focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const input = document.getElementById('manualTableInput') as HTMLInputElement;
                      if (input) {
                        const val = parseInt(input.value, 10);
                        if (!isNaN(val) && val > 0) {
                          setSelectedTableNumber(val);
                          safeStorage.setSession('paomania_selected_table', String(val));
                          setShowTableSelectModal(false);
                        }
                      }
                    }}
                    className="px-4 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black text-sm transition-colors cursor-pointer"
                  >
                    Confirmar
                  </button>
                </div>
              </div>

              {selectedTableNumber && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTableNumber(null);
                    safeStorage.removeItem('paomania_selected_table');
                    setShowTableSelectModal(false);
                  }}
                  className="w-full py-2.5 text-xs font-bold text-stone-500 hover:text-red-600 border border-stone-200 rounded-xl transition-colors cursor-pointer"
                >
                  Remover Mesa (Retirada no Balcão)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating AI Virtual Agent Assistant - Disabled in Totem (Autoatendimento) mode */}
      {!isTotemPath && salesChannel !== 'kiosk' && (
        <AiAssistantFloatingButton 
          onAddToCart={(p) => initiateAddToCart(p)} 
          onAddDirectToCart={(product, qty) => {
            for (let i = 0; i < qty; i++) {
              addToCart(product);
            }
          }}
          hasCartItems={cart.length > 0}
        />
      )}
    </div>
  );
}
