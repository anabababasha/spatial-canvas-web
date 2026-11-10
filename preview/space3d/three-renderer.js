// Three.js renderer for the isolated Space 3D prototype.
//
// Perspective camera, modest lighting, dimensional device glyphs, raycast picking with a touch-friendly screen-space
// fallback, selection highlight. Two layouts:
//   - 'arrangement': the abstract view. Ground grid and rings; glyphs on arrival-order slots (the original prototype).
//   - 'environment': an optional authored environment (for example the synthetic courtyard) drawn as ONE batched
//     THREE.Points object, with glyphs at authored fixture placements. Only available when `environment` is passed.
// Neither layout is a measured position.
//
// Rendering is on demand: a frame is drawn after a change or while a short animation runs, and never while the page,
// the container or the scene is hidden. Observation updates patch existing glyphs in place.
//
// Gestures: one finger pans the ground under the finger, two fingers pinch (zoom), twist (rotate) and slide (tilt);
// Shift, right or middle drag orbits on desktop; wheel zooms; arrows pan, Shift+arrows orbit, +/- zoom, 0 resets.

import * as THREE from './vendor/three-0.187.0/three.module.min.js';
import {
  arrangementRadius, arrangementToLocal, brandTint, glyphShapeFor, isStale, validateSnapshot
} from './renderer-interface.js';

const ARRANGEMENT_VIEW = Object.freeze({ theta: 0, tilt: 56, zoom: 1, targetX: 0, targetY: 0, targetZ: 0 });
const ARRANGEMENT_LIMITS = Object.freeze({ tiltMin: 15, tiltMax: 75, zoomMin: 0.5, zoomMax: 3 });
const PAN_LIMIT_FACTOR = 1.1;
const NODE_HEIGHT = 0.9;
const BACKGROUND = 0x040a14;
const SIGNAL_COLOR = '#ff8f7f';
const PICK_RADIUS_PX = 34;

const CLOUD_VERTEX = `
attribute vec3 aColor;
uniform float uSize;
uniform float uScale;
uniform float uMaxPx;
uniform float uReveal;
uniform vec3 uOrigin;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uBg;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(0.1, -mv.z);
  gl_PointSize = clamp(uSize * uScale / dist, 1.0, uMaxPx);
  float r = distance(position.xz, uOrigin.xz);
  vAlpha = 1.0 - smoothstep(uReveal - 2.5, uReveal, r);
  float fog = smoothstep(uFogNear, uFogFar, dist);
  vColor = mix(aColor, uBg, fog * 0.88);
}`;
const CLOUD_FRAGMENT = `
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  float a = vAlpha * uOpacity;
  if (a < 0.03) discard;
  gl_FragColor = vec4(vColor, a);
}`;

const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createThreeRenderer({
  container, onSelect, forceFail = false, environment = null, layout: initialLayout = 'environment',
  detail: initialDetail = 'high', reducedMotion: reducedMotionOption = null
} = {}) {
  if (forceFail) throw new Error('Forced renderer failure (test switch)');

  const canvas = document.createElement('canvas');
  canvas.className = 'scene-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'default' })
    || canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'default' });
  if (!gl) throw new Error('WebGL is unavailable in this browser');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: false });
  } catch (error) {
    throw new Error(`WebGLRenderer failed: ${error?.message || error}`);
  }
  let detail = initialDetail === 'low' ? 'low' : 'high';
  const pixelRatioCap = () => (detail === 'low' ? 1 : 2);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap()));
  renderer.setClearColor(BACKGROUND, 1);
  container.replaceChildren(canvas);

  const motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reducedMotion = reducedMotionOption ?? Boolean(motionQuery?.matches);
  const onMotionChange = event => { if (reducedMotionOption == null) reducedMotion = event.matches; };
  motionQuery?.addEventListener?.('change', onMotionChange);

  const envView = environment?.view || null;
  let layout = environment && initialLayout !== 'arrangement' ? 'environment' : 'arrangement';

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BACKGROUND, 18, 60);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 220);

  scene.add(new THREE.HemisphereLight(0x9fc5ff, 0x0b1a30, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(6, 10, 4);
  scene.add(key);

  const disposables = new Set();
  const track = object => { disposables.add(object); return object; };

  // ---------- Abstract ground (grid, disc, rings) ----------
  const ground = new THREE.Group();
  scene.add(ground);
  let groundRadius = 0;
  function buildGround(radius) {
    if (radius === groundRadius) return;
    groundRadius = radius;
    for (const child of [...ground.children]) { ground.remove(child); disposeObject(child); }
    const size = Math.ceil(radius) * 2;
    const grid = new THREE.GridHelper(size, size, 0x1e3a5f, 0x12263f);
    grid.material.transparent = true;
    grid.material.opacity = 0.9;
    ground.add(grid);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(radius + 0.5, 64),
      new THREE.MeshStandardMaterial({ color: 0x0a182c, roughness: 1, metalness: 0, transparent: true, opacity: 0.85 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.01;
    ground.add(disc);
    for (const ringRadius of [1.6, 3.2, 4.8, 6.4, 8.0]) {
      if (ringRadius > radius) continue;
      const points = [];
      for (let deg = 0; deg <= 360; deg += 5) {
        const rad = deg * Math.PI / 180;
        points.push(new THREE.Vector3(ringRadius * Math.cos(rad), 0.005, ringRadius * Math.sin(rad)));
      }
      ground.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.22 })));
    }
  }

  // ---------- Labels ----------
  const labelTextures = new Map();
  function labelTexture(text) {
    if (labelTextures.has(text)) return labelTextures.get(text);
    const canvasLabel = document.createElement('canvas');
    const short = text.length === 1;
    canvasLabel.width = short ? 64 : 128; canvasLabel.height = 64;
    const context = canvasLabel.getContext('2d');
    context.fillStyle = short ? 'rgba(2, 6, 16, 0.6)' : 'rgba(2, 6, 16, 0.72)';
    context.beginPath();
    if (short) context.arc(32, 32, 26, 0, Math.PI * 2); else context.roundRect(4, 8, 120, 48, 14);
    context.fill();
    if (short) { context.strokeStyle = 'rgba(255, 143, 127, 0.75)'; context.lineWidth = 3; context.stroke(); }
    context.fillStyle = short ? '#ffe4de' : '#f8fafc';
    context.font = `bold ${short ? 32 : 30}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, short ? 32 : 64, 34);
    const texture = new THREE.CanvasTexture(canvasLabel);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;
    labelTextures.set(text, texture);
    return texture;
  }
  function makeLabelSprite(text, y, width = 0.6, height = 0.3) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(text), depthTest: true, transparent: true }));
    sprite.scale.set(width, height, 1);
    sprite.position.y = y;
    return sprite;
  }

  // ---------- "You" marker (a viewing convention, not a measured position) ----------
  const you = new THREE.Group();
  {
    const youBase = new THREE.Mesh(track(new THREE.CylinderGeometry(0.5, 0.6, 0.06, 32)), new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.35, roughness: 0.6 }));
    youBase.position.y = 0.03;
    const youPost = new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 12)), new THREE.MeshStandardMaterial({ color: 0xbae6fd }));
    youPost.position.y = 0.6;
    const youHead = new THREE.Mesh(track(new THREE.SphereGeometry(0.16, 20, 16)), new THREE.MeshStandardMaterial({ color: 0xe0f2fe, emissive: 0x38bdf8, emissiveIntensity: 0.6 }));
    youHead.position.y = 1.2;
    you.add(youBase, youPost, youHead, makeLabelSprite('YOU', 1.55, 0.72, 0.3));
  }
  scene.add(you);
  const youPosition = mode => (mode === 'environment' && envView ? new THREE.Vector3(envView.home.x, 0, envView.home.z) : new THREE.Vector3(0, 0, 0));
  const youScale = mode => (mode === 'environment' && envView ? 0.6 : 1);
  you.position.copy(youPosition(layout));
  you.scale.setScalar(youScale(layout));

  // ---------- Environment point cloud (one draw call) ----------
  const cloudUniforms = {
    uSize: { value: 0.07 }, uScale: { value: 1 }, uMaxPx: { value: 12 }, uReveal: { value: 1e4 },
    uOrigin: { value: new THREE.Vector3() }, uFogNear: { value: envView?.fogNear ?? 16 }, uFogFar: { value: envView?.fogFar ?? 64 },
    uBg: { value: new THREE.Color(BACKGROUND) }, uOpacity: { value: layout === 'environment' ? 1 : 0 }
  };
  const cloudMaterial = new THREE.ShaderMaterial({ uniforms: cloudUniforms, vertexShader: CLOUD_VERTEX, fragmentShader: CLOUD_FRAGMENT, transparent: true, depthWrite: true });
  let cloud = null;
  let cloudInfo = { count: 0, parts: {}, detail: null };
  function buildCloud() {
    if (!environment) return;
    if (cloud) { scene.remove(cloud); cloud.geometry.dispose(); cloud = null; }
    const data = environment.build(detail);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(data.colors, 3));
    geometry.computeBoundingSphere();
    cloud = new THREE.Points(geometry, cloudMaterial);
    cloud.visible = layout === 'environment';
    scene.add(cloud);
    cloudUniforms.uSize.value = data.pointSize ?? 0.07;
    cloudInfo = { count: data.count, parts: data.parts, detail };
  }
  if (envView) cloudUniforms.uOrigin.value.set(envView.home.x, 0, envView.home.z);
  buildCloud();

  // ---------- Device glyphs ----------
  const geometries = {
    pedestal: track(new THREE.CylinderGeometry(0.2, 0.24, 0.08, 20)),
    generic: track(new THREE.CapsuleGeometry(0.16, 0.42, 4, 12)),
    box: track(new THREE.BoxGeometry(0.5, 0.34, 0.34)),
    halo: track(new THREE.TorusGeometry(0.34, 0.025, 8, 32)),
    highlight: track(new THREE.TorusGeometry(0.46, 0.022, 10, 48)),
    signal: track(new THREE.OctahedronGeometry(0.24, 0)),
    groundMark: track(new THREE.RingGeometry(0.22, 0.32, 32))
  };
  const highlight = new THREE.Mesh(geometries.highlight, new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  highlight.rotation.x = Math.PI / 2;
  highlight.visible = false;
  scene.add(highlight);

  const glyphRoot = new THREE.Group();
  scene.add(glyphRoot);
  const glyphs = new Map();
  const counters = { created: 0, updated: 0, removed: 0 };
  let selectedId = null;
  let snapshotNow = Date.now();

  function positionFor(device, mode = layout) {
    const placement = device.placement;
    if (mode === 'environment' && placement && Number.isFinite(placement.x) && Number.isFinite(placement.z)) {
      return new THREE.Vector3(placement.x, Number.isFinite(placement.y) ? placement.y : 0, placement.z);
    }
    const local = arrangementToLocal(device.arrangement);
    return new THREE.Vector3(local.x, 0, local.z);
  }

  function createGlyph(device) {
    const group = new THREE.Group();
    const shape = glyphShapeFor(device);
    const tint = new THREE.Color(brandTint(device));
    const pedestal = new THREE.Mesh(geometries.pedestal, new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 }));
    pedestal.position.y = 0.04;
    const body = new THREE.Mesh(geometries[shape], new THREE.MeshStandardMaterial({ color: tint, roughness: 0.45, metalness: 0.15, emissive: tint, emissiveIntensity: 0.08, transparent: true }));
    body.position.y = shape === 'box' ? 0.25 : 0.45;
    const halo = new THREE.Mesh(geometries.halo, new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.8 }));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.09;
    const label = makeLabelSprite(device.letter || `#${device.number}`, NODE_HEIGHT + 0.35, device.letter ? 0.34 : 0.62, device.letter ? 0.34 : 0.31);
    // Elevated signals in the environment get a thin drop line and a ground mark so their height reads in depth.
    const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: SIGNAL_COLOR, transparent: true, opacity: 0.35 }));
    const groundMark = new THREE.Mesh(geometries.groundMark, new THREE.MeshBasicMaterial({ color: SIGNAL_COLOR, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    groundMark.rotation.x = -Math.PI / 2;
    group.add(pedestal, body, halo, label, stem, groundMark);
    for (const mesh of [pedestal, body, halo]) mesh.userData.id = device.id;
    const entry = { group, body, halo, pedestal, label, stem, groundMark, shape, tint, stale: null, selected: false, device, look: null };
    glyphRoot.add(group);
    glyphs.set(device.id, entry);
    counters.created++;
    applyLook(entry);
    placeGlyph(entry, positionFor(device));
    return entry;
  }

  function placeGlyph(entry, position) {
    entry.group.position.copy(position);
    const lift = position.y;
    const elevated = layout === 'environment' && lift > 0.25;
    const attribute = entry.stem.geometry.getAttribute('position');
    attribute.setXYZ(1, 0, -lift, 0);
    attribute.needsUpdate = true;
    entry.stem.geometry.computeBoundingSphere();
    entry.stem.visible = elevated;
    entry.groundMark.position.y = -lift + 0.02;
    entry.groundMark.visible = layout === 'environment';
  }

  function applyLook(entry) {
    const look = layout === 'environment' ? 'signal' : 'brand';
    const color = look === 'signal' ? SIGNAL_COLOR : brandTint(entry.device);
    if (entry.look === look && entry.tint.getHexString() === new THREE.Color(color).getHexString()) return;
    entry.look = look;
    entry.tint.set(color);
    entry.body.material.color.copy(entry.tint);
    entry.body.material.emissive.copy(entry.tint);
    entry.halo.material.color.copy(entry.tint);
    entry.pedestal.visible = look === 'brand';
    // In the environment every signal is the same faceted gem so it reads as a signal object, not as a device type.
    const geometry = look === 'signal' ? geometries.signal : geometries[entry.shape];
    if (entry.body.geometry !== geometry) entry.body.geometry = geometry;
    entry.body.material.flatShading = look === 'signal';
    entry.body.material.needsUpdate = true;
    entry.body.scale.set(1, look === 'signal' ? 1.35 : 1, 1);
  }

  function updateGlyph(entry, device) {
    entry.device = device;
    if (!anim.layout) placeGlyph(entry, positionFor(device));
    const stale = isStale(device, snapshotNow);
    if (entry.stale !== stale) {
      entry.stale = stale;
      entry.body.material.opacity = stale ? 0.4 : 1;
      entry.halo.material.opacity = stale ? 0.25 : 0.8;
      entry.label.material.opacity = stale ? 0.5 : 1;
    }
    applyLook(entry);
    const shape = glyphShapeFor(device);
    if (shape !== entry.shape) {
      entry.shape = shape;
      if (entry.look !== 'signal') entry.body.geometry = geometries[shape];
      entry.body.position.y = shape === 'box' ? 0.25 : 0.45;
    }
    counters.updated++;
  }

  function syncHighlight() {
    const target = selectedId ? glyphs.get(selectedId) : null;
    highlight.visible = Boolean(target);
    if (target) highlight.position.set(target.group.position.x, target.group.position.y + 0.02, target.group.position.z);
  }

  function applySelection() {
    for (const [id, entry] of glyphs) {
      const selected = id === selectedId;
      if (selected === entry.selected) continue;
      entry.selected = selected;
      entry.body.material.emissiveIntensity = selected ? 0.55 : 0.08;
      entry.group.scale.setScalar(selected ? 1.15 : 1);
    }
    syncHighlight();
  }

  function disposeObject(object) {
    object.traverse?.(child => {
      if (child.isMesh || child.isLine || child.isSprite) {
        if (child.geometry && !disposables.has(child.geometry)) child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material?.dispose();
      }
    });
  }

  // ---------- Camera ----------
  function homeView(mode = layout) {
    if (mode === 'environment' && envView) {
      return { theta: envView.theta, tilt: envView.tilt, zoom: envView.zoom, targetX: envView.home.x, targetY: envView.targetY, targetZ: envView.home.z + envView.targetAheadZ };
    }
    return { ...ARRANGEMENT_VIEW };
  }
  const limits = (mode = layout) => (mode === 'environment' && envView
    ? { tiltMin: envView.tiltMin, tiltMax: envView.tiltMax, zoomMin: envView.zoomMin, zoomMax: envView.zoomMax }
    : ARRANGEMENT_LIMITS);
  const view = { ...homeView(), baseDistance: 12, radius: 4, centerX: 0, centerZ: 0 };
  let arrangementRadiusValue = 4;
  function syncModeScale() {
    if (layout === 'environment' && envView) {
      view.baseDistance = envView.baseDistance;
      view.radius = envView.panRadius;
      view.centerX = envView.center.x; view.centerZ = envView.center.z;
      scene.fog.near = envView.fogNear + 4; scene.fog.far = envView.fogFar + 6;
    } else {
      view.baseDistance = Math.max(10, arrangementRadiusValue * 2.8);
      view.radius = arrangementRadiusValue;
      view.centerX = 0; view.centerZ = 0;
      scene.fog.near = 18; scene.fog.far = 60;
    }
  }
  syncModeScale();

  // Portrait screens see less width at the same vertical field of view, so the camera backs off a little.
  const aspectFactor = () => (camera.aspect < 1 ? Math.min(1.6, 1 / Math.sqrt(camera.aspect)) : 1);
  const cameraDistance = () => view.baseDistance / view.zoom * aspectFactor();
  function updateCamera() {
    const phi = THREE.MathUtils.degToRad(view.tilt), theta = THREE.MathUtils.degToRad(view.theta);
    const distance = cameraDistance();
    camera.position.set(
      view.targetX + distance * Math.cos(phi) * Math.sin(theta),
      view.targetY + distance * Math.sin(phi),
      view.targetZ + distance * Math.cos(phi) * Math.cos(theta)
    );
    camera.lookAt(view.targetX, view.targetY, view.targetZ);
    camera.updateMatrixWorld();
  }
  const clampTilt = value => Math.max(limits().tiltMin, Math.min(limits().tiltMax, value));
  const clampZoom = value => Math.max(limits().zoomMin, Math.min(limits().zoomMax, value));
  function clampTarget() {
    const limit = view.radius * PAN_LIMIT_FACTOR;
    const dx = view.targetX - view.centerX, dz = view.targetZ - view.centerZ;
    const magnitude = Math.hypot(dx, dz);
    if (magnitude > limit) { view.targetX = view.centerX + dx * limit / magnitude; view.targetZ = view.centerZ + dz * limit / magnitude; }
  }

  // ---------- Animations (short, on demand; skipped under reduced motion) ----------
  const anim = { view: null, layout: null, reveal: null, pulse: null };
  function tween(key, durationMs, apply, done) {
    if (reducedMotion || durationMs <= 0) { anim[key] = null; apply(1, 1); done?.(); invalidate(); return; }
    anim[key] = { start: performance.now(), duration: durationMs, apply, done };
    invalidate();
  }
  function stepAnimations(now) {
    let active = false;
    for (const key of Object.keys(anim)) {
      const item = anim[key];
      if (!item) continue;
      const t = Math.max(0, Math.min(1, (now - item.start) / item.duration));
      item.apply(easeInOutCubic(t), t);
      if (t >= 1) { anim[key] = null; item.done?.(); } else active = true;
    }
    return active;
  }
  function animateView(to, durationMs = 900) {
    const from = { theta: view.theta, tilt: view.tilt, zoom: view.zoom, targetX: view.targetX, targetY: view.targetY, targetZ: view.targetZ };
    const dTheta = ((to.theta - from.theta + 540) % 360) - 180;
    tween('view', durationMs, k => {
      view.theta = (from.theta + dTheta * k + 360) % 360;
      view.tilt = from.tilt + (to.tilt - from.tilt) * k;
      view.zoom = from.zoom + (to.zoom - from.zoom) * k;
      view.targetX = from.targetX + (to.targetX - from.targetX) * k;
      view.targetY = from.targetY + (to.targetY - from.targetY) * k;
      view.targetZ = from.targetZ + (to.targetZ - from.targetZ) * k;
      updateCamera();
    });
  }
  function focusView(id, mode = layout) {
    const entry = glyphs.get(id);
    const position = positionFor(entry.device, mode);
    const lim = limits(mode);
    const baseTilt = mode === layout ? view.tilt : homeView(mode).tilt;
    return {
      theta: view.theta,
      tilt: Math.max(lim.tiltMin, Math.min(lim.tiltMax, Math.max(baseTilt, mode === 'environment' ? 22 : 40))),
      zoom: mode === 'environment' ? (envView?.focusZoom ?? 2.4) : 1.6,
      // Aim slightly below the signal so it sits above the screen centre, clear of the bottom card.
      targetX: position.x, targetY: mode === 'environment' ? position.y - 0.35 : 0, targetZ: position.z
    };
  }

  // ---------- Picking ----------
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  function toNdc(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    return ndc;
  }
  function groundAt(clientX, clientY) {
    raycaster.setFromCamera(toNdc(clientX, clientY), camera);
    const hit = new THREE.Vector3();
    const point = raycaster.ray.intersectPlane(groundPlane, hit);
    if (!point || point.distanceTo(camera.position) > view.baseDistance * 6) return null;
    return point;
  }
  function projectWorld(x, y, z) {
    const vector = new THREE.Vector3(x, y, z).project(camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + (vector.x + 1) / 2 * rect.width, y: rect.top + (1 - vector.y) / 2 * rect.height, depth: vector.z };
  }
  function pickAt(clientX, clientY) {
    raycaster.setFromCamera(toNdc(clientX, clientY), camera);
    for (const hit of raycaster.intersectObjects(glyphRoot.children, true)) {
      const id = hit.object.userData?.id;
      if (id) return id;
    }
    // Touch-friendly fallback: the nearest glyph within a fingertip radius on screen.
    let best = null, bestDistance = PICK_RADIUS_PX;
    for (const [id, entry] of glyphs) {
      const p = entry.group.position;
      const screen = projectWorld(p.x, p.y + 0.45, p.z);
      if (screen.depth > 1) continue;
      const distance = Math.hypot(screen.x - clientX, screen.y - clientY);
      if (distance < bestDistance) { best = id; bestDistance = distance; }
    }
    return best;
  }

  // ---------- Render loop ----------
  let rafId = 0, disposed = false, sceneVisible = true, documentVisible = !document.hidden, intersecting = true, contextLost = false;
  const frameTimes = [], renderTimes = [];
  let frames = 0, lastFrameAt = 0, spinUntil = 0, firstFrameAt = 0;
  function canRender() { return !disposed && sceneVisible && documentVisible && intersecting && !contextLost; }
  function invalidate() {
    if (rafId || !canRender()) return;
    rafId = requestAnimationFrame(frame);
  }
  function frame(now) {
    rafId = 0;
    if (!canRender()) return;
    const animating = stepAnimations(performance.now());
    const started = performance.now();
    renderer.render(scene, camera);
    const renderMs = performance.now() - started;
    frames++;
    if (!firstFrameAt) { firstFrameAt = performance.now(); performance.mark?.('space3d-first-frame'); }
    if (lastFrameAt) pushSample(frameTimes, now - lastFrameAt);
    pushSample(renderTimes, renderMs);
    if (now < spinUntil) {
      view.theta = (view.theta + 0.6) % 360;
      updateCamera();
      lastFrameAt = now;
      invalidate();
    } else if (animating) {
      lastFrameAt = now;
      invalidate();
    } else {
      lastFrameAt = 0;
    }
  }
  function pushSample(list, value) { list.push(value); if (list.length > 600) list.shift(); }
  function summarize(list) {
    if (!list.length) return { mean: null, p95: null, max: null, n: 0 };
    const sorted = [...list].sort((a, b) => a - b);
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    return { mean, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], max: sorted[sorted.length - 1], n: sorted.length };
  }

  // ---------- Gestures ----------
  const pointers = new Map();
  let pinchStart = null;
  const gestureMode = event => ((event.button ?? 0) === 1 || event.button === 2 || event.shiftKey || event.ctrlKey) ? 'orbit' : 'pan';
  const interactionListeners = new Set();
  function onPointerDown(event) {
    if ((event.button ?? 0) > 2) return;
    canvas.focus?.({ preventScroll: true });
    anim.view = null; // a new touch takes over from any focus glide
    for (const listener of interactionListeners) listener(event);
    pointers.set(event.pointerId, {
      x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false,
      mode: gestureMode(event), grabbed: groundAt(event.clientX, event.clientY)
    });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = {
        distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom,
        angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, theta: view.theta,
        midY: (a.y + b.y) / 2, tilt: view.tilt
      };
    }
  }
  function onPointerMove(event) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    pointer.x = event.clientX; pointer.y = event.clientY;
    if (!pointer.moved && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 6) pointer.moved = true;
    if (pointers.size >= 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart.distance > 0) view.zoom = clampZoom(pinchStart.zoom * distance / pinchStart.distance);
      const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      const twist = ((angle - pinchStart.angle + 540) % 360) - 180;
      view.theta = (pinchStart.theta + twist + 720) % 360;
      view.tilt = clampTilt(pinchStart.tilt + ((a.y + b.y) / 2 - pinchStart.midY) * 0.3);
      updateCamera();
      invalidate();
    } else if (pointers.size === 1 && pointer.moved) {
      if (pointer.mode === 'orbit') orbitBy(dx, dy);
      else panTo(pointer, event.clientX, event.clientY);
      updateCamera();
      invalidate();
    }
  }
  function orbitBy(dx, dy) {
    view.theta = (view.theta - dx * 0.45 + 720) % 360;
    view.tilt = clampTilt(view.tilt + dy * 0.3);
  }
  function panTo(pointer, clientX, clientY) {
    const now = groundAt(clientX, clientY);
    if (pointer.grabbed && now) {
      view.targetX += pointer.grabbed.x - now.x;
      view.targetZ += pointer.grabbed.z - now.z;
    } else {
      const rect = canvas.getBoundingClientRect();
      const worldPerPixel = 2 * cameraDistance() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, rect.height);
      const theta = THREE.MathUtils.degToRad(view.theta);
      const dx = clientX - pointer.x, dy = clientY - pointer.y;
      const right = { x: Math.cos(theta), z: -Math.sin(theta) };
      const forward = { x: -Math.sin(theta), z: -Math.cos(theta) };
      const sinT = Math.max(0.25, Math.sin(THREE.MathUtils.degToRad(view.tilt)));
      view.targetX -= (dx * right.x + (-dy / sinT) * forward.x) * worldPerPixel;
      view.targetZ -= (dx * right.z + (-dy / sinT) * forward.z) * worldPerPixel;
    }
    clampTarget();
  }
  function onPointerEnd(event) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 1) {
      const [remaining] = pointers.values();
      remaining.startX = remaining.x; remaining.startY = remaining.y; remaining.moved = false;
      remaining.grabbed = groundAt(remaining.x, remaining.y);
    }
    if (!pointer.moved && pointers.size === 0 && event.type === 'pointerup' && pointer.mode === 'pan') {
      onSelect?.(pickAt(event.clientX, event.clientY));
    }
  }
  function onWheel(event) {
    event.preventDefault();
    anim.view = null;
    view.zoom = clampZoom(view.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
    updateCamera();
    invalidate();
  }
  function onKeyDown(event) {
    const step = 24;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[event.key]) {
      anim.view = null;
      const [dx, dy] = arrows[event.key];
      if (event.shiftKey) orbitBy(dx, dy);
      else {
        const rect = canvas.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
        panTo({ x: centerX, y: centerY, grabbed: groundAt(centerX, centerY) }, centerX + dx, centerY + dy);
      }
    } else if (event.key === '+' || event.key === '=') view.zoom = clampZoom(view.zoom * 1.25);
    else if (event.key === '-' || event.key === '_') view.zoom = clampZoom(view.zoom / 1.25);
    else if (event.key === '0' || event.key === 'Home') { api.resetView(); event.preventDefault(); return; }
    else return;
    event.preventDefault();
    updateCamera();
    invalidate();
  }

  canvas.tabIndex = 0;
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('mousedown', event => { if (event.button === 1) event.preventDefault(); });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerEnd, { passive: true });
  window.addEventListener('pointercancel', onPointerEnd, { passive: true });
  const onBlur = () => { pointers.clear(); pinchStart = null; };
  window.addEventListener('blur', onBlur);
  const onVisibility = () => { documentVisible = !document.hidden; if (documentVisible) invalidate(); };
  document.addEventListener('visibilitychange', onVisibility);
  const onContextLost = event => { event.preventDefault(); contextLost = true; };
  const onContextRestored = () => { contextLost = false; invalidate(); };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  const intersection = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => { intersecting = entries.some(entry => entry.isIntersecting); if (intersecting) invalidate(); })
    : null;
  intersection?.observe(container);

  const bufferSize = new THREE.Vector2();
  function resize() {
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    updateCamera();
    renderer.getDrawingBufferSize(bufferSize);
    cloudUniforms.uScale.value = bufferSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    cloudUniforms.uMaxPx.value = 3.5 * renderer.getPixelRatio();
    invalidate();
  }
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  resizeObserver?.observe(container);
  resize();
  updateCamera();

  // Load-time reveal sweep from the "You" marker. A visual exploration effect only; it does not represent scan coverage.
  if (environment && layout === 'environment') {
    cloudUniforms.uReveal.value = 0;
    tween('reveal', 1800, k => { cloudUniforms.uReveal.value = k * envView.revealRadius; }, () => { cloudUniforms.uReveal.value = 1e4; });
  }

  const api = {
    kind: 'three',
    setObservation(snapshot) {
      validateSnapshot(snapshot);
      snapshotNow = Date.parse(snapshot.capturedAt) || Date.now();
      const radius = arrangementRadius(snapshot);
      const radiusChanged = radius !== arrangementRadiusValue;
      arrangementRadiusValue = radius;
      syncModeScale();
      buildGround(radius);
      ground.visible = layout === 'arrangement';
      const keep = new Set();
      for (const device of snapshot.devices) {
        keep.add(device.id);
        updateGlyph(glyphs.get(device.id) || createGlyph(device), device);
      }
      for (const [id, entry] of glyphs) {
        if (keep.has(id)) continue;
        glyphRoot.remove(entry.group);
        disposeObject(entry.group);
        glyphs.delete(id);
        counters.removed++;
      }
      applySelection();
      if (radiusChanged) { clampTarget(); updateCamera(); }
      invalidate();
    },
    setSelected(id) {
      const previous = selectedId;
      selectedId = id && glyphs.has(id) ? id : null;
      applySelection();
      if (selectedId && selectedId !== previous && environment) {
        tween('pulse', 900, (k, t) => { highlight.scale.setScalar(1 + 0.45 * Math.sin(Math.PI * t)); }, () => highlight.scale.setScalar(1));
      }
      invalidate();
    },
    focusOn(id) {
      if (!glyphs.has(id)) return false;
      animateView(focusView(id), 900);
      return true;
    },
    returnHome() { animateView(homeView(), 900); },
    setLayout(mode) {
      if (!environment) return layout;
      const next = mode === 'arrangement' ? 'arrangement' : 'environment';
      if (next === layout) return layout;
      layout = next;
      syncModeScale();
      const moves = [...glyphs.values()].map(entry => ({ entry, from: entry.group.position.clone(), to: positionFor(entry.device, next) }));
      for (const entry of glyphs.values()) applyLook(entry);
      const youFrom = you.position.clone(), youTo = youPosition(next);
      const scaleFrom = you.scale.x, scaleTo = youScale(next);
      const opacityFrom = cloudUniforms.uOpacity.value, opacityTo = next === 'environment' ? 1 : 0;
      ground.visible = true;
      if (cloud) cloud.visible = true;
      tween('layout', 800, k => {
        for (const move of moves) placeGlyph(move.entry, move.from.clone().lerp(move.to, k));
        you.position.copy(youFrom.clone().lerp(youTo, k));
        you.scale.setScalar(scaleFrom + (scaleTo - scaleFrom) * k);
        cloudUniforms.uOpacity.value = opacityFrom + (opacityTo - opacityFrom) * k;
        syncHighlight();
      }, () => {
        ground.visible = layout === 'arrangement';
        if (cloud) cloud.visible = layout === 'environment';
        for (const move of moves) placeGlyph(move.entry, move.to);
        syncHighlight();
      });
      animateView(selectedId && glyphs.has(selectedId) ? focusView(selectedId, next) : homeView(next), 900);
      return layout;
    },
    setDetail(level) {
      detail = level === 'low' ? 'low' : 'high';
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap()));
      buildCloud();
      resize();
      return detail;
    },
    setReducedMotion(value) { reducedMotion = Boolean(value); },
    onInteraction(listener) { interactionListeners.add(listener); return () => interactionListeners.delete(listener); },
    setVisible(visible) { sceneVisible = Boolean(visible); if (sceneVisible) invalidate(); else if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } },
    resize,
    resetView() {
      if (environment) { api.returnHome(); return; }
      Object.assign(view, homeView());
      updateCamera();
      invalidate();
    },
    zoomBy(factor) { anim.view = null; view.zoom = clampZoom(view.zoom * factor); updateCamera(); invalidate(); },
    stats() {
      const interval = summarize(frameTimes), render = summarize(renderTimes);
      return {
        kind: 'three', frames, renderingActive: Boolean(rafId), canRender: canRender(), contextLost,
        layout, detail, reducedMotion, animating: Object.values(anim).some(Boolean),
        points: cloud && layout === 'environment' ? cloudInfo.count : 0, pointParts: cloudInfo.parts, environmentPoints: cloudInfo.count,
        devices: glyphs.size, created: counters.created, updated: counters.updated, removed: counters.removed,
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, renderedPoints: renderer.info.render.points,
        geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
        pixelRatio: renderer.getPixelRatio(), size: { width: container.clientWidth, height: container.clientHeight },
        frameIntervalMs: interval, renderCpuMs: render, firstFrameAt,
        view: { ...view }
      };
    },
    benchmark(ms = 3000) {
      frameTimes.length = 0; renderTimes.length = 0;
      const startFrames = frames;
      spinUntil = performance.now() + ms;
      invalidate();
      return new Promise(resolve => setTimeout(() => {
        resolve({ ...api.stats(), benchmarkMs: ms, benchmarkFrames: frames - startFrames });
      }, ms + 100));
    },
    projectLocal(x, z, y = 0) { return projectWorld(x, y, z); },
    projectDevice(id) {
      const entry = glyphs.get(id);
      if (!entry) return null;
      const p = entry.group.position;
      return projectWorld(p.x, p.y + 0.45, p.z);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      intersection?.disconnect();
      motionQuery?.removeEventListener?.('change', onMotionChange);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const entry of glyphs.values()) disposeObject(entry.group);
      glyphs.clear();
      for (const child of [...ground.children]) disposeObject(child);
      disposeObject(you);
      if (cloud) cloud.geometry.dispose();
      cloudMaterial.dispose();
      for (const geometry of disposables) geometry.dispose();
      for (const texture of labelTextures.values()) texture.dispose();
      highlight.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    }
  };
  return api;
}
