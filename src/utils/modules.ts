export interface ModulesConfig {
  mesas: boolean;
  qrcodes: boolean;
  totem: boolean;
  delivery: boolean;
  tv: boolean;
  ai_agent: boolean;
  catalogo: boolean;
  pedidos: boolean;
}

export const DEFAULT_MODULES_CONFIG: ModulesConfig = {
  mesas: false,     // Desabilitado conforme solicitação do cliente
  qrcodes: false,   // Desabilitado conforme solicitação do cliente
  totem: false,     // Desabilitado conforme solicitação do cliente
  delivery: true,
  tv: true,
  ai_agent: false,
  catalogo: true,
  pedidos: true,
};

export function parseModulesConfig(raw: any): ModulesConfig {
  if (!raw) return { ...DEFAULT_MODULES_CONFIG };
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          ...DEFAULT_MODULES_CONFIG,
          ...parsed
        };
      }
    } catch {}
  }
  if (typeof raw === 'object') {
    return {
      ...DEFAULT_MODULES_CONFIG,
      ...raw
    };
  }
  return { ...DEFAULT_MODULES_CONFIG };
}
