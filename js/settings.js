import { STORAGE_KEYS } from './config.js?v=20260708-4';
import { checkApiKeyFormat } from './validate.js?v=20260708-4';

export function loadSettings() {
  return {
    apiKey: localStorage.getItem(STORAGE_KEYS.API_KEY) || '',
  };
}

export function saveSettings({ apiKey }) {
  localStorage.setItem(STORAGE_KEYS.API_KEY, apiKey);
}

export function clearSettings() {
  localStorage.removeItem(STORAGE_KEYS.API_KEY);
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
    saveSettings({ apiKey: check.key });
    statusEl.textContent = check.level === 'warning' ? `保存しました。${check.message}` : '設定を保存しました。';
    statusEl.className = check.level === 'warning' ? 'status-msg' : 'status-msg success';
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
