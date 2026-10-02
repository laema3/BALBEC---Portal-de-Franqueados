import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

declare global {
  var _postgresPool: Pool | undefined;
}

export const getDatabaseUrl = (): string | undefined => {
  return process.env.DATABASE_URL || 
         process.env.DATABASE_URL_UNPOOLED ||
         process.env.POSTGRES_URL || 
         process.env.POSTGRES_PRISMA_URL ||
         process.env.POSTGRES_URL_NON_POOLING ||
         process.env.STORAGE_URL ||
         process.env.STORAGE_POSTGRES_URL ||
         process.env.BALBEC_URL ||
         process.env.BALBEC_POSTGRES_URL;
};

export const isDatabaseConfigured = (): boolean => {
  const dbUrl = getDatabaseUrl();
  if (dbUrl && dbUrl.trim() !== '') return true;
  if (process.env.PGHOST && process.env.PGHOST !== 'localhost') return true;
  if (process.env.SQL_HOST && process.env.SQL_HOST !== 'localhost' && process.env.SQL_HOST !== '127.0.0.1') return true;
  return false;
};

export const createPool = () => {
  if (!global._postgresPool) {
    const dbUrl = getDatabaseUrl();

    if (dbUrl) {
      const isUnixSocket = dbUrl.includes('/cloudsql') || dbUrl.includes('/app/cloudsql');
      const useSSL = !isUnixSocket && (process.env.SQL_SSL === 'true' || 
        (!dbUrl.includes('sslmode=disable') && !dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1')));
      
      const sslConfig = useSSL ? { rejectUnauthorized: false } : false;

      console.log(`[DB] Criando Pool utilizando URL do banco (SSL: ${useSSL}, UnixSocket: ${isUnixSocket})`);
      global._postgresPool = new Pool({
        connectionString: dbUrl,
        max: 5,
        connectionTimeoutMillis: 3500, // Fail fast (3.5s) to avoid Vercel 10s timeout
        idleTimeoutMillis: 10000,
        keepAlive: true,
        ssl: sslConfig
      });
    } else if (process.env.PGHOST || (process.env.SQL_HOST && process.env.SQL_HOST !== 'localhost')) {
      const host = process.env.PGHOST || process.env.SQL_HOST;
      const user = process.env.PGUSER || process.env.SQL_USER;
      const password = process.env.PGPASSWORD || process.env.SQL_PASSWORD;
      const database = process.env.PGDATABASE || process.env.SQL_DB_NAME;
      const port = process.env.PGPORT ? parseInt(process.env.PGPORT) : (process.env.SQL_PORT ? parseInt(process.env.SQL_PORT) : 5432);

      const isUnixSocket = !!host && (host.startsWith('/') || host.startsWith('/app/cloudsql') || host.startsWith('/cloudsql'));
      const useSSL = !isUnixSocket && (process.env.SQL_SSL === 'true' || (!host?.includes('localhost') && !host?.includes('127.0.0.1')));

      console.log(`[DB] Criando Pool PG para ${host} (User: ${user}, DB: ${database}, SSL: ${useSSL}, UnixSocket: ${isUnixSocket})`);
      const poolConfig: any = {
        host,
        user,
        password,
        database,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
      };
      if (!isUnixSocket) {
        poolConfig.port = port;
        if (useSSL) poolConfig.ssl = { rejectUnauthorized: false };
      }

      global._postgresPool = new Pool(poolConfig);
    } else {
      // Local development dummy pool
      global._postgresPool = new Pool({
        host: 'localhost',
        user: 'postgres',
        password: '',
        database: 'balbec',
        port: 5432,
        max: 1, 
        connectionTimeoutMillis: 500,
        idleTimeoutMillis: 500,
        ssl: false
      });
    }

    global._postgresPool.on('error', (err) => {
      // Idle SQL pool client error
    });
  }
  return global._postgresPool;
};

export const pool = createPool();

export const db = drizzle(pool, { schema });

export async function testDatabaseConnection(): Promise<{ ok: boolean; host?: string; error?: string }> {
  if (!isDatabaseConfigured()) {
    return { ok: false, error: 'Variável de conexão (DATABASE_URL) não configurada.' };
  }
  try {
    const pingPromise = pool.query('SELECT 1 as ping');
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout (7s)')), 7000));
    const res: any = await Promise.race([pingPromise, timeoutPromise]);
    const dbUrl = getDatabaseUrl() || '';
    let host = 'PostgreSQL';
    try {
      if (dbUrl.includes('@')) {
        host = dbUrl.split('@')[1].split('/')[0].split(':')[0];
      }
    } catch {}
    return { ok: Boolean(res && res.rows && res.rows.length > 0), host };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function ensureTablesExist() {
  if (!isDatabaseConfigured()) {
    return;
  }

  // Fast check: Ensure DB is reachable before attempting DDL migrations
  try {
    const pingPromise = pool.query('SELECT 1 as ping');
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('PostgreSQL indisponível ou tempo limite atingido (3.5s)')), 3500));
    await Promise.race([pingPromise, timeoutPromise]);
  } catch (pingErr: any) {
    console.warn('[DB] PostgreSQL não respondeu ao teste inicial, migrações DDL em lote ignoradas:', pingErr?.message || pingErr);
    return;
  }

  try {
    const runQuery = async (sql: string) => {
      try {
        await pool.query(sql);
      } catch (e: any) {
        console.warn('[DB Migration Warning]:', e?.message || e);
      }
    };

    await runQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        uid TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        password TEXT,
        name TEXT,
        role TEXT DEFAULT 'operator',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        "order" INTEGER DEFAULT 0,
        external_id TEXT,
        is_visible BOOLEAN DEFAULT TRUE,
        available_for_delivery BOOLEAN DEFAULT TRUE,
        available_in_store BOOLEAN DEFAULT TRUE,
        available_for_kiosk BOOLEAN DEFAULT TRUE
      );
    `);

    await runQuery(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS available_for_delivery BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS available_in_store BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS available_for_kiosk BOOLEAN DEFAULT TRUE;`);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        category_id TEXT,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        price DOUBLE PRECISION NOT NULL DEFAULT 0,
        image_url TEXT DEFAULT '',
        is_active BOOLEAN DEFAULT TRUE,
        is_addon BOOLEAN DEFAULT FALSE,
        is_flavor BOOLEAN DEFAULT FALSE,
        addon_ids JSONB DEFAULT '[]'::jsonb,
        max_addons INTEGER DEFAULT 0,
        flavor_ids JSONB DEFAULT '[]'::jsonb,
        external_id TEXT,
        available_for_delivery BOOLEAN DEFAULT TRUE,
        available_in_store BOOLEAN DEFAULT TRUE,
        available_for_kiosk BOOLEAN DEFAULT TRUE
      );
    `);

    await runQuery(`ALTER TABLE products ADD COLUMN IF NOT EXISTS available_for_delivery BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE products ADD COLUMN IF NOT EXISTS available_in_store BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE products ADD COLUMN IF NOT EXISTS available_for_kiosk BOOLEAN DEFAULT TRUE;`);
    
    // Automatically sanitize existing product descriptions from barcode / EAN tags
    await runQuery(`UPDATE products SET description = TRIM(REGEXP_REPLACE(description, '\\[\\s*EAN:[^\\]]*\\]', '', 'gi')) WHERE description ILIKE '%[EAN:%';`);
    await runQuery(`UPDATE products SET description = TRIM(REGEXP_REPLACE(description, 'EAN:\\s*[0-9]+', '', 'gi')) WHERE description ILIKE '%EAN:%';`);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        items JSONB NOT NULL,
        total DOUBLE PRECISION NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at BIGINT NOT NULL,
        type TEXT DEFAULT 'kiosk',
        payment_method TEXT DEFAULT '',
        customer_name TEXT DEFAULT '',
        customer_phone TEXT,
        delivery_type TEXT,
        delivery_address TEXT,
        table_number TEXT,
        table_id TEXT
      );
    `);

    await runQuery(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_number TEXT;`);
    await runQuery(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_id TEXT;`);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS restaurant_tables (
        id TEXT PRIMARY KEY,
        number INTEGER NOT NULL,
        name TEXT NOT NULL,
        section TEXT DEFAULT 'Salão Principal',
        capacity INTEGER DEFAULT 4,
        status TEXT DEFAULT 'available',
        is_active BOOLEAN DEFAULT TRUE,
        created_at BIGINT NOT NULL
      );
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS store_info (
        id TEXT PRIMARY KEY DEFAULT 'default',
        name TEXT DEFAULT 'BALBEC - Portal de Franqueados',
        theme_color TEXT DEFAULT '#e6a800',
        add_button_color TEXT DEFAULT '#e6a800',
        icon_color TEXT DEFAULT '#e6a800',
        header_phrase TEXT DEFAULT 'Portal de Franqueados',
        logo_url TEXT DEFAULT '',
        address TEXT DEFAULT '',
        hours TEXT DEFAULT '',
        instagram TEXT DEFAULT '',
        whatsapp TEXT DEFAULT '',
        category_title_color TEXT DEFAULT '#e6a800',
        delivery_enabled BOOLEAN DEFAULT FALSE,
        in_store_enabled BOOLEAN DEFAULT FALSE,
        kiosk_enabled BOOLEAN DEFAULT TRUE,
        require_qr_code_for_ordering BOOLEAN DEFAULT TRUE,
        is_open BOOLEAN DEFAULT TRUE,
        ntfy_topic TEXT DEFAULT 'balbec_pedidos',
        ntfy_enabled BOOLEAN DEFAULT TRUE,
        tv_ticker_text TEXT DEFAULT '',
        tv_mode TEXT DEFAULT 'split_menu',
        tv_sound_enabled BOOLEAN DEFAULT FALSE,
        tv_show_clock BOOLEAN DEFAULT TRUE,
        tv_show_captions BOOLEAN DEFAULT FALSE,
        is_maintenance BOOLEAN DEFAULT FALSE,
        maintenance_message TEXT DEFAULT 'Estamos atualizando nosso cardápio e sistemas para melhor atendê-lo. Voltaremos em breve!',
        weekly_schedule TEXT DEFAULT '[]',
        auto_open_close BOOLEAN DEFAULT FALSE,
        force_open BOOLEAN DEFAULT FALSE,
        closed_message TEXT DEFAULT 'Estamos fechados no momento. Confira nossos horários de atendimento!',
        ai_agent_enabled BOOLEAN DEFAULT TRUE,
        ai_agent_name TEXT DEFAULT 'Mani',
        ai_agent_tone TEXT DEFAULT 'amigavel',
        ai_agent_custom_prompt TEXT DEFAULT '',
        ai_agent_whatsapp_phone TEXT DEFAULT '',
        ai_agent_whatsapp_default_message TEXT DEFAULT 'Olá! Gostaria de fazer um pedido ou tirar uma dúvida.',
        ai_agent_training_examples TEXT DEFAULT '[]',
        ai_agent_knowledge_base TEXT DEFAULT '',
        ai_agent_forbidden_phrases TEXT DEFAULT '',
        ai_agent_creativity DOUBLE PRECISION DEFAULT 0.65,
        ai_agent_anti_repeat BOOLEAN DEFAULT TRUE,
        in_store_gps_validation BOOLEAN DEFAULT FALSE,
        in_store_latitude DOUBLE PRECISION DEFAULT -19.7478,
        in_store_longitude DOUBLE PRECISION DEFAULT -47.9392,
        in_store_max_radius_meters INTEGER DEFAULT 150,
        in_store_pin_validation BOOLEAN DEFAULT FALSE,
        in_store_pin_code TEXT DEFAULT '1234',
        preferred_printer_name TEXT DEFAULT 'Elgin i9 / Térmica Padrão',
        printer_cut_mode TEXT DEFAULT 'partial',
        printer_copies INTEGER DEFAULT 2,
        totem_printer_cut_mode TEXT DEFAULT 'partial',
        totem_printer_copies INTEGER DEFAULT 1,
        totem_printer_bottom_space_cm DOUBLE PRECISION DEFAULT 2.5,
        windows_printer_cut_mode TEXT DEFAULT 'partial',
        windows_printer_copies INTEGER DEFAULT 2,
        windows_printer_bottom_space_cm DOUBLE PRECISION DEFAULT 8.0,
        configured_printers TEXT DEFAULT '[]',
        caixa_printer_name TEXT DEFAULT 'Elgin i9 (Balcão / Caixa)',
        auto_print_orders_on_caixa BOOLEAN DEFAULT FALSE,
        printer_connection_type TEXT DEFAULT 'network',
        network_printer_ip TEXT DEFAULT '192.168.0.90',
        network_printer_port INTEGER DEFAULT 9100
      );
    `);

    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS bluefocus_sync_url TEXT DEFAULT '';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS bluefocus_empresa_id TEXT DEFAULT 'BALBEC';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS bluefocus_usuario_id TEXT DEFAULT 'CONSULTA';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS bluefocus_pdv_codigo TEXT DEFAULT '1000';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS bluefocus_auth_token TEXT DEFAULT '';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS bluefocus_tipo TEXT DEFAULT '4';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS bluefocus_data_inicial TEXT DEFAULT '30/12/1899';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS bluefocus_start_carga_numero TEXT DEFAULT '0';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS bluefocus_start_carga_sequencia TEXT DEFAULT '0';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS bluefocus_start_produto_id TEXT DEFAULT '0';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS bluefocus_tipo_atualizacao TEXT DEFAULT 'A';`);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS tv_media (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        duration_seconds INTEGER DEFAULT 15,
        "order" INTEGER DEFAULT 1,
        show_captions BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS app_installs (
        id TEXT PRIMARY KEY,
        platform TEXT DEFAULT 'unknown',
        browser TEXT DEFAULT 'unknown',
        device_type TEXT DEFAULT 'mobile',
        installed_at BIGINT NOT NULL,
        user_agent TEXT DEFAULT ''
      );
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT DEFAULT '',
        address TEXT DEFAULT '',
        source TEXT DEFAULT 'cadastro_cardapio',
        total_orders INTEGER DEFAULT 0,
        total_spent DOUBLE PRECISION DEFAULT 0,
        last_order_at BIGINT,
        created_at BIGINT NOT NULL,
        tags TEXT DEFAULT '[]',
        notes TEXT DEFAULT ''
      );
    `);

    // Ensure columns exist on already-created tables in PostgreSQL
    await runQuery(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';`);
    await runQuery(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '';`);
    await runQuery(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'cadastro_cardapio';`);
    await runQuery(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_orders INTEGER DEFAULT 0;`);
    await runQuery(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_spent DOUBLE PRECISION DEFAULT 0;`);
    await runQuery(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_order_at BIGINT;`);
    await runQuery(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT '[]';`);
    await runQuery(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';`);

    // Ensure columns exist on already-created tables in PostgreSQL
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT '';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS tv_selected_categories TEXT DEFAULT '[]';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS tv_ticker_text TEXT DEFAULT '';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS tv_mode TEXT DEFAULT 'split_menu';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS tv_sound_enabled BOOLEAN DEFAULT FALSE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS tv_show_clock BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS tv_show_captions BOOLEAN DEFAULT FALSE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS category_title_color TEXT DEFAULT '#e6a800';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS add_button_color TEXT DEFAULT '#e6a800';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS icon_color TEXT DEFAULT '#e6a800';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS header_phrase TEXT DEFAULT 'Portal de Franqueados';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS ntfy_topic TEXT DEFAULT 'balbec_pedidos';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS ntfy_enabled BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS in_store_enabled BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS kiosk_enabled BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS require_qr_code_for_ordering BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS delivery_enabled BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS is_open BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS is_maintenance BOOLEAN DEFAULT FALSE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS maintenance_message TEXT DEFAULT 'Estamos atualizando nosso cardápio e sistemas para melhor atendê-lo. Voltaremos em breve!';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS weekly_schedule TEXT DEFAULT '[]';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS auto_open_close BOOLEAN DEFAULT FALSE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS closed_message TEXT DEFAULT 'Estamos fechados no momento. Confira nossos horários de atendimento!';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS ai_agent_enabled BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS ai_agent_name TEXT DEFAULT 'Mani';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS ai_agent_tone TEXT DEFAULT 'amigavel';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS ai_agent_custom_prompt TEXT DEFAULT '';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS ai_agent_whatsapp_phone TEXT DEFAULT '';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS ai_agent_whatsapp_default_message TEXT DEFAULT 'Olá! Gostaria de fazer um pedido ou tirar uma dúvida.';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS force_open BOOLEAN DEFAULT FALSE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS preferred_printer_name TEXT DEFAULT 'EPSON TM-T20X (Rede 192.168.0.90)';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS printer_cut_mode TEXT DEFAULT 'partial';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS printer_copies INTEGER DEFAULT 2;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS totem_printer_cut_mode TEXT DEFAULT 'partial';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS totem_printer_copies INTEGER DEFAULT 1;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS totem_printer_bottom_space_cm DOUBLE PRECISION DEFAULT 2.5;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS windows_printer_cut_mode TEXT DEFAULT 'partial';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS windows_printer_copies INTEGER DEFAULT 2;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS windows_printer_bottom_space_cm DOUBLE PRECISION DEFAULT 8.0;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS configured_printers TEXT DEFAULT '[{"id":"p1","name":"EPSON TM-T20X (Rede 192.168.0.90)","model":"Epson Térmica 80mm (IP: 192.168.0.90)","isOrderPrinter":true,"ip":"192.168.0.90"},{"id":"p2","name":"Elgin i9 (Balcão / Ignorada para Pedidos)","model":"Térmica 80mm (Ignorada)","isOrderPrinter":false}]';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS caixa_printer_name TEXT DEFAULT 'EPSON TM-T20X (Rede 192.168.0.90)';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS auto_print_orders_on_caixa BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS printer_connection_type TEXT DEFAULT 'network';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS network_printer_ip TEXT DEFAULT '192.168.0.90';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS network_printer_port INTEGER DEFAULT 9100;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS ai_agent_training_examples TEXT DEFAULT '[]';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS ai_agent_knowledge_base TEXT DEFAULT '';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS ai_agent_forbidden_phrases TEXT DEFAULT '';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS ai_agent_creativity DOUBLE PRECISION DEFAULT 0.65;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS ai_agent_anti_repeat BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS in_store_gps_validation BOOLEAN DEFAULT FALSE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS in_store_latitude DOUBLE PRECISION DEFAULT -19.7478;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS in_store_longitude DOUBLE PRECISION DEFAULT -47.9392;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS in_store_max_radius_meters INTEGER DEFAULT 150;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS in_store_pin_validation BOOLEAN DEFAULT FALSE;`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS in_store_pin_code TEXT DEFAULT '1234';`);
    await runQuery(`ALTER TABLE store_info ADD COLUMN IF NOT EXISTS modules_config TEXT DEFAULT '{"mesas":false,"qrcodes":false,"totem":false,"delivery":true,"tv":true,"ai_agent":false}';`);

    // Ensure columns exist on categories table
    await runQuery(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS external_id TEXT;`);
    await runQuery(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS available_for_delivery BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS available_in_store BOOLEAN DEFAULT TRUE;`);
    await runQuery(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS available_for_kiosk BOOLEAN DEFAULT TRUE;`);

    await runQuery(`ALTER TABLE tv_media ADD COLUMN IF NOT EXISTS show_captions BOOLEAN DEFAULT FALSE;`);
    await runQuery(`ALTER TABLE tv_media ADD COLUMN IF NOT EXISTS fit_mode TEXT DEFAULT 'fit';`);

  } catch (err: any) {
    // Non-fatal init catch
  }
}
