import { STORAGE_KEYS } from './config.js?v=20260708-4';
import { checkApiKeyFormat } from './validate.js?v=20260708-4';
import { storageGet, storageSet, storageRemove } from './storage.js?v=20260708-4';

export function loadSettings() {
  return {
    apiKey: storageGet(STORAGE_KEYS.API_KEY) || '',
  };
}

// 戻り値: 端末に永続化できたか(false: プライベートブラウズ等。このタブを閉じると消える)
export function saveSettings({ apiKey }) {
  return storageSet(STORAGE_KEYS.API_KEY, apiKey);
}

export function clearSettings() {
  storageRemove(STORAGE_KEYS.API_KEY);
}

export function initSettingsPanel({ onSaved, onCleared }) {
  const apiKeyInput = document.getElementById('api-key-input');
  const saveBtn = document.getElementById('save-settings-btn');
  const clearBtn = document.getElementById('clear-settings-btn');
  const statusEl = document.getElementById('settings-status');
  const toggleApiKeyBtn = document.getElementById('toggle-api-key');

  const current = loadSettings();
  apiKeyInput.value = current.apiKey;

  toggleApiKeyBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleApiKeyBtn.textContent = isPassword ? '隠す' : '表示';
  });

  saveBtn.addEventListener('click', () => {
    const check = checkApiKeyFormat(apiKeyInput.value);
    if (!check.ok) {
      statusEl.textContent = check.message;
      statusEl.className = 'status-msg error';
      return;
    }
    const persisted = saveSettings({ apiKey: check.key });
    const notes = [];
    if (check.level === 'warning') notes.push(check.message);
    if (!persisted) notes.push('このブラウザでは端末に保存できません(プライベートブラウズ等)。このタブを閉じるとキーは消えます。');
    statusEl.textContent = ['設定を保存しました。', ...notes].join(' ');
    statusEl.className = notes.length ? 'status-msg' : 'status-msg success';
    onSaved({ apiKey: check.key });
  });

  clearBtn.addEventListener('click', () => {
    clearSettings();
    apiKeyInput.value = '';
    statusEl.textContent = '設定を削除しました。';
    statusEl.className = 'status-msg';
    onCleared();
  });

  return current;
}
