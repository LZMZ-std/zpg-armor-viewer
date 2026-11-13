import { loadArmorAsset } from './offline-assets.js';
import { watchTextures } from './live-textures.js';
import catalogData from './content/armor-catalog.json';
import * as THREE from './assets/vendor/three/three.module.js';
import { OrbitControls } from './assets/vendor/three/OrbitControls.js';
import { readPsdComposite } from './psd-composite.js';

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
        ? '<p class="armor-note" id="armor-visor-note"></p><p class="armor-note"><a id="armor-visor-template" download hidden>Скачать штатную карту визора</a></p>'
        : '<label class="armor-field"><span>Модель</span><select data-model disabled></select></label>'}
    ${slot === 'helmet' ? orientationField : ''}
    ${slot === 'nvg' ? '<label class="armor-switch" id="armor-nvg-position" hidden>Опустить ПНВ<input id="armor-nvg-down" type="checkbox" disabled></label>' : ''}
    ${slot === 'helmet' ? '<p class="armor-note"><a id="armor-helmet-template" download>Скачать развёртку выбранного шлема</a></p><label class="armor-note"><input type="checkbox" id="armor-helmet-original"> Показать штатную текстуру</label>' : ''}
    <div class="armor-texture-controls">
      <h3>Текстура</h3>
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
    if(kind==='body') map=slot==='camo1'?maps.upper:slot==='camo2'?maps.lower:maps.undersuit;
    else map=isVisor(slot)?maps.visor:/flap|camo2/.test(slot)?maps.flaps:/illum|light/.test(slot)?maps.light:maps.main;
    const mat=new THREE.MeshStandardMaterial({map, color:map?0xffffff:kind==='body'?0x17212a:0xe6e8e9,roughness:/visor|glass/.test(slot)?.22:.64,metalness:/visor|glass/.test(slot)?.3:.08,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(kind==='body'?part.geometry.clone():part.geometry,mat);mesh.userData.slot=slot; mesh.userData.originalMap=map;
    mesh.userData.originalColor = mat.color.clone();
    mesh.castShadow=true;mesh.receiveShadow=false;
    if(kind==='body')mesh.userData.restGeometry=part.geometry;
    if(kind==='helmet'&&/flap|camo2/.test(slot)&&!maps.flaps&&!maps.keepFlaps)mesh.visible=false;
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
let selectedModels = { ...initialModels };
const nvgDownInput = $('#armor-nvg-down');
let nvgDown = false;

async function buildModel(slot, id, lowered) {
  const item = modelLists[slot].find(entry => entry.id === id);
  if (slot === 'backpack' || slot === 'vest') return buildAccessory(slot, item);
  if (slot === 'nvg') return buildAccessory(slot, item, lowered ? item?.model : item?.offModel ?? item?.model);
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
  group.userData.templateName = mainUrl?.split('/').pop();
  group.userData.hasVisor = parts.some(part => isVisor(part.slot));
  group.userData.visorTemplate = visor?.image;
  group.userData.visorTemplateName = visorUrl?.split('/').pop();
  return group;
}

function updateSlotControls() {
  for (const [slot, section] of Object.entries(sections)) {
    section.querySelector('[data-pick]').disabled = !ready || !partFor(slot);
    section.querySelector('[data-focus]').disabled = !ready || !partFor(slot);
    section.querySelector('[data-isolate]').disabled = !ready || !partFor(slot);
    section.querySelector('[data-reset]').disabled = !ready || (!customTextures.has(slot) && !liveTextures.has(slot));
  }
  $('#armor-visor-note').textContent = helmet?.userData.hasVisor
    ? 'Подключи отдельную текстуру визора.'
    : 'У выбранного шлема визор входит в общую текстуру. Подключи файл в разделе «Шлем».';
}

async function changeModel(slot, id, lowered = false) {
  const input = modelInputs[slot];
  input.disabled = true;
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
    if (slot === 'helmet') {
      const link = $('#armor-helmet-template');
      link.hidden = !next.userData.template;
      if (next.userData.template) {
        link.href = next.userData.template.src;
        link.download = next.userData.templateName;
      }
      const visorLink = $('#armor-visor-template');
      visorLink.hidden = !next.userData.hasVisor || !next.userData.visorTemplate;
      if (!visorLink.hidden) {
        visorLink.href = next.userData.visorTemplate.src;
        visorLink.download = next.userData.visorTemplateName;
      }
    }
    if (slot === 'upper' || slot === 'vest') applyPose();
    for (const affected of affectedSlots) {
      const texture = customTextures.get(affected);
      if (texture) setSlotTexture(affected, texture);
    }
    if (ready) cameraView(next ? slot : 'reset');
    message('');
  } catch (error) {
    input.value = selectedModels[slot];
    if (!ready) throw error;
    message('Не удалось открыть выбранную модель.');
    console.error(error);
  } finally {
    input.disabled = !ready;
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

async function loadOutfit() {
  for (const [slot, input] of Object.entries(modelInputs)) {
    input.replaceChildren(...modelLists[slot].map(item => new Option(item.name, item.id)));
    const emptyLabel = { backpack: 'Без рюкзака', vest: 'Без жилета', nvg: 'Без ПНВ' }[slot];
    if (emptyLabel) input.prepend(new Option(emptyLabel, ''));
    input.value = selectedModels[slot];
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
    for (const input of Object.values(modelInputs)) input.disabled = false;
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
  section.querySelector('[data-reset]').addEventListener('click', () => {
    liveTextures.stop(slot);
    setSlotTexture(slot, null);
    customTextures.get(slot)?.dispose();
    customTextures.delete(slot);
    updateSlotControls();
    render();
  });
}
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
