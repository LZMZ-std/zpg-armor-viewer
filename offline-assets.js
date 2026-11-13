const pending = new Map();
let nextAssetId = 0;

// Classic scripts can load alongside a local HTML file. Each contains one asset.
globalThis.receiveArmorAsset = (id, data) => {
  pending.get(id)?.(data);
};

export function loadArmorAsset(path) {
  return new Promise((resolve, reject) => {
    const id = String(++nextAssetId);
    const script = document.createElement('script');
    function cleanup() {
      pending.delete(id);
      script.remove();
    }
    pending.set(id, data => {
      cleanup();
      resolve(data);
    });
    script.onload = script.onerror = () => {
      cleanup();
      reject(new Error('Ресурс недоступен: ' + path));
    };
    script.dataset.assetId = id;
    script.src = path + '.asset.js';
    document.head.append(script);
  });
}
