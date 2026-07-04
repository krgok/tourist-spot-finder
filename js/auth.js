function decodeJwt(token) {
  const payload = token.split('.')[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  );
  return JSON.parse(json);
}

let gisScriptLoaded = false;

function loadGisScript() {
  if (gisScriptLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      gisScriptLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Googleログインスクリプトの読み込みに失敗しました。'));
    document.head.appendChild(script);
  });
}

export async function initAuth({ clientId, onLogin, onLogout }) {
  const signinContainer = document.getElementById('g_id_signin_container');
  const userInfoEl = document.getElementById('user-info');
  const userNameEl = document.getElementById('user-name');
  const userAvatarEl = document.getElementById('user-avatar');
  const logoutBtn = document.getElementById('logout-btn');

  signinContainer.innerHTML = '';
  userInfoEl.classList.add('hidden');

  if (!clientId) {
    signinContainer.textContent = 'ログインするにはOAuthクライアントIDを設定してください。';
    return;
  }

  await loadGisScript();

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => {
      const payload = decodeJwt(response.credential);
      sessionStorage.setItem('tourist-app.user', JSON.stringify(payload));
      renderUser(payload);
      onLogin(payload);
    },
  });

  const cachedUser = sessionStorage.getItem('tourist-app.user');
  if (cachedUser) {
    const payload = JSON.parse(cachedUser);
    renderUser(payload);
    onLogin(payload);
  } else {
    window.google.accounts.id.renderButton(signinContainer, {
      theme: 'outline',
      size: 'medium',
    });
  }

  function renderUser(payload) {
    signinContainer.innerHTML = '';
    userInfoEl.classList.remove('hidden');
    userNameEl.textContent = payload.name || payload.email;
    userAvatarEl.src = payload.picture || '';
  }

  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('tourist-app.user');
    userInfoEl.classList.add('hidden');
    window.google.accounts.id.disableAutoSelect();
    window.google.accounts.id.renderButton(signinContainer, {
      theme: 'outline',
      size: 'medium',
    });
    onLogout();
  });
}
