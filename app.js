import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

/* =========================================================
   ELECTRICITY LAB — LEVEL 1 (Fixed black screen + Stage 2 ready)
   ========================================================= */

const BULB_RESISTANCE = 6;
const BULB_RATED_VOLTAGE = 3;
const BULB_RATED_POWER = (BULB_RATED_VOLTAGE ** 2) / BULB_RESISTANCE;
const MIN_VOLTAGE = 0.5;
const MAX_VOLTAGE = 12;
const VOLTAGE_STEP = 0.5;

// Wire tuning – slightly stiffer, still natural sag
const ROPE_PARTICLE_COUNT = 22;
const ROPE_SOLVER_ITERATIONS = 12;
const ROPE_GRAVITY = 4.2;
const ROPE_DAMPING = 0.978;
const ROPE_RADIUS = 0.042;
const ROPE_GROUND_HEIGHT = 0.075;

let voltage = 3;
let circuitComplete = false;
let bulbFailed = false;
let filamentDamage = 0;
let lastFrameTime = 0;
let showElectronFlow = false;

const $ = (id) => document.getElementById(id);

/* =========================================================
   SCREEN NAVIGATION
   ========================================================= */
const screens = {
  home: $("home-screen"),
  levels: $("levels-screen"),
  sandbox: $("sandbox-screen"),
  game: $("game-screen"),
};

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    if (el) el.classList.toggle("hidden", key !== name);
  }

  // Critical fix for black screen
  if (name === "game") {
    // Wait one frame so the container is actually visible and has size
    requestAnimationFrame(() => {
      resizeRenderer();
      // Force another resize shortly after in case of CSS transitions
      setTimeout(resizeRenderer, 50);
      setTimeout(resizeRenderer, 200);
    });
  }
}

$("learn-button")?.addEventListener("click", () => showScreen("levels"));
$("sandbox-button")?.addEventListener("click", () => showScreen("sandbox"));
$("levels-back-button")?.addEventListener("click", () => showScreen("home"));
$("game-back-button")?.addEventListener("click", () => showScreen("levels"));
document.querySelectorAll(".back-home-button").forEach(btn => {
  btn.addEventListener("click", () => showScreen("home"));
});
$("level-one-button")?.addEventListener("click", () => showScreen("game"));

/* =========================================================
   THREE.JS SETUP
   ========================================================= */
const canvas = $("scene-canvas");
const container = $("scene-container");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0c1523");

const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
camera.position.set(0, 9.5, 8);
camera.lookAt(0, 0.3, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

// Lights
scene.add(new THREE.HemisphereLight("#dceaff", "#17243a", 1.8));
const keyLight = new THREE.DirectionalLight("#ffffff", 2.4);
keyLight.position.set(-5, 10, 6);
keyLight.castShadow = true;
scene.add(keyLight);
const fillLight = new THREE.PointLight("#4a9cff", 40, 20);
fillLight.position.set(5, 5, -4);
scene.add(fillLight);

/* =========================================================
   WORKBENCH
   ========================================================= */
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 14),
  new THREE.MeshStandardMaterial({ color: "#101b2b", roughness: 0.9, metalness: 0.05 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.03;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(20, 40, "#29415b", "#1a2b40");
grid.position.y = 0.005;
scene.add(grid);

const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPoint = new THREE.Vector3();
let dragging = null;
const interactiveObjects = [];

/* =========================================================
   MATERIALS
   ========================================================= */
const materials = {
  battery: new THREE.MeshStandardMaterial({ color: "#263b58", metalness: 0.55, roughness: 0.32 }),
  metal: new THREE.MeshStandardMaterial({ color: "#b9c9d9", metalness: 0.9, roughness: 0.22 }),
  red: new THREE.MeshStandardMaterial({ color: "#ff535d", emissive: "#63141b", emissiveIntensity: 0.3, roughness: 0.4 }),
  black: new THREE.MeshStandardMaterial({ color: "#303b4b", roughness: 0.48 }),
  bulbBase: new THREE.MeshStandardMaterial({ color: "#8b9db3", metalness: 0.7, roughness: 0.28 }),
  bulbGlass: new THREE.MeshPhysicalMaterial({
    color: "#fff6df", emissive: "#ffad35", emissiveIntensity: 0.04,
    roughness: 0.08, metalness: 0, transmission: 0.88, transparent: true,
    opacity: 0.28, thickness: 0.12, ior: 1.45, depthWrite: false
  }),
  filament: new THREE.MeshStandardMaterial({
    color: "#ffcb74", emissive: "#ff6b20", emissiveIntensity: 0.04, metalness: 0.35, roughness: 0.38
  }),
  electron: new THREE.MeshBasicMaterial({ color: "#4fc3ff", transparent: true, opacity: 0.9 }),
};

/* =========================================================
   HELPERS
   ========================================================= */
function makeMesh(geo, mat, parent, pos) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos.x, pos.y, pos.z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const terminals = {};
function makeTerminal(parent, id, x, y, z, color) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);
  const padMat = new THREE.MeshStandardMaterial({ color, metalness: 0.82, roughness: 0.24 });
  makeMesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 20), padMat, group, { x: 0, y: 0, z: 0 });
  makeMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 16), materials.metal, group, { x: 0, y: 0.04, z: 0 });
  terminals[id] = { id, parent, localPosition: new THREE.Vector3(x, y, z), mesh: group };
  return group;
}

function makeTextSprite(text, color) {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.font = "bold 82px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 65);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(0.32, 0.32, 1);
  return sprite;
}

/* =========================================================
   BATTERY
   ========================================================= */
const battery = new THREE.Group();
battery.position.set(-2.6, 0, 0);
battery.userData.dragType = "component";
scene.add(battery);

const batBody = makeMesh(new THREE.CylinderGeometry(0.42, 0.42, 1.3, 32), materials.battery, battery, { x: 0, y: 0.42, z: 0 });
batBody.rotation.z = Math.PI / 2;
makeMesh(new THREE.CylinderGeometry(0.23, 0.23, 0.12, 20), materials.red, battery, { x: -0.7, y: 0.42, z: 0 }).rotation.z = Math.PI / 2;
makeMesh(new THREE.CylinderGeometry(0.23, 0.23, 0.12, 20), materials.metal, battery, { x: 0.7, y: 0.42, z: 0 }).rotation.z = Math.PI / 2;

makeTerminal(battery, "batteryPlus", -0.82, 0.42, 0, "#ff626b");
makeTerminal(battery, "batteryMinus", 0.82, 0.42, 0, "#cbd7e6");

const plusMark = makeTextSprite("+", "#ff858b");
plusMark.position.set(-0.35, 0.9, 0);
battery.add(plusMark);
const minusMark = makeTextSprite("−", "#d9e4f3");
minusMark.position.set(0.35, 0.9, 0);
battery.add(minusMark);

/* =========================================================
   BULB
   ========================================================= */
const bulb = new THREE.Group();
bulb.position.set(2.6, 0, 0);
bulb.userData.dragType = "component";
scene.add(bulb);

makeMesh(new THREE.CylinderGeometry(0.28, 0.26, 0.34, 28), materials.bulbBase, bulb, { x: 0, y: 0.28, z: 0 });
for (let i = 0; i < 4; i++) {
  makeMesh(new THREE.TorusGeometry(0.27, 0.022, 8, 24), materials.metal, bulb, { x: 0, y: 0.15 + i * 0.08, z: 0 }).rotation.x = Math.PI / 2;
}

const globe = makeMesh(new THREE.SphereGeometry(0.38, 36, 28), materials.bulbGlass, bulb, { x: 0, y: 0.76, z: 0 });
globe.scale.set(1, 1.12, 1);

const filamentPoints = [];
for (let i = 0; i <= 80; i++) {
  const t = i / 80;
  const a = t * Math.PI * 2 * 7;
  filamentPoints.push(new THREE.Vector3(Math.cos(a) * 0.085, 0.75 + t * 0.2, Math.sin(a) * 0.085));
}
const filamentMesh = new THREE.Mesh(
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(filamentPoints), 180, 0.011, 6, false),
  materials.filament
);
bulb.add(filamentMesh);

const bulbLight = new THREE.PointLight("#ffbd63", 0, 5);
bulbLight.position.set(0, 0.82, 0);
bulb.add(bulbLight);

makeTerminal(bulb, "bulbA", -0.52, 0.3, 0, "#dce7f5");
makeTerminal(bulb, "bulbB", 0.52, 0.3, 0, "#dce7f5");

/* =========================================================
   WIRES
   ========================================================= */
function makeConnector(mat) {
  const g = new THREE.Group();
  makeMesh(new THREE.CylinderGeometry(0.1, 0.085, 0.28, 14), mat, g, { x: 0, y: 0, z: 0 });
  makeMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 12), materials.metal, g, { x: 0, y: 0.18, z: 0 });
  makeMesh(new THREE.CylinderGeometry(0.07, 0.085, 0.09, 12), materials.metal, g, { x: 0, y: -0.16, z: 0 });
  return g;
}

function makeWire(mat, start, end, length) {
  const startEnd = makeConnector(mat);
  const finishEnd = makeConnector(mat);
  startEnd.position.copy(start);
  finishEnd.position.copy(end);
  startEnd.userData.isWireEnd = true;
  finishEnd.userData.isWireEnd = true;
  scene.add(startEnd, finishEnd);
  interactiveObjects.push(startEnd, finishEnd);

  const particles = [];
  for (let i = 0; i < ROPE_PARTICLE_COUNT; i++) {
    const t = i / (ROPE_PARTICLE_COUNT - 1);
    const p = start.clone().lerp(end, t);
    p.y -= Math.sin(t * Math.PI) * 0.16;
    particles.push({ position: p, previous: p.clone() });
  }

  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(particles.map(p => p.position)), ROPE_PARTICLE_COUNT * 2, ROPE_RADIUS, 8, false),
    mat
  );
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  scene.add(mesh);

  const wire = {
    material: mat,
    length,
    ends: [
      { connector: startEnd, terminalId: null },
      { connector: finishEnd, terminalId: null }
    ],
    particles,
    mesh,
    segmentLength: length / (ROPE_PARTICLE_COUNT - 1)
  };

  startEnd.userData.wire = wire;
  startEnd.userData.endIndex = 0;
  finishEnd.userData.wire = wire;
  finishEnd.userData.endIndex = 1;

  return wire;
}

const redWire = makeWire(materials.red,
  new THREE.Vector3(-3.4, 0.42, 0),
  new THREE.Vector3(1.5, 0.32, 0.65), 5.9);

const blackWire = makeWire(materials.black,
  new THREE.Vector3(3.1, 0.3, 0),
  new THREE.Vector3(-1.5, 0.32, -0.65), 5.9);

const wires = [redWire, blackWire];
interactiveObjects.push(battery, bulb);

/* =========================================================
   TERMINAL HELPERS
   ========================================================= */
function getTerminalPosition(id) {
  const t = terminals[id];
  if (!t) return new THREE.Vector3();
  t.parent.updateMatrixWorld(true);
  return t.localPosition.clone().applyMatrix4(t.parent.matrixWorld);
}

function getEndPosition(wire, idx) {
  const end = wire.ends[idx];
  return end.terminalId ? getTerminalPosition(end.terminalId) : end.connector.position.clone();
}

function setEndPosition(wire, idx, pos) {
  const end = wire.ends[idx];
  if (!end.terminalId) end.connector.position.copy(pos);
}

/* =========================================================
   ROPE SIMULATION
   ========================================================= */
function simulateWire(wire, dt) {
  const pts = wire.particles;
  const last = pts.length - 1;

  pts[0].position.copy(getEndPosition(wire, 0));
  pts[last].position.copy(getEndPosition(wire, 1));
  pts[0].previous.copy(pts[0].position);
  pts[last].previous.copy(pts[last].position);

  const step = Math.min(dt, 0.022);
  const g = ROPE_GRAVITY * step * step;

  for (let i = 1; i < last; i++) {
    const p = pts[i];
    const curr = p.position.clone();
    const vel = p.position.clone().sub(p.previous).multiplyScalar(ROPE_DAMPING);
    p.position.add(vel);
    p.position.y -= g;
    p.previous.copy(curr);
    if (p.position.y < ROPE_GROUND_HEIGHT) {
      p.position.y = ROPE_GROUND_HEIGHT;
      if (p.previous.y > p.position.y) p.previous.y = p.position.y;
    }
  }

  for (let iter = 0; iter < ROPE_SOLVER_ITERATIONS; iter++) {
    pts[0].position.copy(getEndPosition(wire, 0));
    pts[last].position.copy(getEndPosition(wire, 1));

    for (let i = 0; i < last; i++) {
      const a = pts[i], b = pts[i + 1];
      const diff = b.position.clone().sub(a.position);
      const dist = diff.length();
      if (dist < 1e-5) continue;
      const corr = diff.multiplyScalar((dist - wire.segmentLength) / dist);
      if (i === 0) b.position.sub(corr);
      else if (i + 1 === last) a.position.add(corr);
      else {
        a.position.addScaledVector(corr, 0.5);
        b.position.addScaledVector(corr, -0.5);
      }
    }
  }

  pts[0].position.copy(getEndPosition(wire, 0));
  pts[last].position.copy(getEndPosition(wire, 1));

  const curve = new THREE.CatmullRomCurve3(pts.map(p => p.position));
  const old = wire.mesh.geometry;
  wire.mesh.geometry = new THREE.TubeGeometry(curve, (ROPE_PARTICLE_COUNT - 1) * 3, ROPE_RADIUS, 8, false);
  old.dispose();
}

/* =========================================================
   CIRCUIT LOGIC
   ========================================================= */
function wireConnects(wire, a, b) {
  const ids = wire.ends.map(e => e.terminalId);
  return ids.includes(a) && ids.includes(b);
}

function isTerminalOccupied(id, except = null) {
  return wires.some(w => w.ends.some(e => e.terminalId === id && e !== except));
}

function updateCircuit() {
  circuitComplete =
    wireConnects(redWire, "batteryPlus", "bulbA") &&
    wireConnects(blackWire, "bulbB", "batteryMinus");
  updateReadings();
  updateBulbAppearance();
  updateStatus();
}

function updateStatus() {
  const status = $("circuit-status");
  const hint = $("scene-hint");
  if (!status || !hint) return;

  status.classList.toggle("complete", circuitComplete && !bulbFailed);
  if (bulbFailed) {
    status.innerHTML = '<span class="status-dot"></span> Bulb burned out';
    hint.textContent = "Filament failed. Reset to try again.";
  } else if (circuitComplete) {
    status.innerHTML = '<span class="status-dot"></span> Circuit complete';
    hint.textContent = "Loop complete. Adjust voltage and observe.";
  } else {
    status.innerHTML = '<span class="status-dot"></span> Circuit incomplete';
    hint.textContent = "Red: Battery + → Bulb left. Black: Bulb right → Battery −.";
  }
}

function calculateCircuit() {
  if (!circuitComplete || bulbFailed) return { current: 0, power: 0 };
  const current = voltage / BULB_RESISTANCE;
  return { current, power: voltage * current };
}

function updateReadings() {
  const { current, power } = calculateCircuit();
  if ($("voltage-value")) $("voltage-value").textContent = voltage.toFixed(1);
  if ($("current-value")) $("current-value").textContent = current.toFixed(3);
  if ($("power-value")) $("power-value").textContent = power.toFixed(3);
  if ($("resistance-value")) $("resistance-value").textContent = BULB_RESISTANCE.toFixed(1);

  const pct = ((voltage - MIN_VOLTAGE) / (MAX_VOLTAGE - MIN_VOLTAGE)) * 100;
  if ($("voltage-track-fill")) $("voltage-track-fill").style.width = `${Math.max(0, Math.min(100, pct))}%`;

  const note = $("measurement-note");
  if (note) {
    if (bulbFailed) {
      note.classList.remove("active");
      note.textContent = "Open circuit – filament broken.";
    } else if (!circuitComplete) {
      note.classList.remove("active");
      note.textContent = "No complete path. Current = 0.";
    } else {
      note.classList.add("active");
      note.textContent = `${voltage.toFixed(1)} V ÷ ${BULB_RESISTANCE} Ω = ${current.toFixed(3)} A → ${power.toFixed(3)} W`;
    }
  }
}

function updateBulbAppearance() {
  const { power } = calculateCircuit();
  if (bulbFailed) {
    materials.filament.emissiveIntensity = 0;
    materials.filament.color.set("#3b3430");
    materials.bulbGlass.emissiveIntensity = 0;
    bulbLight.intensity = 0;
    return;
  }
  const b = Math.min(power / BULB_RATED_POWER, 1.5);
  materials.filament.color.set("#ffcb74");
  materials.filament.emissive.set("#ff6b20");
  materials.filament.emissiveIntensity = 0.04 + b * 2.6;
  materials.bulbGlass.emissiveIntensity = 0.015 + b * 0.15;
  bulbLight.intensity = Math.min(b * 3.2, 5);
  if (power > BULB_RATED_POWER) materials.filament.emissive.set("#fff0a1");
}

function updateBulbDamage(dt) {
  if (!circuitComplete || bulbFailed) return;
  const { power } = calculateCircuit();
  const ratio = power / BULB_RATED_POWER;
  if (ratio > 1.15) {
    filamentDamage += dt * (ratio - 1.15) * 0.07;
    if (filamentDamage >= 1) {
      bulbFailed = true;
      updateReadings();
      updateBulbAppearance();
      updateStatus();
    }
  }
}

/* =========================================================
   ELECTRON FLOW (Negative → Positive)
   ========================================================= */
const electronParticles = [];
const electronGroup = new THREE.Group();
scene.add(electronGroup);

for (let i = 0; i < 42; i++) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), materials.electron);
  m.visible = false;
  electronGroup.add(m);
  electronParticles.push({ mesh: m, t: Math.random(), speed: 0.16 + Math.random() * 0.14 });
}

function updateElectronFlow(dt) {
  const active = showElectronFlow && circuitComplete && !bulbFailed;
  electronGroup.visible = active;
  if (!active) return;

  const path = [];
  // Electron path: Battery − → black wire → bulb → red wire → Battery +
  for (let i = 0; i < blackWire.particles.length; i++) path.push(blackWire.particles[i].position.clone());
  path.push(getTerminalPosition("bulbB"));
  path.push(getTerminalPosition("bulbA"));
  for (let i = redWire.particles.length - 1; i >= 0; i--) path.push(redWire.particles[i].position.clone());

  if (path.length < 3) return;
  const curve = new THREE.CatmullRomCurve3(path);

  for (const p of electronParticles) {
    p.t += p.speed * dt;
    if (p.t > 1) p.t -= 1;
    p.mesh.position.copy(curve.getPoint(p.t));
    p.mesh.visible = true;
  }
}

/* =========================================================
   CONTROLS
   ========================================================= */
function setVoltage(v) {
  voltage = THREE.MathUtils.clamp(Math.round(v * 10) / 10, MIN_VOLTAGE, MAX_VOLTAGE);
  updateReadings();
  updateBulbAppearance();
}
$("voltage-down")?.addEventListener("click", () => setVoltage(voltage - VOLTAGE_STEP));
$("voltage-up")?.addEventListener("click", () => setVoltage(voltage + VOLTAGE_STEP));

/* =========================================================
   POINTER
   ========================================================= */
function setPointer(e) {
  const r = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

function getGround(e) {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray.intersectPlane(dragPlane, dragPoint) ? dragPoint.clone() : null;
}

function findWireEnd(obj) {
  let c = obj;
  while (c && c !== scene) {
    if (c.userData.isWireEnd) return c;
    c = c.parent;
  }
  return null;
}

function findComponent(obj) {
  let c = obj;
  while (c && c !== scene) {
    if (c.userData.dragType === "component") return c;
    c = c.parent;
  }
  return null;
}

function clampLength(wire, idx, candidate) {
  const other = getEndPosition(wire, idx === 0 ? 1 : 0);
  const diff = candidate.clone().sub(other);
  const d = diff.length();
  if (d <= wire.length) return candidate;
  return other.add(diff.multiplyScalar(wire.length / d));
}

function snapEnd(wire, idx) {
  const end = wire.ends[idx];
  const pos = end.connector.position;
  let best = null, bestD = Infinity;
  for (const id of Object.keys(terminals)) {
    const d = pos.distanceTo(getTerminalPosition(id));
    if (d < bestD && !isTerminalOccupied(id, end)) {
      bestD = d;
      best = id;
    }
  }
  if (best && bestD < 0.45) {
    end.terminalId = best;
    end.connector.position.copy(getTerminalPosition(best));
  }
}

canvas.addEventListener("pointerdown", e => {
  if (e.button !== 0 && e.pointerType !== "touch") return;
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interactiveObjects, true);
  if (!hits.length) return;

  const we = findWireEnd(hits[0].object);
  if (we) {
    const w = we.userData.wire;
    const idx = we.userData.endIndex;
    w.ends[idx].terminalId = null;
    dragging = { type: "wireEnd", wire: w, endIndex: idx, object: we };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }

  const comp = findComponent(hits[0].object);
  if (comp) {
    const pt = getGround(e);
    if (!pt) return;
    dragging = {
      type: "component",
      object: comp,
      offset: new THREE.Vector3(comp.position.x - pt.x, 0, comp.position.z - pt.z)
    };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
});

canvas.addEventListener("pointermove", e => {
  if (!dragging) return;
  const pt = getGround(e);
  if (!pt) return;

  if (dragging.type === "wireEnd") {
    const cand = new THREE.Vector3(pt.x, 0.34, pt.z);
    setEndPosition(dragging.wire, dragging.endIndex, clampLength(dragging.wire, dragging.endIndex, cand));
  } else {
    dragging.object.position.x = pt.x + dragging.offset.x;
    dragging.object.position.z = pt.z + dragging.offset.z;
  }
});

function endDrag(e) {
  if (!dragging) return;
  if (dragging.type === "wireEnd") {
    snapEnd(dragging.wire, dragging.endIndex);
    updateCircuit();
  }
  dragging = null;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

/* =========================================================
   RESET
   ========================================================= */
function resetLayout() {
  battery.position.set(-2.6, 0, 0);
  bulb.position.set(2.6, 0, 0);
  for (const w of wires) for (const e of w.ends) e.terminalId = null;

  redWire.ends[0].connector.position.set(-3.4, 0.42, 0);
  redWire.ends[1].connector.position.set(1.5, 0.32, 0.65);
  blackWire.ends[0].connector.position.set(3.1, 0.3, 0);
  blackWire.ends[1].connector.position.set(-1.5, 0.32, -0.65);

  for (const w of wires) {
    const a = getEndPosition(w, 0), b = getEndPosition(w, 1);
    for (let i = 0; i < w.particles.length; i++) {
      const t = i / (w.particles.length - 1);
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(t * Math.PI) * 0.16;
      w.particles[i].position.copy(p);
      w.particles[i].previous.copy(p);
    }
  }

  voltage = 3;
  filamentDamage = 0;
  bulbFailed = false;
  materials.filament.color.set("#ffcb74");
  materials.filament.emissive.set("#ff6b20");
  updateCircuit();
}
$("reset-button")?.addEventListener("click", resetLayout);

/* =========================================================
   UI BUTTONS (Electron + Toolbox)
   ========================================================= */
function ensureButtons() {
  if (!$("electron-toggle")) {
    const btn = document.createElement("button");
    btn.id = "electron-toggle";
    btn.textContent = "Electron Flow: OFF";
    btn.style.cssText = `
      position:fixed; bottom:22px; left:22px; z-index:200;
      padding:11px 16px; border-radius:8px; border:1px solid #2a3f5c;
      background:#122033; color:#e0f0ff; font-size:13px; cursor:pointer;
    `;
    btn.onclick = () => {
      showElectronFlow = !showElectronFlow;
      btn.textContent = `Electron Flow: ${showElectronFlow ? "ON" : "OFF"}`;
      btn.style.background = showElectronFlow ? "#1a4a70" : "#122033";
    };
    document.body.appendChild(btn);
  }

  if (!$("toolbox-button")) {
    const btn = document.createElement("button");
    btn.id = "toolbox-button";
    btn.textContent = "Toolbox";
    btn.style.cssText = `
      position:fixed; bottom:22px; left:190px; z-index:200;
      padding:11px 16px; border-radius:8px; border:1px solid #2a3f5c;
      background:#122033; color:#e0f0ff; font-size:13px; cursor:pointer;
    `;
    btn.onclick = () => {
      alert("Toolbox tools coming next:\n\n• Multimeter (probes)\n• Inline Ammeter\n• Clamp Meter\n• Note Pad");
    };
    document.body.appendChild(btn);
  }
}
ensureButtons();

/* =========================================================
   RESIZE + LOOP
   ========================================================= */
function resizeRenderer() {
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w < 10 || h < 10) return; // still hidden
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resizeRenderer);

function animate(t) {
  requestAnimationFrame(animate);
  const dt = lastFrameTime ? Math.min((t - lastFrameTime) / 1000, 0.025) : 0;
  lastFrameTime = t;

  for (const w of wires) simulateWire(w, dt);
  updateBulbDamage(dt);
  updateElectronFlow(dt);
  renderer.render(scene, camera);
}

// Initial
resizeRenderer();
updateCircuit();
animate(0);
showScreen("home");
