// Camada de dados. Dois "motores" com a mesma interface:
//  - Firebase (Auth + Firestore + Firebase AI Logic/Gemini) quando config.js tem as chaves;
//  - Demonstração (localStorage) quando não tem, para a app abrir e ser experimentada.
import { mapAuthError, mapAiError, parseJsonLoose } from './lib.js';

const cfg = window.PLANTAE_CONFIG || {};
const SDK = cfg.sdkVersion || '13.4.0';
const CDN = `https://www.gstatic.com/firebasejs/${SDK}/`;
export const MODEL = cfg.geminiModel || 'gemini-3.8-flash';

export const isConfigured = () =>
  !!(cfg.firebase && cfg.firebase.apiKey && cfg.firebase.projectId && cfg.firebase.appId);

export async function createBackend() {
  return isConfigured() ? firebaseBackend() : demoBackend();
}

/* ---------------------------- Prompts do Gemini ---------------------------- */
const CHAT_SYSTEM = `És o Plantae, um assistente de jardinagem simpático e rigoroso.
Responde sempre em português europeu, de forma prática e curta (máx. ~6 frases ou uma lista curta).
Quando souberes o jardim do utilizador, usa-o para personalizar a resposta.
Se não tiveres certeza, diz que não tens certeza em vez de inventar. Para suspeitas de intoxicação de animais
ou pessoas, recomenda contactar um veterinário ou o Centro de Informação Antivenenos (CIAV: 808 250 143, em Portugal).
Não dês doses de pesticidas; sugere primeiro métodos simples (isolar, limpar, ajustar rega e luz).
Só falas de plantas, jardinagem e temas relacionados.`;

const IDENTIFY_PROMPT = `Identifica a planta na fotografia. Responde APENAS com JSON válido (sem texto fora do JSON) com estas chaves:
"planta_visivel" (boolean), "nome_comum" (português europeu), "especie" (nome científico), "confianca" ("alta"|"média"|"baixa"),
"alternativas" (até 3 objetos {"nome","especie"} de outras possibilidades), "resumo" (máx. 2 frases),
"rega_dias" (inteiro, intervalo típico de rega em casa), "luz" ("baixa"|"média"|"alta"),
"toxica_animais" (true|false|null se não souberes), "dificuldade" ("Muito fácil"|"Fácil"|"Moderada"|"Exigente"),
"cuidados" (array de 3 frases curtas). Se não houver planta visível, devolve {"planta_visivel": false}.
Sê honesto na "confianca": se a imagem estiver desfocada ou for ambígua, usa "baixa" e preenche "alternativas".`;

const diagnosePrompt = (name) => `Analisa a saúde da planta${name ? ` "${name}"` : ''} na fotografia.
Responde APENAS com JSON válido com as chaves: "planta_visivel" (boolean), "saudavel" (boolean),
"problema" (frase curta, ou "Sem problemas visíveis"), "causa_provavel" (1-2 frases),
"gravidade" ("baixa"|"média"|"alta"), "passos" (array de 3 a 5 ações práticas e simples, sem pesticidas com doses),
"prevencao" (1 frase), "procurar_ajuda_quando" (1 frase). Não tens certeza absoluta a partir de uma foto: se for incerto, diz isso em "causa_provavel".`;

/* ------------------------------- Firebase --------------------------------- */
async function firebaseBackend() {
  const [appM, authM, fsM, aiM] = await Promise.all([
    import(CDN + 'firebase-app.js'),
    import(CDN + 'firebase-auth.js'),
    import(CDN + 'firebase-firestore.js'),
    import(CDN + 'firebase-ai.js'),
  ]);
  const app = appM.initializeApp(cfg.firebase);
  if (cfg.appCheckSiteKey) {
    const ac = await import(CDN + 'firebase-app-check.js');
    ac.initializeAppCheck(app, {
      provider: new ac.ReCaptchaV3Provider(cfg.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  const auth = authM.getAuth(app);
  auth.languageCode = 'pt';
  let db;
  try {
    db = fsM.initializeFirestore(app, {
      localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }),
    });
  } catch {
    db = fsM.getFirestore(app);
  }
  const ai = aiM.getAI(app, { backend: new aiM.GoogleAIBackend() });
  const clean = (o) => JSON.parse(JSON.stringify(o));
  const fail = (e) => {
    const msg = mapAuthError(e && e.code);
    const err = new Error(msg);
    err.silent = msg === '';
    return err;
  };

  let redirectError = null;
  await authM.getRedirectResult(auth).catch((e) => { redirectError = fail(e); });

  const toUser = (u) =>
    u && {
      uid: u.uid,
      name: u.displayName || (u.email ? u.email.split('@')[0] : 'Jardineiro'),
      email: u.email || '',
      photo: u.photoURL || '',
      provider: (u.providerData[0] && u.providerData[0].providerId) || 'password',
    };

  async function social(provider) {
    try {
      await authM.signInWithPopup(auth, provider);
    } catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
        await authM.signInWithRedirect(auth, provider);
        return;
      }
      throw fail(e);
    }
  }

  const plantsCol = (uid) => fsM.collection(db, 'users', uid, 'plants');
  const diaryCol = (uid, pid) => fsM.collection(db, 'users', uid, 'plants', pid, 'diary');

  async function generateJson(prompt, b64, mime) {
    const model = aiM.getGenerativeModel(ai, { model: MODEL, generationConfig: { responseMimeType: 'application/json' } });
    try {
      const res = await model.generateContent([prompt, { inlineData: { mimeType: mime || 'image/jpeg', data: b64 } }]);
      return parseJsonLoose(res.response.text());
    } catch (e) {
      throw new Error(mapAiError(e));
    }
  }

  return {
    mode: 'firebase',
    takeAuthError: () => { const e = redirectError; redirectError = null; return e; },
    auth: {
      onChange: (cb) => authM.onAuthStateChanged(auth, (u) => cb(toUser(u))),
      async signUp({ name, email, password }) {
        try {
          const cred = await authM.createUserWithEmailAndPassword(auth, email.trim(), password);
          await authM.updateProfile(cred.user, { displayName: name.trim() });
          authM.sendEmailVerification(cred.user).catch(() => {});
          await fsM.setDoc(fsM.doc(db, 'users', cred.user.uid), {
            name: name.trim(), email: email.trim(), createdAt: Date.now(),
          }, { merge: true });
          return toUser(auth.currentUser);
        } catch (e) { throw fail(e); }
      },
      async signIn(email, password) {
        try { await authM.signInWithEmailAndPassword(auth, email.trim(), password); }
        catch (e) { throw fail(e); }
      },
      google: () => social(new authM.GoogleAuthProvider()),
      apple: () => {
        const p = new authM.OAuthProvider('apple.com');
        p.addScope('email'); p.addScope('name');
        return social(p);
      },
      async reset(email) {
        try { await authM.sendPasswordResetEmail(auth, email.trim()); }
        catch (e) { throw fail(e); }
      },
      guest: null,
      signOut: () => authM.signOut(auth),
    },
    users: {
      touch: (u) => fsM.setDoc(fsM.doc(db, 'users', u.uid), clean({
        name: u.name, email: u.email, provider: u.provider, lastLogin: Date.now(),
      }), { merge: true }).catch(() => {}),
    },
    plants: {
      subscribe(uid, cb) {
        const q = fsM.query(plantsCol(uid), fsM.orderBy('createdAt', 'desc'));
        return fsM.onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => cb(null, e));
      },
      async save(uid, plant) {
        const { id, ...data } = clean(plant);
        if (id) { await fsM.setDoc(fsM.doc(db, 'users', uid, 'plants', id), data, { merge: true }); return id; }
        data.createdAt = Date.now();
        return (await fsM.addDoc(plantsCol(uid), data)).id;
      },
      async remove(uid, id) {
        const entries = await fsM.getDocs(diaryCol(uid, id));
        const batch = fsM.writeBatch(db);
        entries.forEach((d) => batch.delete(d.ref));
        batch.delete(fsM.doc(db, 'users', uid, 'plants', id));
        await batch.commit();
      },
    },
    diary: {
      subscribe(uid, pid, cb) {
        const q = fsM.query(diaryCol(uid, pid), fsM.orderBy('date', 'desc'));
        return fsM.onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]));
      },
      add: (uid, pid, entry) => fsM.addDoc(diaryCol(uid, pid), clean(entry)),
      remove: (uid, pid, eid) => fsM.deleteDoc(fsM.doc(db, 'users', uid, 'plants', pid, 'diary', eid)),
    },
    ai: {
      available: true,
      async chat(turns, gardenContext, onText) {
        const system = CHAT_SYSTEM + (gardenContext ? `\n\nJardim do utilizador:\n${gardenContext}` : '');
        const model = aiM.getGenerativeModel(ai, { model: MODEL, systemInstruction: system });
        const contents = turns.map((t) => ({ role: t.role === 'user' ? 'user' : 'model', parts: [{ text: t.text }] }));
        try {
          const res = await model.generateContentStream({ contents });
          let acc = '';
          for await (const chunk of res.stream) { acc += chunk.text(); onText(acc); }
          return acc;
        } catch (e) { throw new Error(mapAiError(e)); }
      },
      identify: (b64, mime) => generateJson(IDENTIFY_PROMPT, b64, mime),
      diagnose: (b64, mime, name) => generateJson(diagnosePrompt(name), b64, mime),
    },
  };
}

/* ----------------------------- Modo demonstração -------------------------- */
function demoBackend() {
  const K = 'plantae_demo_';
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(K + k)); return v ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(K + k, JSON.stringify(v)); } catch { /* quota */ } };
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f());
  const msg = 'Modo demonstração: liga o Firebase em config.js para criar contas e entrar com Google ou Apple.';
  const needFirebase = () => Promise.reject(new Error(msg));
  const uid = () => 'd' + Math.random().toString(36).slice(2, 10);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let authCb = null;
  const guestUser = () => ({ uid: 'guest', name: 'Convidado', email: '', photo: '', provider: 'demo' });

  return {
    mode: 'demo',
    takeAuthError: () => null,
    auth: {
      onChange(cb) { authCb = cb; setTimeout(() => cb(load('user', null)), 0); return () => { authCb = null; }; },
      signUp: needFirebase, signIn: needFirebase, google: needFirebase, apple: needFirebase, reset: needFirebase,
      async guest() { save('user', guestUser()); authCb && authCb(guestUser()); },
      async signOut() { localStorage.removeItem(K + 'user'); authCb && authCb(null); },
    },
    users: { touch: async () => {} },
    plants: {
      subscribe(_uid, cb) {
        const f = () => cb(load('plants', []).sort((a, b) => b.createdAt - a.createdAt));
        listeners.add(f); f(); return () => listeners.delete(f);
      },
      async save(_uid, plant) {
        const all = load('plants', []);
        if (plant.id) { const i = all.findIndex((p) => p.id === plant.id); if (i >= 0) all[i] = { ...all[i], ...plant }; }
        else all.push({ ...plant, id: uid(), createdAt: Date.now() });
        save('plants', all); emit(); return plant.id;
      },
      async remove(_uid, id) { save('plants', load('plants', []).filter((p) => p.id !== id)); localStorage.removeItem(K + 'diary_' + id); emit(); },
    },
    diary: {
      subscribe(_uid, pid, cb) {
        const f = () => cb(load('diary_' + pid, []).sort((a, b) => b.date - a.date));
        listeners.add(f); f(); return () => listeners.delete(f);
      },
      async add(_uid, pid, entry) { const l = load('diary_' + pid, []); l.push({ ...entry, id: uid() }); save('diary_' + pid, l); emit(); },
      async remove(_uid, pid, eid) { save('diary_' + pid, load('diary_' + pid, []).filter((e) => e.id !== eid)); emit(); },
    },
    ai: {
      available: false,
      async chat(_turns, _ctx, onText) {
        await wait(400);
        const t = 'Estou em modo demonstração, por isso não tenho ligação ao Gemini. Quando configurares o Firebase AI Logic em config.js, respondo às tuas dúvidas sobre as tuas plantas.';
        onText(t); return t;
      },
      async identify() {
        await wait(700);
        return { exemplo: true, planta_visivel: true, nome_comum: 'Costela-de-adão', especie: 'Monstera deliciosa', confianca: 'alta',
          alternativas: [{ nome: 'Monstera adansonii', especie: 'Monstera adansonii' }],
          resumo: 'Resultado de exemplo (modo demonstração): trepadeira tropical com folhas grandes e perfuradas.',
          rega_dias: 7, luz: 'média', toxica_animais: true, dificuldade: 'Fácil',
          cuidados: ['Luz forte mas indireta.', 'Regar quando os 3 cm de cima da terra estiverem secos.', 'Limpar as folhas com um pano húmido.'] };
      },
      async diagnose() {
        await wait(700);
        return { exemplo: true, planta_visivel: true, saudavel: false, problema: 'Folhas amarelas (exemplo)', causa_provavel: 'Resultado de exemplo (modo demonstração): excesso de rega é a causa mais comum.',
          gravidade: 'média', passos: ['Verifica se a terra está encharcada.', 'Garante drenagem no vaso.', 'Espaça as regas até a terra secar 3 cm.'],
          prevencao: 'Regar só quando a terra estiver seca à superfície.', procurar_ajuda_quando: 'Se houver cheiro a podre ou caule mole.' };
      },
    },
  };
}
