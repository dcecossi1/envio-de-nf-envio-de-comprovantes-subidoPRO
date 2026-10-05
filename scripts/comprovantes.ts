/**
 * Baixa os comprovantes de pagamento do Asaas e salva todos numa pasta só,
 * com o nome do cliente e o mês em que ele pagou:
 *
 *   comprovantes/Comprovante Empresa Exemplo 09-2026.pdf
 *
 *   npm run comprovantes                          → mês atual e o anterior
 *   npm run comprovantes -- --mes 2026-09         → só esse mês
 *   npm run comprovantes -- --pasta ~/Comprovantes → outra pasta (padrão: ./comprovantes)
 *
 * Mês = data de PAGAMENTO, não de vencimento. Sem --mes o mês anterior entra
 * junto, para pegar quem pagou atrasado depois da última rodada. Arquivo que
 * já existe é pulado: rodar de novo nunca duplica nem sobrescreve.
 *
 * Nome do cliente: o da sua lista de destinatários, casado pelo CNPJ (o nome
 * cadastrado no Asaas às vezes vem truncado); quem não está na lista usa o
 * nome do Asaas.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Asaas, baixarComprovante, type AsaasCobranca } from "../src/asaas.js";
import { expandirCaminho, lerConfig, lerToken } from "../src/config.js";
import { carregarDestinatarios, type Destinatario } from "../src/destinatarios.js";
import { renovarAccessToken } from "../src/google.js";

function lerArgs(argv: string[]) {
  let mes: string | null = null;
  let pasta = "./comprovantes";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const valor = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`falta o valor de ${a}`);
      return v;
    };
    if (a === "--mes") mes = valor();
    else if (a === "--pasta") pasta = valor();
    else throw new Error(`opção desconhecida: ${a}`);
  }
  if (mes !== null && !/^\d{4}-\d{2}$/.test(mes)) throw new Error("informe --mes no formato AAAA-MM");
  return { mes, pasta: expandirCaminho(pasta) };
}

function mesDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Intervalo de datas de pagamento: o mês pedido, ou do início do mês anterior até hoje. */
function intervalo(mes: string | null): { de: string; ate: string } {
  if (mes) {
    const [ano, m] = mes.split("-").map(Number) as [number, number];
    return { de: `${mes}-01`, ate: `${mes}-${String(new Date(ano, m, 0).getDate()).padStart(2, "0")}` };
  }
  const hoje = new Date();
  return {
    de: `${mesDe(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1))}-01`,
    ate: hoje.toISOString().slice(0, 10),
  };
}

/** Tira o que macOS e Windows não aceitam em nome de arquivo. */
function nomeDeArquivo(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

async function main() {
  const o = lerArgs(process.argv.slice(2));
  const config = lerConfig();
  const { de, ate } = intervalo(o.mes);
  const asaas = new Asaas(config.asaasChave, config.asaasUrl);

  const pagas = await asaas.listarPagas(de, ate);
  const clientes = new Map((await asaas.listarClientes()).map((c) => [c.id, c]));

  // A lista de destinatários só serve para dar nome bonito; se ela não
  // existir, o nome do Asaas resolve e o download segue.
  let porCnpj = new Map<string, Destinatario>();
  try {
    const lista = await carregarDestinatarios(config, async () => {
      const t = lerToken();
      return renovarAccessToken({
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        refreshToken: t.refresh_token,
      });
    });
    porCnpj = new Map(lista.filter((d) => d.cnpj).map((d) => [d.cnpj!, d]));
  } catch (e) {
    console.log(`Aviso: lista de destinatários indisponível (${e instanceof Error ? e.message : String(e)}); usando nomes do Asaas.`);
  }

  const nomeCliente = (p: AsaasCobranca) => {
    const c = clientes.get(p.customer);
    const cnpj = (c?.cpfCnpj ?? "").replace(/\D/g, "");
    return porCnpj.get(cnpj)?.nome ?? c?.name ?? p.customer;
  };

  // Ordem estável (data de pagamento, id): é o que faz o " (2)" de um segundo
  // pagamento no mesmo mês cair sempre no mesmo arquivo, rodada após rodada.
  pagas.sort((a, b) => (a.paymentDate ?? "").localeCompare(b.paymentDate ?? "") || a.id.localeCompare(b.id));
  const vistos = new Map<string, number>();

  mkdirSync(o.pasta, { recursive: true });
  const baixados: string[] = [];
  const existentes: string[] = [];
  const falhas: string[] = [];

  for (const p of pagas) {
    const mes = p.paymentDate!.slice(0, 7);
    const base = nomeDeArquivo(`Comprovante ${nomeCliente(p)} ${mes.slice(5)}-${mes.slice(0, 4)}`);
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    const arquivo = `${base}${n > 1 ? ` (${n})` : ""}.pdf`;
    const destino = join(o.pasta, arquivo);

    if (existsSync(destino)) {
      existentes.push(arquivo);
      continue;
    }
    if (!p.transactionReceiptUrl) {
      falhas.push(`${arquivo}: cobrança ${p.id} (${p.status}) sem comprovante no Asaas`);
      continue;
    }
    try {
      writeFileSync(destino, await baixarComprovante(p.transactionReceiptUrl));
      baixados.push(arquivo);
    } catch (e) {
      falhas.push(`${arquivo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\nPagamentos de ${de} a ${ate}: ${pagas.length}. Pasta: ${o.pasta}`);
  console.log(`Baixados agora: ${baixados.length}`);
  for (const a of baixados) console.log(`  + ${a}`);
  console.log(`Já estavam na pasta: ${existentes.length}`);
  if (falhas.length > 0) {
    console.log(`Falharam: ${falhas.length}`);
    for (const f of falhas) console.log(`  ! ${f}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`\nErro: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
