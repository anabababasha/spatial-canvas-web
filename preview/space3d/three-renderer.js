// Three.js renderer for the isolated Space 3D prototype.
//
// Perspective camera, ground grid, modest lighting, dimensional device glyphs, raycast picking, selection highlight.
// Rendering is on demand: a frame is drawn only after a change, and never while the page, the container or the
// scene is hidden. Observation updates patch existing glyphs in place; the grid, lights and camera are built once.
//
// Gestures match the main app's Space view after the 2026-11-10 fix: one finger pans the ground under the finger,
// two fingers pinch (zoom), twist (rotate) and slide (tilt); Shift, right or middle drag orbits on desktop; wheel zooms;
// arrows pan, Shift+arrows orbit, +/- zoom, 0 resets.

import * as THREE from './vendor/three-0.187.0/three.module.min.js';
import {
  arrangementRadius, arrangementToLocal, brandTint, glyphShapeFor, isStale, validateSnapshot
} from './renderer-interface.js';

const VIEW_DEFAULTS = Object.freeze({ theta: 0, tilt: 56, zoom: 1, targetX: 0, targetZ: 0 });
const TILT_MIN = 15, TILT_MAX = 75, ZOOM_MIN = 0.5, ZOOM_MAX = 3, PAN_LIMIT_FACTOR = 1.1;
const NODE_HEIGHT = 0.9;

export function createThreeRenderer({ container, onSelect, forceFail = false }) {
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x060e1c, 1);
  container.replaceChildren(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x060e1c, 18, 60);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);

  // Modest lighting: a sky/ground hemisphere plus one key light. No shadows.
  scene.add(new THREE.HemisphereLight(0x9fc5ff, 0x0b1a30, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(6, 10, 4);
  scene.add(key);

  // Ground: grid, arrangement rings and the central "You" marker. All of it is layout, none of it is measurement.
  const ground = new THREE.Group();
  scene.add(ground);
  let groundRadius = 0;
  const disposables = new Set();
  const track = object => { disposables.add(object); return object; };

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
      const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.22 }));
      ground.add(ring);
    }
    const you = new THREE.Group();
    const youBase = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.06, 32), new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.35, roughness: 0.6 }));
    youBase.position.y = 0.03;
    const youPost = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 12), new THREE.MeshStandardMaterial({ color: 0xbae6fd }));
    youPost.position.y = 0.6;
    const youHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), new THREE.MeshStandardMaterial({ color: 0xe0f2fe, emissive: 0x38bdf8, emissiveIntensity: 0.6 }));
    youHead.position.y = 1.2;
    you.add(youBase, youPost, youHead);
    you.add(makeLabelSprite('YOU', 1.55, 0.72, 0.3));
    ground.add(you);
  }

  // Shared geometries; per-device materials (tint, stale opacity, selection emissive).
  const geometries = {
    pedestal: track(new THREE.CylinderGeometry(0.2, 0.24, 0.08, 20)),
    generic: track(new THREE.CapsuleGeometry(0.16, 0.42, 4, 12)),
    box: track(new THREE.BoxGeometry(0.5, 0.34, 0.34)),
    halo: track(new THREE.TorusGeometry(0.34, 0.025, 8, 32)),
    highlight: track(new THREE.TorusGeometry(0.5, 0.035, 10, 48))
  };
  const highlight = new THREE.Mesh(geometries.highlight, new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  highlight.rotation.x = Math.PI / 2;
  highlight.visible = false;
  scene.add(highlight);

  const labelTextures = new Map();
  function labelTexture(text) {
    if (labelTextures.has(text)) return labelTextures.get(text);
    const canvasLabel = document.createElement('canvas');
    canvasLabel.width = 128; canvasLabel.height = 64;
    const context = canvasLabel.getContext('2d');
    context.fillStyle = 'rgba(2, 6, 16, 0.72)';
    context.beginPath();
    context.roundRect(4, 8, 120, 48, 14);
    context.fill();
    context.fillStyle = '#f8fafc';
    context.font = 'bold 30px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 64, 33);
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

  const glyphRoot = new THREE.Group();
  scene.add(glyphRoot);
  const glyphs = new Map(); // id -> { group, body, halo, pedestal, label, shape, tint, stale }
  const counters = { created: 0, updated: 0, removed: 0 };
  let selectedId = null;
  let snapshotNow = Date.now();

  function createGlyph(device) {
    const group = new THREE.Group();
    const shape = glyphShapeFor(device);
    const tint = new THREE.Color(brandTint(device));
    const pedestal = new THREE.Mesh(geometries.pedestal, new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 }));
    pedestal.position.y = 0.04;
    const body = new THREE.Mesh(geometries[shape], new THREE.MeshStandardMaterial({ color: tint, roughness: 0.45, metalness: 0.15, emissive: tint, emissiveIntensity: 0.08, transparent: true }));
    body.position.y = shape === 'box' ? 0.08 + 0.17 : 0.08 + 0.37;
    const halo = new THREE.Mesh(geometries.halo, new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.8 }));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.09;
    const label = makeLabelSprite(`#${device.number}`, NODE_HEIGHT + 0.45, 0.62, 0.31);
    group.add(pedestal, body, halo, label);
    for (const mesh of [pedestal, body, halo]) mesh.userData.id = device.id;
    const entry = { group, body, halo, pedestal, label, shape, tint, stale: null, selected: false };
    glyphRoot.add(group);
    glyphs.set(device.id, entry);
    counters.created++;
    return entry;
  }

  function updateGlyph(entry, device) {
    const local = arrangementToLocal(device.arrangement);
    entry.group.position.set(local.x, 0, local.z);
    const stale = isStale(device, snapshotNow);
    if (entry.stale !== stale) {
      entry.stale = stale;
      entry.body.material.opacity = stale ? 0.4 : 1;
      entry.halo.material.opacity = stale ? 0.25 : 0.8;
      entry.label.material.opacity = stale ? 0.5 : 1;
    }
    const nextTint = brandTint(device);
    if (entry.tint.getHexString() !== nextTint.slice(1).toLowerCase()) {
      entry.tint.set(nextTint);
      entry.body.material.color.copy(entry.tint);
      entry.body.material.emissive.copy(entry.tint);
      entry.halo.material.color.copy(entry.tint);
    }
    const shape = glyphShapeFor(device);
    if (shape !== entry.shape) {
      entry.body.geometry = geometries[shape];
      entry.body.position.y = shape === 'box' ? 0.25 : 0.45;
      entry.shape = shape;
    }
    counters.updated++;
  }

  function applySelection() {
    for (const [id, entry] of glyphs) {
      const selected = id === selectedId;
      if (selected === entry.selected) continue;
      entry.selected = selected;
      entry.body.material.emissiveIntensity = selected ? 0.55 : 0.08;
      entry.group.scale.setScalar(selected ? 1.15 : 1);
    }
    const target = selectedId ? glyphs.get(selectedId) : null;
    highlight.visible = Boolean(target);
    if (target) highlight.position.set(target.group.position.x, 0.02, target.group.position.z);
  }

  function disposeObject(object) {
    object.traverse?.(child => {
      if (child.isMesh || child.isLine || child.isSprite) {
        if (child.geometry && !disposables.has(child.geometry)) child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (!material) continue;
          if (material.map && !labelTextures.has(material.map)) { /* label textures are shared and disposed with the renderer */ }
          material.dispose();
        }
      }
    });
  }

  // Camera state and math.
  const view = { ...VIEW_DEFAULTS, baseDistance: 12, radius: 4 };
  function updateCamera() {
    const phi = THREE.MathUtils.degToRad(view.tilt), theta = THREE.MathUtils.degToRad(view.theta);
    const distance = view.baseDistance / view.zoom;
    camera.position.set(
      view.targetX + distance * Math.cos(phi) * Math.sin(theta),
      distance * Math.sin(phi),
      view.targetZ + distance * Math.cos(phi) * Math.cos(theta)
    );
    camera.lookAt(view.targetX, 0, view.targetZ);
    camera.updateMatrixWorld();
  }
  const clampTilt = value => Math.max(TILT_MIN, Math.min(TILT_MAX, value));
  const clampZoom = value => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
  function clampTarget() {
    const limit = view.radius * PAN_LIMIT_FACTOR;
    const magnitude = Math.hypot(view.targetX, view.targetZ);
    if (magnitude > limit) { view.targetX *= limit / magnitude; view.targetZ *= limit / magnitude; }
  }

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
    if (!point) return null;
    // Reject hits far behind or beyond a sane range (near-horizon rays).
    if (point.distanceTo(camera.position) > view.baseDistance * 6) return null;
    return point;
  }
  function pickAt(clientX, clientY) {
    raycaster.setFromCamera(toNdc(clientX, clientY), camera);
    const hits = raycaster.intersectObjects(glyphRoot.children, true);
    for (const hit of hits) {
      const id = hit.object.userData?.id;
      if (id) return id;
    }
    return null;
  }

  // Render on demand.
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
    const started = performance.now();
    renderer.render(scene, camera);
    const renderMs = performance.now() - started;
    frames++;
    if (!firstFrameAt) { firstFrameAt = performance.now(); performance.mark?.('space3d-first-frame'); }
    if (lastFrameAt) pushSample(frameTimes, now - lastFrameAt);
    pushSample(renderTimes, renderMs);
    lastFrameAt = now;
    if (now < spinUntil) {
      view.theta = (view.theta + 0.6) % 360;
      updateCamera();
      invalidate();
    } else {
      lastFrameAt = 0; // intervals are only meaningful during continuous rendering
    }
  }
  function pushSample(list, value) { list.push(value); if (list.length > 600) list.shift(); }
  function summarize(list) {
    if (!list.length) return { mean: null, p95: null, max: null, n: 0 };
    const sorted = [...list].sort((a, b) => a - b);
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    return { mean, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], max: sorted[sorted.length - 1], n: sorted.length };
  }

  // Gesture handling (pointer events; touch-action: none is set in CSS).
  const pointers = new Map();
  let pinchStart = null;
  const gestureMode = event => ((event.button ?? 0) === 1 || event.button === 2 || event.shiftKey || event.ctrlKey) ? 'orbit' : 'pan';
  function onPointerDown(event) {
    if ((event.button ?? 0) > 2) return;
    canvas.focus?.({ preventScroll: true });
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
      view.theta = (pinchStart.theta + twist + 720) % 360; // clockwise on screen turns the arrangement clockwise
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
    // Near ground follows the finger horizontally: the camera orbits the opposite way. Drag down looks more from above.
    view.theta = (view.theta - dx * 0.45 + 720) % 360;
    view.tilt = clampTilt(view.tilt + dy * 0.3);
  }
  function panTo(pointer, clientX, clientY) {
    const now = groundAt(clientX, clientY);
    if (pointer.grabbed && now) {
      // Move the target so the grabbed ground point lands under the finger (camera and target translate together).
      view.targetX += pointer.grabbed.x - now.x;
      view.targetZ += pointer.grabbed.z - now.z;
    } else {
      // Above the horizon no ground point exists: approximate with the ground scale at the target distance.
      const rect = canvas.getBoundingClientRect();
      const worldPerPixel = 2 * (view.baseDistance / view.zoom) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, rect.height);
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
    view.zoom = clampZoom(view.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
    updateCamera();
    invalidate();
  }
  function onKeyDown(event) {
    const step = 24;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[event.key]) {
      const [dx, dy] = arrows[event.key];
      if (event.shiftKey) orbitBy(dx, dy);
      else {
        const rect = canvas.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
        const pointer = { x: centerX, y: centerY, grabbed: groundAt(centerX, centerY) };
        panTo(pointer, centerX + dx, centerY + dy);
      }
    } else if (event.key === '+' || event.key === '=') view.zoom = clampZoom(view.zoom * 1.25);
    else if (event.key === '-' || event.key === '_') view.zoom = clampZoom(view.zoom / 1.25);
    else if (event.key === '0' || event.key === 'Home') Object.assign(view, VIEW_DEFAULTS);
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

  function resize() {
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    invalidate();
  }
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  resizeObserver?.observe(container);
  resize();
  updateCamera();

  return {
    kind: 'three',
    setObservation(snapshot) {
      validateSnapshot(snapshot);
      snapshotNow = Date.parse(snapshot.capturedAt) || Date.now();
      const radius = arrangementRadius(snapshot);
      const radiusChanged = radius !== view.radius;
      view.radius = radius;
      view.baseDistance = Math.max(10, radius * 2.8);
      buildGround(radius);
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
    setSelected(id) { selectedId = id || null; applySelection(); invalidate(); },
    setVisible(visible) { sceneVisible = Boolean(visible); if (sceneVisible) invalidate(); else if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } },
    resize,
    resetView() { Object.assign(view, VIEW_DEFAULTS); updateCamera(); invalidate(); },
    zoomBy(factor) { view.zoom = clampZoom(view.zoom * factor); updateCamera(); invalidate(); },
    stats() {
      const interval = summarize(frameTimes), render = summarize(renderTimes);
      return {
        kind: 'three', frames, renderingActive: Boolean(rafId), canRender: canRender(), contextLost,
        devices: glyphs.size, created: counters.created, updated: counters.updated, removed: counters.removed,
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
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
        const result = this.stats();
        resolve({ ...result, benchmarkMs: ms, benchmarkFrames: frames - startFrames });
      }, ms + 100));
    },
    projectLocal(x, z, y = 0) {
      const vector = new THREE.Vector3(x, y, z).project(camera);
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + (vector.x + 1) / 2 * rect.width, y: rect.top + (1 - vector.y) / 2 * rect.height, depth: vector.z };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      intersection?.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const entry of glyphs.values()) disposeObject(entry.group);
      glyphs.clear();
      for (const child of [...ground.children]) disposeObject(child);
      for (const geometry of disposables) geometry.dispose();
      for (const texture of labelTextures.values()) texture.dispose();
      highlight.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    }
  };
}
