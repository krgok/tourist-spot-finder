const MESSAGES = {
  1: '位置情報の利用が許可されていません。ブラウザのアドレスバー付近の鍵/設定アイコンから位置情報を「許可」にするか、「場所を指定」で地名を入力してください。',
  2: '現在地を取得できませんでした。屋内や電波の弱い場所では取得できないことがあります。「場所を指定」で地名を入力することもできます。',
  3: '現在地の取得がタイムアウトしました。もう一度お試しいただくか、「場所を指定」で地名を入力してください。',
};

export function geolocationErrorMessage(code) {
  return MESSAGES[code] || '現在地の取得に失敗しました。';
}

function request(geo, options) {
  return new Promise((resolve, reject) => {
    geo.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) => reject(error),
      options
    );
  });
}

// まず高精度で取得し、「取得不可/タイムアウト」のときだけ低精度(Wi-Fi・基地局)で1回やり直す。
// 許可されていない場合(code 1)はやり直さない。以前は高精度だけで10秒待って失敗していた
// (PC や屋内では高精度の取得が成功しないことが多い)。
export async function getCurrentPosition({ geo = globalThis.navigator?.geolocation } = {}) {
  if (!geo) throw new Error('このブラウザは位置情報取得に対応していません。「場所を指定」で地名を入力してください。');

  try {
    return await request(geo, { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
  } catch (error) {
    if (error?.code === 2 || error?.code === 3) {
      try {
        return await request(geo, { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 });
      } catch (retryError) {
        throw new Error(geolocationErrorMessage(retryError?.code));
      }
    }
    throw new Error(geolocationErrorMessage(error?.code));
  }
}
