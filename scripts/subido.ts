/**
 * Apoio ao envio de recebimentos para a Liga Subido PRO (programa que pontua
 * agências pelo faturamento comprovado de clientes com contrato).
 *
 * O Subido não tem API pública e a sessão de login é sua: o envio em si é
 * feito no navegador (ver docs/subido-tarefa-agendada.md). Este script dá os
 * dados certos para cada envio e anota o que foi enviado.
 *
 *   npm run subido -- pendentes
 *       → JSON com os pagamentos do Asaas ainda não enviados ao Subido
 *   npm run subido -- pendentes --desde 2026-10-01 --copiar-para /tmp/envios
 *       → muda o início e copia os PDFs para uma pasta (útil quando a
 *         ferramenta que faz o upload só lê pastas específicas)
 *   npm run subido -- registrar pay_xxxxxxxx
 *       → anota em registro/subido.json depois que o envio foi CONCLUÍDO no site
 *
 * Regras:
 * - só entra no Subido quem tem contrato: subido-clientes.json liga o CPF/CNPJ
 *   do cliente no Asaas ao nome EXATO dele no Subido; null = sem contrato, fica
 *   de fora de propósito; ausente do arquivo = cliente novo, pulado e avisado;
 * - título "<Cliente no Subido> - pagamento MM/AAAA", mês = data de pagamento;
 * - janela de envio do Subido: sábado 00h00 a quarta 23h59.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Asaas } from "../src/asaas.js";
import {
  PASTA_COMPROVANTES,
  arquivosDosComprovantes,
  destinatariosPorCnpj,
  nomeDoCliente,
} from "../src/comprovantes.js";
import { expandirCaminho, lerConfig, lerToken } from "../src/config.js";
import { carregarDestinatarios } from "../src/destinatarios.js";
import { renovarAccessToken } from "../src/google.js";

const ARQUIVO_MAPA = resolve(process.cwd(), "subido-clientes.json");
const ARQUIVO_REGISTRO = resolve(process.cwd(), "registro", "subido.json");

type Mapa = Record<string, string | null>;
type EnvioSubido = {
  pagamento: string;
  cnpj: string;
  clienteSubido: string;
  valor: number;
  dataPagamento: string;
  titulo: string;
  arquivo: string;
  enviadoEm: string;
};

function lerMapa(): Mapa {
  if (!existsSync(ARQUIVO_MAPA)) {
    throw new Error("não achei subido-clientes.json — copie subido-clientes.exemplo.json e preencha");
  }
  return (JSON.parse(readFileSync(ARQUIVO_MAPA, "utf8")) as { clientes: Mapa }).clientes;
}

function lerRegistro(): EnvioSubido[] {
  return existsSync(ARQUIVO_REGISTRO) ? (JSON.parse(readFileSync(ARQUIVO_REGISTRO, "utf8")) as EnvioSubido[]) : [];
}

/** Escreve num temporário e renomeia: o registro é a trava contra reenvio, não pode corromper. */
function gravarRegistro(lista: EnvioSubido[]) {
  mkdirSync(dirname(ARQUIVO_REGISTRO), { recursive: true });
  const tmp = `${ARQUIVO_REGISTRO}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(lista, null, 2)}\n`, "utf8");
  renameSync(tmp, ARQUIVO_REGISTRO);
}

function reais(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dataBr(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function titulo(cliente: string, dataPagamento: string): string {
  return `${cliente} - pagamento ${dataPagamento.slice(5, 7)}/${dataPagamento.slice(0, 4)}`;
}

/** Sábado (6), domingo (0), segunda a quarta (1–3). Quinta é validação, sexta é resultado. */
function dentroDaJanela(d = new Date()): boolean {
  return [6, 0, 1, 2, 3].includes(d.getDay());
}

function opcao(argv: string[], nome: string): string | undefined {
  const i = argv.indexOf(nome);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function pendentes(argv: string[]) {
  const config = lerConfig();
  const desde = opcao(argv, "--desde") ?? process.env.SUBIDO_INICIO?.trim();
  if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
    throw new Error("informe --desde AAAA-MM-DD ou SUBIDO_INICIO no .env (data a partir da qual os pagamentos entram)");
  }
  const copiarPara = opcao(argv, "--copiar-para");
  const hoje = new Date().toISOString().slice(0, 10);
  const mapa = lerMapa();

  const asaas = new Asaas(config.asaasChave, config.asaasUrl);
  const pagas = await asaas.listarPagas(desde, hoje);
  const clientes = new Map((await asaas.listarClientes()).map((c) => [c.id, c]));
  const porCnpj = await destinatariosPorCnpj(() =>
    carregarDestinatarios(config, async () =>
      renovarAccessToken({
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        refreshToken: lerToken().refresh_token,
      }),
    ),
  );
  const arquivos = arquivosDosComprovantes(pagas, nomeDoCliente(clientes, porCnpj));
  const jaEnviados = new Set(lerRegistro().map((e) => e.pagamento));
  const pasta = expandirCaminho(PASTA_COMPROVANTES);
  if (copiarPara) mkdirSync(expandirCaminho(copiarPara), { recursive: true });

  const enviar = [];
  const pulados = [];
  for (const p of pagas) {
    if (jaEnviados.has(p.id)) continue;
    const c = clientes.get(p.customer);
    const cnpj = (c?.cpfCnpj ?? "").replace(/\D/g, "");
    const cliente = mapa[cnpj];
    let arquivo = join(pasta, arquivos.get(p.id)!);
    const base = { pagamento: p.id, clienteAsaas: c?.name ?? p.customer, cnpj, valor: reais(p.value), data: dataBr(p.paymentDate!) };
    if (!cliente) {
      pulados.push({ ...base, motivo: cnpj in mapa ? "sem contrato (fica de fora por regra)" : "cliente novo, fora de subido-clientes.json — decidir se entra" });
    } else if (!existsSync(arquivo)) {
      pulados.push({ ...base, motivo: `comprovante não está na pasta (${arquivo}) — rode npm run comprovantes antes` });
    } else {
      if (copiarPara) {
        const destino = join(expandirCaminho(copiarPara), basename(arquivo));
        copyFileSync(arquivo, destino);
        arquivo = destino;
      }
      enviar.push({ ...base, clienteSubido: cliente, titulo: titulo(cliente, p.paymentDate!), arquivo });
    }
  }

  console.log(JSON.stringify({ hoje, dentroDaJanela: dentroDaJanela(), enviar, pulados }, null, 2));
}

async function registrar(id: string) {
  const config = lerConfig();
  const mapa = lerMapa();
  const lista = lerRegistro();
  if (lista.some((e) => e.pagamento === id)) {
    console.log(`${id}: já estava registrado`);
    return;
  }
  const asaas = new Asaas(config.asaasChave, config.asaasUrl);
  const p = await asaas.buscarCobranca(id);
  if (!p.paymentDate) throw new Error(`${id} não está paga (status ${p.status})`);
  const c = (await asaas.listarClientes()).find((x) => x.id === p.customer);
  const cnpj = (c?.cpfCnpj ?? "").replace(/\D/g, "");
  const cliente = mapa[cnpj];
  if (!cliente) throw new Error(`${id}: cliente sem nome do Subido em subido-clientes.json`);

  lista.push({
    pagamento: p.id,
    cnpj,
    clienteSubido: cliente,
    valor: p.value,
    dataPagamento: p.paymentDate,
    titulo: titulo(cliente, p.paymentDate),
    arquivo: "",
    enviadoEm: new Date().toISOString(),
  });
  gravarRegistro(lista);
  console.log(`${id}: registrado (${cliente}, R$ ${reais(p.value)}, ${dataBr(p.paymentDate)})`);
}

async function main() {
  const argv = process.argv.slice(2);
  const [comando, arg] = argv;
  if (comando === "pendentes") return pendentes(argv.slice(1));
  if (comando === "registrar" && arg) return registrar(arg);
  throw new Error("uso: npm run subido -- pendentes [--desde AAAA-MM-DD] [--copiar-para PASTA] | registrar <id do pagamento>");
}

main().catch((e) => {
  console.error(`\nErro: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
