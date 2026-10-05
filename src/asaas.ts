/**
 * Cliente mínimo da API do Asaas.
 *
 * Só lê cliente e cobrança e (opcionalmente) anexa um documento a uma
 * cobrança. Não cria cobrança, não cancela, não estorna, não transfere — de
 * propósito. A chave de API do Asaas pode ter permissão por recurso: crie a
 * sua com o mínimo (leitura de clientes e cobranças) e sem saque via API.
 */

export type AsaasCliente = {
  id: string;
  name: string;
  email: string | null;
  cpfCnpj: string | null;
  deleted: boolean;
};

export type AsaasCobranca = {
  id: string;
  customer: string;
  value: number;
  dueDate: string; // AAAA-MM-DD
  status: string; // PENDING, RECEIVED, CONFIRMED, OVERDUE...
  billingType: string;
  invoiceUrl: string; // link da fatura que o cliente abre
  description: string | null;
  paymentDate: string | null; // AAAA-MM-DD, quando o cliente pagou
  transactionReceiptUrl: string | null; // página pública do comprovante (só em cobrança paga)
  deleted: boolean;
};

export type AsaasDocumento = {
  id: string;
  name: string;
  file: { originalName: string; downloadUrl: string };
  deleted: boolean;
};

export const COBRANCA_EM_ABERTO = new Set(["PENDING", "OVERDUE"]);

type Pagina<T> = { data: T[]; hasMore: boolean; totalCount: number };

export class Asaas {
  constructor(
    private readonly chave: string,
    private readonly base = "https://api.asaas.com/v3",
  ) {}

  private async chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
    const resp = await fetch(`${this.base}${caminho}`, {
      ...init,
      headers: { accept: "application/json", access_token: this.chave, ...(init?.headers ?? {}) },
    });
    if (!resp.ok) {
      throw new Error(
        `Asaas ${init?.method ?? "GET"} ${caminho}: HTTP ${resp.status} ${await resp.text()}`,
      );
    }
    return (await resp.json()) as T;
  }

  private async todasAsPaginas<T>(caminho: string, params: Record<string, string>): Promise<T[]> {
    const itens: T[] = [];
    let offset = 0;
    for (;;) {
      const q = new URLSearchParams({ ...params, limit: "100", offset: String(offset) });
      const pagina = await this.chamar<Pagina<T>>(`${caminho}?${q}`);
      itens.push(...pagina.data);
      if (!pagina.hasMore || pagina.data.length === 0) return itens;
      offset += pagina.data.length;
    }
  }

  async listarClientes(): Promise<AsaasCliente[]> {
    return (await this.todasAsPaginas<AsaasCliente>("/customers", {})).filter((c) => !c.deleted);
  }

  /** Cobranças com vencimento no intervalo (datas AAAA-MM-DD, inclusivas). */
  async listarCobrancas(de: string, ate: string): Promise<AsaasCobranca[]> {
    const cobrancas = await this.todasAsPaginas<AsaasCobranca>("/payments", {
      "dueDate[ge]": de,
      "dueDate[le]": ate,
    });
    return cobrancas.filter((p) => !p.deleted);
  }

  async buscarCobranca(id: string): Promise<AsaasCobranca> {
    return this.chamar<AsaasCobranca>(`/payments/${encodeURIComponent(id)}`);
  }

  /** Cobranças PAGAS no intervalo (data de pagamento, AAAA-MM-DD, inclusiva). */
  async listarPagas(de: string, ate: string): Promise<AsaasCobranca[]> {
    const pagas = await this.todasAsPaginas<AsaasCobranca>("/payments", {
      "paymentDate[ge]": de,
      "paymentDate[le]": ate,
    });
    return pagas.filter((p) => !p.deleted && p.paymentDate);
  }

  async listarDocumentos(cobrancaId: string): Promise<AsaasDocumento[]> {
    const docs = await this.todasAsPaginas<AsaasDocumento>(`/payments/${cobrancaId}/documents`, {});
    return docs.filter((d) => !d.deleted);
  }

  /** Anexa um arquivo à cobrança; ele passa a aparecer na fatura do cliente. */
  async anexarDocumento(
    cobrancaId: string,
    arquivo: { nome: string; conteudo: Uint8Array; mime: string },
  ): Promise<AsaasDocumento> {
    const form = new FormData();
    // Uint8Array.from copia para um ArrayBuffer "puro", que é o que o Blob aceita.
    form.set("file", new Blob([Uint8Array.from(arquivo.conteudo)], { type: arquivo.mime }), arquivo.nome);
    form.set("type", "INVOICE");
    form.set("availableAfterPayment", "false");
    return this.chamar<AsaasDocumento>(`/payments/${cobrancaId}/documents`, {
      method: "POST",
      body: form,
    });
  }
}

/**
 * PDF do comprovante de pagamento.
 *
 * A API não devolve o PDF: devolve `transactionReceiptUrl`, uma página HTML
 * pública com o botão "Baixar pdf" (`/transactionReceipt/pdf/<id>`). O link do
 * PDF é lido dessa página. Se o Asaas mudar a página, isto falha com erro
 * explícito — nunca salva HTML com nome de .pdf.
 */
export async function baixarComprovante(transactionReceiptUrl: string): Promise<Buffer> {
  const pagina = await fetch(transactionReceiptUrl);
  if (!pagina.ok) throw new Error(`página do comprovante: HTTP ${pagina.status}`);
  const caminho = /href="(\/transactionReceipt\/pdf\/[^"]+)"/.exec(await pagina.text())?.[1];
  if (!caminho) throw new Error("link do PDF não encontrado na página do comprovante (o Asaas mudou a página?)");
  const resp = await fetch(new URL(caminho, transactionReceiptUrl));
  const pdf = Buffer.from(await resp.arrayBuffer());
  if (!resp.ok || pdf.subarray(0, 4).toString() !== "%PDF") {
    throw new Error(`o comprovante não veio como PDF (HTTP ${resp.status}, ${resp.headers.get("content-type")})`);
  }
  return pdf;
}
