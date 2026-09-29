export const EXCLUDED_CATEGORIES = [
  'SERVICOS',
  'SERVIÇOS',
  'SERVICO',
  'SERVIÇO',
  'PRESTACAO DE SERVICO',
  'PRESTAÇÃO DE SERVIÇO',
  'MATERIA PRIMA',
  'MATÉRIA PRIMA',
  'MATERIAS PRIMAS',
  'MATÉRIAS PRIMAS',
  'MATERIA-PRIMA',
  'MATÉRIA-PRIMA',
  'MATERIAS-PRIMAS',
  'MATÉRIAS-PRIMAS',
  'UNIFORMES',
  'UNIFORME',
  'VALILHAME',
  'VALILHAMES',
  'VASILHAME',
  'VASILHAMES',
  'MANUTENCAO',
  'MANUTENÇÃO',
  'MANUTENCOES',
  'MANUTENÇÕES',
  'MANUTENCAO PREDIAL',
  'MANUTENÇÃO PREDIAL',
  'MANUTENCAO GERAL',
  'MANUTENÇÃO GERAL',
  'ITEM DE MANUTENCAO',
  'ITEM DE MANUTENÇÃO',
  'ITENS DE MANUTENCAO',
  'ITENS DE MANUTENÇÃO',
  'EQUIPAMENTO',
  'EQUIPAMENTOS',
  'DESPESA',
  'DESPESAS',
  'INSUMO',
  'INSUMOS',
  'USO E CONSUMO',
  'USO INTERNO',
  'MATERIAL DE LIMPEZA',
  'PRODUTO DE LIMPEZA',
  'PRODUTOS DE LIMPEZA',
  'LIMPEZA',
  'PATRIMONIO',
  'PATRIMÔNIO',
  'IMOBILIZADO',
  'DESCARTAVEIS',
  'DESCARTÁVEIS',
  'EMBALAGEM INTERNA',
  'EMBALAGENS INTERNAS',
  'TAXA',
  'TAXAS',
  'TESTE',
  'TESTES'
];

export const normalizeText = (str: string) => 
  (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const shouldExcludeProduct = (product: any, categories: any[]) => {
  const normalizedName = normalizeText(product.name || "");
  const normalizedTokens = normalizedName.split(/\s+/);
  
  // 1. Check if product name contains any excluded keyword
  const isNameExcluded = EXCLUDED_CATEGORIES.some(excluded => {
    const normExcluded = normalizeText(excluded);
    return normalizedName.includes(normExcluded);
  });
  if (isNameExcluded) return true;

  // 2. Check if product category name is in the excluded list
  const category = categories.find(c => c.id === product.categoryId);
  if (category) {
    const normalizedCat = normalizeText(category.name);
    const isCatExcluded = EXCLUDED_CATEGORIES.some(excluded => {
      const normExcluded = normalizeText(excluded);
      return normalizedCat === normExcluded || normalizedCat.includes(normExcluded);
    });
    if (isCatExcluded) return true;
  }

  return false;
};

export const isExcludedCategory = (name: string) => {
  const normalizedName = normalizeText(name);
  return EXCLUDED_CATEGORIES.some(excluded => {
    const normExcluded = normalizeText(excluded);
    return normalizedName === normExcluded || normalizedName.includes(normExcluded);
  });
};

export const isAddonCategory = (name: string) => {
  const norm = normalizeText(name || "");
  return (
    norm === 'adicionais' ||
    norm === 'adicional' ||
    norm === 'opcionais' ||
    norm === 'opcional' ||
    norm === 'complementos' ||
    norm === 'complemento' ||
    norm.includes('adicionais') ||
    norm.includes('adicional') ||
    norm.includes('opcionais') ||
    norm.includes('opcional')
  );
};

export const isAddonItem = (product: any, categories?: any[]) => {
  if (!product) return false;
  if (product.isAddon === true) return true;
  if (product.categoryId === 'fly938s') return true;

  const normName = normalizeText(product.name || "");
  if (
    normName.startsWith('adicional ') ||
    normName.startsWith('adicionais ') ||
    normName.startsWith('adc ') ||
    normName.startsWith('adic ') ||
    normName.startsWith('opcional ') ||
    normName.startsWith('opcionais ') ||
    normName === 'adicional' ||
    normName === 'adicionais' ||
    normName === 'opcional' ||
    normName === 'opcionais'
  ) {
    return true;
  }

  if (categories && Array.isArray(categories)) {
    const category = categories.find(c => c && c.id === product.categoryId);
    if (category && isAddonCategory(category.name)) {
      return true;
    }
  }

  return false;
};

export const isStoreOnlyCategory = (_name: string) => {
  return false;
};

export const MASTER_ADMIN_EMAILS = [
  'camillasites@gmail.com',
  'contato2@balbec.com.br',
  'contato@balbec.com.br',
  'admin@balbec.com.br'
];

export const isAuthorizedAdminEmail = (email?: string | null): boolean => {
  if (!email) return false;
  const cleanEmail = email.trim().toLowerCase();
  if (MASTER_ADMIN_EMAILS.includes(cleanEmail) || cleanEmail.endsWith('@balbec.com.br') || cleanEmail.endsWith('@paomania.com.br')) {
    return true;
  }
  return false;
};

export const cleanProductDescription = (desc?: string | null, removeChannels: boolean = true): string => {
  if (!desc || typeof desc !== 'string') return '';
  let result = desc;
  
  if (removeChannels) {
    result = result.replace(/\[channels:.*?\]/gi, '');
  }

  // Preserve codes and standardize [EAN: 123] or (Barcode: 123) into readable Cód: 123
  return result
    .replace(/\[\s*(?:EAN|EAN-?13|BARCODE|C[ÓO]D\.?\s*(?:DE\s*)?BARRAS?|C[ÓO]DIGO\s+(?:DE\s+)?BARRAS?)\s*:?\s*([^\]]+)\]/gi, 'Cód: $1')
    .replace(/\(\s*(?:EAN|EAN-?13|BARCODE|C[ÓO]D\.?\s*(?:DE\s*)?BARRAS?|C[ÓO]DIGO\s+(?:DE\s+)?BARRAS?)\s*:?\s*([^)]+)\)/gi, 'Cód: $1')
    .replace(/(?:EAN|EAN-?13|BARCODE|C[ÓO]D\.?\s*(?:DE\s*)?BARRAS?|C[ÓO]DIGO\s+(?:DE\s+)?BARRAS?)\s*:?\s*(\d+)/gi, 'Cód: $1')
    // Clean up double spaces and dangling separators
    .replace(/\s+/g, ' ')
    .replace(/^\s*[-–—|:,;]\s*/, '')
    .replace(/\s*[-–—|:,;]\s*$/, '')
    .trim();
};

/**
 * Retorna a descrição do produto garantindo a presença do código do produto.
 * Se o produto tiver código (externalId/code) e ele ainda não constar na descrição,
 * ele é incluído de forma limpa e destacada.
 */
export const formatProductDescriptionWithCode = (desc?: string | null, code?: string | null): string => {
  const cleanDesc = cleanProductDescription(desc, true);
  const cleanCode = (code || '').toString().trim();
  if (!cleanCode) return cleanDesc;

  // Se a descrição já contém o código (ex: "Cód: 1001" ou "1001"), retorna a descrição limpa
  if (cleanDesc.toLowerCase().includes(cleanCode.toLowerCase())) {
    return cleanDesc;
  }

  if (!cleanDesc) {
    return `Cód: ${cleanCode}`;
  }

  return `Cód: ${cleanCode} • ${cleanDesc}`;
};

