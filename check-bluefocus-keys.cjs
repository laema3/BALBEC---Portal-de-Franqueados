const axios = require('axios');

async function check() {
  try {
    const response = await axios.post("http://localhost:3000/api/bluefocus/sync-products", {
        empresaId: "PÃO MANIA",
        startCargaNumero: 0,
        startCargaSequencia: 0,
        startProdutoId: 0,
        batchSize: 5,
        tipoAtualizacao: "T", // Full Sync
        dataInicial: "30/12/1899",
        excludeKeywords: [] // Don't exclude anything for the check
    });
    console.log(response.data);
  } catch(e) {
      console.error(e.response ? e.response.data : e.message);
  }
}
check();
