import { loadArmorAsset } from './offline-assets.js';
import { watchTextures } from './live-textures.js';
import catalogData from './content/armor-catalog.json';
import * as THREE from './assets/vendor/three/three.module.js';
import { OrbitControls } from './assets/vendor/three/OrbitControls.js';
import { readPsdComposite } from './psd-composite.js';
import { listProjects, loadProject, saveProject } from './project-store.js';

const panel = document.getElementById('armor-view');
const slots = { helmet: 'Шлем', visor: 'Визор', nvg: 'ПНВ / NVG', upper: 'Верх', vest: 'Жилет', lower: 'Низ', backpack: 'Рюкзак' };
const isVisor = slot => /visor|glass/i.test(slot);
const initialModels = {
  helmet: 'QS_0th_P2_V1_H', upper: 'QS_0th_P2_V1_A', backpack: 'QS_0th_L_V1_B', vest: '', nvg: ''
};
const toolbarIcon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const fullscreenIcon = toolbarIcon('<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>');
const exitFullscreenIcon = toolbarIcon('<path d="M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5"/>');
const viewDirections = {
  perspective: ['3D-вид', [1.7, .38, 3.1]],
  front: ['Спереди', [0, 0, 4]],
  right: ['Справа', [4, 0, 0]],
  left: ['Слева', [-4, 0, 0]],
  top: ['Сверху', [0, 4, 0]],
  back: ['Сзади', [0, 0, -4]],
  bottom: ['Снизу', [0, -4, 0]]
};
const quadViews = ['front', 'right', 'left', 'top'].map(direction => ({
  direction,
  target: new THREE.Vector3(0, 1, 0),
  camera: new THREE.OrthographicCamera(-1, 1, 1, -1, .005, 100)
}));
let quadMode = false;
let quadInitialized = false;
const orientationField = `
  <label class="armor-field"><span>Ориентация текстуры</span>
    <select id="armor-helmet-orientation">
      <option value="normal">Как в файле</option>
      <option value="vertical">Отразить верх и низ</option>
      <option value="horizontal">Отразить лево и право</option>
      <option value="rotate">Повернуть на 180°</option>
    </select>
  </label>`;

function textureSection(slot, label) {
  return `<section class="armor-control-group armor-custom" id="armor-slot-${slot}" data-slot="${slot}" hidden>
    <h2 class="armor-control-title">${label}</h2>
    <button class="armor-focus-button" type="button" data-focus="${slot}" disabled aria-label="${label} крупным планом">Крупно</button>
    <button class="armor-isolate-button" type="button" data-isolate="${slot}" aria-pressed="false" disabled>Изолировать · I</button>
    ${slot === 'lower'
      ? '<p class="armor-note">Модель верха и низа выбирается в блоке «Верх».</p>'
      : slot === 'visor'
        ? '<p class="armor-note" id="armor-visor-note"></p>'
        : `<label class="armor-field"><span>Поиск модели</span><input type="search" data-model-search placeholder="Название или ID" disabled></label>
           <label class="armor-field"><span>Модель</span><select data-model disabled></select></label>
           <p class="armor-note" data-model-results></p>`}
    <div class="armor-mesh-name" data-mesh-name hidden>
      <label class="armor-field"><span>Имя модели (.p3d)</span><input data-mesh-id readonly spellcheck="false"></label>
      <button type="button" data-copy-mesh>Копировать</button>
    </div>
    ${slot === 'helmet' ? orientationField : ''}
    ${slot === 'nvg' ? '<label class="armor-switch" id="armor-nvg-position" hidden>Опустить ПНВ<input id="armor-nvg-down" type="checkbox" disabled></label>' : ''}
    ${slot === 'helmet' ? '<label class="armor-note"><input type="checkbox" id="armor-helmet-original"> Показать штатную текстуру</label>' : ''}
    <div class="armor-texture-controls">
      <h3>Текстура</h3>
      <div class="armor-texture-downloads" data-downloads hidden></div>
      <div class="armor-texture-actions">
        <button type="button" data-pick disabled>Подключить Live</button>
        <button type="button" data-reset disabled>Сбросить</button>
      </div>
      <p class="armor-note" data-status role="status"></p>
      <p class="armor-note">PSD, PNG, JPG, WebP</p>
    </div>
  </section>`;
}
panel.innerHTML = `
  <header class="armor-heading">
    <h1 class="armor-wordmark" aria-label="ZPG Armor Viewer">ZPG</h1>
  </header>
  <div class="armor-stage">
      <canvas class="armor-canvas" tabindex="0" aria-label="3D-модель брони. Нажми на деталь для настройки. Стрелки вращают модель, плюс и минус меняют масштаб, Home сбрасывает ракурс."></canvas>
      <div class="armor-quad" hidden>
        ${quadViews.map(({ direction }, index) => `<div class="armor-quad-pane">
          <select data-quad-view="${index}" aria-label="Вид в окне ${index + 1}">
            ${Object.entries(viewDirections).map(([value, [label]]) => `<option value="${value}" ${value === direction ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>`).join('')}
      </div>
      <div class="armor-status" role="status">Загрузка модели…</div>
      <div class="armor-viewport-label"><span aria-hidden="true"></span> 3D-просмотр</div>
      <div class="armor-camera-tools" aria-label="Инструменты просмотра">
        <button type="button" id="armor-project-open" title="Проекты" aria-label="Проекты" disabled>${toolbarIcon('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>')}</button>
        <button type="button" id="armor-parts-toggle" title="Детали" aria-label="Детали" aria-expanded="false" aria-controls="armor-parts-panel">${toolbarIcon('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>')}</button>
        <button type="button" data-camera="reset" title="Весь комплект" aria-label="Весь комплект">${toolbarIcon('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5m-4-14 4 2.3v5.4L12 17l-4-2.3V9.3L12 7Zm-4 2.3 4 2.3 4-2.3m-4 2.3V17"/>')}</button>
        <button type="button" id="armor-quad-toggle" title="Четыре вида" aria-label="Четыре вида" aria-pressed="false">${toolbarIcon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/>')}</button>
        <button type="button" id="armor-end-isolation" title="Вернуть весь комплект (I)" aria-label="Вернуть весь комплект" hidden>${toolbarIcon('<path d="M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4"/><circle cx="12" cy="12" r="3"/>')}</button>
        <button type="button" id="armor-fullscreen" title="На весь экран" aria-label="На весь экран" aria-pressed="false">${fullscreenIcon}</button>
      </div>
      <p class="armor-overlay-message armor-note" id="armor-message" role="status"></p>
      <aside class="armor-detail-panel" id="armor-parts-panel" aria-label="Настройки деталей" hidden>
        <button type="button" class="armor-close-panel" aria-label="Закрыть настройки">×</button>
        <section class="armor-control-group" id="armor-parts-list" hidden>
          <h2 class="armor-control-title">Детали комплекта</h2>
          <nav class="armor-slot-nav" aria-label="Детали комплекта">
            ${Object.entries(slots).map(([slot, label]) => `<button type="button" data-jump="${slot}"><span>${label}</span><small data-live-summary="${slot}">Файл не подключён</small></button>`).join('')}
          </nav>
          <label class="armor-field"><span>Освещение</span>
          <select id="armor-light-temperature">
            <option value="neutral">Нейтральное</option>
            <option value="warm">Тёплое</option>
            <option value="cool">Холодное</option>
          </select>
          </label>
        </section>
        ${Object.entries(slots).map(([slot, label]) => textureSection(slot, label)).join('')}
      </aside>
      <dialog id="armor-projects" class="armor-projects" aria-labelledby="armor-project-title">
        <h2 id="armor-project-title">Проекты</h2>
        <button class="armor-close-panel" id="armor-project-close" type="button" aria-label="Закрыть проекты">×</button>
        <label class="armor-field"><span>Сохранённый проект</span><select id="armor-project-list"></select></label>
        <button type="button" id="armor-project-load">Открыть</button>
        <form id="armor-project-save">
          <label class="armor-field"><span>Название проекта</span><input id="armor-project-name" maxlength="80" required></label>
          <button type="submit">Сохранить</button>
        </form>
        <p class="armor-note" id="armor-project-status" role="status"></p>
        <div id="armor-project-relinks"></div>
      </dialog>
  </div>
  <footer class="armor-shortcuts" aria-label="Управление моделью">
    <span><kbd>ЛКМ</kbd> Вращение</span>
    <span><kbd>Колесо</kbd> Масштаб</span>
    <span><kbd>ПКМ</kbd> Смещение</span>
    <span class="armor-click-hint">Клик по детали открывает настройки</span>
  </footer>`;

const $ = s => panel.querySelector(s);
let ready = false;
let selectedSlot = null;
let isolatedSlot = null;
let renderer, scene, camera, controls, body, helmet, backpack, vest, nvg, keyLight, fillLight;
let raf = 0;
const catalog = catalogData;
const meshCache = new Map();
const textureCache = new Map();
const customTextures = new Map();
const stage = $('.armor-stage');
const canvas = $('canvas');
const status = $('.armor-status');
const textureLoader = new THREE.TextureLoader();
const visible = () => !document.hidden;
const sections = Object.fromEntries(Object.keys(slots).map(slot => [slot, $(`[data-slot="${slot}"]`)]));
function slotStatus(slot, text, state = 'idle') {
  const status = sections[slot].querySelector('[data-status]');
  const summary = $(`[data-live-summary="${slot}"]`);
  if (status.textContent === text && summary.dataset.state === state) return;
  status.textContent = text;
  summary.textContent = text || 'Файл не подключён';
  summary.dataset.state = state;
}
const message = text => { $('#armor-message').textContent = text; };

async function getTexture(url) {
  if(!url) return null;
  if(!textureCache.has(url)) textureCache.set(url, loadArmorAsset(url).then(data => textureLoader.loadAsync(data)).then(t=>{
    t.colorSpace=THREE.SRGBColorSpace; t.flipY=false; t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    t.name = url.split('/').pop();
    t.wrapS=t.wrapT=THREE.RepeatWrapping; return t;
  }).catch(error=>{textureCache.delete(url);throw error;}));
  return textureCache.get(url);
}
async function geometry(id) {
  if(!meshCache.has(id)) meshCache.set(id,(async()=>{
    const def = catalog.meshes[id];
    const encoded = await loadArmorAsset(def.url);
    const bin = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)).buffer;
    return def.groups.map(group=>{
      const g=new THREE.BufferGeometry();
      for(const [field,name,size] of [['positions','position',3],['normals','normal',3],['uv','uv',2]]) {
        const a=group[field];g.setAttribute(name,new THREE.BufferAttribute(new Float32Array(bin,a.offset,a.length),size));
      }
      if(group.arms){const a=group.arms;g.setAttribute('arms',new THREE.BufferAttribute(new Float32Array(bin,a.offset,a.length),4));}
      g.computeBoundingBox();g.computeBoundingSphere();return {geometry:g,slot:group.slot,selections:group.selections||[],defaultMap:group.defaultMap};
    });
  })().catch(error=>{meshCache.delete(id);throw error;}));
  return meshCache.get(id);
}
function buildPart(parts, kind, maps) {
  const group=new THREE.Group();group.userData.kind=kind;
  parts.forEach((part,i)=>{
    let slot=part.slot, map;
    if (maps.defaults) {
      map = maps.defaults[i];
      const selections = part.selections.map(name => name.toLowerCase());
      if (kind === 'body') {
        if (selections.includes('camo2') || /camo2|lower|legs/.test(slot)) slot = 'camo2';
        else if (selections.includes('camo1') || !/undersuit|bodyglove/.test(slot)) slot = 'camo1';
      } else if (selections.some(isVisor)) slot = 'visor';
    } else if(kind==='body') map=slot==='camo1'?maps.upper:slot==='camo2'?maps.lower:maps.undersuit;
    else map=isVisor(slot)?maps.visor:/flap|camo2/.test(slot)?maps.flaps:/illum|light/.test(slot)?maps.light:maps.main;
    const mat=new THREE.MeshStandardMaterial({map, color:map?0xffffff:kind==='body'?0x17212a:0xe6e8e9,roughness:/visor|glass/.test(slot)?.22:.64,metalness:/visor|glass/.test(slot)?.3:.08,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(kind==='body'?part.geometry.clone():part.geometry,mat);mesh.userData.slot=slot; mesh.userData.originalMap=map;
    mesh.userData.originalColor = mat.color.clone();
    mesh.castShadow=true;mesh.receiveShadow=false;
    if(kind==='body')mesh.userData.restGeometry=part.geometry;
    if(kind==='helmet'&&/flap|camo2/.test(slot)&&!maps.defaults&&!maps.flaps&&!maps.keepFlaps)mesh.visible=false;
    mesh.userData.initialVisibility = mesh.visible;
    group.add(mesh);
  });
  // The game uses a hip-centered origin; both models share the same frame.
  group.position.y=1.008694;group.rotation.y=Math.PI;
  return group;
}
function applyPose(){
  for (const part of [body, vest]) part?.traverse(mesh=>{
    const rest=mesh.userData.restGeometry;if(!rest)return;
    const source=rest.attributes.position, normal=rest.attributes.normal, weights=rest.attributes.arms;
    const position=mesh.geometry.attributes.position, normals=mesh.geometry.attributes.normal;
    for(let i=0;i<source.count;i++){
      const x=source.getX(i),y=source.getY(i),z=source.getZ(i),sign=x>=0?1:-1;
      const weight=weights?Math.min(1,weights.getX(i)+weights.getY(i)):0;
      const degrees = sign > 0 ? 29 : 33;
      const a=-sign*degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a),px=sign*.205,py=.425;
      const tx=px+(x-px)*c-(y-py)*s,ty=py+(x-px)*s+(y-py)*c;
      const nx=normal.getX(i),ny=normal.getY(i),nz=normal.getZ(i);
      const ox=x+(tx-x)*weight,oy=y+(ty-y)*weight,oz=z;
      const onx=nx+(nx*c-ny*s-nx)*weight,ony=ny+(nx*s+ny*c-ny)*weight;
      position.setXYZ(i,ox,oy,oz);
      const n=new THREE.Vector3(onx,ony,nz).normalize();normals.setXYZ(i,n.x,n.y,n.z);
    }
    position.needsUpdate=true;normals.needsUpdate=true;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
  });render();
}

async function buildAccessory(slot, definition, model = definition?.model) {
  if (!definition) return null;
  const parts = await geometry(model);
  const maps = await Promise.all(definition.maps.map(getTexture));
  const defaults = await Promise.all(parts.map(part => getTexture(part.defaultMap)));
  const group = new THREE.Group();
  group.userData.uvLayout = slot === 'nvg' ? definition.id : model;
  for (const [index, part] of parts.entries()) {
    const selection = part.selections.find(name => definition.slots.includes(name));
    const mapIndex = selection ? definition.slots.indexOf(selection) : -1;
    const useModelMaterial = definition.useModelMaterial?.includes(mapIndex);
    const map = mapIndex >= 0 && !useModelMaterial ? maps[mapIndex] : defaults[index];
    if (mapIndex >= 0 && !map && !useModelMaterial) continue;
    const material = new THREE.MeshStandardMaterial({
      map, color: map ? 0xffffff : 0x4e5962, roughness: .83, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(slot === 'vest' ? part.geometry.clone() : part.geometry, material);
    if (slot === 'vest') mesh.userData.restGeometry = part.geometry;
    mesh.userData.originalMap = map;
    mesh.userData.originalColor = material.color.clone();
    mesh.userData.slot = selection || part.slot;
    group.add(mesh);
  }
  group.position.y = 1.008694;
  group.rotation.y = Math.PI;
  if (model === 'ls_gar_standard_backpack_old') {
    group.position.set(.00036105514, 1.008694 - .8231988, .42156324);
  } else if (model === 'lsd_gar_artilleryGunner_nvg') {
    group.position.set(.0011840984, 1.008694 - .8689626, -.016598642);
  }
  return group;
}

const modelLists = {
  helmet: catalog.helmets, upper: catalog.bodies, backpack: catalog.backpacks,
  vest: catalog.vests, nvg: catalog.nvgs
};
const modelInputs = Object.fromEntries(Object.keys(modelLists).map(slot => [slot, sections[slot].querySelector('[data-model]')]));
const modelSearches = Object.fromEntries(Object.keys(modelLists).map(slot => [slot, sections[slot].querySelector('[data-model-search]')]));
let selectedModels = { ...initialModels };
const nvgDownInput = $('#armor-nvg-down');
let nvgDown = false;
let modelChanges = 0;
let applyingProject = false;

async function buildModel(slot, id, lowered) {
  const item = modelLists[slot].find(entry => entry.id === id);
  if (slot === 'backpack' || slot === 'vest') return buildAccessory(slot, item);
  if (slot === 'nvg') return buildAccessory(slot, item, lowered ? item?.model : item?.offModel ?? item?.model);
  if (item.useMeshMaterials) {
    const parts = await geometry(item.model);
    const defaults = await Promise.all(parts.map(part => getTexture(part.defaultMap)));
    const group = buildPart(parts, slot === 'upper' ? 'body' : 'helmet', { defaults });
    group.userData.uvLayout = item.model;
    if (slot === 'helmet') {
      const main = group.children.find(mesh => !/visor|glass|flap|camo2|illum|light/i.test(mesh.userData.slot));
      const visor = group.children.find(mesh => isVisor(mesh.userData.slot));
      group.userData.primaryMap = main?.material.map;
      group.userData.template = main?.material.map?.image;
      group.userData.hasVisor = Boolean(visor);
      group.userData.visorTemplate = visor?.material.map?.image;
    }
    return group;
  }
  if (slot === 'upper') {
    const [parts, upper, lower, undersuit] = await Promise.all([
      geometry(item.model || catalog.bodyModel), getTexture(item.upper), getTexture(item.lower), getTexture(catalog.undersuit)
    ]);
    const group = buildPart(parts, 'body', { upper, lower, undersuit });
    group.userData.uvLayout = item.model || catalog.bodyModel;
    return group;
  }
  const mapFor = pattern => item.maps[item.slots.findIndex(name => pattern.test(name))];
  const parts = await geometry(item.model);
  const defaultFor = pattern => parts.find(part => pattern.test(part.slot) && part.defaultMap)?.defaultMap;
  const mainUrl = item.maps[0] || defaultFor(/^(helmet|camo1)$/i);
  const flapIndex = item.slots.findIndex(name => /flap|camo2/i.test(name));
  const keepFlaps = item.useModelMaterial?.includes(flapIndex);
  const flapUrl = item.maps[flapIndex] || (keepFlaps ? defaultFor(/flap|camo2/i) : null);
  const visorUrl = mapFor(/visor|glass/i) || defaultFor(/visor|glass/i) || catalog.visor;
  const [main, visor, flaps, light] = await Promise.all([
    getTexture(mainUrl), getTexture(visorUrl),
    getTexture(flapUrl), getTexture(mapFor(/illum|light/i))
  ]);
  const group = buildPart(parts, 'helmet', { main, visor, flaps, light, keepFlaps });
  group.userData.uvLayout = item.model;
  group.userData.primaryMap = main;
  group.userData.template = main?.image;
  group.userData.hasVisor = parts.some(part => isVisor(part.slot));
  group.userData.visorTemplate = visor?.image;
  return group;
}

function updateSlotControls() {
  for (const [slot, section] of Object.entries(sections)) {
    section.querySelector('[data-pick]').disabled = !ready || !partFor(slot);
    section.querySelector('[data-focus]').disabled = !ready || !partFor(slot);
    section.querySelector('[data-isolate]').disabled = !ready || !partFor(slot);
    section.querySelector('[data-reset]').disabled = !ready || (!customTextures.has(slot) && !liveTextures.has(slot));
    const meshId = meshIdFor(slot);
    const nameField = section.querySelector('[data-mesh-name]');
    const nameInput = nameField.querySelector('[data-mesh-id]');
    if (nameInput.value !== meshId) nameInput.value = meshId;
    nameField.hidden = !meshId;
  }
  $('#armor-visor-note').textContent = helmet?.userData.hasVisor
    ? 'Подключи отдельную текстуру визора.'
    : 'У выбранного шлема визор входит в общую текстуру. Подключи файл в разделе «Шлем».';
}

function meshIdFor(slot) {
  const modelSlot = slot === 'lower' ? 'upper' : slot === 'visor' ? 'helmet' : slot;
  const model = modelLists[modelSlot].find(item => item.id === selectedModels[modelSlot]);
  if (!model || !partFor(slot)) return '';
  if (slot === 'nvg' && !nvgDown && model.offModel) return model.offModel;
  return model.model || (modelSlot === 'upper' ? catalog.bodyModel : '');
}

async function changeModel(slot, id, lowered = false) {
  const input = modelInputs[slot];
  modelChanges++;
  $('#armor-project-open').disabled = true;
  input.disabled = true;
  modelSearches[slot].disabled = true;
  if (slot === 'nvg') nvgDownInput.disabled = true;
  try {
    const next = await buildModel(slot, id, lowered);
    const previous = partFor(slot);
    const affectedSlots = slot === 'upper' ? ['upper', 'lower']
      : slot === 'helmet' ? ['helmet', 'visor'] : [slot];
    if (previous && previous.userData.uvLayout !== next?.userData.uvLayout) {
      if (slot === 'helmet') $('#armor-helmet-orientation').value = 'normal';
      for (const affected of affectedSlots) {
        if (!liveTextures.has(affected) && !customTextures.has(affected)) continue;
        liveTextures.stop(affected);
        customTextures.get(affected)?.dispose();
        customTextures.delete(affected);
        slotStatus(affected, 'Развёртка изменилась. Подключи текстуру для выбранной модели.', 'error');
      }
    }
    if (previous) {
      scene.remove(previous);
      previous.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.material.dispose();
        if (mesh.userData.restGeometry) mesh.geometry.dispose();
      });
    }
    if (slot === 'helmet') helmet = next;
    else if (slot === 'backpack') backpack = next;
    else if (slot === 'vest') vest = next;
    else if (slot === 'nvg') {
      nvg = next;
      nvgDown = lowered;
    }
    else body = next;
    selectedModels[slot] = id;
    if (next) scene.add(next);
    if (!partFor(isolatedSlot)) isolatedSlot = null;
    updateIsolation();
    affectedSlots.forEach(updateTextureDownloads);
    if (slot === 'upper' || slot === 'vest') applyPose();
    for (const affected of affectedSlots) {
      const texture = customTextures.get(affected);
      if (texture) setSlotTexture(affected, texture);
    }
    if (ready && !applyingProject) cameraView(next ? slot : 'reset');
    message('');
    return true;
  } catch (error) {
    input.value = selectedModels[slot];
    if (!ready) throw error;
    message('Не удалось открыть выбранную модель.');
    console.error(error);
    return false;
  } finally {
    modelChanges--;
    $('#armor-project-open').disabled = !ready || modelChanges > 0;
    input.disabled = !ready;
    modelSearches[slot].disabled = !ready;
    filterModels(slot);
    if (slot === 'nvg') {
      const item = modelLists.nvg.find(entry => entry.id === selectedModels.nvg);
      const hasPositions = Boolean(item?.offModel && item.model !== item.offModel);
      $('#armor-nvg-position').hidden = !hasPositions;
      nvgDownInput.disabled = !ready || !hasPositions;
      nvgDownInput.checked = nvgDown;
    }
    updateSlotControls();
  }
}

function filterModels(slot) {
  const input = modelInputs[slot];
  const terms = modelSearches[slot].value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = modelLists[slot].filter(item => {
    const label = `${item.name} ${item.id} ${item.model}`.toLowerCase();
    return terms.every(term => label.includes(term));
  });
  const selected = selectedModels[slot];
  const options = matches.map(item => new Option(item.name, item.id));
  const current = modelLists[slot].find(item => item.id === selected);
  if (current && !matches.includes(current)) options.unshift(new Option(current.name + ' (выбрано)', current.id));
  const emptyLabel = { backpack: 'Без рюкзака', vest: 'Без жилета', nvg: 'Без ПНВ' }[slot];
  if (emptyLabel) options.unshift(new Option(emptyLabel, ''));
  input.replaceChildren(...options);
  input.value = selected;
  sections[slot].querySelector('[data-model-results]').textContent = !terms.length ? ''
    : matches.length ? 'Найдено: ' + matches.length : 'Совпадений нет.';
}

async function loadOutfit() {
  for (const [slot, input] of Object.entries(modelInputs)) {
    filterModels(slot);
    modelSearches[slot].addEventListener('input', () => filterModels(slot));
    input.addEventListener('change', () => changeModel(slot, input.value));
  }
  await Promise.all(Object.keys(modelInputs).map(slot => changeModel(slot, selectedModels[slot])));
}

function updateQuadCamera(view, aspect) {
  if (view.camera.isPerspectiveCamera) {
    view.camera.aspect = aspect;
  } else {
    const span = 1.15 / Math.min(1, aspect);
    Object.assign(view.camera, { left: -span * aspect, right: span * aspect, top: span, bottom: -span });
  }
  view.camera.updateProjectionMatrix();
}

function resetQuadCamera(view) {
  view.target.set(0, 1, 0);
  view.camera.zoom = 1;
  const [, offset] = viewDirections[view.direction];
  view.camera.position.copy(view.target).add(new THREE.Vector3(...offset));
  const vertical = view.direction === 'top' || view.direction === 'bottom';
  view.camera.up.set(0, vertical ? 0 : 1, vertical ? -Math.sign(offset[1]) : 0);
  view.camera.lookAt(view.target);
  updateQuadCamera(view, camera.aspect);
}

function render() {
  if (!renderer || !visible() || raf) return;
  raf = requestAnimationFrame(() => {
    // A control change during this frame is included in the draw below.
    const moving = ready && !quadMode && controls.update();
    raf = 0;
    drawFrame();
    if (moving) render();
  });
}

function drawFrame() {
  if (!renderer || !visible()) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  if (!quadMode) {
    renderer.setViewport(0, 0, width, height);
    renderer.render(scene, camera);
    return;
  }
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  renderer.setScissorTest(true);
  quadViews.forEach((view, index) => {
    const x = index % 2 * halfWidth;
    const y = index < 2 ? halfHeight : 0;
    renderer.setViewport(x, y, halfWidth, halfHeight);
    renderer.setScissor(x, y, halfWidth, halfHeight);
    renderer.render(scene, view.camera);
  });
  renderer.setScissorTest(false);
}

function resize() {
  if (!renderer || !visible()) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  quadViews.forEach(view => updateQuadCamera(view, camera.aspect));
  render();
}

function paneAt(event) {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  let x = (event.clientX - bounds.left) / bounds.width;
  let y = (event.clientY - bounds.top) / bounds.height;
  if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
  let view;
  if (quadMode) {
    const column = Math.floor(x * 2);
    const row = Math.floor(y * 2);
    view = quadViews[row * 2 + column];
    x = x * 2 - column;
    y = y * 2 - row;
  }
  return { x, y, view };
}

function setQuadMode(active) {
  if (active && !quadInitialized) {
    quadViews.forEach(resetQuadCamera);
    quadInitialized = true;
  }
  quadMode = active;
  $('.armor-quad').hidden = !active;
  $('#armor-quad-toggle').setAttribute('aria-pressed', String(active));
  controls.enabled = !active;
  resize();
}
function cancelFrame() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}
function cameraView(view){
  if(!camera)return;
  controls.target.set(0,1,0);
  const distance=camera.aspect<.9?4.4:3.5;
  if(view==='head'||view==='helmet'||view==='visor'||view==='nvg'){controls.target.set(0,1.73,0);camera.position.set(.16,1.78,1.05);}
  else if(view==='vest'||view==='upper'){controls.target.set(0,1.26,0);camera.position.set(.25,1.33,1.5);}
  else if(view==='lower'){controls.target.set(0,.62,0);camera.position.set(.26,.74,1.75);}
  else if(view==='backpack'){controls.target.set(0,1.27,0);camera.position.set(-.24,1.35,-1.55);}
  else if(view==='back')camera.position.set(0,1.3,-distance);
  else if(view==='front')camera.position.set(0,1.3,distance);
  else camera.position.set(distance*.48,1.38,distance*.86);
  controls.update();render();
  panel.querySelectorAll('[data-camera]').forEach(b=>{if(b.dataset.camera!=='full')b.setAttribute('aria-pressed',String(b.dataset.camera===view));});
}
$('#armor-quad-toggle').addEventListener('click', () => {
  if (ready) setQuadMode(!quadMode);
});
panel.querySelectorAll('[data-quad-view]').forEach(input => {
  input.addEventListener('change', () => {
    const view = quadViews[Number(input.dataset.quadView)];
    view.direction = input.value;
    view.camera = input.value === 'perspective'
      ? new THREE.PerspectiveCamera(37, camera.aspect, .005, 100)
      : new THREE.OrthographicCamera(-1, 1, 1, -1, .005, 100);
    resetQuadCamera(view);
    render();
  });
});
canvas.addEventListener('wheel', event => {
  if (!quadMode) return;
  event.preventDefault();
  const view = paneAt(event)?.view;
  if (!view) return;
  view.camera.zoom = THREE.MathUtils.clamp(view.camera.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), .65, 8);
  view.camera.updateProjectionMatrix();
  render();
}, { passive: false });
function setLighting() {
  const colors = {
    neutral: [0xffffff, 0xf1f4ff],
    warm: [0xffc995, 0xffe2ba],
    cool: [0xc6e2ff, 0xa2caff]
  };
  const [key, fill] = colors[$('#armor-light-temperature').value];
  keyLight.color.setHex(key);
  fillLight.color.setHex(fill);
  render();
}

async function boot() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(getComputedStyle(stage).getPropertyValue('--viewport').trim());
    camera = new THREE.PerspectiveCamera(37, 1, .005, 100);
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = .085;
    controls.minDistance = .16;
    controls.maxDistance = 7;
    controls.addEventListener('change', render);

    const ambient = new THREE.HemisphereLight(0xf2f5ff, 0x52555a, .95);
    keyLight = new THREE.DirectionalLight(0xffffff, 3.3);
    keyLight.position.set(3, 4, 4);
    fillLight = new THREE.DirectionalLight(0xf1f4ff, 1.6);
    fillLight.position.set(-3, 2, 1);
    const rim = new THREE.DirectionalLight(0xffffff, 2);
    rim.position.set(1, 3, -3);
    scene.add(ambient, keyLight, fillLight, rim);

    resize();
    cameraView('reset');
    setLighting();
    await loadOutfit();
    ready = true;
    status.hidden = true;
    for (const input of [...Object.values(modelInputs), ...Object.values(modelSearches)]) input.disabled = false;
    $('#armor-project-open').disabled = false;
    updateSlotControls();
    render();
  } catch (error) {
    status.textContent = /WebGL/i.test(error.message)
      ? 'Не удалось запустить WebGL 2.'
      : 'Не удалось открыть модель. Проверь, что папка assets находится рядом с HTML.';
    console.error(error);
  }
}

$('#armor-light-temperature').addEventListener('change', () => {
  if (keyLight) setLighting();
});
panel.querySelectorAll('[data-camera]').forEach(button => {
  button.addEventListener('click', () => {
    if (quadMode) {
      quadViews.forEach(resetQuadCamera);
      resize();
    }
    cameraView(button.dataset.camera);
  });
});
nvgDownInput.addEventListener('change', () => changeModel('nvg', selectedModels.nvg, nvgDownInput.checked));
panel.querySelectorAll('[data-focus]').forEach(button => {
  button.addEventListener('click', () => focusPart(button.dataset.focus));
});
panel.querySelectorAll('[data-isolate]').forEach(button => {
  button.addEventListener('click', () => toggleIsolation(button.dataset.isolate));
});
$('#armor-end-isolation').addEventListener('click', () => toggleIsolation(isolatedSlot));

function focusPart(slot) {
  if (!ready || !slot || !partFor(slot)) return;
  if (quadMode) setQuadMode(false);
  cameraView(slot);
}

function updateIsolation() {
  const target = isolatedSlot ? partFor(isolatedSlot) : null;
  for (const part of [body, helmet, backpack, vest, nvg].filter(Boolean)) {
    part.visible = !target || target === part;
  }
  body?.traverse(mesh => {
    if (!mesh.isMesh) return;
    const material = mesh.userData.slot;
    mesh.visible = target !== body ||
      material === (isolatedSlot === 'lower' ? 'camo2' : 'camo1');
  });
  for (const mesh of helmet?.children ?? []) {
    if (isVisor(mesh.userData.slot)) mesh.visible = true;
    else if (mesh.isMesh) mesh.visible = mesh.userData.initialVisibility && isolatedSlot !== 'visor';
  }
  for (const [slot, section] of Object.entries(sections)) {
    const button = section.querySelector('[data-isolate]');
    button.setAttribute('aria-pressed', String(isolatedSlot === slot));
    button.textContent = isolatedSlot === slot ? 'Вернуть комплект · I' : 'Изолировать · I';
  }
  $('#armor-end-isolation').hidden = !isolatedSlot;
}

function toggleIsolation(slot) {
  if (!ready || !slot || !partFor(slot)) return;
  isolatedSlot = isolatedSlot === slot ? null : slot;
  updateIsolation();
  render();
}

window.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
      event.target.closest?.('input, select, textarea, [contenteditable]')) return;
  if (event.code === 'KeyI') toggleIsolation(isolatedSlot || selectedSlot);
  else if (event.code === 'KeyF') focusPart(selectedSlot || isolatedSlot);
  else return;
  event.preventDefault();
});
const detailPanel = $('#armor-parts-panel');
const partsList = $('#armor-parts-list');
const partsToggle = $('#armor-parts-toggle');
const closePanel = $('.armor-close-panel');

function showPartSettings(slot, focus = false) {
  if (slot) selectedSlot = slot;
  partsList.hidden = Boolean(slot);
  for (const [name, section] of Object.entries(sections)) section.hidden = name !== slot;
  detailPanel.hidden = false;
  detailPanel.scrollTop = 0;
  partsToggle.setAttribute('aria-expanded', 'true');
  if (focus) closePanel.focus();
}

function hidePartSettings() {
  if (detailPanel.contains(document.activeElement)) partsToggle.focus();
  detailPanel.hidden = true;
  partsToggle.setAttribute('aria-expanded', 'false');
}

partsToggle.addEventListener('click', () => {
  if (!detailPanel.hidden && !partsList.hidden) hidePartSettings();
  else showPartSettings(null, true);
});
closePanel.addEventListener('click', hidePartSettings);
stage.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !detailPanel.hidden) hidePartSettings();
});
panel.querySelectorAll('[data-jump]').forEach(button => {
  button.addEventListener('click', () => showPartSettings(button.dataset.jump, true));
});

const raycaster = new THREE.Raycaster();
const cursor = new THREE.Vector2();
let press = null;
let quadDrag = null;

function moveQuadView(view, dx, dy, orbit) {
  const viewCamera = view.camera;
  const height = canvas.clientHeight / 2;
  if (!height) return;
  if (orbit) {
    const offset = viewCamera.position.clone().sub(view.target);
    const angle = new THREE.Spherical().setFromVector3(offset);
    angle.theta -= dx * Math.PI / height;
    angle.phi -= dy * Math.PI / height;
    angle.makeSafe();
    viewCamera.position.copy(view.target).add(offset.setFromSpherical(angle));
    viewCamera.lookAt(view.target);
  } else {
    const viewHeight = viewCamera.isPerspectiveCamera
      ? 2 * viewCamera.position.distanceTo(view.target) * Math.tan(THREE.MathUtils.degToRad(viewCamera.fov / 2))
      : viewCamera.top - viewCamera.bottom;
    const scale = viewHeight / (height * viewCamera.zoom);
    const shift = new THREE.Vector3(-dx * scale, dy * scale, 0).applyQuaternion(viewCamera.quaternion);
    view.target.add(shift);
    viewCamera.position.add(shift);
  }
  render();
}

canvas.addEventListener('pointerdown', event => {
  if (!ready || !event.isPrimary || quadDrag) return;
  press = event.button === 0
    ? { id: event.pointerId, x: event.clientX, y: event.clientY }
    : null;
  const view = quadMode ? paneAt(event)?.view : null;
  const orbit = event.button === 0 && view?.camera.isPerspectiveCamera;
  if (!view || (!orbit && event.button !== 1 && event.button !== 2)) return;
  quadDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, orbit, view };
  canvas.setPointerCapture(event.pointerId);
  if (!orbit) event.preventDefault();
});
canvas.addEventListener('pointermove', event => {
  if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) {
    press = null;
  }
  if (quadDrag?.id !== event.pointerId || press) return;
  moveQuadView(quadDrag.view, event.clientX - quadDrag.x, event.clientY - quadDrag.y, quadDrag.orbit);
  quadDrag.x = event.clientX;
  quadDrag.y = event.clientY;
});
function endQuadDrag(event) {
  if (quadDrag?.id === event.pointerId) quadDrag = null;
}
canvas.addEventListener('contextmenu', event => { if (quadMode) event.preventDefault(); });
canvas.addEventListener('pointercancel', event => {
  press = null;
  endQuadDrag(event);
});
canvas.addEventListener('lostpointercapture', endQuadDrag);
canvas.addEventListener('pointerup', event => {
  endQuadDrag(event);
  const start = press;
  press = null;
  if (start?.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;

  const pane = paneAt(event);
  if (!pane) return;
  cursor.set(2 * pane.x - 1, 1 - 2 * pane.y);
  const pickCamera = pane.view?.camera ?? camera;
  pickCamera.updateMatrixWorld();
  scene.updateMatrixWorld();
  raycaster.setFromCamera(cursor, pickCamera);
  const parts = [helmet, nvg, body, vest, backpack].filter(Boolean);
  const hit = raycaster.intersectObjects(parts).find(({ object }) => object.visible && object.parent.visible);
  if (!hit) {
    hidePartSettings();
    return;
  }
  const part = hit.object.parent;
  if (part === body) {
    const materialSlot = hit.object.userData.slot;
    const lower = materialSlot === 'camo2' || (materialSlot !== 'camo1' && hit.point.y < 1);
    showPartSettings(lower ? 'lower' : 'upper');
  } else if (part === helmet && isVisor(hit.object.userData.slot)) {
    showPartSettings('visor');
  } else {
    showPartSettings(Object.keys(slots).find(slot => partFor(slot) === part));
  }
});

const fullscreenButton = $('#armor-fullscreen');
fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement === stage) await document.exitFullscreen();
    else await stage.requestFullscreen();
  } catch {
    message('Не удалось открыть полноэкранный режим.');
  }
});
document.addEventListener('fullscreenchange', () => {
  const active = document.fullscreenElement === stage;
  const label = active ? 'Выйти из полноэкранного режима (Esc)' : 'На весь экран';
  fullscreenButton.innerHTML = active ? exitFullscreenIcon : fullscreenIcon;
  fullscreenButton.title = label;
  fullscreenButton.setAttribute('aria-label', label);
  fullscreenButton.setAttribute('aria-pressed', String(active));
  resize();
});

function orientHelmetTexture(texture) {
  const mode = $('#armor-helmet-orientation').value;
  const flipX = mode === 'horizontal' || mode === 'rotate';
  const flipY = mode === 'vertical' || mode === 'rotate';
  texture.repeat.set(flipX ? -1 : 1, flipY ? -1 : 1);
  texture.offset.set(flipX ? 1 : 0, flipY ? 1 : 0);
  texture.updateMatrix();
}

$('#armor-helmet-orientation').addEventListener('change', () => {
  const texture = customTextures.get('helmet');
  if (!texture) return;
  orientHelmetTexture(texture);
  render();
});

$('#armor-helmet-original').addEventListener('change', event => {
  setSlotTexture('helmet', event.target.checked ? null : customTextures.get('helmet'));
  render();
});

function partFor(slot) {
  if (slot === 'helmet') return helmet;
  if (slot === 'visor') return helmet?.userData.hasVisor ? helmet : null;
  if (slot === 'backpack') return backpack;
  if (slot === 'vest') return vest;
  if (slot === 'nvg') return nvg;
  return slot === 'upper' || slot === 'lower' ? body : null;
}

function updateTextureDownloads(slot) {
  const container = sections[slot].querySelector('[data-downloads]');
  const maps = new Set();
  const part = partFor(slot);
  for (const mesh of part?.children ?? []) {
    if (!mesh.isMesh || mesh.userData.initialVisibility === false) continue;
    const materialSlot = mesh.userData.slot;
    if (slot === 'upper' && materialSlot !== 'camo1') continue;
    if (slot === 'lower' && materialSlot !== 'camo2') continue;
    if (slot === 'helmet' && isVisor(materialSlot)) continue;
    if (slot === 'visor' && !isVisor(materialSlot)) continue;
    const map = mesh.userData.originalMap;
    if (map?.image?.src) maps.add(map);
  }
  container.replaceChildren();
  container.hidden = !part;
  if (!part) return;
  if (!maps.size) {
    const note = document.createElement('p');
    note.className = 'armor-note';
    note.textContent = 'У этой детали нет штатной карты.';
    container.append(note);
    return;
  }
  const names = new Set();
  for (const map of maps) {
    const link = document.createElement('a');
    const name = map.name || 'texture.webp';
    let filename = name;
    for (let index = 2; names.has(filename.toLowerCase()); index++) filename = `${index}-${name}`;
    names.add(filename.toLowerCase());
    link.href = map.image.src;
    link.download = filename;
    link.textContent = maps.size === 1 ? 'Скачать текстуру модели' : 'Скачать ' + filename;
    link.title = filename;
    container.append(link);
  }
}

function setSlotTexture(slot, texture) {
  if (slot === 'helmet' && $('#armor-helmet-original').checked) texture = null;
  partFor(slot)?.traverse(mesh => {
    if (!mesh.isMesh) return;
    const materialSlot = mesh.userData.slot;
    const matches = slot === 'upper' ? materialSlot === 'camo1'
      : slot === 'lower' ? materialSlot === 'camo2'
      : slot === 'visor' ? isVisor(materialSlot)
      : slot === 'helmet' ? helmet.userData.primaryMap
        ? mesh.userData.originalMap === helmet.userData.primaryMap && !/visor|glass/i.test(materialSlot)
        : !/visor|glass|flap|camo2|illum|light/i.test(materialSlot)
      : !/visor|glass|flap|illum|light/i.test(materialSlot);
    if (!matches) return;
    mesh.material.map = texture ?? mesh.userData.originalMap;
    if (texture) mesh.material.color.setHex(0xffffff);
    else mesh.material.color.copy(mesh.userData.originalColor);
    mesh.material.needsUpdate = true;
  });
}

async function applyCustomTexture(file, slot, isCurrent = () => true) {
  if (!ready || !partFor(slot)) return false;
  const isPsd = /\.psd$/i.test(file.name);
  const limit = isPsd ? 256 : 25;
  if (file.size > limit * 1024 * 1024) {
    throw new Error('Выбери файл до ' + limit + ' МБ.');
  }
  const url = isPsd ? null : URL.createObjectURL(file);
  try {
    const texture = isPsd
      ? new THREE.CanvasTexture(await readPsdComposite(file))
      : await textureLoader.loadAsync(url);
    if (!isCurrent()) {
      texture.dispose();
      return false;
    }
    const template = slot === 'helmet' ? helmet.userData.template
      : slot === 'visor' ? helmet.userData.visorTemplate : null;
    if (template && Math.abs(texture.image.width / texture.image.height - template.width / template.height) > .01) {
      texture.dispose();
      throw new Error(`Размер кадра не совпадает с развёрткой. Нужен полный холст с пропорциями ${template.width} × ${template.height}.`);
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    if (slot === 'helmet') orientHelmetTexture(texture);
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    setSlotTexture(slot, texture);
    customTextures.get(slot)?.dispose();
    customTextures.set(slot, texture);
    updateSlotControls();
    render();
    return true;
  } catch (error) {
    throw new Error(error instanceof Error && !(error instanceof RangeError)
      ? error.message : 'Не удалось прочитать файл. Попробуй сохранить его ещё раз.');
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

const liveTextures = watchTextures({
  sections,
  apply: applyCustomTexture,
  report: slotStatus,
  async prepare(slot, handle) {
    if (slot !== 'helmet' || !/^84_P15_ARC_V2_H_co\./i.test(handle.name)) return;
    if (helmet.userData.uvLayout !== 'ls_gar_arc_helmet') {
      const id = 'QS_0th_ARC_P15_V0_H';
      modelInputs.helmet.value = id;
      await changeModel('helmet', id);
      if (helmet.userData.uvLayout !== 'ls_gar_arc_helmet') {
        throw new Error('Не удалось выбрать модель Republic ARC Helmet.');
      }
    }
    $('#armor-helmet-orientation').value = 'normal';
    $('#armor-helmet-original').checked = false;
  },
  onChange: updateSlotControls
});
for (const [slot, section] of Object.entries(sections)) {
  const copyMesh = section.querySelector('[data-copy-mesh]');
  const meshId = section.querySelector('[data-mesh-id]');
  copyMesh.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(meshId.value);
      copyMesh.textContent = 'Скопировано';
    } catch {
      meshId.focus();
      meshId.select();
      copyMesh.textContent = 'Нажми Ctrl+C';
    }
    setTimeout(() => { copyMesh.textContent = 'Копировать'; }, 1700);
  });
  section.querySelector('[data-reset]').addEventListener('click', () => {
    liveTextures.stop(slot);
    setSlotTexture(slot, null);
    customTextures.get(slot)?.dispose();
    customTextures.delete(slot);
    updateSlotControls();
    render();
  });
}

const projectPanel = $('#armor-projects');
const projectList = $('#armor-project-list');
const projectName = $('#armor-project-name');
const projectStatus = $('#armor-project-status');
const projectRelinks = $('#armor-project-relinks');
const projectLoad = $('#armor-project-load');

function captureView(viewCamera, target) {
  return { position: viewCamera.position.toArray(), target: target.toArray(), zoom: viewCamera.zoom };
}

function restoreView(viewCamera, target, saved) {
  viewCamera.position.fromArray(saved.position);
  target.fromArray(saved.target);
  viewCamera.zoom = saved.zoom;
  viewCamera.lookAt(target);
  viewCamera.updateProjectionMatrix();
}

function captureProject(name) {
  return {
    name, version: 1, models: { ...selectedModels }, nvgDown,
    light: $('#armor-light-temperature').value,
    helmetOrientation: $('#armor-helmet-orientation').value,
    textureFiles: liveTextures.snapshot(),
    camera: captureView(camera, controls.target),
    quadMode, quadInitialized,
    quadViews: quadViews.map(view => ({
      direction: view.direction,
      ...captureView(view.camera, view.target)
    }))
  };
}

async function refreshProjectList(selection) {
  const names = await listProjects();
  names.sort((left, right) => left.localeCompare(right, 'ru'));
  projectList.replaceChildren(...names.map(name => new Option(name, name)));
  if (!names.length) projectList.append(new Option('Проектов пока нет', ''));
  if (selection && names.includes(selection)) projectList.value = selection;
}

function setProjectBusy(busy) {
  for (const input of projectPanel.querySelectorAll('button, select, input')) input.disabled = busy;
  projectLoad.disabled = busy || !projectList.value;
}

async function restoreProject(project) {
  if (!project || project.version !== 1) throw new Error('Проект не найден или сохранён в другой версии.');
  applyingProject = true;
  const unavailable = [];
  try {
    for (const slot of Object.keys(slots)) {
      liveTextures.stop(slot);
      setSlotTexture(slot, null);
      customTextures.get(slot)?.dispose();
    }
    customTextures.clear();
    isolatedSlot = null;
    updateIsolation();
    const loaded = await Promise.all(Object.entries(modelLists).map(async ([slot, models]) => {
      const id = project.models[slot];
      const valid = models.some(model => model.id === id) || (id === '' && initialModels[slot] !== undefined
        && ['vest', 'backpack', 'nvg'].includes(slot));
      if (!valid) return false;
      modelSearches[slot].value = '';
      return changeModel(slot, id, slot === 'nvg' && project.nvgDown);
    }));
    $('#armor-light-temperature').value = project.light;
    setLighting();
    $('#armor-helmet-orientation').value = project.helmetOrientation;
    $('#armor-helmet-original').checked = false;
    controls.enableDamping = false;
    controls.update();
    restoreView(camera, controls.target, project.camera);
    controls.update();
    controls.enableDamping = true;
    panel.querySelectorAll('[data-quad-view]').forEach(select => {
      const index = Number(select.dataset.quadView);
      const saved = project.quadViews[index];
      select.value = saved.direction;
      select.dispatchEvent(new Event('change'));
      if (project.quadInitialized) restoreView(quadViews[index].camera, quadViews[index].target, saved);
    });
    quadInitialized = project.quadInitialized;
    setQuadMode(project.quadMode);
    hidePartSettings();
    for (const [slot, handle] of Object.entries(project.textureFiles)) {
      const modelSlot = slot === 'visor' ? 'helmet' : slot === 'lower' ? 'upper' : slot;
      if (!partFor(slot) || selectedModels[modelSlot] !== project.models[modelSlot]) continue;
      if (!await liveTextures.restore(slot, handle)) unavailable.push([slot, handle.name]);
    }
    updateSlotControls();
    return { unavailable, modelsMissing: loaded.includes(false) };
  } finally {
    applyingProject = false;
    render();
  }
}

$('#armor-project-open').addEventListener('click', async () => {
  projectRelinks.replaceChildren();
  projectStatus.textContent = '';
  projectPanel.showModal();
  setProjectBusy(true);
  try {
    await refreshProjectList(projectName.value);
  } catch {
    projectStatus.textContent = 'Хранилище проектов недоступно в этом окне.';
  } finally {
    setProjectBusy(false);
  }
});
$('#armor-project-close').addEventListener('click', () => projectPanel.close());
projectList.addEventListener('change', () => { projectLoad.disabled = !projectList.value; });
projectPanel.addEventListener('cancel', event => {
  if ($('#armor-project-close').disabled) event.preventDefault();
});
$('#armor-project-save').addEventListener('submit', async event => {
  event.preventDefault();
  const name = projectName.value.trim();
  if (!name) return;
  setProjectBusy(true);
  try {
    await saveProject(captureProject(name));
    await refreshProjectList(name);
    projectStatus.textContent = 'Сохранено: ' + name;
  } catch {
    projectStatus.textContent = 'Не удалось сохранить проект. Проверь доступ к хранилищу браузера.';
  } finally {
    setProjectBusy(false);
  }
});
projectLoad.addEventListener('click', async () => {
  const name = projectList.value;
  projectRelinks.replaceChildren();
  setProjectBusy(true);
  projectStatus.textContent = 'Открываю…';
  try {
    const { unavailable, modelsMissing } = await restoreProject(await loadProject(name));
    projectName.value = name;
    const notes = ['Открыт: ' + name];
    if (modelsMissing) notes.push('Часть моделей недоступна.');
    if (unavailable.length) notes.push('Подключи недоступные файлы заново и сохрани проект.');
    projectStatus.textContent = notes.join(' ');
    for (const [slot, filename] of unavailable) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = slots[slot] + ' · ' + filename;
      button.addEventListener('click', () => {
        projectPanel.close();
        showPartSettings(slot, true);
        sections[slot].querySelector('[data-pick]').click();
      });
      projectRelinks.append(button);
    }
  } catch (error) {
    projectStatus.textContent = error.message || 'Не удалось открыть проект.';
  } finally {
    setProjectBusy(false);
  }
});

canvas.addEventListener('keydown', event => {
  if (!controls) return;
  if (quadMode) {
    if (event.key === 'Home') {
      event.preventDefault();
      $('[data-camera="reset"]').click();
    }
    return;
  }
  const offset = camera.position.clone().sub(controls.target);
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), event.key === 'ArrowLeft' ? .12 : -.12);
  } else if (event.key === '+' || event.key === '=') {
    offset.multiplyScalar(.9);
  } else if (event.key === '-') {
    offset.multiplyScalar(1.1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    cameraView('reset');
    return;
  } else {
    return;
  }
  event.preventDefault();
  offset.clampLength(controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(offset);
  controls.update();
  render();
});
new ResizeObserver(resize).observe(stage);
document.addEventListener('visibilitychange', () => {
  if (visible()) resize();
  else cancelFrame();
});
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  cancelFrame();
  message('Графический контекст потерян. Обнови страницу.');
});
boot();
