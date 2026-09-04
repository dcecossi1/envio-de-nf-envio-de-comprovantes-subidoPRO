import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Registro do que já foi enviado, em arquivo JSON.
 *
 * A chave é a chave de acesso da NFS-e, que é única por nota. É isso que
 * impede o reenvio: rodar o comando duas vezes no mesmo mês não manda nada de
 * novo. Some o arquivo, some a trava — por isso ele é gravado de forma
 * atômica (escreve num temporário e renomeia) e fica fora do Git.
 */
export type Envio = {
  chaveAcesso: string;
  numero: number;
  competencia: string;
  cliente: string;
  cnpjTomador: string;
  valor: number;
  arquivo: string;
  destinatarios: string[];
  cobrancaId: string | null;
  linkFatura: string | null;
  mensagemId: string;
  enviadoEm: string; // ISO
};

export class Registro {
  private readonly porChave = new Map<string, Envio>();

  constructor(private readonly caminho: string) {
    if (!existsSync(caminho)) return;
    const conteudo = JSON.parse(readFileSync(caminho, "utf8")) as Envio[];
    for (const e of conteudo) this.porChave.set(e.chaveAcesso, e);
  }

  buscar(chaveAcesso: string): Envio | undefined {
    return this.porChave.get(chaveAcesso);
  }

  anotar(envio: Envio): void {
    this.porChave.set(envio.chaveAcesso, envio);
    mkdirSync(dirname(this.caminho), { recursive: true });
    const lista = [...this.porChave.values()].sort((a, b) => a.enviadoEm.localeCompare(b.enviadoEm));
    const temporario = `${this.caminho}.tmp`;
    writeFileSync(temporario, `${JSON.stringify(lista, null, 2)}\n`, "utf8");
    renameSync(temporario, this.caminho);
  }
}
