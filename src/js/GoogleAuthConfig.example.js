// src/js/GoogleAuthConfig.example.js
// Copie pra src/js/GoogleAuthConfig.js (gitignored) e preencha com suas
// próprias credenciais do Google Cloud Console:
//   1. console.cloud.google.com → crie um projeto
//   2. Ative a "Google Calendar API"
//   3. Tela de consentimento OAuth → Externo/Testing, adicione seu e-mail
//      como usuário de teste
//   4. Credenciais → Criar credenciais → ID do cliente OAuth →
//      tipo "App para computador"
module.exports = {
    CLIENT_ID: "SEU_CLIENT_ID.apps.googleusercontent.com",
    CLIENT_SECRET: "SEU_CLIENT_SECRET"
};
