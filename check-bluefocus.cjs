const axios = require('axios');

async function check(tipo) {
  const soapEnvelope = `<?xml version="1.0"?>
<SOAP-ENV:Envelope 
xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" 
xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<SOAP-ENV:Body>
<IntegracaoFcxExportaCadSAT.Execute xmlns="Valim">
<Sdtwebserviceentradaexpcadastro>
<EmpresaId>PAOMANIA</EmpresaId>
<UsuarioId>CONSULTA</UsuarioId>
<PDVCodigo>1000</PDVCodigo>
<TipoAtualizacao>C</TipoAtualizacao>
<Tipo>${tipo}</Tipo>
<PessoaId>0</PessoaId>
<CargaPDVNumero>0</CargaPDVNumero>
<CargaPDVSequencia>0</CargaPDVSequencia>
<ProdutoId>0</ProdutoId>
<DataHoraInicio></DataHoraInicio>
</Sdtwebserviceentradaexpcadastro>
</IntegracaoFcxExportaCadSAT.Execute>
</SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  try {
    const response = await axios.post("http://paomania.ddns.net:8082/valim/servlet/aintegracaofcxexportacadsat", soapEnvelope, {
        headers: {
            "Content-Type": "text/xml"
        }
    });
    console.log(`Tipo ${tipo}: `, response.data.substring(0, 300));
  } catch(e) {
      console.error(`Tipo ${tipo}: Error`);
  }
}

async function run() {
    for (let i = 1; i <= 10; i++) {
        await check(i);
    }
}
run();
