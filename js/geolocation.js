export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('このブラウザは位置情報取得に対応していません。'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        const messages = {
          1: '位置情報の利用が許可されていません。ブラウザの設定を確認してください。',
          2: '現在地を取得できませんでした。',
          3: '現在地の取得がタイムアウトしました。',
        };
        reject(new Error(messages[error.code] || '現在地の取得に失敗しました。'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}
