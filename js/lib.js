// Funções puras (sem DOM nem rede): testáveis em Node.
export const DAY = 86400000;

/** Dias até à próxima rega (<=0 = hoje ou atrasada). */
export function daysUntil(plant, now = Date.now()) {
  return Math.ceil((plant.lastWatered + plant.freq * DAY - now) / DAY);
}

/** Percentagem da barra de progresso de rega (0-100). */
export function waterProgress(plant, now = Date.now()) {
  const total = plant.freq * DAY;
  const elapsed = now - plant.lastWatered;
  return Math.max(4, Math.min(100, Math.round((elapsed / total) * 100)));
}

export function dueLabel(d) {
  if (d < 0) return `Rega atrasada há ${-d} dia${d === -1 ? '' : 's'}`;
  if (d === 0) return 'Regar hoje';
  if (d === 1) return 'Regar amanhã';
  return `Regar em ${d} dias`;
}

export function clampFreq(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 7;
  return Math.max(1, Math.min(90, v));
}

export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim());
}

/** 0 = vazia, 1 = fraca ... 4 = forte. */
export function passwordStrength(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.max(1, Math.min(4, s));
}
export const STRENGTH_LABELS = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'];

const CRED = 'Email ou palavra-passe incorretos.';
const AUTH_ERRORS = {
  'auth/invalid-email': 'O email não é válido.',
  'auth/missing-password': 'Escreve a palavra-passe.',
  'auth/user-not-found': CRED,
  'auth/wrong-password': CRED,
  'auth/invalid-credential': CRED,
  'auth/invalid-login-credentials': CRED,
  'auth/email-already-in-use': 'Já existe uma conta com este email. Tenta iniciar sessão.',
  'auth/weak-password': 'A palavra-passe é demasiado fraca.',
  'auth/too-many-requests': 'Demasiadas tentativas. Aguarda uns minutos e tenta de novo.',
  'auth/network-request-failed': 'Sem ligação à internet.',
  'auth/popup-closed-by-user': '',
  'auth/cancelled-popup-request': '',
  'auth/account-exists-with-different-credential':
    'Este email já está associado a outro método de início de sessão (ex.: Google ou palavra-passe).',
  'auth/operation-not-allowed':
    'Este método não está ativo no Firebase (Authentication › Sign-in method).',
  'auth/unauthorized-domain':
    'Este domínio não está autorizado no Firebase (Authentication › Settings › Authorized domains).',
  'auth/user-disabled': 'Esta conta foi desativada.',
};
/** Devolve mensagem em PT; '' significa "ignorar em silêncio" (ex.: janela fechada). */
export function mapAuthError(code) {
  return Object.prototype.hasOwnProperty.call(AUTH_ERRORS, code)
    ? AUTH_ERRORS[code]
    : 'Não foi possível concluir. Tenta novamente.';
}

export function mapAiError(err) {
  const msg = String((err && err.message) || err || '');
  if (/app.?check/i.test(msg)) return 'O App Check bloqueou o pedido. Confirma a chave reCAPTCHA e o domínio no Firebase.';
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) return 'Limite gratuito do Gemini atingido. Tenta daqui a pouco.';
  if (/403|permission|not enabled|has not been used|disabled|API key/i.test(msg))
    return 'O Firebase AI Logic não está ativo neste projeto. Na consola Firebase abre AI Logic e clica em "Começar".';
  if (/network|failed to fetch|offline/i.test(msg)) return 'Sem ligação à internet.';
  return 'O assistente não conseguiu responder agora. Tenta novamente.';
}

/** Extrai JSON de uma resposta de modelo (remove cercas ``` e texto à volta). */
export function parseJsonLoose(text) {
  const t = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('JSON em falta');
  return JSON.parse(t.slice(a, b + 1));
}

/** Conselho de rega a partir da meteorologia do dia. */
export function weatherAdvice({ tmax, rainMm }) {
  if (rainMm >= 5) return 'Vai chover hoje: as plantas de exterior dispensam rega.';
  if (tmax >= 32) return 'Calor extremo: verifica a terra mais cedo e evita regar com sol forte.';
  if (tmax <= 5) return 'Frio: protege plantas sensíveis e rega com menos frequência.';
  return 'Bom dia para cuidar do jardim.';
}

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'jardineiro';
}

export function plantsToContext(plants, now = Date.now()) {
  return plants
    .map((p) => {
      const d = daysUntil(p, now);
      const rega = d <= 0 ? 'precisa de rega hoje' : `próxima rega em ${d} dia${d === 1 ? '' : 's'}`;
      return `- ${p.name}${p.species ? ` (${p.species})` : ''}${p.location ? ` em ${p.location}` : ''}; rega a cada ${p.freq} dias; ${rega}`;
    })
    .join('\n');
}
