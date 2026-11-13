export function watchTextures({ sections, apply, prepare, report, onChange }) {
  const watches = new Map();
  let polling = false;
  const clock = new Intl.DateTimeFormat('ru', { timeStyle: 'medium' });

  function reportWatch(slot, watch, state, detail) {
    const updated = watch.updatedAt ? ' · ' + clock.format(watch.updatedAt) : '';
    report(slot, watch.handle.name + updated + (detail ? ' · ' + detail : ''), state);
  }

  async function refresh(slot, watch) {
    try {
      const file = await watch.handle.getFile();
      if (watches.get(slot) !== watch) return;
      const version = file.lastModified + ':' + file.size;
      if (watch.version === version) {
        reportWatch(slot, watch, 'live');
        return;
      }
      const applied = await apply(file, slot, () => watches.get(slot) === watch);
      if (watches.get(slot) !== watch) return;
      if (applied) {
        watch.version = version;
        watch.updatedAt = new Date();
        reportWatch(slot, watch, 'live');
      }
    } catch (error) {
      if (watches.get(slot) === watch) {
        const detail = error.name === 'NotAllowedError'
          ? 'Доступ закрыт. Подключи файл заново.'
          : error.name === 'NotFoundError' || error.name === 'NotReadableError'
            ? 'Файл временно недоступен.'
            : error.message || 'Ошибка чтения файла.';
        reportWatch(slot, watch, 'error', detail);
      }
    }
  }

  async function poll() {
    if (polling || !watches.size) return;
    polling = true;
    try {
      for (const [slot, watch] of watches) await refresh(slot, watch);
    } finally {
      polling = false;
    }
  }

  async function chooseFile(slot) {
    if (!window.showOpenFilePicker) {
      report(slot, 'Для автообновления нужен Chrome или Edge.', 'error');
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Текстура', accept: {
          'image/vnd.adobe.photoshop': ['.psd'], 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp']
        } }]
      });
      try {
        await prepare(slot, handle);
      } catch (error) {
        report(slot, handle.name + ' · ' + error.message, 'error');
        return;
      }
      const watch = { handle };
      watches.set(slot, watch);
      onChange();
      reportWatch(slot, watch, 'pending', 'Подключаю…');
      await poll();
    } catch (error) {
      if (error.name !== 'AbortError') {
        report(slot, 'Не удалось подключить файл.', 'error');
      }
    }
  }
  for (const [slot, section] of Object.entries(sections)) {
    section.querySelector('[data-pick]').addEventListener('click', () => chooseFile(slot));
  }

  setInterval(poll, 750);
  window.addEventListener('focus', poll);
  return {
    has(slot) {
      return watches.has(slot);
    },
    stop(slot) {
      watches.delete(slot);
      report(slot, '');
    }
  };
}
