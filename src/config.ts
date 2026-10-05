import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import "dotenv/config";

export type Config = {
  asaasChave: string;
  asaasUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  cnpjEmitente: string;
  assinatura: string;
  destinatariosCsv: string;
  planilhaId: string | null;
  planilhaGid: number;
  anexarNaCobranca: boolean;
};

export const ARQUIVO_TOKEN = resolve(process.cwd(), ".google-token.json");
export const ARQUIVO_REGISTRO = resolve(process.cwd(), "registro", "envios.json");

function obrigatorio(nome: string): string {
  const v = process.env[nome]?.trim();
  if (!v) throw new Error(`${nome} não está no .env (veja o .env.example)`);
  return v;
}

export function lerConfig(): Config {
  if (!existsSync(resolve(process.cwd(), ".env"))) {
    throw new Error("não achei o .env — copie o .env.example para .env e preencha");
  }
  return {
    asaasChave: obrigatorio("ASAAS_API_KEY"),
    asaasUrl: process.env.ASAAS_API_URL?.trim() || "https://api.asaas.com/v3",
    googleClientId: obrigatorio("GOOGLE_CLIENT_ID"),
    googleClientSecret: obrigatorio("GOOGLE_CLIENT_SECRET"),
    cnpjEmitente: obrigatorio("CNPJ_EMITENTE").replace(/\D/g, ""),
    assinatura: (process.env.ASSINATURA ?? "Att").replace(/\\n/g, "\n"),
    destinatariosCsv: process.env.DESTINATARIOS_CSV?.trim() || "destinatarios.csv",
    planilhaId: process.env.PLANILHA_ID?.trim() || null,
    planilhaGid: Number(process.env.PLANILHA_GID ?? 0),
    anexarNaCobranca: /^(true|1|sim)$/i.test(process.env.ANEXAR_NA_COBRANCA ?? ""),
  };
}

export type Token = { refresh_token: string; escopos: string[]; conta: string; criado_em: string };

export function lerToken(): Token {
  if (!existsSync(ARQUIVO_TOKEN)) {
    throw new Error("conta Google não autorizada ainda — rode: npm run autorizar");
  }
  return JSON.parse(readFileSync(ARQUIVO_TOKEN, "utf8")) as Token;
}

export function expandirCaminho(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : resolve(p);
}
