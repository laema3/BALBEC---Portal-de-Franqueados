import { pgTable, text, integer, boolean, doublePrecision, jsonb, timestamp, serial, bigint } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table (linked to Firebase Auth UID)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  password: text('password'),
  name: text('name'),
  role: text('role').default('operator'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Categories table
export const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  order: integer('order').default(0),
  externalId: text('external_id'),
  isVisible: boolean('is_visible').default(true),
  availableForDelivery: boolean('available_for_delivery').default(true),
  availableInStore: boolean('available_in_store').default(true),
  availableForKiosk: boolean('available_for_kiosk').default(true),
});

// Products table
export const products = pgTable('products', {
  id: text('id').primaryKey(),
  categoryId: text('category_id'),
  name: text('name').notNull(),
  description: text('description').default(''),
  price: doublePrecision('price').notNull().default(0),
  imageUrl: text('image_url').default(''),
  isActive: boolean('is_active').default(true),
  isAddon: boolean('is_addon').default(false),
  isFlavor: boolean('is_flavor').default(false),
  addonIds: jsonb('addon_ids').$type<string[]>().default([]),
  maxAddons: integer('max_addons').default(0),
  flavorIds: jsonb('flavor_ids').$type<string[]>().default([]),
  externalId: text('external_id'),
  availableForDelivery: boolean('available_for_delivery').default(true),
  availableInStore: boolean('available_in_store').default(true),
  availableForKiosk: boolean('available_for_kiosk').default(true),
});

// Orders table
export const orders = pgTable('orders', {
  id: text('id').primaryKey(),
  items: jsonb('items').notNull(),
  total: doublePrecision('total').notNull().default(0),
  status: text('status').notNull().default('pending'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  type: text('type').default('kiosk'),
  paymentMethod: text('payment_method').default(''),
  customerName: text('customer_name').default(''),
  customerPhone: text('customer_phone'),
  deliveryType: text('delivery_type'),
  deliveryAddress: text('delivery_address'),
  tableNumber: text('table_number'),
  tableId: text('table_id'),
});

// Restaurant Tables (Controle de Mesas e QR Codes)
export const restaurantTables = pgTable('restaurant_tables', {
  id: text('id').primaryKey(),
  number: integer('number').notNull(),
  name: text('name').notNull(),
  section: text('section').default('Salão Principal'),
  capacity: integer('capacity').default(4),
  status: text('status').default('available'), // 'available' | 'occupied' | 'reserved'
  isActive: boolean('is_active').default(true),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

// Store Info table
export const storeInfo = pgTable('store_info', {
  id: text('id').primaryKey().default('default'),
  name: text('name').default('Pão Mania'),
  themeColor: text('theme_color').default('#e6a800'),
  addButtonColor: text('add_button_color').default('#e6a800'),
  iconColor: text('icon_color').default('#e6a800'),
  headerPhrase: text('header_phrase').default('O Sabor da Tradição'),
  logoUrl: text('logo_url').default(''),
  address: text('address').default(''),
  hours: text('hours').default(''),
  instagram: text('instagram').default(''),
  whatsapp: text('whatsapp').default(''),
  categoryTitleColor: text('category_title_color').default('#e6a800'),
  deliveryEnabled: boolean('delivery_enabled').default(true),
  inStoreEnabled: boolean('in_store_enabled').default(true),
  kioskEnabled: boolean('kiosk_enabled').default(true),
  requireQrCodeForOrdering: boolean('require_qr_code_for_ordering').default(true),
  isOpen: boolean('is_open').default(true),
  ntfyTopic: text('ntfy_topic').default('paomania_pedidos'),
  ntfyEnabled: boolean('ntfy_enabled').default(true),
  tvTickerText: text('tv_ticker_text').default('🥖 Pães quentinhos saindo a toda hora! Experimente nossos cafés e salgados especiais. Peça pelo app ou no balcão!'),
  tvMode: text('tv_mode').default('fullscreen_media'),
  tvSelectedCategories: text('tv_selected_categories').default('[]'),
  tvSoundEnabled: boolean('tv_sound_enabled').default(false),
  tvShowClock: boolean('tv_show_clock').default(true),
  tvShowCaptions: boolean('tv_show_captions').default(false),
  isMaintenance: boolean('is_maintenance').default(false),
  maintenanceMessage: text('maintenance_message').default('Estamos atualizando nosso cardápio e sistemas para melhor atendê-lo. Voltaremos em breve!'),
  weeklySchedule: text('weekly_schedule').default('[]'),
  autoOpenClose: boolean('auto_open_close').default(false),
  forceOpen: boolean('force_open').default(false),
  closedMessage: text('closed_message').default('Estamos fechados no momento. Confira nossos horários de atendimento!'),
  aiAgentEnabled: boolean('ai_agent_enabled').default(true),
  aiAgentName: text('ai_agent_name').default('Mani'),
  aiAgentTone: text('ai_agent_tone').default('amigavel'),
  aiAgentCustomPrompt: text('ai_agent_custom_prompt').default(''),
  aiAgentWhatsAppPhone: text('ai_agent_whatsapp_phone').default(''),
  aiAgentWhatsAppDefaultMessage: text('ai_agent_whatsapp_default_message').default('Olá! Gostaria de fazer um pedido ou tirar uma dúvida.'),
  aiAgentTrainingExamples: text('ai_agent_training_examples').default('[]'),
  aiAgentKnowledgeBase: text('ai_agent_knowledge_base').default(''),
  aiAgentForbiddenPhrases: text('ai_agent_forbidden_phrases').default(''),
  aiAgentCreativity: doublePrecision('ai_agent_creativity').default(0.65),
  aiAgentAntiRepeat: boolean('ai_agent_anti_repeat').default(true),
  inStoreGpsValidation: boolean('in_store_gps_validation').default(false),
  inStoreLatitude: doublePrecision('in_store_latitude').default(-19.7478),
  inStoreLongitude: doublePrecision('in_store_longitude').default(-47.9392),
  inStoreMaxRadiusMeters: integer('in_store_max_radius_meters').default(150),
  inStorePinValidation: boolean('in_store_pin_validation').default(false),
  inStorePinCode: text('in_store_pin_code').default('1234'),
  preferredPrinterName: text('preferred_printer_name').default('EPSON TM-T20X (Rede 192.168.0.90)'),
  printerCutMode: text('printer_cut_mode').default('partial'),
  printerCopies: integer('printer_copies').default(2),
  totemPrinterCutMode: text('totem_printer_cut_mode').default('partial'),
  totemPrinterCopies: integer('totem_printer_copies').default(2),
  totemPrinterBottomSpaceCm: doublePrecision('totem_printer_bottom_space_cm').default(2.5),
  windowsPrinterCutMode: text('windows_printer_cut_mode').default('partial'),
  windowsPrinterCopies: integer('windows_printer_copies').default(2),
  windowsPrinterBottomSpaceCm: doublePrecision('windows_printer_bottom_space_cm').default(8.0),
  configuredPrinters: text('configured_printers').default(JSON.stringify([
    { id: 'p1', name: 'EPSON TM-T20X (Rede 192.168.0.90)', model: 'Epson Térmica 80mm (IP: 192.168.0.90)', isOrderPrinter: true, ip: '192.168.0.90' },
    { id: 'p2', name: 'Elgin i9 (Balcão / Ignorada para Pedidos)', model: 'Térmica 80mm (Ignorada)', isOrderPrinter: false }
  ])),
  caixaPrinterName: text('caixa_printer_name').default('EPSON TM-T20X (Rede 192.168.0.90)'),
  autoPrintOrdersOnCaixa: boolean('auto_print_orders_on_caixa').default(true),
  printerConnectionType: text('printer_connection_type').default('network'),
  networkPrinterIp: text('network_printer_ip').default('192.168.0.90'),
  networkPrinterPort: integer('network_printer_port').default(9100),
  bluefocusSyncUrl2: text('bluefocus_sync_url_2').default(''),
});

// TV Media Playlist table for Smart TV Indoor Signage
export const tvMedia = pgTable('tv_media', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  type: text('type').notNull().default('video'), // 'video' | 'image' | 'youtube'
  url: text('url').notNull(),
  durationSeconds: integer('duration_seconds').default(15),
  order: integer('order').default(0),
  showCaptions: boolean('show_captions').default(false),
  fitMode: text('fit_mode').default('fit'), // 'fit' | 'vertical_smartphone' | 'cover'
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// App Installs tracking table for PWA
export const appInstalls = pgTable('app_installs', {
  id: text('id').primaryKey(),
  platform: text('platform').default('unknown'), // 'android', 'ios', 'windows', 'macos', 'linux', 'other'
  browser: text('browser').default('unknown'), // 'chrome', 'safari', 'edge', 'firefox', 'samsung', 'other'
  deviceType: text('device_type').default('mobile'), // 'mobile', 'tablet', 'desktop'
  installedAt: bigint('installed_at', { mode: 'number' }).notNull(),
  userAgent: text('user_agent').default(''),
});

// Customers & Marketing Leads table
export const customers = pgTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  email: text('email').default(''),
  address: text('address').default(''),
  source: text('source').default('cadastro_cardapio'), // 'cadastro_cardapio' | 'pedido_delivery' | 'pedido_loja' | 'pedido_totem' | 'assistente_ia' | 'popup_novidades' | 'manual'
  totalOrders: integer('total_orders').default(0),
  totalSpent: doublePrecision('total_spent').default(0),
  lastOrderAt: bigint('last_order_at', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  tags: text('tags').default('[]'),
  notes: text('notes').default(''),
});

