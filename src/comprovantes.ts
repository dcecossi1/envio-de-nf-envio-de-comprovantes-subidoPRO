import type { AsaasCliente, AsaasCobranca } from "./asaas.js";
import type { Destinatario } from "./destinatarios.js";

/** Pasta padrão dos comprovantes, relativa à raiz do projeto (fora do Git). */
export const PASTA_COMPROVANTES = "./comprovantes";

/**
 * Nome do cliente nos arquivos: o da sua lista de destinatários (pelo CNPJ),
 * senão o cadastrado no Asaas — que às vezes vem truncado.
 */
export function nomeDoCliente(clientes: Map<string, AsaasCliente>, porCnpj: Map<string, Destinatario>) {
  return (p: AsaasCobranca): string => {
    const c = clientes.get(p.customer);
    const cnpj = (c?.cpfCnpj ?? "").replace(/\D/g, "");
    return porCnpj.get(cnpj)?.nome ?? c?.name ?? p.customer;
  };
}

/** Tira o que macOS e Windows não aceitam em nome de arquivo. */
function nomeDeArquivo(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

/**
 * Nome do arquivo de cada comprovante: "Comprovante <Cliente> MM-AAAA.pdf",
 * mês = data de pagamento, " (2)" no segundo pagamento do mesmo cliente no mês.
 * A ordem (data de pagamento, id) é fixa: o mesmo pagamento cai sempre no
 * mesmo arquivo, em qualquer rodada e em qualquer script.
 */
export function arquivosDosComprovantes(
  pagas: AsaasCobranca[],
  nome: (p: AsaasCobranca) => string,
): Map<string, string> {
  const ordenadas = [...pagas].sort(
    (a, b) => (a.paymentDate ?? "").localeCompare(b.paymentDate ?? "") || a.id.localeCompare(b.id),
  );
  const vistos = new Map<string, number>();
  const saida = new Map<string, string>();
  for (const p of ordenadas) {
    const mes = p.paymentDate!.slice(0, 7);
    const base = nomeDeArquivo(`Comprovante ${nome(p)} ${mes.slice(5)}-${mes.slice(0, 4)}`);
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    saida.set(p.id, `${base}${n > 1 ? ` (${n})` : ""}.pdf`);
  }
  return saida;
}

/** Lista de destinatários indexada por CNPJ; vazia se não houver lista (os nomes vêm do Asaas). */
export async function destinatariosPorCnpj(
  carregar: () => Promise<Destinatario[]>,
): Promise<Map<string, Destinatario>> {
  try {
    const lista = await carregar();
    return new Map(lista.filter((d) => d.cnpj).map((d) => [d.cnpj!, d]));
  } catch (e) {
    console.error(`Aviso: lista de destinatários indisponível (${e instanceof Error ? e.message : String(e)}); usando nomes do Asaas.`);
    return new Map();
  }
}
