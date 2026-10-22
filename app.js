import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

/* =========================================================
   ELECTRICITY LAB — LEVEL 1 (Polished)
   - Slightly stiffer copper wires
   - Wire ends permanently fixed
   - Minimizable UI panels
   - Electron flow visual layer (Negative → Positive)
   - Toolbox foundation
   ========================================================= */

const BULB_RESISTANCE = 6;
const BULB_RATED_VOLTAGE = 3;
const BULB_RATED_POWER = BULB_RATED_VOLTAGE * BULB_RATED_VOLTAGE / BULB_RESISTANCE;
const MIN_VOLTAGE = 0.5;
const MAX_VOLTAGE = 12;
const VOLTAGE_STEP = 0.5;

// --- Wire tuning (slightly stiffer) ---
const ROPE_PARTICLE_COUNT = 22;
const ROPE_SOLVER_ITERATIONS = 12;      // was 8 → higher = stiffer
const ROPE_GRAVITY = 4.2;              // was 7 → less sag
const ROPE_DAMPING = 0.978;
const ROPE_RADIUS = 0.042;
const ROPE_GROUND_HEIGHT = 0.075;

let voltage = 3;
let circuitComplete = false;
let bulbFailed = false;
let filamentDamage = 0;
let lastFrameTime = 0;
let showElectronFlow = false;          // visual layer OFF by default

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
  for (const [screenName, element] of Object.entries(screens)) {
    element.classList.toggle("hidden", screenName !== name);
  }
  if (name === "game") {
    requestAnimationFrame(resizeRenderer);
  }
}

$("learn-button")?.addEventListener("click", () => showScreen("levels"));
$("sandbox-button")?.addEventListener("click", () => showScreen("sandbox"));
$("levels-back-button")?.addEventListener("click", () => showScreen("home"));
$("game-back-button")?.addEventListener("click", () => showScreen("levels"));
document.querySelectorAll(".back-home-button").forEach((btn) => {
  btn.addEventListener("click", () => showScreen("home"));
});
$("level-one-button")?.addEventListener("click", () => showScreen("game"));

/* =========================================================
   THREE.JS SCENE
   ========================================================= */
const canvas = $("scene-canvas");
const container = $("scene-container");
const scene = new THREE.Scene();
scene.background = new THREE.Color("#0c1523");

const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
camera.position.set(0, 10, 7.5);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

scene.add(new THREE.HemisphereLight("#dceaff", "#17243a", 2));
const keyLight = new THREE.DirectionalLight("#ffffff", 2.2);
keyLight.position.set(-4, 9, 5);
keyLight.castShadow = true;
scene.add(keyLight);
const fillLight = new THREE.PointLight("#438bff", 35, 18);
fillLight.position.set(4, 4, -4);
scene.add(fillLight);

/* =========================================================
   WORKBENCH
   ========================================================= */
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(18, 12),
  new THREE.MeshStandardMaterial({ color: "#101b2b", roughness: 0.92, metalness: 0.05 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.03;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(18, 36, "#29415b", "#1a2b40");
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
  electron: new THREE.MeshBasicMaterial({ color: "#4fc3ff", transparent: true, opacity: 0.85 }),
};

/* =========================================================
   HELPERS
   ========================================================= */
function makeMesh(geometry, material, parent, position) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, position.y, position.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const terminals = {};
function makeTerminal(parent, id, x, y, z, color) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);

  const padMaterial = new THREE.MeshStandardMaterial({ color, metalness: 0.82, roughness: 0.24 });
  makeMesh(new THREE.CylinderGeometry(0.135, 0.135, 0.075, 24), padMaterial, group, { x: 0, y: 0, z: 0 });
  makeMesh(new THREE.CylinderGeometry(0.075, 0.075, 0.035, 20), materials.metal, group, { x: 0, y: 0.045, z: 0 });

  terminals[id] = { id, parent, localPosition: new THREE.Vector3(x, y, z), mesh: group };
  return group;
}

function makeTextSprite(text, color) {
  const textCanvas = document.createElement("canvas");
  textCanvas.width = 128;
  textCanvas.height = 128;
  const ctx = textCanvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = color;
  ctx.font = "bold 82px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 65);
  const texture = new THREE.CanvasTexture(textCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(0.34, 0.34, 1);
  return sprite;
}

/* =========================================================
   BATTERY
   ========================================================= */
const battery = new THREE.Group();
battery.position.set(-2.5, 0, 0);
battery.userData.dragType = "component";
battery.userData.componentName = "battery";
scene.add(battery);

const batteryBody = makeMesh(new THREE.CylinderGeometry(0.43, 0.43, 1.35, 32), materials.battery, battery, { x: 0, y: 0.43, z: 0 });
batteryBody.rotation.z = Math.PI / 2;

const positiveCap = makeMesh(new THREE.CylinderGeometry(0.24, 0.24, 0.13, 24), materials.red, battery, { x: -0.72, y: 0.43, z: 0 });
positiveCap.rotation.z = Math.PI / 2;
const negativeCap = makeMesh(new THREE.CylinderGeometry(0.24, 0.24, 0.13, 24), materials.metal, battery, { x: 0.72, y: 0.43, z: 0 });
negativeCap.rotation.z = Math.PI / 2;

makeTerminal(battery, "batteryPlus", -0.83, 0.43, 0, "#ff626b");
makeTerminal(battery, "batteryMinus", 0.83, 0.43, 0, "#cbd7e6");

const plusMark = makeTextSprite("+", "#ff858b");
plusMark.position.set(-0.35, 0.92, 0);
battery.add(plusMark);
const minusMark = makeTextSprite("−", "#d9e4f3");
minusMark.position.set(0.35, 0.92, 0);
battery.add(minusMark);

/* =========================================================
   BULB
   ========================================================= */
const bulb = new THREE.Group();
bulb.position.set(2.5, 0, 0);
bulb.userData.dragType = "component";
bulb.userData.componentName = "bulb";
scene.add(bulb);

makeMesh(new THREE.CylinderGeometry(0.29, 0.27, 0.36, 32), materials.bulbBase, bulb, { x: 0, y: 0.3, z: 0 });
for (let i = 0; i < 4; i++) {
  makeMesh(new THREE.TorusGeometry(0.277, 0.025, 8, 28), materials.metal, bulb, { x: 0, y: 0.16 + i * 0.085, z: 0 }).rotation.x = Math.PI / 2;
}

const bulbGlobe = makeMesh(new THREE.SphereGeometry(0.39, 40, 32), materials.bulbGlass, bulb, { x: 0, y: 0.78, z: 0 });
bulbGlobe.scale.set(1, 1.12, 1);

const supportMaterial = new THREE.MeshStandardMaterial({ color: "#c4cbd2", metalness: 0.8, roughness: 0.28 });
function makeFilamentSupport(points, material, radius = 0.018) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, radius, 6, false), material);
  mesh.castShadow = true;
  bulb.add(mesh);
  return mesh;
}
makeFilamentSupport([[0, 0.45, 0], [0, 0.62, 0], [0, 0.86, 0]], supportMaterial, 0.016);
makeFilamentSupport([[-0.13, 0.61, 0], [-0.13, 0.79, 0], [-0.10, 0.93, 0]], supportMaterial, 0.012);
makeFilamentSupport([[0.13, 0.61, 0], [0.13, 0.79, 0], [0.10, 0.93, 0]], supportMaterial, 0.012);

const filamentPoints = [];
for (let i = 0; i <= 100; i++) {
  const t = i / 100;
  const angle = t * Math.PI * 2 * 8;
  filamentPoints.push(new THREE.Vector3(Math.cos(angle) * 0.09, 0.77 + t * 0.22, Math.sin(angle) * 0.09));
}
const filamentMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(filamentPoints), 240, 0.012, 8, false), materials.filament);
bulb.add(filamentMesh);

const bulbLight = new THREE.PointLight("#ffbd63", 0, 5);
bulbLight.position.set(0, 0.85, 0);
bulb.add(bulbLight);

makeTerminal(bulb, "bulbA", -0.53, 0.32, 0, "#dce7f5");
makeTerminal(bulb, "bulbB", 0.53, 0.32, 0, "#dce7f5");

/* =========================================================
   WIRES (Improved - ends permanently fixed)
   ========================================================= */
function makeConnector(colorMaterial) {
  const connector = new THREE.Group();
  makeMesh(new THREE.CylinderGeometry(0.105, 0.09, 0.30, 16), colorMaterial, connector, { x: 0, y: 0, z: 0 });
  makeMesh(new THREE.CylinderGeometry(0.055, 0.055, 0.16, 16), materials.metal, connector, { x: 0, y: 0.20, z: 0 });
  makeMesh(new THREE.CylinderGeometry(0.075, 0.09, 0.10, 16), materials.metal, connector, { x: 0, y: -0.17, z: 0 });
  return connector;
}

function makeWire(color, material, startPos, endPos, length) {
  const startEnd = makeConnector(material);
  const finishEnd = makeConnector(material);
  startEnd.position.copy(startPos);
  finishEnd.position.copy(endPos);
  startEnd.userData.isWireEnd = true;
  finishEnd.userData.isWireEnd = true;
  scene.add(startEnd);
  scene.add(finishEnd);
  interactiveObjects.push(startEnd, finishEnd);

  const particles = [];
  for (let i = 0; i < ROPE_PARTICLE_COUNT; i++) {
    const t = i / (ROPE_PARTICLE_COUNT - 1);
    const pos = startPos.clone().lerp(endPos, t);
    pos.y -= Math.sin(t * Math.PI) * 0.18; // less initial sag
    particles.push({ position: pos, previous: pos.clone() });
  }

  const curve = new THREE.CatmullRomCurve3(particles.map(p => p.position));
  const cableMesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, ROPE_PARTICLE_COUNT * 2, ROPE_RADIUS, 8, false),
    material
  );
  cableMesh.frustumCulled = false;
  cableMesh.castShadow = true;
  scene.add(cableMesh);

  const wire = {
    color, material, length,
    ends: [
      { connector: startEnd, terminalId: null },
      { connector: finishEnd, terminalId: null }
    ],
    particles,
    mesh: cableMesh,
    segmentLength: length / (ROPE_PARTICLE_COUNT - 1)
  };

  startEnd.userData.wire = wire;
  startEnd.userData.endIndex = 0;
  finishEnd.userData.wire = wire;
  finishEnd.userData.endIndex = 1;

  return wire;
}

const redWire = makeWire("#ff535d", materials.red,
  new THREE.Vector3(-3.33, 0.43, 0),
  new THREE.Vector3(1.45, 0.35, 0.7), 6.0);

const blackWire = makeWire("#b5c3d5", materials.black,
  new THREE.Vector3(3.03, 0.32, 0),
  new THREE.Vector3(-1.45, 0.35, -0.7), 6.0);

const wires = [redWire, blackWire];
interactiveObjects.push(battery, bulb);

/* =========================================================
   TERMINAL / END HELPERS
   ========================================================= */
function getTerminalPosition(terminalId) {
  const t = terminals[terminalId];
  if (!t) return new THREE.Vector3();
  t.parent.updateMatrixWorld(true);
  return t.localPosition.clone().applyMatrix4(t.parent.matrixWorld);
}

function getEndPosition(wire, endIndex) {
  const end = wire.ends[endIndex];
  if (end.terminalId) return getTerminalPosition(end.terminalId);
  return end.connector.position.clone();
}

function setEndPosition(wire, endIndex, position) {
  const end = wire.ends[endIndex];
  if (end.terminalId) return;
  end.connector.position.copy(position);
}

/* =========================================================
   VERLET ROPE (stiffer + ends locked)
   ========================================================= */
function simulateWire(wire, deltaTime) {
  const particles = wire.particles;
  const last = particles.length - 1;

  // Force endpoints to stay exactly on connectors / terminals
  particles[0].position.copy(getEndPosition(wire, 0));
  particles[last].position.copy(getEndPosition(wire, 1));
  particles[0].previous.copy(particles[0].position);
  particles[last].previous.copy(particles[last].position);

  const dt = Math.min(deltaTime, 0.022);
  const gravityStep = ROPE_GRAVITY * dt * dt;

  for (let i = 1; i < last; i++) {
    const p = particles[i];
    const curr = p.position.clone();
    const vel = p.position.clone().sub(p.previous).multiplyScalar(ROPE_DAMPING);
    p.position.add(vel);
    p.position.y -= gravityStep;
    p.previous.copy(curr);

    if (p.position.y < ROPE_GROUND_HEIGHT) {
      p.position.y = ROPE_GROUND_HEIGHT;
      if (p.previous.y > p.position.y) p.previous.y = p.position.y;
    }
  }

  // More iterations = stiffer
  for (let iter = 0; iter < ROPE_SOLVER_ITERATIONS; iter++) {
    particles[0].position.copy(getEndPosition(wire, 0));
    particles[last].position.copy(getEndPosition(wire, 1));

    for (let i = 0; i < last; i++) {
      const a = particles[i];
      const b = particles[i + 1];
      const diff = b.position.clone().sub(a.position);
      const dist = diff.length();
      if (dist < 0.00001) continue;

      const corr = diff.multiplyScalar((dist - wire.segmentLength) / dist);
      const isFirst = i === 0;
      const isLast = i + 1 === last;

      if (isFirst && !isLast) b.position.sub(corr);
      else if (isLast && !isFirst) a.position.add(corr);
      else if (!isFirst && !isLast) {
        a.position.addScaledVector(corr, 0.5);
        b.position.addScaledVector(corr, -0.5);
      }
    }
  }

  // Final lock
  particles[0].position.copy(getEndPosition(wire, 0));
  particles[last].position.copy(getEndPosition(wire, 1));

  // Update mesh
  const curve = new THREE.CatmullRomCurve3(particles.map(p => p.position));
  const oldGeo = wire.mesh.geometry;
  wire.mesh.geometry = new THREE.TubeGeometry(curve, (ROPE_PARTICLE_COUNT - 1) * 3, ROPE_RADIUS, 8, false);
  oldGeo.dispose();
}

/* =========================================================
   CIRCUIT LOGIC
   ========================================================= */
function wireConnects(wire, a, b) {
  const ids = wire.ends.map(e => e.terminalId);
  return ids.includes(a) && ids.includes(b);
}

function isTerminalOccupied(terminalId, exceptEnd = null) {
  return wires.some(w => w.ends.some(e => e.terminalId === terminalId && e !== exceptEnd));
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
    hint.textContent = "The filament has failed. Reset the bulb to try again.";
  } else if (circuitComplete) {
    status.innerHTML = '<span class="status-dot"></span> Circuit complete';
    hint.textContent = "The loop is complete. Adjust the voltage and watch the bulb.";
  } else {
    status.innerHTML = '<span class="status-dot"></span> Circuit incomplete';
    hint.textContent = "Connect red wire: Battery + → Bulb left. Black wire: Bulb right → Battery −.";
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
      note.textContent = "Filament broken: open circuit. Current = 0.";
    } else if (!circuitComplete) {
      note.classList.remove("active");
      note.textContent = "No complete path. Current and power = 0.";
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
  const brightness = Math.min(power / BULB_RATED_POWER, 1.5);
  materials.filament.color.set("#ffcb74");
  materials.filament.emissive.set("#ff6b20");
  materials.filament.emissiveIntensity = 0.04 + brightness * 2.6;
  materials.bulbGlass.emissiveIntensity = 0.015 + brightness * 0.15;
  bulbLight.intensity = Math.min(brightness * 3.2, 5);
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
   ELECTRON FLOW VISUAL LAYER
   ========================================================= */
const electronParticles = [];
const ELECTRON_COUNT = 48;
const electronGroup = new THREE.Group();
scene.add(electronGroup);

function createElectronParticles() {
  for (let i = 0; i < ELECTRON_COUNT; i++) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 8),
      materials.electron
    );
    mesh.visible = false;
    electronGroup.add(mesh);
    electronParticles.push({
      mesh,
      t: Math.random(),           // 0 → 1 along the path
      speed: 0.18 + Math.random() * 0.12
    });
  }
}
createElectronParticles();

function updateElectronFlow(dt) {
  const visible = showElectronFlow && circuitComplete && !bulbFailed;
  electronGroup.visible = visible;

  if (!visible) return;

  // Path: Battery Minus → Black wire → Bulb → Red wire → Battery Plus
  // (real electron flow direction)
  const pathPoints = [];
  // From batteryMinus along black wire
  for (let i = 0; i < blackWire.particles.length; i++) {
    pathPoints.push(blackWire.particles[i].position.clone());
  }
  // Through bulb (approximate)
  pathPoints.push(getTerminalPosition("bulbB"));
  pathPoints.push(getTerminalPosition("bulbA"));
  // Along red wire back to batteryPlus
  for (let i = redWire.particles.length - 1; i >= 0; i--) {
    pathPoints.push(redWire.particles[i].position.clone());
  }

  if (pathPoints.length < 2) return;

  const curve = new THREE.CatmullRomCurve3(pathPoints);

  for (const p of electronParticles) {
    p.t += p.speed * dt;
    if (p.t > 1) p.t -= 1;
    const pos = curve.getPoint(p.t);
    p.mesh.position.copy(pos);
    p.mesh.visible = true;
  }
}

/* =========================================================
   VOLTAGE CONTROLS
   ========================================================= */
function setVoltage(v) {
  voltage = THREE.MathUtils.clamp(Math.round(v * 10) / 10, MIN_VOLTAGE, MAX_VOLTAGE);
  updateReadings();
  updateBulbAppearance();
}
$("voltage-down")?.addEventListener("click", () => setVoltage(voltage - VOLTAGE_STEP));
$("voltage-up")?.addEventListener("click", () => setVoltage(voltage + VOLTAGE_STEP));

/* =========================================================
   POINTER INTERACTION
   ========================================================= */
function setPointerFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function getGroundPoint(e) {
  setPointerFromEvent(e);
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

function findComponentGroup(obj) {
  let c = obj;
  while (c && c !== scene) {
    if (c.userData.dragType === "component") return c;
    c = c.parent;
  }
  return null;
}

function getOtherEndPosition(wire, endIndex) {
  return getEndPosition(wire, endIndex === 0 ? 1 : 0);
}

function clampEndpointToCableLength(wire, endIndex, candidate) {
  const other = getOtherEndPosition(wire, endIndex);
  const diff = candidate.clone().sub(other);
  const dist = diff.length();
  if (dist <= wire.length || dist < 0.0001) return candidate;
  return other.add(diff.multiplyScalar(wire.length / dist));
}

function snapWireEnd(wire, endIndex) {
  const end = wire.ends[endIndex];
  const pos = end.connector.position;
  let closestId = null;
  let closestDist = Infinity;

  for (const id of Object.keys(terminals)) {
    const tPos = getTerminalPosition(id);
    const d = pos.distanceTo(tPos);
    if (d < closestDist && !isTerminalOccupied(id, end)) {
      closestDist = d;
      closestId = id;
    }
  }

  if (closestId && closestDist <= 0.43) {
    end.terminalId = closestId;
    end.connector.position.copy(getTerminalPosition(closestId));
  }
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.pointerType !== "touch") return;
  setPointerFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interactiveObjects, true);
  if (!hits.length) return;

  const wireEnd = findWireEnd(hits[0].object);
  if (wireEnd) {
    const wire = wireEnd.userData.wire;
    const endIndex = wireEnd.userData.endIndex;
    wire.ends[endIndex].terminalId = null; // detach
    dragging = { type: "wireEnd", object: wireEnd, wire, endIndex };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }

  const component = findComponentGroup(hits[0].object);
  if (component) {
    const point = getGroundPoint(e);
    if (!point) return;
    dragging = {
      type: "component",
      object: component,
      offset: new THREE.Vector3(component.position.x - point.x, 0, component.position.z - point.z)
    };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const point = getGroundPoint(e);
  if (!point) return;

  if (dragging.type === "wireEnd") {
    const candidate = new THREE.Vector3(point.x, 0.35, point.z);
    const limited = clampEndpointToCableLength(dragging.wire, dragging.endIndex, candidate);
    setEndPosition(dragging.wire, dragging.endIndex, limited);
  } else if (dragging.type === "component") {
    dragging.object.position.x = point.x + dragging.offset.x;
    dragging.object.position.z = point.z + dragging.offset.z;
  }
});

function finishDragging(e) {
  if (!dragging) return;
  if (dragging.type === "wireEnd") {
    snapWireEnd(dragging.wire, dragging.endIndex);
    updateCircuit();
  }
  dragging = null;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
}
canvas.addEventListener("pointerup", finishDragging);
canvas.addEventListener("pointercancel", finishDragging);

/* =========================================================
   RESET
   ========================================================= */
function resetLayout() {
  battery.position.set(-2.5, 0, 0);
  bulb.position.set(2.5, 0, 0);

  for (const wire of wires) {
    for (const end of wire.ends) end.terminalId = null;
  }

  redWire.ends[0].connector.position.set(-3.33, 0.43, 0);
  redWire.ends[1].connector.position.set(1.45, 0.35, 0.7);
  blackWire.ends[0].connector.position.set(3.03, 0.32, 0);
  blackWire.ends[1].connector.position.set(-1.45, 0.35, -0.7);

  for (const wire of wires) {
    const first = getEndPosition(wire, 0);
    const last = getEndPosition(wire, 1);
    for (let i = 0; i < wire.particles.length; i++) {
      const t = i / (wire.particles.length - 1);
      const p = first.clone().lerp(last, t);
      p.y -= Math.sin(t * Math.PI) * 0.18;
      wire.particles[i].position.copy(p);
      wire.particles[i].previous.copy(p);
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
   TOOLBOX + ELECTRON TOGGLE (UI)
   ========================================================= */
// Create floating buttons if they don't exist in HTML
function createUIButtons() {
  // Electron Flow Toggle
  if (!$("electron-toggle")) {
    const btn = document.createElement("button");
    btn.id = "electron-toggle";
    btn.className = "small-button";
    btn.textContent = "Electron Flow: OFF";
    btn.style.cssText = "position:fixed; bottom:24px; left:24px; z-index:100; padding:10px 16px;";
    btn.addEventListener("click", () => {
      showElectronFlow = !showElectronFlow;
      btn.textContent = `Electron Flow: ${showElectronFlow ? "ON" : "OFF"}`;
      btn.style.background = showElectronFlow ? "#1a3a5c" : "";
    });
    document.body.appendChild(btn);
  }

  // Toolbox button
  if (!$("toolbox-button")) {
    const btn = document.createElement("button");
    btn.id = "toolbox-button";
    btn.className = "small-button";
    btn.textContent = "Toolbox";
    btn.style.cssText = "position:fixed; bottom:24px; left:180px; z-index:100; padding:10px 16px;";
    btn.addEventListener("click", () => {
      alert("Toolbox coming in next stage:\n• Multimeter\n• Inline Ammeter\n• Clamp Meter\n• Note Pad");
    });
    document.body.appendChild(btn);
  }
}
createUIButtons();

/* =========================================================
   RESIZE + MAIN LOOP
   ========================================================= */
function resizeRenderer() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resizeRenderer);

function animate(timestamp) {
  requestAnimationFrame(animate);
  const dt = lastFrameTime ? Math.min((timestamp - lastFrameTime) / 1000, 0.025) : 0;
  lastFrameTime = timestamp;

  for (const wire of wires) simulateWire(wire, dt);
  updateBulbDamage(dt);
  updateElectronFlow(dt);

  renderer.render(scene, camera);
}

resizeRenderer();
updateCircuit();
animate(0);
showScreen("home");
