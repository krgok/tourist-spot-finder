import { supabase, isSupabaseConfigured } from './supabaseClient.js?v=20260708-2';

export async function initAuth({ onLogin, onLogout }) {
  const signinContainer = document.getElementById('g_id_signin_container');
  const userInfoEl = document.getElementById('user-info');
  const userNameEl = document.getElementById('user-name');
  const userAvatarEl = document.getElementById('user-avatar');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');

  if (!isSupabaseConfigured()) {
    signinContainer.textContent = 'ログイン機能を使うにはSupabaseの設定が必要です。';
    return;
  }

  function renderUser(user) {
    signinContainer.classList.add('hidden');
    userInfoEl.classList.remove('hidden');
    userNameEl.textContent = user.user_metadata?.full_name || user.email || '';
    userAvatarEl.src = user.user_metadata?.avatar_url || '';
  }

  function renderSignedOut() {
    signinContainer.classList.remove('hidden');
    userInfoEl.classList.add('hidden');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.user) {
    renderUser(session.user);
    onLogin(session.user);
  } else {
    renderSignedOut();
  }

  supabase.auth.onAuthStateChange((_event, newSession) => {
    if (newSession?.user) {
      renderUser(newSession.user);
      onLogin(newSession.user);
    } else {
      renderSignedOut();
      onLogout();
    }
  });

  loginBtn.addEventListener('click', async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
  });

  logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
  });
}
