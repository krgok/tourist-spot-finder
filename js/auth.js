import { supabase, isSupabaseConfigured } from './supabaseClient.js?v=20260708-4';
import { safeHttpsUrl } from './safeUrl.js?v=20260708-4';
import { createAuthTracker } from './authState.js?v=20260708-4';

export async function initAuth({ onLogin, onLogout, onError = () => {} }) {
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
    // アバターURLは外部(Googleアカウント)由来なので https のみ許可する。
    const avatarUrl = safeHttpsUrl(user.user_metadata?.avatar_url);
    if (avatarUrl) {
      userAvatarEl.src = avatarUrl;
      userAvatarEl.classList.remove('hidden');
    } else {
      userAvatarEl.removeAttribute('src');
      userAvatarEl.classList.add('hidden');
    }
  }

  function renderSignedOut() {
    signinContainer.classList.remove('hidden');
    userInfoEl.classList.add('hidden');
    userAvatarEl.removeAttribute('src');
  }

  // ログイン後のデータ取得などで例外が出ても、認証の通知処理を止めない。
  const tracker = createAuthTracker({
    onLogin: (user) => Promise.resolve(onLogin(user)).catch((err) => onError(err?.message || String(err))),
    onLogout: () => Promise.resolve(onLogout()).catch((err) => onError(err?.message || String(err))),
  });

  function applySession(session) {
    if (session?.user) {
      renderUser(session.user);
    } else {
      renderSignedOut();
    }
    tracker.apply(session?.user ?? null);
  }

  // 先にリスナーを登録する(後から登録すると、その間のログアウト等を取りこぼす)。
  // コールバック内で supabase の他のメソッドを await すると(ライブラリ内の排他制御で)
  // デッドロックするため、公式の推奨どおり setTimeout で処理を切り離す。
  supabase.auth.onAuthStateChange((_event, newSession) => {
    setTimeout(() => applySession(newSession), 0);
  });

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    applySession(session);
  } catch (err) {
    console.error(err);
    renderSignedOut();
    onError('ログイン状態を確認できませんでした。通信状況を確認して、ページを再読み込みしてください。');
  }

  loginBtn.addEventListener('click', async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
      if (error) throw error;
    } catch (err) {
      console.error(err);
      onError('ログインを開始できませんでした。通信状況を確認して、もう一度お試しください。');
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (err) {
      console.error(err);
      onError('ログアウトできませんでした。通信状況を確認して、もう一度お試しください。');
    }
  });
}
