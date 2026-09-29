import { GoogleGenAI } from '@google/genai';
import { Request, Response } from 'express';
import { getStoreCurrentStatus, parseWeeklySchedule, formatWeeklyScheduleSummary } from '../utils/scheduleHelper';
import { isExcludedCategory, shouldExcludeProduct } from '../constants';

export function registerAiRoutes(app: any, getLiveDbState: () => { categories: any[]; products: any[]; storeInfo: any }) {
  // Main AI Virtual Agent Chat Endpoint
  app.post('/api/ai/chat', async (req: Request, res: Response) => {
    try {
      const { messages, userMessage } = req.body;
      const dbState = getLiveDbState();
      const storeInfo = dbState.storeInfo || {};
      const rawCategories = dbState.categories || [];
      const rawProducts = dbState.products || [];

      const currentStatus = getStoreCurrentStatus(
        storeInfo.weeklySchedule,
        storeInfo.isOpen !== false,
        !!storeInfo.autoOpenClose
      );

      const weeklySchedule = parseWeeklySchedule(storeInfo.weeklySchedule);
      const scheduleSummary = formatWeeklyScheduleSummary(weeklySchedule);

      // 1. Filter only active, visible, non-maintenance categories available for in-store consumption
      const activeCategories = rawCategories.filter((c: any) => 
        c && 
        c.id && 
        typeof c.name === 'string' && 
        c.isVisible !== false && 
        c.availableInStore !== false && 
        !isExcludedCategory(c.name)
      );

      const activeCategoryIds = new Set(activeCategories.map((c: any) => c.id));

      // 2. Filter active products that belong to active categories, available in store and not excluded
      const activeProducts = rawProducts.filter((p: any) => 
        p && 
        p.isActive !== false && 
        p.availableInStore !== false && 
        !p.isAddon && 
        !p.isFlavor && 
        !shouldExcludeProduct(p, rawCategories) &&
        activeCategoryIds.has(p.categoryId)
      );

      const availableAddons = rawProducts.filter((p: any) => 
        p && 
        p.isActive !== false && 
        p.availableInStore !== false && 
        p.isAddon && 
        !shouldExcludeProduct(p, rawCategories)
      );

      const availableFlavors = rawProducts.filter((p: any) => 
        p && 
        p.isActive !== false && 
        p.availableInStore !== false && 
        p.isFlavor && 
        !shouldExcludeProduct(p, rawCategories)
      );

      // 3. Keep only active categories that have at least one active in-store product
      const activeCategoriesWithProducts = activeCategories.filter((c: any) =>
        activeProducts.some((p: any) => p.categoryId === c.id)
      );
      
      // Build categorized product catalog for AI grounding (Strictly In-Store Active Only)
      const catalogByCategory: Record<string, any[]> = {};
      for (const cat of activeCategoriesWithProducts) {
        const prodsInCat = activeProducts.filter((p: any) => p.categoryId === cat.id);
        if (prodsInCat.length > 0) {
          catalogByCategory[cat.name] = prodsInCat;
        }
      }

      const catalogSummary = Object.entries(catalogByCategory).map(([catName, prods]) => {
        const items = prods.map((p: any) => 
          `  - ${p.name}: R$ ${Number(p.price).toFixed(2).replace('.', ',')}${p.description ? ` | Descrição: "${p.description}"` : ''}`
        ).join('\n');
        return `* Categoria: ${catName} (${prods.length} itens disponíveis para consumo na loja):\n${items}`;
      }).join('\n\n');

      const categoriesListSummary = activeCategoriesWithProducts.map(c => `• ${c.name}`).join('\n');

      const addonsSummary = availableAddons.length > 0
        ? availableAddons.map((a: any) => `  - ${a.name}: + R$ ${Number(a.price).toFixed(2).replace('.', ',')}`).join('\n')
        : 'Adicionais padrão da chapa (queijo, ovo, bacon, etc.) disponíveis.';

      const flavorsSummary = availableFlavors.length > 0
        ? availableFlavors.map((f: any) => `  - ${f.name}`).join('\n')
        : 'Sabores variados de sucos naturais e polpas (Laranja, Maracujá, Acerola, Abacaxi, Limão, Morango, Caju, etc.).';

      const agentName = storeInfo.aiAgentName || 'Mani';
      const agentTone = storeInfo.aiAgentTone || 'amigavel';
      const customPrompt = storeInfo.aiAgentCustomPrompt || '';
      const knowledgeBase = storeInfo.aiAgentKnowledgeBase || '';
      const forbiddenPhrases = storeInfo.aiAgentForbiddenPhrases || '';
      const creativity = typeof storeInfo.aiAgentCreativity === 'number' ? storeInfo.aiAgentCreativity : 0.65;
      const antiRepeatStrict = storeInfo.aiAgentAntiRepeat !== false;
      const whatsappNumber = storeInfo.aiAgentWhatsAppPhone || storeInfo.whatsapp || '';

      // Parse training examples (few-shot dialogues)
      let parsedTrainingExamples: Array<{ question: string; answer: string; active?: boolean }> = [];
      try {
        if (typeof storeInfo.aiAgentTrainingExamples === 'string' && storeInfo.aiAgentTrainingExamples.trim()) {
          parsedTrainingExamples = JSON.parse(storeInfo.aiAgentTrainingExamples);
        } else if (Array.isArray(storeInfo.aiAgentTrainingExamples)) {
          parsedTrainingExamples = storeInfo.aiAgentTrainingExamples;
        }
      } catch (e) {
        parsedTrainingExamples = [];
      }

      const activeTrainingExamples = parsedTrainingExamples.filter(
        (ex) => ex && ex.active !== false && ex.question && ex.answer
      );

      const trainingExamplesSummary = activeTrainingExamples.length > 0
        ? activeTrainingExamples.map((ex, idx) => 
            `[EXEMPLO DE TREINAMENTO ${idx + 1}]\nPergunta do Cliente: "${ex.question}"\nSua Resposta Ideal: "${ex.answer}"`
          ).join('\n\n')
        : 'Nenhum diálogo personalizado cadastrado ainda. Siga o padrão de atendimento acolhedor e informativo da padaria.';

      const toneDescription = agentTone === 'direto' 
        ? 'Seja direto, rápido e objetivo, priorizando respostas curtas e claras.'
        : agentTone === 'especialista'
        ? 'Seja um consultor gastronômico apaixonado por panificação artesanal e cafés especiais, explicando detalhes dos ingredientes e harmonizações.'
        : 'Seja acolhedor, simpático, atencioso e prestativo, como o melhor atendente de padaria tradicional brasileira.';

      const systemInstruction = `Você é "${agentName}", atendente virtual oficial e especialista no portal de franqueados "${storeInfo.name || 'BALBEC - Portal de Franqueados'}".

SUA BASE DE CONHECIMENTO COMPLETA:
- Nome do Estabelecimento: ${storeInfo.name || 'BALBEC - Portal de Franqueados'}
- Endereço Físico: ${storeInfo.address || 'Praça Dr. Jorge Frange, 72 - São Benedito, Uberaba - MG'}
- Telefone / WhatsApp Oficial: ${whatsappNumber || '(34) 3338-3795'}
- CNPJ: 03.162.220/0001-00

HORÁRIO DE ATENDIMENTO E FUNCIONAMENTO:
- Status Agora em Tempo Real: ${currentStatus.isOpenNow ? '🟢 ABERTO AGORA' : '🔴 FECHADO NO MOMENTO'} (${currentStatus.details})
- Horários da Semana:
${weeklySchedule.map(d => `  * ${d.dayName}: ${d.isOpen ? `${d.openTime} às ${d.closeTime}` : 'Fechado'}`).join('\n')}

FORMAS E CONDIÇÕES DE PAGAMENTO ACEITAS:
- PIX (instantâneo)
- Cartão de Crédito (todas as principais bandeiras)
- Cartão de Débito
- Dinheiro (com opção de troco para o valor informado pelo cliente)
- O pagamento pode ser feito na entrega (para delivery) ou na retirada no balcão da loja.

MODALIDADES DE PEDIDO E ATENDIMENTO:
1) **Delivery (Entrega em Domicílio)**: O cliente informa o endereço e recebe o pedido em casa quentinho.
2) **Consumo na Loja / Retirada no Balcão**: O cliente retira o pedido na loja física ou consome no local.
3) **Totem de Autoatendimento**: É um terminal exclusivo instalado na loja física para uso presencial no balcão.

CATEGORIAS ATIVAS DISPONÍVEIS EXCLUSIVAMENTE PARA CONSUMO NA LOJA (${activeCategoriesWithProducts.length} categorias ativas):
${categoriesListSummary || 'Categorias em atualização.'}

CARDÁPIO OFICIAL DE PRODUTOS E PREÇOS REAIS (APENAS ITENS E CATEGORIAS ATIVAS PARA CONSUMO NA LOJA):
${catalogSummary || 'Cardápio em atualização.'}

COMPLEMENTOS E ADICIONAIS DE LANCHES/CHAPA:
${addonsSummary}

SABORES DE SUCOS E BEBIDAS:
${flavorsSummary}

INFORMAÇÕES EXTRAS E FORNADAS DA PADARIA:
${customPrompt || 'Pães artesanais quentinhos, bolos caseiros, salgados fritos e assados na hora, lanches especiais na chapa, cafés expresso, cappuccinos e bebidas geladas.'}

${knowledgeBase ? `CONTEÚDOS E POLÍTICAS DE ATENDIMENTO APRENDIDOS (BASE DE CONHECIMENTO CADASTRADA PELO GERENTE):\n${knowledgeBase}\n` : ''}
${forbiddenPhrases ? `RESTRIÇÕES IMPORTANTES (O QUE NUNCA DIZER OU PROMETER AO CLIENTE):\n${forbiddenPhrases}\n` : ''}

══════════════════════════════════════════════════════════════
EXEMPLOS REAIS DE TREINAMENTO (COMO VOCÊ DEVE RESPONDER / FEW-SHOT):
══════════════════════════════════════════════════════════════
Use os diálogos de exemplo abaixo como seu guia supremo de estilo, precisão e vocabulário:

${trainingExamplesSummary}

══════════════════════════════════════════════════════════════
REGRAS CRÍTICAS DE COMPORTAMENTO E DIRETRIZES ANTI-REPETIÇÃO:
══════════════════════════════════════════════════════════════
1. **PROIBIDO REPETIR RESPOSTAS OU SAUDAÇÕES PADRONIZADAS**:
   - ${antiRepeatStrict ? 'NUNCA repita "Olá! Sou Mani...", "Olá!", "Como posso ajudar?" se a conversa já estiver em andamento.' : ''}
   - Se o cliente acabou de fazer uma nova pergunta ou continuar um pedido, responda DIRETO e CONCISE ao que foi perguntado.
   - NUNCA repita o mesmo parágrafo ou as mesmas frases ditas anteriormente no histórico da conversa.
   - Varie a forma de se expressar com naturalidade e simpatia humana, evitando respostas robóticas ou mecânicas.

2. **REGRA SUPREMA: APENAS CATEGORIAS E PRODUTOS ATIVOS PARA CONSUMO NA LOJA**:
   - Quando alguém pedir o cardápio, solicitar ver as opções, perguntar o que tem para comer/beber ou pedir sugestões/preços, você DEVE mostrar e sugerir APENAS E EXCLUSIVAMENTE as categorias e produtos ativos para consumo na loja listados na base de conhecimento acima.
   - NENHUMA categoria ou produto inativo, desativado, não disponível para consumo na loja ou externo deve ser citado, sugerido ou inventado.
   - Se o cliente pedir o cardápio, apresente de forma organizada e limpa as categorias ativas com seus respectivos produtos e valores exatos.
   - Se o cliente perguntar por algum item que não esteja na lista de consumo na loja, informe com simpatia que no momento não temos esse item disponível para consumo na loja e indique as opções ativas disponíveis.

3. **DOMÍNIO TOTAL DO CARDÁPIO, PREÇOS E DESCRIÇÕES**:
   - Sempre forneça o valor EXATO e o nome correto do produto conforme a tabela acima (ex: "O Pão de Queijo custa R$ X,XX").
   - Se o cliente perguntar o que tem em uma categoria (ex: "quais cafés vocês têm?", "quais salgados?"), liste os itens e preços daquela categoria com clareza.
   - Se o cliente perguntar ingredientes ou descrições, utilize as informações da base de conhecimento.

4. **HORÁRIOS E PAGAMENTOS**:
   - Ao ser questionado sobre horários, informe o horário de hoje ou da semana de forma precisa e indique se a loja está aberta agora.
   - Ao ser questionado sobre pagamentos, confirme claramente que aceita PIX, Cartão de Crédito, Débito e Dinheiro com troco.

5. **ELABORAÇÃO DE PEDIDOS (DRAFT ORDER)**:
   - Se o cliente solicitar itens ou pedir para anotar o pedido (ex: "quero 2 pães franceses e 1 cappuccino", "anote meu pedido: ..."):
     a) Resuma os itens com quantidades, valores unitários e valor total.
     b) Adicione no final da sua mensagem a tag de estruturação para acionar o botão de envio no WhatsApp:
        [[DRAFT_ORDER: item1:quantidade:precoUnitario, item2:quantidade:precoUnitario]]
        Exemplo: [[DRAFT_ORDER: Pão Francês:2:1.20, Café Expresso:1:6.00]]

TOM DE VOZ:
- ${toneDescription}
- Sempre em Português do Brasil com excelente pontuação, clareza e simpatia.
`;

      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        // Fallback intelligent conversation
        const fallback = generateConversationalFallback(
          userMessage || '',
          storeInfo,
          currentStatus,
          weeklySchedule,
          activeProducts,
          availableAddons,
          availableFlavors,
          activeCategoriesWithProducts,
          agentName,
          messages || []
        );
        return res.json(fallback);
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      // Sanitize and normalize conversation history for Gemini API:
      // 1. Must strictly start with 'user'
      // 2. Must alternate 'user' -> 'model' -> 'user'
      // 3. Must end with the latest 'user' prompt
      const rawTurns: Array<{ role: 'user' | 'model'; text: string }> = [];

      if (Array.isArray(messages)) {
        for (const msg of messages) {
          const role: 'user' | 'model' = (msg.role === 'assistant' || msg.role === 'model' || msg.sender === 'assistant') ? 'model' : 'user';
          const text = (msg.content || msg.text || '').trim();
          if (text) {
            rawTurns.push({ role, text });
          }
        }
      }

      if (userMessage && userMessage.trim()) {
        const lastTurn = rawTurns[rawTurns.length - 1];
        if (!lastTurn || lastTurn.role !== 'user' || lastTurn.text !== userMessage.trim()) {
          rawTurns.push({ role: 'user', text: userMessage.trim() });
        }
      }

      // Remove leading model turns (e.g. initial welcome message) so conversation starts with user turn
      while (rawTurns.length > 0 && rawTurns[0].role === 'model') {
        rawTurns.shift();
      }

      if (rawTurns.length === 0) {
        rawTurns.push({ role: 'user', text: userMessage?.trim() || 'Olá!' });
      }

      // Collapse adjacent same-role turns so they strictly alternate
      const alternatingTurns: Array<{ role: 'user' | 'model'; text: string }> = [];
      for (const turn of rawTurns) {
        if (alternatingTurns.length === 0) {
          alternatingTurns.push(turn);
        } else {
          const prev = alternatingTurns[alternatingTurns.length - 1];
          if (prev.role === turn.role) {
            prev.text += `\n${turn.text}`;
          } else {
            alternatingTurns.push(turn);
          }
        }
      }

      // Ensure last turn is user
      if (alternatingTurns.length > 0 && alternatingTurns[alternatingTurns.length - 1].role !== 'user') {
        alternatingTurns.push({ role: 'user', text: userMessage?.trim() || 'Pode me ajudar?' });
      }

      const formattedContents = alternatingTurns.map(t => ({
        role: t.role,
        parts: [{ text: t.text }],
      }));

      let responseText = '';
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: formattedContents,
          config: {
            systemInstruction,
            temperature: creativity,
          },
        });
        responseText = response.text || '';
      } catch (modelErr: any) {
        console.warn('Primary model gemini-3.8-flash error, trying fallback model:', modelErr?.message);
        try {
          const fallbackRes = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: formattedContents,
            config: {
              systemInstruction,
              temperature: creativity,
            },
          });
          responseText = fallbackRes.text || '';
        } catch (e2: any) {
          console.warn('Secondary model failed, trying conversational fallback generator:', e2?.message);
          const fallback = generateConversationalFallback(
            req.body?.userMessage || '',
            storeInfo,
            currentStatus,
            weeklySchedule,
            activeProducts,
            availableAddons,
            availableFlavors,
            activeCategoriesWithProducts,
            agentName,
            req.body?.messages || []
          );
          return res.json(fallback);
        }
      }

      if (!responseText.trim()) {
        responseText = 'Como posso te ajudar com nosso cardápio hoje?';
      }

      // Parse Draft Order tag if present: [[DRAFT_ORDER: item1:qty:price, item2:qty:price]]
      const draftMatch = responseText.match(/\[\[(?:DRAFT_ORDER|PEDIDO_WHATSAPP|PEDIDO_ITENS):\s*([^\]]+)\]\]/i);
      let structuredOrder: { items: Array<{ name: string; quantity: number; price: number }>; total: number } | null = null;

      if (draftMatch && draftMatch[1]) {
        const rawItems = draftMatch[1].split(',');
        const parsedItems: Array<{ name: string; quantity: number; price: number }> = [];
        let total = 0;

        for (const raw of rawItems) {
          const parts = raw.trim().split(':');
          const name = parts[0]?.trim();
          const qty = parseInt(parts[1]?.trim() || '1', 10) || 1;
          const price = parseFloat(parts[2]?.trim() || '0') || 0;

          if (name) {
            parsedItems.push({ name, quantity: qty, price });
            total += price * qty;
          }
        }

        if (parsedItems.length > 0) {
          structuredOrder = { items: parsedItems, total };
        }

        responseText = responseText.replace(/\[\[(?:DRAFT_ORDER|PEDIDO_WHATSAPP|PEDIDO_ITENS):\s*[^\]]+\]\]/gi, '').trim();
      }

      // Generate direct WhatsApp link
      const cleanPhone = (whatsappNumber || '').replace(/\D/g, '');
      let whatsappLink = '';
      if (cleanPhone) {
        const defaultMsg = encodeURIComponent(`Olá! Estava conversando com ${agentName} no site da padaria e gostaria de atendimento.`);
        whatsappLink = `https://wa.me/55${cleanPhone.replace(/^55/, '')}?text=${defaultMsg}`;
      }

      return res.json({
        reply: responseText,
        structuredOrder,
        whatsappLink,
        agentName,
      });

    } catch (error: any) {
      console.error('Error in /api/ai/chat (falling back to local conversational engine):', error?.message || error);
      
      try {
        const dbState: any = getLiveDbState() || {};
        const storeInfo = dbState.storeInfo || {};
        const currentStatus = getStoreCurrentStatus(storeInfo.weeklySchedule, storeInfo.isOpen !== false, !!storeInfo.autoOpenClose);
        const weeklySchedule = parseWeeklySchedule(storeInfo.weeklySchedule);
        const rawCategories = Array.isArray(dbState.categories) ? dbState.categories : [];
        const rawProducts = Array.isArray(dbState.products) ? dbState.products : [];

        const activeCategories = rawCategories.filter((c: any) => 
          c && 
          c.id && 
          typeof c.name === 'string' && 
          c.isVisible !== false && 
          c.availableInStore !== false && 
          !isExcludedCategory(c.name)
        );

        const activeCategoryIds = new Set(activeCategories.map((c: any) => c.id));

        const activeProducts = rawProducts.filter((p: any) => 
          p && 
          p.name &&
          p.isActive !== false && 
          p.availableInStore !== false && 
          !p.isAddon && 
          !p.isFlavor && 
          !shouldExcludeProduct(p, rawCategories) &&
          activeCategoryIds.has(p.categoryId)
        );

        const availableAddons = rawProducts.filter((p: any) => 
          p && 
          p.name &&
          p.isActive !== false && 
          p.availableInStore !== false && 
          p.isAddon && 
          !shouldExcludeProduct(p, rawCategories)
        );

        const availableFlavors = rawProducts.filter((p: any) => 
          p && 
          p.name &&
          p.isActive !== false && 
          p.availableInStore !== false && 
          p.isFlavor && 
          !shouldExcludeProduct(p, rawCategories)
        );

        const activeCategoriesWithProducts = activeCategories.filter((c: any) =>
          activeProducts.some((p: any) => p.categoryId === c.id)
        );

        const agentName = storeInfo.aiAgentName || 'Mani';

        const fallback = generateConversationalFallback(
          req.body?.userMessage || '',
          storeInfo,
          currentStatus,
          weeklySchedule,
          activeProducts,
          availableAddons,
          availableFlavors,
          activeCategoriesWithProducts,
          agentName,
          req.body?.messages || []
        );
        return res.json(fallback);
      } catch (innerFallbackErr) {
        console.error('Inner error in fallback generator:', innerFallbackErr);
        return res.json({
          reply: `Olá! Sou Mani, atendente virtual do Portal BALBEC. Posso te ajudar com dúvidas, pedidos ou informações do portal. Como posso ajudar hoje?`,
          agentName: 'Mani',
        });
      }
    }
  });

  // Direct endpoint to generate clean WhatsApp links with complete order details
  app.post('/api/ai/format-whatsapp-order', (req: Request, res: Response) => {
    try {
      const { items, customerName, customerPhone, deliveryType, deliveryAddress, paymentMethod, notes } = req.body;
      const dbState = getLiveDbState();
      const storeInfo = dbState.storeInfo || {};
      const agentName = storeInfo.aiAgentName || 'Mani';
      const phone = (storeInfo.aiAgentWhatsAppPhone || storeInfo.whatsapp || '').replace(/\D/g, '');

      if (!phone) {
        return res.status(400).json({ error: 'Número de WhatsApp do portal não configurado.' });
      }

      let total = 0;
      const itemsText = (items || []).map((item: any) => {
        const itemTotal = Number(item.price) * Number(item.quantity);
        total += itemTotal;
        return `• ${item.quantity}x *${item.name}* - R$ ${itemTotal.toFixed(2).replace('.', ',')}`;
      }).join('\n');

      const message = `🍞 *PEDIDO VIA ATENDENTE VIRTUAL (${agentName})* 🍞
*${storeInfo.name || 'BALBEC - PORTAL DE FRANQUEADOS'}*

📋 *Itens do Pedido:*
${itemsText || '• (Itens a combinar)'}

💰 *Total:* R$ ${total.toFixed(2).replace('.', ',')}

👤 *Cliente:* ${customerName || 'Não informado'}
📞 *Telefone:* ${customerPhone || 'Não informado'}
📍 *Modalidade:* ${deliveryType === 'delivery' ? `🛵 Entrega em: ${deliveryAddress || 'Endereço a combinar'}` : '🏬 Retirada no Balcão'}
💳 *Pagamento:* ${paymentMethod || 'A combinar'}
${notes ? `📝 *Observação:* ${notes}\n` : ''}
Gostaria de confirmar meu pedido! 😊`;

      const cleanPhone = phone.startsWith('55') ? phone : `55${phone}`;
      const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;

      return res.json({
        success: true,
        whatsappUrl,
        formattedMessage: message,
        total,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });
}

function generateConversationalFallback(
  userQuery: string,
  storeInfo: any = {},
  currentStatus: any = {},
  weeklySchedule: any[] = [],
  products: any[] = [],
  availableAddons: any[] = [],
  availableFlavors: any[] = [],
  categories: any[] = [],
  agentName: string = 'Mani',
  history: any[] = []
) {
  try {
    const query = (userQuery || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const phone = (storeInfo?.aiAgentWhatsAppPhone || storeInfo?.whatsapp || '').replace(/\D/g, '');
    const cleanPhone = phone.startsWith('55') ? phone : `55${phone}`;
    const whatsappLink = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent('Olá! Gostaria de fazer meu pedido.')}` : '';

    const safeProducts = Array.isArray(products) ? products.filter((p: any) => p && typeof p.name === 'string' && p.name.trim().length > 0) : [];
    const safeCategories = Array.isArray(categories) ? categories.filter((c: any) => c && typeof c.name === 'string' && c.name.trim().length > 0) : [];
    const safeSchedule = Array.isArray(weeklySchedule) ? weeklySchedule : [];

    // 1. Specific product query or price inquiry
    const matchedProduct = safeProducts.find((p: any) => {
      const pName = (p.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return pName && (query.includes(pName) || (pName.length > 4 && query.includes(pName.substring(0, 5))));
    });

    if (matchedProduct && (query.includes('quanto') || query.includes('preco') || query.includes('valor') || query.includes('tem') || query.includes('possui') || query.includes('qual o valor'))) {
      const formattedPrice = `R$ ${Number(matchedProduct.price || 0).toFixed(2).replace('.', ',')}`;
      const desc = matchedProduct.description ? ` (${matchedProduct.description})` : '';
      return {
        reply: `O **${matchedProduct.name}** está por **${formattedPrice}**${desc}. Posso adicionar ao seu pedido?`,
        whatsappLink,
        agentName,
      };
    }

    // 2. Order Intent
    if (query.includes('quero') || query.includes('pedir') || query.includes('comprar') || query.includes('pedido') || query.includes('monte') || query.includes('anote')) {
      const matched: Array<{ name: string; quantity: number; price: number }> = [];
      let total = 0;

      for (const p of safeProducts) {
        const pName = (p.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (pName && query.includes(pName)) {
          const qty = 1;
          const price = Number(p.price || 0);
          matched.push({ name: p.name, quantity: qty, price });
          total += price * qty;
        }
      }

      if (matched.length > 0) {
        const itemsList = matched.map(m => `• ${m.quantity}x **${m.name}** - R$ ${(m.price * m.quantity).toFixed(2).replace('.', ',')}`).join('\n');
        return {
          reply: `Perfeito! Anotei seu pedido:\n\n${itemsList}\n\n💰 **Total: R$ ${total.toFixed(2).replace('.', ',')}**\n\nClique no botão abaixo para **Confirmar e Enviar via WhatsApp** ou **Adicionar ao Carrinho**!`,
          structuredOrder: { items: matched, total },
          whatsappLink,
          agentName,
        };
      }
    }

    // 3. Category queries (e.g., "o que voces tem de doce?", "quais os paes?", "cardapio")
    const matchedCategory = safeCategories.find((c: any) => {
      const cName = (c.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return query.includes(cName) || (cName.includes('pao') && query.includes('pao')) || (cName.includes('doce') && query.includes('doce')) || (cName.includes('salgado') && query.includes('salgado')) || (cName.includes('cafe') && query.includes('cafe'));
    });

    if (matchedCategory) {
      const prodsInCat = safeProducts.filter((p: any) => p.categoryId === matchedCategory.id);
      if (prodsInCat.length > 0) {
        const list = prodsInCat.slice(0, 8).map((p: any) => `• **${p.name}** - R$ ${Number(p.price || 0).toFixed(2).replace('.', ',')}${p.description ? ` (${p.description})` : ''}`).join('\n');
        return {
          reply: `Na categoria **${matchedCategory.name}**, temos:\n\n${list}\n\nQual deles você gostaria de experimentar ou adicionar ao pedido?`,
          whatsappLink,
          agentName,
        };
      }
    }

    if (query.includes('cardapio') || query.includes('menu') || query.includes('categorias') || query.includes('o que tem') || query.includes('o que voces tem') || query.includes('opcoes')) {
      const formattedCategories = safeCategories.map((c: any) => {
        const prods = safeProducts.filter((p: any) => p.categoryId === c.id);
        const items = prods.slice(0, 6).map((p: any) => `  • **${p.name}** - R$ ${Number(p.price || 0).toFixed(2).replace('.', ',')}`).join('\n');
        return `📌 **${c.name}** (${prods.length} itens):\n${items || '  • Itens disponíveis no balcão'}`;
      }).join('\n\n');

      return {
        reply: `Aqui está o nosso cardápio ativo para consumo na loja:\n\n${formattedCategories || 'Nosso cardápio está sendo atualizado.'}\n\nVocê pode me perguntar sobre qualquer item, solicitar preços detalhados ou me pedir para anotar seu pedido! 🥐☕`,
        whatsappLink,
        agentName,
      };
    }

    // 4. Payment Methods
    if (query.includes('pagamento') || query.includes('pix') || query.includes('cartao') || query.includes('dinheiro') || query.includes('pagar') || query.includes('forma de pagamento') || query.includes('troco')) {
      return {
        reply: `Aceitamos as seguintes formas de pagamento:\n\n💳 **Cartão de Crédito e Débito** (principais bandeiras)\n📱 **PIX** (rápido e prático)\n💵 **Dinheiro** (com troco facilitado)\n\nO pagamento pode ser feito tanto na entrega (Delivery) quanto na retirada no balcão!`,
        whatsappLink,
        agentName,
      };
    }

    // 5. Operating Hours
    if (query.includes('horario') || query.includes('hora') || query.includes('aberto') || query.includes('abre') || query.includes('fecha') || query.includes('domingo') || query.includes('segunda') || query.includes('sabado') || query.includes('funciona')) {
      const summary = safeSchedule.map((d: any) => `• **${d.dayName}**: ${d.isOpen ? `${d.openTime} às ${d.closeTime}` : 'Fechado'}`).join('\n');
      return {
        reply: `Nosso horário de funcionamento é:\n\n${summary || '• Segunda a Sábado: 05:30 às 20:00\n• Domingo: 06:00 às 13:00'}\n\n${currentStatus?.isOpenNow ? '🟢 **Estamos abertos agora!** Venha nos visitar ou faça seu pedido por aqui.' : '🔴 **No momento a loja física está fechada**, mas você pode consultar os itens e adiantar seu pedido.'}`,
        whatsappLink,
        agentName,
      };
    }

    // 6. Delivery and pickup
    if (query.includes('entrega') || query.includes('delivery') || query.includes('taxa') || query.includes('buscar') || query.includes('retirar') || query.includes('balcao') || query.includes('totem')) {
      return {
        reply: `Temos duas formas de atendimento:\n\n🛵 **Delivery**: Entregamos no conforto da sua casa ou trabalho.\n🏬 **Consumo / Retirada no Balcão**: Você pode consultar o cardápio e retirar diretamente na nossa loja física (${storeInfo?.address || 'Praça Dr. Jorge Frange, 72'}).\n\n*(Nota: O Totem é um terminal de autoatendimento presencial exclusivo para uso no balcão da loja).*`,
        whatsappLink,
        agentName,
      };
    }

    // 7. Suggestions / Recommendations
    if (query.includes('sugere') || query.includes('sugestao') || query.includes('recomenda') || query.includes('combina') || query.includes('o que tem de bom') || query.includes('especial') || query.includes('tarde') || query.includes('manha') || query.includes('lanche')) {
      const sampleProducts = safeProducts.slice(0, 4);
      const prodNames = sampleProducts.map((p: any) => `• **${p.name}** (R$ ${Number(p.price || 0).toFixed(2).replace('.', ',')})`).join('\n');
      
      return {
        reply: `Se você quer uma recomendação especial para o café da tarde ou lanche, que tal experimentar nossos destaques:\n\n${prodNames || '• Pão de Queijo quentinho\n• Café Expresso Gourmet\n• Croissant Misto na chapa\n• Fatia de Bolo Caseiro'}\n\n*Dica especial:* Nossa principal fornada de pão francês quentinho sai fresquinha às **16:30**! 🥖✨\n\nDeseja que eu monte um pedido ou adicione algum item ao seu carrinho?`,
        whatsappLink,
        agentName,
      };
    }

    // 8. Address / Location
    if (query.includes('onde') || query.includes('endereco') || query.includes('local') || query.includes('fica') || query.includes('cidade') || query.includes('bairro')) {
      return {
        reply: `📍 Nosso endereço é:\n\n**${storeInfo?.address || 'Praça Dr. Jorge Frange, 72 - São Benedito, Uberaba - MG'}**.\n\nVenha tomar um café quentinho conosco! 🥖☕`,
        whatsappLink,
        agentName,
      };
    }

    // 9. Natural context response
    const hasHistory = Array.isArray(history) && history.length > 1;
    if (hasHistory) {
      return {
        reply: `Com certeza! Posso te informar preços, detalhes de qualquer produto do cardápio, horários de atendimento ou anotar seu pedido completo. O que você gostaria de saber?`,
        whatsappLink,
        agentName,
      };
    }

    return {
      reply: `Olá! Sou **${agentName}**, atendente virtual da **${storeInfo?.name || 'BALBEC - Portal de Franqueados'}**. \n\nEstou aqui para te informar sobre nossos produtos, pedidos, horários e suporte. Como posso te ajudar?`,
      whatsappLink,
      agentName,
    };
  } catch (err: any) {
    console.error('generateConversationalFallback inner error:', err);
    return {
      reply: `Olá! Sou ${agentName || 'Mani'}, atendente virtual do Portal BALBEC. Posso te ajudar com dúvidas e informações. Como posso te ajudar hoje?`,
      agentName: agentName || 'Mani',
    };
  }
}
