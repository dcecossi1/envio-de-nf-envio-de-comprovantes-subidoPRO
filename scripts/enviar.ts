/**
 * Envia as notas fiscais do mês por e-mail para cada cliente, com o link da
 * cobrança do Asaas no corpo e o PDF em anexo.
 *
 *   npm run enviar -- --pasta ./notas --competencia 2026-09
 *       → só mostra o plano (quem recebe o quê); não envia nada
 *   npm run enviar -- --pasta ./notas --competencia 2026-09 --teste voce@empresa.com
 *       → manda tudo só pra esse endereço, com "[TESTE]" no assunto
 *   npm run enviar -- --pasta ./notas --competencia 2026-09 --enviar
 *       → envia de verdade, para os clientes
 *
 * Outras opções:
 *   --so acme,contoso           só clientes cujo nome contém um desses trechos
 *   --permitir-sem-cobranca     envia mesmo sem cobrança no Asaas (e-mail sai sem link)
 *   --ignorar-valor             envia mesmo se o valor da nota diferir do da cobrança
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Asaas, COBRANCA_EM_ABERTO, type AsaasCliente, type AsaasCobranca } from "../src/asaas.js";
import { ARQUIVO_REGISTRO, lerConfig, lerToken, type Config, type Token } from "../src/config.js";
import { lerCsv } from "../src/csv.js";
import { lerDestinatarios, type Destinatario } from "../src/destinatarios.js";
import { ESCOPO_ENVIO, enviarEmail, lerAbaComoCsv, renovarAccessToken } from "../src/google.js";
import { competenciaMes, formatarDocumento, lerDanfse, type NotaFiscal } from "../src/nfse.js";
import { Registro } from "../src/registro.js";

type Opcoes = {
  pasta: string;
  competencia: string; // AAAA-MM
  enviar: boolean;
  teste: string | null;
  permitirSemCobranca: boolean;
  ignorarValor: boolean;
  so: string[];
};

type Plano = {
  arquivo: string;
  nota: NotaFiscal;
  destinatario: Destinatario | null;
  cobranca: AsaasCobranca | null;
  situacao: string;
  pronto: boolean;
};

function lerArgs(argv: string[]): Opcoes {
  const o: Opcoes = {
    pasta: "",
    competencia: "",
    enviar: false,
    teste: null,
    permitirSemCobranca: false,
    ignorarValor: false,
    so: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const valor = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`falta o valor de ${a}`);
      return v;
    };
    if (a === "--pasta") o.pasta = valor();
    else if (a === "--competencia") o.competencia = valor();
    else if (a === "--enviar") o.enviar = true;
    else if (a === "--teste") o.teste = valor();
    else if (a === "--permitir-sem-cobranca") o.permitirSemCobranca = true;
    else if (a === "--ignorar-valor") o.ignorarValor = true;
    else if (a === "--so") o.so = valor().split(",").map(simplificar).filter(Boolean);
    else throw new Error(`opção desconhecida: ${a}`);
  }
  if (!o.pasta) throw new Error("informe --pasta (onde estão os PDFs das notas)");
  if (!/^\d{4}-\d{2}$/.test(o.competencia)) throw new Error("informe --competencia no formato AAAA-MM");
  return o;
}

/** minúsculo e sem acento — para comparar nomes vindos de fontes diferentes */
function simplificar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function expandir(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : resolve(p);
}

function reais(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function diaMes(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function mesAno(competencia: string): string {
  return `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;
}

function ultimoDia(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number) as [number, number];
  return `${competencia}-${String(new Date(ano, mes, 0).getDate()).padStart(2, "0")}`;
}

function textoDoPdf(caminho: string): string {
  try {
    return execFileSync("pdftotext", ["-layout", caminho, "-"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ENOENT/.test(msg)) {
      throw new Error("pdftotext não encontrado — instale o poppler (macOS: brew install poppler; Ubuntu: apt install poppler-utils)");
    }
    throw e;
  }
}

function corpoDoEmail(linkFatura: string | null, assinatura: string): string {
  const linhas = ["Olá,", "", "Segue em anexo a nota fiscal."];
  if (linkFatura) linhas.push("", `Link da fatura: ${linkFatura}`);
  linhas.push("", assinatura);
  return linhas.join("\n");
}

function tabela(cabecalho: string[], linhas: string[][]) {
  const larguras = cabecalho.map((c, i) => Math.max(c.length, ...linhas.map((l) => (l[i] ?? "").length)));
  const fmt = (l: string[]) => l.map((c, i) => (c ?? "").padEnd(larguras[i]!)).join("  ").trimEnd();
  console.log(fmt(cabecalho));
  console.log(larguras.map((w) => "-".repeat(w)).join("  "));
  for (const l of linhas) console.log(fmt(l));
}

async function carregarDestinatarios(
  config: Config,
  accessToken: () => Promise<string>,
): Promise<Destinatario[]> {
  if (config.planilhaId) {
    return lerDestinatarios(
      lerCsv(await lerAbaComoCsv(await accessToken(), config.planilhaId, config.planilhaGid)),
    );
  }
  const caminho = expandir(config.destinatariosCsv);
  if (!existsSync(caminho)) {
    throw new Error(`não achei ${caminho} — copie o destinatarios.exemplo.csv ou preencha PLANILHA_ID no .env`);
  }
  return lerDestinatarios(lerCsv(readFileSync(caminho, "utf8")));
}

async function main() {
  const o = lerArgs(process.argv.slice(2));
  const config = lerConfig();
  const pasta = expandir(o.pasta);

  // A conta Google só é exigida quando o Google é realmente usado: para
  // enviar, ou para ler a planilha. Com destinatários em CSV, ver o plano
  // funciona antes mesmo de autorizar qualquer conta.
  let token: Token | null = null;
  const contaGoogle = () => (token ??= lerToken());
  let accessToken: string | null = null;
  const comToken = async () => {
    const t = contaGoogle();
    return (accessToken ??= await renovarAccessToken({
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      refreshToken: t.refresh_token,
    }));
  };

  // 1. Notas da pasta
  const arquivos = readdirSync(pasta).filter((n) => n.toLowerCase().endsWith(".pdf"));
  if (arquivos.length === 0) throw new Error(`nenhum PDF em ${pasta}`);
  const notas: { arquivo: string; nota: NotaFiscal }[] = [];
  const ilegiveis: string[] = [];
  for (const arquivo of arquivos) {
    try {
      const nota = lerDanfse(textoDoPdf(join(pasta, arquivo)));
      if (competenciaMes(nota) === o.competencia) notas.push({ arquivo, nota });
    } catch (e) {
      ilegiveis.push(`${arquivo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\nPasta ${pasta}: ${arquivos.length} PDF(s), ${notas.length} nota(s) da competência ${mesAno(o.competencia)}.`);
  if (ilegiveis.length > 0) {
    console.log("Não consegui ler (ficam de fora):");
    for (const i of ilegiveis) console.log(`  - ${i}`);
  }
  if (notas.length === 0) return;

  // 2. Destinatários e Asaas
  if ((o.enviar || o.teste) && !contaGoogle().escopos.includes(ESCOPO_ENVIO)) {
    throw new Error("a conta autorizada não tem permissão de envio — rode: npm run autorizar");
  }

  const destinatarios = await carregarDestinatarios(config, comToken);
  const destinatarioPorCnpj = new Map<string, Destinatario>();
  for (const d of destinatarios) if (d.cnpj) destinatarioPorCnpj.set(d.cnpj, d);

  const asaas = new Asaas(config.asaasChave, config.asaasUrl);
  const clientes = await asaas.listarClientes();
  const clientePorCnpj = new Map<string, AsaasCliente[]>();
  for (const c of clientes) {
    const d = (c.cpfCnpj ?? "").replace(/\D/g, "");
    if (d) clientePorCnpj.set(d, [...(clientePorCnpj.get(d) ?? []), c]);
  }
  const cobrancasDoMes = await asaas.listarCobrancas(`${o.competencia}-01`, ultimoDia(o.competencia));

  const registro = new Registro(ARQUIVO_REGISTRO);

  // 3. Plano: uma linha por nota, com o motivo de cada uma que não vai
  const planos: Plano[] = [];
  for (const { arquivo, nota } of notas) {
    const destinatario = destinatarioPorCnpj.get(nota.cnpjTomador) ?? null;
    if (o.so.length > 0) {
      const nome = simplificar(destinatario?.nome ?? nota.nomeTomador);
      if (!o.so.some((s) => nome.includes(s))) continue;
    }
    const ids = new Set((clientePorCnpj.get(nota.cnpjTomador) ?? []).map((c) => c.id));
    const candidatas = cobrancasDoMes.filter((p) => ids.has(p.customer));
    const cobranca =
      candidatas.filter((p) => COBRANCA_EM_ABERTO.has(p.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ??
      [...candidatas].sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0] ??
      null;

    const plano: Plano = { arquivo, nota, destinatario, cobranca, situacao: "pronto", pronto: true };
    const parar = (motivo: string) => {
      plano.situacao = motivo;
      plano.pronto = false;
    };

    const jaEnviada = registro.buscar(nota.chaveAcesso);
    if (jaEnviada) parar(`já enviada em ${new Date(jaEnviada.enviadoEm).toLocaleString("pt-BR")}`);
    else if (nota.cnpjEmitente !== config.cnpjEmitente) parar(`emitente diferente do CNPJ_EMITENTE (${formatarDocumento(nota.cnpjEmitente)})`);
    else if (!destinatario) parar(`CNPJ ${formatarDocumento(nota.cnpjTomador)} não está na lista de destinatários`);
    else if (destinatario.emails.length === 0) parar(destinatario.observacao ?? "sem e-mail na lista");
    else if (!cobranca) {
      const motivo = ids.size === 0 ? "sem cliente no Asaas com esse CNPJ" : `sem cobrança vencendo em ${mesAno(o.competencia)}`;
      if (o.permitirSemCobranca) plano.situacao = `${motivo} — vai SEM link`;
      else parar(motivo);
    } else if (Math.abs(cobranca.value - nota.valor) > 0.01) {
      const motivo = `valor difere: nota ${reais(nota.valor)}, cobrança ${reais(cobranca.value)}`;
      if (o.ignorarValor) plano.situacao = `${motivo} — enviando assim mesmo`;
      else parar(motivo);
    }
    planos.push(plano);
  }

  console.log("");
  tabela(
    ["Cliente", "NF", "Valor", "Cobrança", "Para", "Situação"],
    planos.map((p) => [
      p.destinatario?.nome ?? p.nota.nomeTomador,
      String(p.nota.numero),
      reais(p.nota.valor),
      p.cobranca ? `${diaMes(p.cobranca.dueDate)} ${reais(p.cobranca.value)} ${p.cobranca.status}` : "—",
      p.destinatario?.emails.join(", ") ?? "—",
      p.situacao,
    ]),
  );

  // Cobranças do mês sem nota na pasta — para ninguém esquecer de emitir
  const cnpjsComNota = new Set(notas.map((n) => n.nota.cnpjTomador));
  const clientePorId = new Map(clientes.map((c) => [c.id, c]));
  const semNota = new Map<string, AsaasCobranca>();
  for (const p of cobrancasDoMes) {
    const cnpj = (clientePorId.get(p.customer)?.cpfCnpj ?? "").replace(/\D/g, "");
    if (!cnpjsComNota.has(cnpj)) semNota.set(p.customer, p);
  }
  if (semNota.size > 0) {
    console.log(`\nCobranças vencendo em ${mesAno(o.competencia)} sem nota na pasta:`);
    for (const [id, p] of semNota) {
      const cliente = clientePorId.get(id);
      const obs = cliente?.cpfCnpj ? destinatarioPorCnpj.get(cliente.cpfCnpj.replace(/\D/g, ""))?.observacao : null;
      console.log(`  - ${cliente?.name ?? id}: ${diaMes(p.dueDate)} ${reais(p.value)} ${p.status}${obs ? ` (${obs})` : ""}`);
    }
  }

  const prontos = planos.filter((p) => p.pronto);
  if (!o.enviar && !o.teste) {
    console.log(`\n${prontos.length} pronta(s) para enviar. Nada foi enviado — use --teste ou --enviar.`);
    return;
  }
  if (prontos.length === 0) {
    console.log("\nNada pronto para enviar.");
    return;
  }

  // 4. Envio
  if (o.teste) console.log(`\nMODO TESTE: tudo vai só para ${o.teste}; nada é registrado nem anexado no Asaas.`);
  console.log(`\nEnviando ${prontos.length} nota(s) pela conta ${contaGoogle().conta}...`);
  let falhas = 0;
  for (const p of prontos) {
    const d = p.destinatario!;
    const rotulo = `${d.nome} (NF ${p.nota.numero})`;
    try {
      const pdf = readFileSync(join(pasta, p.arquivo));
      const nomeAnexo = `Nota Fiscal - ${d.nome} - ${mesAno(o.competencia).replace("/", "-")}.pdf`;

      if (config.anexarNaCobranca && p.cobranca && !o.teste) {
        const jaAnexado = (await asaas.listarDocumentos(p.cobranca.id)).some(
          (doc) => doc.file.originalName === nomeAnexo,
        );
        if (!jaAnexado) {
          await asaas.anexarDocumento(p.cobranca.id, { nome: nomeAnexo, conteudo: pdf, mime: "application/pdf" });
        }
      }

      const enviado = await enviarEmail(await comToken(), {
        para: o.teste ? [o.teste] : d.emails,
        assunto: `${o.teste ? "[TESTE] " : ""}Nota Fiscal - ${d.nome}`,
        texto: corpoDoEmail(p.cobranca?.invoiceUrl ?? null, config.assinatura),
        anexos: [{ nome: nomeAnexo, mime: "application/pdf", conteudo: pdf }],
      });

      if (o.teste) {
        console.log(`  ${rotulo}: teste enviado para ${o.teste} (${enviado.id})`);
        continue;
      }

      registro.anotar({
        chaveAcesso: p.nota.chaveAcesso,
        numero: p.nota.numero,
        competencia: p.nota.competencia,
        cliente: d.nome,
        cnpjTomador: p.nota.cnpjTomador,
        valor: p.nota.valor,
        arquivo: p.arquivo,
        destinatarios: d.emails,
        cobrancaId: p.cobranca?.id ?? null,
        linkFatura: p.cobranca?.invoiceUrl ?? null,
        mensagemId: enviado.id,
        enviadoEm: new Date().toISOString(),
      });
      console.log(`  ${rotulo}: enviado para ${d.emails.join(", ")} (${enviado.id})`);
    } catch (e) {
      falhas++;
      console.error(`  ${rotulo}: FALHOU — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\n${prontos.length - falhas} enviada(s), ${falhas} falha(s).`);
  if (falhas > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`\nErro: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
