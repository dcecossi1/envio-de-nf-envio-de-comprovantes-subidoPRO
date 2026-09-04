/**
 * Leitura de uma NFS-e no padrão nacional (DANFSe v1.0 e v2.0) a partir do
 * texto do PDF extraído com `pdftotext -layout` (poppler).
 *
 * O modo `-layout` é o que torna isso confiável: cada rótulo tem o valor na
 * linha seguinte, na MESMA coluna. Sem ele a ordem dos campos vira loteria.
 *
 * O nome do arquivo não identifica nada — costuma vir com erro de digitação.
 * Quem identifica a nota é a chave de acesso; o cliente, o CNPJ do tomador.
 */

export type NotaFiscal = {
  chaveAcesso: string; // 50 dígitos, única por nota
  numero: number;
  competencia: string; // AAAA-MM-DD
  emissao: string; // como está na nota: dd/mm/aaaa hh:mm:ss
  cnpjEmitente: string; // só dígitos
  cnpjTomador: string; // só dígitos (CNPJ ou CPF)
  nomeTomador: string;
  valor: number;
  layout: string; // "v1.0", "v2.0"...
};

export function somenteDigitos(s: string): string {
  return s.replace(/\D/g, "");
}

export function formatarDocumento(digitos: string): string {
  if (digitos.length === 14) {
    return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (digitos.length === 11) {
    return digitos.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return digitos;
}

/** "2026-09-02" → "2026-09" */
export function competenciaMes(nota: NotaFiscal): string {
  return nota.competencia.slice(0, 7);
}

const RE_DOC = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/;

/** Células de uma linha em layout: trechos separados por 2+ espaços, com a coluna onde começam. */
function celulas(linha: string): { texto: string; col: number }[] {
  const saida: { texto: string; col: number }[] = [];
  const re = /\S+(?: \S+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(linha))) saida.push({ texto: m[0], col: m.index });
  return saida;
}

/** Valor que está na linha seguinte ao rótulo, na mesma coluna do rótulo. */
function sobRotulo(linhas: string[], i: number, rotulo: RegExp): string | null {
  const linha = linhas[i];
  if (linha === undefined || i + 1 >= linhas.length) return null;
  const m = rotulo.exec(linha);
  if (!m) return null;
  const col = m.index;
  let melhor: { texto: string; col: number } | null = null;
  let distancia = Infinity;
  for (const c of celulas(linhas[i + 1] ?? "")) {
    const d = Math.abs(c.col - col);
    if (c.col >= col - 6 && d < distancia) {
      melhor = c;
      distancia = d;
    }
  }
  return melhor?.texto ?? null;
}

function acharLinha(linhas: string[], re: RegExp, aPartirDe = 0): number {
  for (let i = aPartirDe; i < linhas.length; i++) {
    if (re.test(linhas[i] ?? "")) return i;
  }
  return -1;
}

function lerValor(s: string | null): number | null {
  const m = s ? /R\$\s*([\d.]+,\d{2})/.exec(s) : null;
  return m?.[1] ? Number(m[1].replace(/\./g, "").replace(",", ".")) : null;
}

function lerData(s: string | null): string | null {
  const m = s ? /(\d{2})\/(\d{2})\/(\d{4})/.exec(s) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function lerDanfse(texto: string): NotaFiscal {
  const linhas = texto.split(/\r?\n/);
  const faltando: string[] = [];

  const layout = /DANFSe v(\d+\.\d+)/.exec(texto)?.[1] ?? "?";

  const iChave = acharLinha(linhas, /Chave de Acesso da NFS-e/i);
  const chaveAcesso = iChave >= 0 ? (/\d{50}/.exec(linhas[iChave + 1] ?? "")?.[0] ?? null) : null;
  if (!chaveAcesso) faltando.push("chave de acesso");

  const iNumero = acharLinha(linhas, /N[úÚ]MERO DA NFS-e\s{2,}COMPET/i);
  const numero = Number(sobRotulo(linhas, iNumero, /N[úÚ]MERO DA NFS-e/i) ?? NaN);
  if (!Number.isInteger(numero)) faltando.push("número");
  const competencia = lerData(sobRotulo(linhas, iNumero, /COMPET[êÊ]NCIA DA NFS-e/i));
  if (!competencia) faltando.push("competência");
  const emissao = sobRotulo(linhas, iNumero, /DATA E HORA DA EMISS[ãÃ]O DA NFS-e/i) ?? "";

  // O primeiro "CNPJ / CPF / NIF" da nota é do emitente; o da linha TOMADOR é do cliente.
  const iTomador = acharLinha(linhas, /^TOMADOR/);
  const iEmitente = acharLinha(linhas, /CNPJ \/ CPF \/ NIF/);
  const cnpjEmitente =
    iEmitente >= 0 && iEmitente !== iTomador
      ? RE_DOC.exec(sobRotulo(linhas, iEmitente, /CNPJ \/ CPF \/ NIF/) ?? "")?.[0]
      : undefined;
  if (!cnpjEmitente) faltando.push("CNPJ do emitente");
  const cnpjTomador =
    iTomador >= 0
      ? RE_DOC.exec(sobRotulo(linhas, iTomador, /CNPJ \/ CPF \/ NIF/) ?? "")?.[0]
      : undefined;
  if (!cnpjTomador) faltando.push("CNPJ do tomador");

  const iNome = iTomador >= 0 ? acharLinha(linhas, /Nome \/ Nome Empresarial/i, iTomador + 1) : -1;
  const nomeTomador = iNome >= 0 ? (celulas(linhas[iNome + 1] ?? "")[0]?.texto ?? "") : "";
  if (!nomeTomador) faltando.push("nome do tomador");

  // v1.0: "Valor do Serviço"; v2.0: "VALOR DA OPERAÇÃO / SERVIÇO"
  let valor: number | null = null;
  const iValor1 = acharLinha(linhas, /Valor do Servi[çc]o/);
  if (iValor1 >= 0) valor = lerValor(sobRotulo(linhas, iValor1, /Valor do Servi[çc]o/));
  if (valor === null) {
    const iValor2 = acharLinha(linhas, /VALOR DA OPERA[çÇ][ãÃ]O \/ SERVI[çÇ]O/i);
    if (iValor2 >= 0) {
      valor = lerValor(sobRotulo(linhas, iValor2, /VALOR DA OPERA[çÇ][ãÃ]O \/ SERVI[çÇ]O/i));
    }
  }
  if (valor === null) faltando.push("valor do serviço");

  if (faltando.length > 0) {
    throw new Error(`não achei ${faltando.join(", ")} (layout ${layout})`);
  }

  return {
    chaveAcesso: chaveAcesso!,
    numero,
    competencia: competencia!,
    emissao,
    cnpjEmitente: somenteDigitos(cnpjEmitente!),
    cnpjTomador: somenteDigitos(cnpjTomador!),
    nomeTomador,
    valor: valor!,
    layout: `v${layout}`,
  };
}
