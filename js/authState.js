// ログイン状態の遷移を整理する(Supabase に依存しない純粋なロジック)。
// supabase-js は、起動時に getSession() と onAuthStateChange(INITIAL_SESSION)、1時間ごとに
// TOKEN_REFRESHED と、同じユーザーのイベントを何度も通知する。そのたびに
// お気に入り・履歴を取得し直さないよう、ユーザーが切り替わったときだけ通知する。

export function createAuthTracker({ onLogin, onLogout }) {
  let currentUserId = null;

  return {
    // 戻り値: 'login' | 'logout' | 'same' | 'none'
    apply(user) {
      if (user?.id) {
        if (user.id === currentUserId) return 'same';
        currentUserId = user.id;
        onLogin(user);
        return 'login';
      }
      if (currentUserId !== null) {
        currentUserId = null;
        onLogout();
        return 'logout';
      }
      return 'none';
    },
    get userId() {
      return currentUserId;
    },
  };
}
