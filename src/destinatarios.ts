import { existsSync, readFileSync } from "node:fs";
import { expandirCaminho, type Config } from "./config.js";
import { lerCsv } from "./csv.js";
import { lerAbaComoCsv } from "./google.js";
import { somenteDigitos } from "./nfse.js";

/**
 * Para quem vai a nota de cada cliente.
 *
 * Fonte: um CSV local ou uma planilha do Google Sheets, com as colunas
 * `cliente`, `cnpj`, `emails` e (opcional) `observacao`. O CNPJ é a chave que
 * casa a linha com a nota — nome de cliente muda de grafia, CNPJ não.
 *
 * Quando a célula de CNPJ não é um documento ("não emite nota", "sem
 * contrato"), o texto vira `observacao` e o cliente fica fora do envio, com o
 * motivo visível no plano.
 */
export type Destinatario = {
  nome: string;
  cnpj: string | null; // só dígitos; null quando a célula não é um documento
  emails: string[];
  observacao: string | null;
};

export function lerDestinatarios(linhas: string[][]): Destinatario[] {
  const iCabecalho = linhas.findIndex((l) =>
    l.some((c) => /^cnpj$/i.test((c ?? "").trim())),
  );
  if (iCabecalho < 0) throw new Error("a planilha precisa de uma coluna chamada 'cnpj'");

  const cabecalho = (linhas[iCabecalho] ?? []).map((c) => (c ?? "").trim().toLowerCase());
  const coluna = (re: RegExp) => cabecalho.findIndex((c) => re.test(c));
  const cNome = coluna(/^(cliente|nome|tomador)$/);
  const cCnpj = coluna(/^(cnpj|cpf|cnpj\/cpf|documento)$/);
  const cEmail = coluna(/^e-?mails?$/);
  const cObs = coluna(/^(observa[çc][ãa]o|obs)$/);
  if (cNome < 0 || cEmail < 0) {
    throw new Error("a planilha precisa das colunas 'cliente' e 'emails'");
  }

  const saida: Destinatario[] = [];
  for (const l of linhas.slice(iCabecalho + 1)) {
    const celula = (i: number) => (i >= 0 ? (l[i] ?? "").trim() : "");
    const nome = celula(cNome);
    if (!nome) continue;
    const bruto = celula(cCnpj);
    const digitos = somenteDigitos(bruto);
    const ehDocumento = digitos.length === 14 || digitos.length === 11;
    saida.push({
      nome,
      cnpj: ehDocumento ? digitos : null,
      emails: celula(cEmail)
        .split(/[;,\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@")),
      observacao: celula(cObs) || (ehDocumento ? null : bruto) || null,
    });
  }
  return saida;
}

/** Lê a lista da planilha do Google (se PLANILHA_ID estiver no .env) ou do CSV local. */
export async function carregarDestinatarios(
  config: Config,
  accessToken: () => Promise<string>,
): Promise<Destinatario[]> {
  if (config.planilhaId) {
    return lerDestinatarios(
      lerCsv(await lerAbaComoCsv(await accessToken(), config.planilhaId, config.planilhaGid)),
    );
  }
  const caminho = expandirCaminho(config.destinatariosCsv);
  if (!existsSync(caminho)) {
    throw new Error(`não achei ${caminho} — copie o destinatarios.exemplo.csv ou preencha PLANILHA_ID no .env`);
  }
  return lerDestinatarios(lerCsv(readFileSync(caminho, "utf8")));
}
