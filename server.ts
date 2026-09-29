import express from "express";
import path from "path";
import axios from "axios";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import dotenv from "dotenv";
import compression from "compression";
import { setupDatabaseRoutes, hydrateFromPostgres, getMemStoreInfo } from "./src/server/dbRoutes";
import { setupPrinterRoutes } from "./src/server/printerRoutes";
import { setupPrinterAgentRoutes } from "./src/server/printerAgentRoutes";
import { ensureTablesExist } from "./src/db/index";
import { cleanProductDescription } from "./src/constants";

dotenv.config();

// Global crash protection for container environments (Render, Cloud Run, etc.)
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception capturada (evitando queda do servidor):', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled Rejection capturada (evitando queda do servidor):', reason);
});

export const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Middleware registration (immediately available)
app.use(compression());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Prevent browser caching on DB API routes (ensures instant sync across mobile & desktop)
app.use('/api/db', (req, res, next) => {
  // For catalog endpoints, allow revalidation via ETag / 304 Not Modified
  if (req.path === '/products' || req.path === '/categories' || req.path === '/tables' || req.path === '/store-info') {
    res.setHeader('Cache-Control', 'no-cache');
  } else {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use((req, res, next) => {
  const host = req.headers.host;
  // Se o acesso for pelo domínio principal, redireciona para o subdomínio preservando o método (POST/GET)
  if (host && (host === 'paomania.com.br' || host === 'www.paomania.com.br')) {
    console.log(`[Redirect] ${host}${req.url} -> cardapiodigital.paomania.com.br (Method: ${req.method})`);
    return res.redirect(308, `https://cardapiodigital.paomania.com.br${req.url}`);
  }
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} (Host: ${host})`);
  next();
});

const APP_BUILD_VERSION = process.env.APP_VERSION || "2.5.0";

app.get("/api/version", (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({ version: APP_BUILD_VERSION });
});

app.get("/api/ping", (req, res) => {
  res.json({ message: "pong", time: new Date().toISOString() });
});

app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    node: process.version,
    env: process.env.NODE_ENV,
    vercel: !!process.env.VERCEL,
    db_config: {
      host: !!process.env.SQL_HOST,
      user: !!process.env.SQL_USER,
      db: !!process.env.SQL_DB_NAME,
      pass: !!process.env.SQL_PASSWORD,
      port: !!process.env.SQL_PORT
    },
    time: new Date().toISOString()
  });
});

// SSE Clients list & broadcast
let sseClients: Array<{ id: string; res: any }> = [];

export function broadcastSync(type = 'sync') {
  console.log(`[SSE] Broadcasting sync event (${type}) to ${sseClients.length} clients`);
  for (const client of sseClients) {
    try {
      client.res.write(`data: ${JSON.stringify({ type, time: Date.now() })}\n\n`);
    } catch (e) {
      // ignore
    }
  }
}

app.get('/api/events', (req, res) => {
  if (process.env.VERCEL) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.write(`data: ${JSON.stringify({ type: 'connected', time: Date.now() })}\n\n`);
    res.end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const clientId = Math.random().toString(36).substring(7);
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  res.write(`data: ${JSON.stringify({ type: 'connected', time: Date.now() })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// Mount Cloud SQL PostgreSQL API routes immediately
try {
  setupDatabaseRoutes(app, broadcastSync);
  setupPrinterRoutes(app);
  setupPrinterAgentRoutes(app, getMemStoreInfo);
} catch (err) {
  console.error("Erro ao registrar rotas do DB:", err);
}

// Image Proxy Route to prevent Mixed Content (HTTP -> HTTPS) SSL protocol errors
app.get("/api/image-proxy", async (req, res) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl) {
    return res.status(400).send("URL parameter is required");
  }
  try {
    const response = await axios.get(imageUrl, {
      responseType: "stream",
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    if (response.headers["content-type"]) {
      res.setHeader("Content-Type", response.headers["content-type"]);
    }
    res.setHeader("Cache-Control", "public, max-age=604800, immutable"); // Cache 7 dias
    response.data.pipe(res);
  } catch (error: any) {
    res.setHeader("Cache-Control", "public, max-age=3600"); // Cache 1h para evitar loops contínuos de erro
    res.status(404).send("Image not found");
  }
});

// Helper function to diagnose and format BlueFocus errors friendly
function formatBlueFocusError(error: any): { message: string; details: any } {
  let friendlyMessage = "Erro ao comunicar com o servidor da BlueFocus";
  const errorDetail = error.response?.data || error.message || error.code || String(error);

  if (error.code === 'ECONNREFUSED') {
    friendlyMessage = "Conexão recusada pelo servidor BlueFocus (porta 8082 fechada ou serviço parado no computador local).";
  } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    friendlyMessage = "Tempo limite esgotado (Timeout) ao conectar ao servidor BlueFocus (paomania.ddns.net:8082). Verifique se o roteador/computador está online.";
  } else if (error.code === 'ENOTFOUND') {
    friendlyMessage = "Endereço DDNS não encontrado (paomania.ddns.net). Verifique o endereço no No-IP / DDNS.";
  } else if (error.response?.status === 401 || error.response?.status === 403) {
    friendlyMessage = "Chave de autenticação rejeitada pela BlueFocus. Verifique o campo 'autentica'.";
  } else if (typeof errorDetail === 'string') {
    if (errorDetail.includes('<Message>')) {
      const match = errorDetail.match(/<Message>(.*?)<\/Message>/);
      if (match) friendlyMessage = match[1];
    } else if (errorDetail.includes('<faultstring>')) {
      const match = errorDetail.match(/<faultstring>(.*?)<\/faultstring>/);
      if (match) friendlyMessage = match[1];
    } else if (errorDetail.includes('Erro')) {
      friendlyMessage = errorDetail.substring(0, 180);
    }
  }

  return { message: friendlyMessage, details: errorDetail };
}

// API Route for BlueFocus Product Sync
  app.post("/api/bluefocus/sync-products", async (req, res) => {
    console.log(`[Sync] Recebida requisição de sincronização: ${req.method} ${req.url}`);
    try {
      const {
        empresaId: reqEmpresaId, 
        usuarioId: reqUsuarioId, 
        pdvCodigo: reqPdvCodigo, 
        syncUrl: reqSyncUrl,
        tipoAtualizacao: reqTipoAtualizacao,
        tipo: reqTipo,
        dataInicial: reqDataInicial,
        startCargaNumero = 0,
        startCargaSequencia = 0,
        startProdutoId = 0,
        authToken,
        batchSize = 50, // Number of iterations per request
        excludeKeywords = []
      } = req.body;

      const authKey = process.env.BLUE_FOCUS_AUTH_KEY || process.env.BLUEFOCUS_AUTH_KEY || process.env.BLUEFOCUS_AUTH_TOKEN;
      const empresaId = reqEmpresaId || process.env.BLUEFOCUS_EMPRESA_ID || process.env.BLUEFOCUS_EMPRESA || 'PAOMANIA';
      const usuarioId = reqUsuarioId || process.env.BLUEFOCUS_USUARIO_ID || process.env.BLUEFOCUS_USUARIO || 'CONSULTA';
      const pdvCodigo = reqPdvCodigo || process.env.BLUEFOCUS_PDV_CODIGO || '1000';
      const syncUrl = reqSyncUrl || process.env.BLUEFOCUS_SYNC_URL || "http://paomania.ddns.net:8082/valim/servlet/aintegracaofcxexportacadsat";
      const tipoAtualizacao = reqTipoAtualizacao || 'A';
      const tipo = reqTipo || '4';
      const dataInicial = reqDataInicial || '30/12/1899';

      console.log(`Batch Sync: Empresa: [${empresaId}], Carga: ${startCargaNumero}/${startCargaSequencia}, Batch: ${batchSize}`);

      const isValidToken = (t?: string) => {
        if (!t) return false;
        const clean = String(t).trim();
        return clean.length > 5 && !clean.includes('XXXX') && clean !== 'AGUARDANDO_CHAVE' && clean !== 'undefined' && clean !== 'null';
      };

      const headers: any = {
        "Content-Type": "text/xml; charset=utf-8"
      };
      
      if (isValidToken(authToken)) {
        headers["autentica"] = authToken.trim();
      } else if (isValidToken(authKey)) {
        headers["autentica"] = authKey.trim();
      }

      let allMappedProducts: any[] = [];
      let currentCargaNumero = parseInt(String(startCargaNumero));
      let currentCargaSequencia = parseInt(String(startCargaSequencia));
      let lastProdutoId = parseInt(String(startProdutoId)); // The manual says to use this for pagination
      let hasMore = true;
      let iterations = 0;
      let lastXml = "";
      let snFim = 'N';
      let ignoredCount = 0;
      let ignoredBreakdown: Record<string, number> = { suspended: 0, filtered: 0 };
      let lastBatchProducts: any[] = [];
      
      const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, " ").toUpperCase().trim();
      const excludeList = Array.isArray(excludeKeywords) ? excludeKeywords.map((k: string) => normalize(k)).filter(k => k.length > 0) : [];
      
      // Track visited markers to prevent infinite loops
      const visitedMarkers = new Set<string>();

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        isArray: (name) => ["ProdutoItem", "produtoitem", "Produto", "PrecoProdutoItem"].includes(name)
      });

      const getVal = (obj: any, key: string) => {
        if (!obj || typeof obj !== 'object') return undefined;
        const lowerKey = key.toLowerCase();
        
        // Direct match or namespace match
        for (const k in obj) {
          const cleanK = k.toLowerCase().split(':').pop();
          if (cleanK === lowerKey) {
            const val = obj[k];
            // Handle { "#text": "value" } or similar from fast-xml-parser
            if (val && typeof val === 'object' && val['#text'] !== undefined) return val['#text'];
            return val;
          }
        }
        return undefined;
      };

      const soapTipoAtualizacao = String(tipoAtualizacao);
      const isFullSync = soapTipoAtualizacao === 'C' || (currentCargaNumero === 0 && currentCargaSequencia === 0);
      // Always request Tipo 4 (Produtos) for product sync, overriding legacy '1' (Cadastros Gerais)
      const soapTipo = (tipo === '1' || !tipo) ? '4' : String(tipo);

      // In Vercel serverless environment, enforce smaller batch sizes (max 4 per request) to prevent 10s timeout
      const maxIterationsPerCall = process.env.VERCEL ? Math.min(Number(batchSize) || 4, 4) : Math.min(Number(batchSize) || 20, 20);

      while (iterations < maxIterationsPerCall && hasMore) {
        let soapCargaNumero = currentCargaNumero;
        let soapCargaSequencia = currentCargaSequencia;
        let soapProdutoId = lastProdutoId;

        if (isFullSync && iterations === 1) {
          soapCargaNumero = parseInt(String(startCargaNumero)) || 0;
          soapCargaSequencia = parseInt(String(startCargaSequencia)) || 0;
          soapProdutoId = parseInt(String(startProdutoId)) || 0;
        }

        // BlueFocus Valim SOAP expects 'A' (Alterações) even for full loads from zero
        const finalTipoAtualizacao = 'A';

        const markerKey = `${soapCargaNumero}-${soapCargaSequencia}-${soapProdutoId}`;
        if (visitedMarkers.has(markerKey)) {
          console.log(`Marker ${markerKey} already visited. Stopping.`);
          hasMore = false;
          break;
        }
        visitedMarkers.add(markerKey);
        
        iterations++;
        
        console.log(`[BlueFocus] Iniciando requisição: Tipo=${soapTipo}, Atualizacao=${finalTipoAtualizacao}, Carga=${soapCargaNumero}/${soapCargaSequencia}, Iteração=${iterations}`);

        const soapDataInicio = dataInicial || "30/12/1899";

        const soapEnvelope = `<?xml version="1.0"?>
<SOAP-ENV:Envelope 
xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" 
xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<SOAP-ENV:Body>
<IntegracaoFcxExportaCadSAT.Execute xmlns="Valim">
<Sdtwebserviceentradaexpcadastro>
<EmpresaId>${empresaId}</EmpresaId>
<UsuarioId>${usuarioId}</UsuarioId>
<PDVCodigo>${pdvCodigo}</PDVCodigo>
<TipoAtualizacao>${finalTipoAtualizacao}</TipoAtualizacao>
<Tipo>${soapTipo}</Tipo>
<PessoaId>0</PessoaId>
<CargaPDVNumero>${soapCargaNumero}</CargaPDVNumero>
<CargaPDVSequencia>${soapCargaSequencia}</CargaPDVSequencia>
<ProdutoId>${soapProdutoId}</ProdutoId>
<DataHoraInicio>${soapDataInicio}</DataHoraInicio>
</Sdtwebserviceentradaexpcadastro>
</IntegracaoFcxExportaCadSAT.Execute>
</SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

        try {
          const currentTimeout = process.env.VERCEL ? 7000 : (tipo === '1' ? 45000 : 15000);
          
          const response = await axios.post(syncUrl, soapEnvelope, { 
            headers, 
            timeout: currentTimeout 
          });
          lastXml = response.data;
          
          const jsonObj = parser.parse(response.data);
          const envelope = getVal(jsonObj, "Envelope");
          const body = getVal(envelope, "Body");
          const executeResponse = getVal(body, "IntegracaoFcxExportaCadSAT.ExecuteResponse") || getVal(body, "ExecuteResponse");
          const saiaExp = getVal(executeResponse, "Sdtwebservicesaidaexpcadastrosat") || getVal(executeResponse, "Sdtwebserviceout") || executeResponse;

          if (!saiaExp) {
            console.log("[Sync] Resposta vazia ou estrutura desconhecida. Debug XML:", lastXml.substring(0, 1000));
            hasMore = false;
            break;
          }

          const msgErro = getVal(saiaExp, "MsgErro");
          if (msgErro && msgErro !== "" && msgErro !== "OK") {
            return res.status(400).json({ error: msgErro, debugXml: lastXml.substring(0, 2000) });
          }

          let products = getVal(saiaExp, "ProdutoItem") || getVal(saiaExp, "Produto");
          let productsArray: any[] = [];
          
          if (products) {
            productsArray = Array.isArray(products) ? products : [products];
            lastBatchProducts = productsArray; // Keep for the response summary
            console.log(`[Sync] Iteração ${iterations}: Encontrados ${productsArray.length} itens no XML.`);
            
            for (const item of productsArray) {
              const pId = String(getVal(item, "ProdutoId") || "");
              if (!pId) continue;

              // Filter out suspended products
              const isSuspended = getVal(item, "ProdutoSNSuspenso") === 'S';
              if (isSuspended) {
                ignoredCount++;
                ignoredBreakdown.suspended++;
                continue;
              }

              // Update lastProdutoId for next loop paging as per documentation
              const currentId = parseInt(pId);
              if (!isNaN(currentId)) {
                lastProdutoId = currentId;
              }

              const pName = String(getVal(item, "ProdutoDescricaoResumida") || getVal(item, "ProdutoDescricao") || "Sem Nome");
              const pCat = String(getVal(item, "ProdutoFamiliaDescricao") || "");
              const normalizedName = normalize(pName);
              const normalizedCat = normalize(pCat);
              
              // Filter out excluded keywords by name or category
              if (excludeList.some(k => normalizedName.includes(k) || normalizedCat.includes(k))) {
                const matchingKey = excludeList.find(k => normalizedName.includes(k) || normalizedCat.includes(k)) || "unspecified";
                ignoredBreakdown[matchingKey] = (ignoredBreakdown[matchingKey] || 0) + 1;
                ignoredCount++;
                ignoredBreakdown.filtered++;
                continue;
              }

              let price = 0;
              const priceItems = getVal(item, "PrecoProdutoItem");
              if (priceItems) {
                const priceArray = Array.isArray(priceItems) ? priceItems : [priceItems];
                // Try to find the 'V' (Venda) price type
                const vPrice = priceArray.find((p: any) => 
                  getVal(p, "PrecoProdutoPrecoTipo") === 'V' || 
                  String(getVal(p, "PrecoProdutoPrecoDesc")).toLowerCase().includes('venda')
                ) || priceArray[0];
                price = parseFloat(String(getVal(vPrice, "PrecoProdutoValor") || 0).replace(',', '.'));
              } else {
                price = parseFloat(String(getVal(item, "ProdutoValorUnitario") || getVal(item, "ProdutoPrecoVenda") || 0).replace(',', '.'));
              }

              // Extract barcode from CodigoBarrasItem if available
              let barcode = "";
              const barcodeItems = getVal(item, "CodigoBarrasItem");
              if (barcodeItems) {
                const barcodeArray = Array.isArray(barcodeItems) ? barcodeItems : [barcodeItems];
                barcode = String(getVal(barcodeArray[0], "CodigoBarras") || "");
              }

              const rawDesc = getVal(item, "ProdutoDescricao") || "";
              const finalDesc = cleanProductDescription(rawDesc, true);

              // Base URL derivation for static mercadoria images
              const baseUrl = syncUrl 
                ? String(syncUrl).split('?')[0].replace(/\/(servlet|ws|bluefocus|aintegracao).*$/i, '').replace(/\/+$/, '') 
                : '';
              const standardMercadoriaUrl = (baseUrl && pId) ? `${baseUrl}/static/mercadoria/${pId}.jpg` : "";
              const rawImgUrl = getVal(item, "ProdutoUrlImagem") || getVal(item, "UrlImagem") || getVal(item, "ProdutoImagemUrl") || getVal(item, "ImagemUrl") || getVal(item, "ProdutoImagem") || getVal(item, "Imagem") || getVal(item, "ProdutoFoto") || getVal(item, "Foto") || getVal(item, "UrlFoto") || getVal(item, "FotoUrl") || getVal(item, "ProdutoFotoUrl") || getVal(item, "ProdutoCaminhoImagem") || getVal(item, "CaminhoImagem") || getVal(item, "ProdutoLinkImagem") || getVal(item, "LinkImagem") || "";

              let finalImgUrl = rawImgUrl;
              if (finalImgUrl && !finalImgUrl.startsWith("http://") && !finalImgUrl.startsWith("https://") && baseUrl) {
                const cleanPath = finalImgUrl.startsWith("/") ? finalImgUrl : `/${finalImgUrl}`;
                finalImgUrl = `${baseUrl}${cleanPath}`;
              }
              if (!finalImgUrl) {
                finalImgUrl = standardMercadoriaUrl;
              }

              // Extract category/family/group safely from all known BlueFocus XML tags
              const rawCatId = getVal(item, "ProdutoFamiliaId") || 
                               getVal(item, "FamiliaId") || 
                               getVal(item, "ProdutoGrupoId") || 
                               getVal(item, "GrupoId") || 
                               getVal(item, "ProdutoSubGrupoId") || 
                               getVal(item, "SubGrupoId") || 
                               getVal(item, "ProdutoSecaoId") || 
                               getVal(item, "SecaoId") || 
                               getVal(item, "ProdutoFamiliaCod") || 
                               getVal(item, "ProdutoGrupoCod") || 
                               "0";

              let rawCatName = getVal(item, "ProdutoFamiliaDescricao") || 
                                getVal(item, "FamiliaDescricao") || 
                                getVal(item, "ProdutoGrupoDescricao") || 
                                getVal(item, "GrupoDescricao") || 
                                getVal(item, "ProdutoSubGrupoDescricao") || 
                                getVal(item, "SubGrupoDescricao") || 
                                getVal(item, "ProdutoSecaoDescricao") || 
                                getVal(item, "SecaoDescricao") || 
                                getVal(item, "ProdutoFamiliaNome") || 
                                getVal(item, "ProdutoGrupoNome") || 
                                "";

              if (!rawCatName && String(rawCatId) !== "0" && String(rawCatId) !== "") {
                rawCatName = `Grupo ${rawCatId}`;
              } else if (!rawCatName) {
                rawCatName = "Geral";
              }

              allMappedProducts.push({
                externalId: pId,
                name: getVal(item, "ProdutoDescricaoResumida") || getVal(item, "ProdutoDescricao") || "Sem Nome",
                description: finalDesc,
                price: price,
                imageUrl: finalImgUrl, 
                isActive: true,
                categoryExternalId: String(rawCatId),
                categoryName: String(rawCatName).trim()
              });
            }
          }

          // For Full Sync (Tipo 1), if snFim is not found, assume 'S' (finished)
          // For Change Sync (Tipo 4), if snFim is not found, assume 'N' to continue searching
          snFim = getVal(saiaExp, "SNFim") || (tipo === '1' ? 'S' : 'N');
          
          if (snFim === 'S') {
            hasMore = false;
          } else {
            // Try to get markers from the response root first
            const rootNextNumero = getVal(saiaExp, "CargaPDVNumero");
            const rootNextSequencia = getVal(saiaExp, "CargaPDVSequencia");
            
            if (rootNextNumero !== undefined && rootNextSequencia !== undefined) {
              const nNum = parseInt(String(rootNextNumero));
              const nSeq = parseInt(String(rootNextSequencia));
              
              if (nNum === currentCargaNumero && nSeq === currentCargaSequencia) {
                currentCargaSequencia++;
              } else {
                currentCargaNumero = nNum;
                currentCargaSequencia = nSeq;
              }
            } else if (productsArray.length > 0) {
              const lastProduct = productsArray[productsArray.length - 1];
              const pNextNumero = parseInt(String(getVal(lastProduct, "CargaPDVNumero") || currentCargaNumero));
              const pNextSequencia = parseInt(String(getVal(lastProduct, "CargaPDVSequencia") || currentCargaSequencia));
              
              if (pNextNumero === currentCargaNumero && pNextSequencia === currentCargaSequencia) {
                currentCargaSequencia++;
              } else {
                currentCargaNumero = pNextNumero;
                currentCargaSequencia = pNextSequencia;
              }
            } else {
              // No products and no markers in root? 
              // If SNFim is N, we try to advance sequencia to avoid getting stuck, 
              // but only for a few iterations.
              currentCargaSequencia++;
              if (iterations > 10) { 
                hasMore = false;
              }
            }
          }
        } catch (error: any) {
          console.error("Batch Error:", error.message);
          const { message: friendlyMsg, details: det } = formatBlueFocusError(error);
          return res.status(500).json({ 
            error: friendlyMsg,
            details: det,
            debugXml: error.response?.data ? String(error.response.data).substring(0, 2000) : undefined
          });
        }
      }

      res.json({ 
        products: allMappedProducts,
        nextCargaNumero: currentCargaNumero,
        nextCargaSequencia: currentCargaSequencia,
        snFim: isFullSync ? 'S' : snFim, // Force 'S' for Full Sync to prevent infinite loops in frontend
        iterations: iterations,
        ignoredCount: ignoredCount,
        ignoredBreakdown: ignoredBreakdown,
        lastProcessedName: lastBatchProducts.length > 0 ? String(getVal(lastBatchProducts[lastBatchProducts.length - 1], "ProdutoDescricaoResumida") || getVal(lastBatchProducts[lastBatchProducts.length - 1], "ProdutoDescricao") || "Sem Nome") : null,
        lastProductName: allMappedProducts.length > 0 ? allMappedProducts[allMappedProducts.length - 1].name : null,
        lastProductId: allMappedProducts.length > 0 ? allMappedProducts[allMappedProducts.length - 1].externalId : null,
        debugXml: lastXml.substring(0, 5000)
      });
    } catch (error: any) {
      console.error("BlueFocus Sync Error!");
      if (error.response) {
        console.error("Status:", error.response.status);
        console.error("Data:", error.response.data);
      } else if (error.request) {
        console.error("No response received from BlueFocus.");
      } else {
        console.error("Error setting up request:", error.message);
      }
      
      const { message: friendlyMessage, details: errorDetail } = formatBlueFocusError(error);

      res.status(500).json({ 
        error: friendlyMessage,
        details: errorDetail 
      });
    }
  });

  // API Route for BlueFocus Order Export (Pre-Sale)
  app.post("/api/bluefocus/export-order", async (req, res) => {
    console.log(`[Order] Recebida exportação de pedido: ${req.url}`);
    try {
      const { 
        order,
        empresaId: reqEmpresaId,
        usuarioId: reqUsuarioId,
        pdvCodigo: reqPdvCodigo,
        authToken
      } = req.body;
      
      const authKey = process.env.BLUE_FOCUS_AUTH_KEY || process.env.BLUEFOCUS_AUTH_KEY || process.env.BLUEFOCUS_AUTH_TOKEN;
      const empresaId = reqEmpresaId || process.env.BLUEFOCUS_EMPRESA_ID || process.env.BLUEFOCUS_EMPRESA || 'PAOMANIA';
      const usuarioId = reqUsuarioId || process.env.BLUEFOCUS_USUARIO_ID || process.env.BLUEFOCUS_USUARIO || 'CONSULTA';
      const pdvCodigo = reqPdvCodigo || process.env.BLUEFOCUS_PDV_CODIGO || '1000';

      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const dateTimeStr = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

      // Map items to BlueFocus XML format
      const itemsXml = order.items.map((item: any, index: number) => `
        <ProdutoItem>
          <SaidaItemSeq>${index + 1}</SaidaItemSeq>
          <SaidaItemLoteProdutoId>${item.externalId || item.productId}</SaidaItemLoteProdutoId>
          <SaidaItemUnidadeId>UN</SaidaItemUnidadeId>
          <SaidaItemCodigoBarras>${item.externalId || item.productId}</SaidaItemCodigoBarras>
          <SaidaItemQuantidade>${item.quantity}</SaidaItemQuantidade>
          <SaidaItemValorUnitario>${item.price}</SaidaItemValorUnitario>
          <SaidaItemCancelado>N</SaidaItemCancelado>
          <SaidaItemTotalizador>T1</SaidaItemTotalizador>
          <SaidaItemTipoTributacao>T</SaidaItemTipoTributacao>
        </ProdutoItem>`).join('');

      const soapEnvelope = `<?xml version="1.0"?>
<SOAP-ENV:Envelope 
xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" 
xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<SOAP-ENV:Body>
<IntegracaoFcxRegistraVenda.Execute xmlns="Valim">
<Sdtwebserviceentradavenda>
<Venda>
<TipoVenda>P</TipoVenda>
<EmpresaId>${empresaId}</EmpresaId>
<UsuarioId>${usuarioId}</UsuarioId>
<PDVCodigo>${pdvCodigo}</PDVCodigo>
<SaidaSNCancela>N</SaidaSNCancela>
<SaidaDataEmissao>${dateStr}</SaidaDataEmissao>
<SaidaClienteId>100</SaidaClienteId>
<SaidaDataHoraInclusao>${dateTimeStr}</SaidaDataHoraInclusao>
<SaidaUsuarioInclusao>${usuarioId}</SaidaUsuarioInclusao>
<SaidaNumeroVendaFCX>${order.id.replace(/\D/g, '').substring(0, 9) || Math.floor(Math.random() * 100000)}</SaidaNumeroVendaFCX>
${itemsXml}
<ParcelaItem>
<SaidaPagtoParcelaSequencia>1</SaidaPagtoParcelaSequencia>
<SaidaPagtoParcelaFormaId>1</SaidaPagtoParcelaFormaId>
<SaidaPagtoParcelaValor>${order.total}</SaidaPagtoParcelaValor>
<SaidaPagtoParcelaVencimento>${dateStr}</SaidaPagtoParcelaVencimento>
</ParcelaItem>
</Venda>
</Sdtwebserviceentradavenda>
</IntegracaoFcxRegistraVenda.Execute>
</SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

      const isValidToken = (t?: string) => {
        if (!t) return false;
        const clean = String(t).trim();
        return clean.length > 5 && !clean.includes('XXXX') && clean !== 'AGUARDANDO_CHAVE';
      };

      const headers: any = {
        "Content-Type": "text/xml; charset=utf-8"
      };
      
      if (isValidToken(authToken)) {
        headers["autentica"] = authToken.trim();
      } else if (isValidToken(authKey)) {
        headers["autentica"] = authKey.trim();
      }

      const response = await axios.post(
        process.env.BLUEFOCUS_ORDER_URL || "http://paomania.ddns.net:8082/valim/servlet/aintegracaofcxregistravenda",
        soapEnvelope,
        { headers }
      );

      const parser = new XMLParser();
      const jsonObj = parser.parse(response.data);
      
      const body = jsonObj["SOAP-ENV:Envelope"]?.["SOAP-ENV:Body"];
      const executeResponse = body?.["IntegracaoFcxRegistraVenda.ExecuteResponse"] || body?.["IntegracaoFcxRegPreVendaSat.ExecuteResponse"];
      const saiaVenda = executeResponse?.["Sdtwebservicesaidavenda"];
      const msgErro = saiaVenda?.["MsgErro"];

      if (msgErro) {
        return res.status(400).json({ error: msgErro });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("BlueFocus Export Error!");
      if (error.response) {
        console.error("Status:", error.response.status);
        console.error("Data:", error.response.data);
      } else if (error.request) {
        console.error("No response received from BlueFocus.");
      } else {
        console.error("Error setting up request:", error.message);
      }
      
      const errorDetail = error.response?.data || error.message;
      console.error("BlueFocus Export Error Details:", errorDetail);
      res.status(500).json({ 
        error: "Erro ao exportar venda para BlueFocus",
        details: errorDetail
      });
    }
  });

  // API Route to proxy NTFY push notifications reliably from backend (no CORS, no adblock issues)
  app.post("/api/ntfy/send", async (req, res) => {
    try {
      const { topic, title, message, priority, tags, clickUrl } = req.body || {};
      const cleanTopic = (topic || "paomania_pedidos").trim().replace(/[^a-zA-Z0-9_-]/g, "") || "paomania_pedidos";
      
      if (!message) {
        return res.status(400).json({ error: "Mensagem é obrigatória" });
      }

      const payload: Record<string, any> = {
        topic: cleanTopic,
        message: String(message),
        priority: Number(priority) || 4,
      };

      if (title) payload.title = String(title);
      if (Array.isArray(tags) && tags.length > 0) payload.tags = tags;
      if (clickUrl) payload.click = String(clickUrl);

      const ntfyRes = await axios.post("https://ntfy.sh", payload, {
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        },
        timeout: 10000
      });

      console.log(`[NTFY] Notificação enviada com sucesso para tópico "${cleanTopic}" (HTTP ${ntfyRes.status})`);
      res.json({ success: true, status: ntfyRes.status });
    } catch (err: any) {
      console.warn("[NTFY Proxy Erro]:", err?.response?.data || err?.message || err);
      // Return 200 with success: false to never crash calling app flows
      res.json({ success: false, error: err?.message || "Failed to send notification" });
    }
  });

  app.use("/api/*", (req, res) => {
    console.log(`[404] Rota API não encontrada: ${req.method} ${req.url}`);
    res.status(404).json({ 
      error: "Rota da API não encontrada no servidor Express.",
      path: req.originalUrl,
      method: req.method
    });
  });

  // Start server and initialize services
  async function startServer() {
    // Vite middleware for development or Static Serving for production
    if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
      console.log("[Dev] Configurando middleware do Vite...");
      try {
        const { createServer: createViteServer } = await import("vite");
        const vite = await createViteServer({
          server: { 
            middlewareMode: true,
            allowedHosts: true,
          },
          appType: "spa",
        });
        app.use(vite.middlewares);
        console.log("[Dev] Vite middleware configurado.");
      } catch (viteErr) {
        console.error("[Dev] Erro ao iniciar Vite:", viteErr);
      }
    } else if (!process.env.VERCEL) {
      const distPath = path.resolve(process.cwd(), "dist");
      console.log(`[Prod] Servindo arquivos estáticos de: ${distPath}`);
      
      app.get('/manifest.json', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        res.setHeader('Content-Type', 'application/manifest+json');
        res.sendFile(path.join(distPath, 'manifest.json'));
      });

      app.get('/manifest-totem.json', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        res.setHeader('Content-Type', 'application/manifest+json');
        res.sendFile(path.join(distPath, 'manifest-totem.json'));
      });

      // Serve static files with long-term caching for assets
      app.use(express.static(distPath, {
        index: false,
        maxAge: '1d'
      }));

      // SPA Fallback: All routes not caught by API or static files go to index.html
      app.get("*", (req, res) => {
        const indexPath = path.join(distPath, "index.html");
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
        res.setHeader('CDN-Cache-Control', 'no-store');

        const reqPath = (req.path || '').toLowerCase();
        const isTotemReq = reqPath.startsWith('/totem') || reqPath.startsWith('/kiosk');
        const isTvReq = reqPath.startsWith('/tv');

        // Se for acesso ao totem ou TV, envia o HTML com a tag de manifesto específica
        if (isTotemReq || isTvReq) {
          const fs = require('fs');
          fs.readFile(indexPath, 'utf8', (err: any, htmlContent: string) => {
            if (err) {
              console.error(`[Prod] Erro ao ler index.html de ${indexPath}:`, err);
              return res.sendFile(indexPath);
            }
            const targetManifest = isTvReq ? '/manifest-tv.json' : '/manifest-totem.json';
            const targetTitle = isTvReq ? 'Smart TV & Painel de Mídia | Pão Mania' : 'Totem Autoatendimento | Pão Mania';
            const modifiedHtml = htmlContent
              .replace(/href="\/manifest\.json"/g, `href="${targetManifest}"`)
              .replace(/<title>.*?<\/title>/gi, `<title>${targetTitle}</title>`);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(modifiedHtml);
          });
          return;
        }

        res.sendFile(indexPath, (err) => {
          if (err) {
            console.error(`[Prod] Erro ao enviar index.html de ${indexPath}:`, err);
            res.status(500).send("Erro ao carregar o aplicativo. Verifique se o build (dist/) foi concluído.");
          }
        });
      });
    }

    // Database Initialization and State Hydration (Awaited before listening)
    try {
      console.log("[DB] Verificando tabelas e colunas PostgreSQL...");
      await ensureTablesExist();
      console.log("[DB] Tabelas PostgreSQL verificadas com sucesso.");
      await hydrateFromPostgres();
      console.log("[DB] Estado da loja e cadastros hidratados com sucesso do PostgreSQL.");
    } catch (dbInitErr) {
      console.warn("[DB] Aviso na inicialização do banco de dados:", dbInitErr);
    }

    if (!process.env.VERCEL) {
      const server = app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on port ${PORT}`);
      });
      server.keepAliveTimeout = 120000;
      server.headersTimeout = 120000;
    }
  }

  startServer().catch(err => {
    console.error("Erro fatal ao iniciar o servidor:", err);
  });

export default app;
