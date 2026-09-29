const axios = require('axios');

async function check() {
  try {
    console.log("Fetching first batch of products...");
    let categorias = new Set();
    let currentCargaNumero = 0;
    let currentCargaSequencia = 0;
    let currentProdutoId = 0;
    
    // Just fetch a few batches
    for(let i=0; i<10; i++) {
        const response = await axios.post("http://localhost:3000/api/bluefocus/sync", {
            startCargaNumero: currentCargaNumero,
            startCargaSequencia: currentCargaSequencia,
            startProdutoId: currentProdutoId,
            batchSize: 500,
            tipoAtualizacao: "T", // Full Sync
            dataInicial: "30/12/1899"
        });
        
        const data = response.data;
        if (data.products && data.products.length > 0) {
            data.products.forEach(p => categorias.add(p.category));
        }
        
        currentCargaNumero = data.nextCargaNumero;
        currentCargaSequencia = data.nextCargaSequencia;
        currentProdutoId = data.lastProductId ? parseInt(data.lastProductId) : 0;
        
        if (data.snFim === 'S' || (data.products && data.products.length === 0)) {
            break;
        }
    }
    
    console.log("Categorias encontradas:", Array.from(categorias).sort());
  } catch(e) {
      console.error(e);
  }
}
check();
