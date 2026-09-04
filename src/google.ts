/**
 * Google: renovação do token, envio pelo Gmail e leitura de uma aba do Sheets.
 *
 * O e-mail sai da conta de quem autorizou e fica na pasta "Enviados" dela —
 * sem servidor de e-mail próprio e sem remetente falso. O escopo usado no
 * envio é `gmail.send`: envia e só; não lê, não lista, não apaga nada.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export const ESCOPO_ENVIO = "https://www.googleapis.com/auth/gmail.send";
/** Só para ler a planilha de destinatários; dispensável se você usar o CSV. */
export const ESCOPO_PLANILHA = "https://www.googleapis.com/auth/drive.readonly";

export async function renovarAccessToken(credenciais: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<string> {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credenciais.clientId,
      client_secret: credenciais.clientSecret,
      refresh_token: credenciais.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) throw new Error(`Google: falha ao renovar o token — ${await resp.text()}`);
  const json = (await resp.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google: resposta sem access_token");
  return json.access_token;
}

export type Anexo = { nome: string; mime: string; conteudo: Buffer };

export type Email = {
  para: string[];
  assunto: string;
  texto: string;
  anexos?: Anexo[];
};

function base64(s: string | Buffer): string {
  return Buffer.from(s).toString("base64");
}

/** Base64 em linhas de 76 colunas, como o MIME pede. */
function emLinhas(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

/** Cabeçalho com acento vira "encoded-word" (RFC 2047). */
function cabecalho(s: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${base64(s)}?=`;
}

function nomeAscii(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/"/g, "'");
}

export function montarMime(e: Email): string {
  const limite = `----=_nf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const partes = [
    `To: ${e.para.join(", ")}`,
    `Subject: ${cabecalho(e.assunto)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${limite}"`,
    "",
    `--${limite}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    emLinhas(base64(e.texto)),
  ];
  for (const a of e.anexos ?? []) {
    const ascii = nomeAscii(a.nome);
    partes.push(
      `--${limite}`,
      `Content-Type: ${a.mime}; name="${ascii}"`,
      `Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.nome)}`,
      "Content-Transfer-Encoding: base64",
      "",
      emLinhas(base64(a.conteudo)),
    );
  }
  partes.push(`--${limite}--`, "");
  return partes.join("\r\n");
}

export async function enviarEmail(
  accessToken: string,
  e: Email,
): Promise<{ id: string; threadId: string }> {
  if (e.para.length === 0) throw new Error("e-mail sem destinatário");
  const raw = Buffer.from(montarMime(e)).toString("base64url");
  const resp = await fetch(GMAIL_SEND, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!resp.ok) throw new Error(`Gmail: HTTP ${resp.status} ${await resp.text()}`);
  return (await resp.json()) as { id: string; threadId: string };
}

/**
 * Lê uma aba do Google Sheets pelo export CSV do próprio Docs. Usa o escopo de
 * leitura do Drive e dispensa habilitar a Sheets API no projeto do Google Cloud.
 */
export async function lerAbaComoCsv(
  accessToken: string,
  planilhaId: string,
  gid: number,
): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${planilhaId}/export?format=csv&gid=${gid}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`Sheets: HTTP ${resp.status} ao exportar a planilha ${planilhaId}`);
  const tipo = resp.headers.get("content-type") ?? "";
  if (!tipo.includes("text/csv")) {
    throw new Error(`a planilha não veio como CSV (${tipo}) — a conta autorizada tem acesso a ela?`);
  }
  return resp.text();
}
