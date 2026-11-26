// Configuração PÚBLICA do Firebase (não é segredo; a segurança vem das regras do Firestore e do App Check).
// Firebase Console › Definições do projeto › As tuas apps › Web › "Configuração do SDK".
// Enquanto estiver vazio, a app corre em MODO DEMONSTRAÇÃO (dados só neste dispositivo).
window.PLANTAE_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyB1yoi5_UoeiTaMW9KjZBMIF9Q3hphVQXk',
    authDomain: 'plantae-b4b26.firebaseapp.com',
    projectId: 'plantae-b4b26',
    storageBucket: 'plantae-b4b26.firebasestorage.app',
    messagingSenderId: '852009308026',
    appId: '1:852009308026:web:1b83fdba495b62190e50c3',
  },
  // Opcional mas recomendado em produção: chave reCAPTCHA v3 para o App Check.
  appCheckSiteKey: '',
  // Modelo Gemini via Firebase AI Logic (Gemini Developer API). Verifica a lista atual na documentação.
  geminiModel: 'gemini-3.8-flash',
  // Versão do SDK Firebase carregada pelo CDN do Google.
  sdkVersion: '13.4.0',
};
