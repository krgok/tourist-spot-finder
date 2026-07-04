import { STORAGE_KEYS } from './config.js';

export function loadSettings() {
  return {
    apiKey: localStorage.getItem(STORAGE_KEYS.API_KEY) || '',
    clientId: localStorage.getItem(STORAGE_KEYS.CLIENT_ID) || '',
  };
}

export function saveSettings({ apiKey, clientId }) {
  localStorage.setItem(STORAGE_KEYS.API_KEY, apiKey);
  localStorage.setItem(STORAGE_KEYS.CLIENT_ID, clientId);
}

export function clearSettings() {
  localStorage.removeItem(STORAGE_KEYS.API_KEY);
  localStorage.removeItem(STORAGE_KEYS.CLIENT_ID);
}

export function initSettingsPanel({ onSaved, onCleared }) {
  const apiKeyInput = document.getElementById('api-key-input');
  const clientIdInput = document.getElementById('client-id-input');
  const saveBtn = document.getElementById('save-settings-btn');
  const clearBtn = document.getElementById('clear-settings-btn');
  const statusEl = document.getElementById('settings-status');
  const toggleApiKeyBtn = document.getElementById('toggle-api-key');
  const toggleClientIdBtn = document.getElementById('toggle-client-id');

  const current = loadSettings();
  apiKeyInput.value = current.apiKey;
  clientIdInput.value = current.clientId;

  const setToggle = (input, btn) => {
    btn.addEventListener('click', () => {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.textContent = isPassword ? '隠す' : '表示';
    });
  };
  setToggle(apiKeyInput, toggleApiKeyBtn);
  setToggle(clientIdInput, toggleClientIdBtn);

  saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const clientId = clientIdInput.value.trim();
    saveSettings({ apiKey, clientId });
    statusEl.textContent = '設定を保存しました。';
    statusEl.className = 'status-msg success';
    onSaved({ apiKey, clientId });
  });

  clearBtn.addEventListener('click', () => {
    clearSettings();
    apiKeyInput.value = '';
    clientIdInput.value = '';
    statusEl.textContent = '設定を削除しました。';
    statusEl.className = 'status-msg';
    onCleared();
  });

  return current;
}
