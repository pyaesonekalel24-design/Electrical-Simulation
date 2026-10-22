import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

/* =========================================================
   ELECTRICITY LAB — LEVEL 1
   + Real Toolbox (Multimeter, Inline Ammeter, Clamp, Note Pad)
   + Fixed wire ends
   + Electrons follow real wires
   ========================================================= */

const BULB_RESISTANCE = 6;
const BULB_RATED_VOLTAGE = 3;
const BULB_RATED_POWER = (BULB_RATED_VOLTAGE ** 2) / BULB_RESISTANCE;
const MIN_VOLTAGE = 0.5;
const MAX_VOLTAGE = 12;
const VOLTAGE_STEP = 0.5;

const ROPE_PARTICLE_COUNT = 24;
const ROPE_SOLVER_ITERATIONS = 14;
const ROPE_GRAVITY = 4.0;
const ROPE_DAMPING = 0.976;
const ROPE_RADIUS = 0.040;
const ROPE_GROUND_HEIGHT = 0.07;

let voltage = 3;
let circuitComplete = false;
let bulbFailed = false;
let filamentDamage = 0;
let lastFrameTime = 0;
let showElectronFlow = false;
let toolboxOpen = false;

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
  if (name === "game") {
    requestAnimationFrame(() => {
      resizeRenderer();
      setTimeout(resizeRenderer, 60);
      setTimeout(resizeRenderer, 250);
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

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 9.2, 8.2);
camera.lookAt(0, 0.25, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

scene.add(new THREE.HemisphereLight("#dceaff", "#17243a", 1.7));
const keyLight = new THREE.DirectionalLight("#ffffff", 2.3);
keyLight.position.set(-5, 10, 6);
keyLight.castShadow = true;
scene.add(keyLight);
const fillLight = new THREE.PointLight("#4a9cff", 38, 18);
fillLight.position.set(5, 4.5, -4);
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
  red: new THREE.MeshStandardMaterial({ color: "#ff535d", emissive: "#63141b", emissiveIntensity: 0.28, roughness: 0.4 }),
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
  electron: new THREE.MeshBasicMaterial({ color: "#5ed0ff", transparent: true, opacity: 0.92 }),
  toolBody: new THREE.MeshStandardMaterial({ color: "#1e2d42", metalness: 0.4, roughness: 0.45 }),
  toolAccent: new THREE.MeshStandardMaterial({ color: "#3d5a80", metalness: 0.5, roughness: 0.35 }),
  screen: new THREE.MeshStandardMaterial({ color: "#0a1628", emissive: "#1a3a5c", emissiveIntensity: 0.3 }),
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
  makeMesh(new THREE.CylinderGeometry(0.125, 0.125, 0.065, 20), padMat, group, { x: 0, y: 0, z: 0 });
  makeMesh(new THREE.CylinderGeometry(0.065, 0.065, 0.028, 16), materials.metal, group, { x: 0, y: 0.038, z: 0 });
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
  sprite.scale.set(0.3, 0.3, 1);
  return sprite;
}

/* =========================================================
   BATTERY + BULB (same as before)
   ========================================================= */
const battery = new THREE.Group();
battery.position.set(-2.6, 0, 0);
battery.userData.dragType = "component";
scene.add(battery);

const batBody = makeMesh(new THREE.CylinderGeometry(0.41, 0.41, 1.28, 32), materials.battery, battery, { x: 0, y: 0.41, z: 0 });
batBody.rotation.z = Math.PI / 2;
makeMesh(new THREE.CylinderGeometry(0.22, 0.22, 0.11, 20), materials.red, battery, { x: -0.69, y: 0.41, z: 0 }).rotation.z = Math.PI / 2;
makeMesh(new THREE.CylinderGeometry(0.22, 0.22, 0.11, 20), materials.metal, battery, { x: 0.69, y: 0.41, z: 0 }).rotation.z = Math.PI / 2;
makeTerminal(battery, "batteryPlus", -0.81, 0.41, 0, "#ff626b");
makeTerminal(battery, "batteryMinus", 0.81, 0.41, 0, "#cbd7e6");
const plusMark = makeTextSprite("+", "#ff858b");
plusMark.position.set(-0.34, 0.88, 0);
battery.add(plusMark);
const minusMark = makeTextSprite("−", "#d9e4f3");
minusMark.position.set(0.34, 0.88, 0);
battery.add(minusMark);

const bulb = new THREE.Group();
bulb.position.set(2.6, 0, 0);
bulb.userData.dragType = "component";
scene.add(bulb);

makeMesh(new THREE.CylinderGeometry(0.27, 0.25, 0.33, 28), materials.bulbBase, bulb, { x: 0, y: 0.27, z: 0 });
for (let i = 0; i < 4; i++) {
  makeMesh(new THREE.TorusGeometry(0.26, 0.02, 8, 24), materials.metal, bulb, { x: 0, y: 0.14 + i * 0.075, z: 0 }).rotation.x = Math.PI / 2;
}
const globe = makeMesh(new THREE.SphereGeometry(0.37, 36, 28), materials.bulbGlass, bulb, { x: 0, y: 0.74, z: 0 });
globe.scale.set(1, 1.12, 1);

const filamentPoints = [];
for (let i = 0; i <= 80; i++) {
  const t = i / 80;
  const a = t * Math.PI * 2 * 7;
  filamentPoints.push(new THREE.Vector3(Math.cos(a) * 0.08, 0.73 + t * 0.19, Math.sin(a) * 0.08));
}
const filamentMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(filamentPoints), 180, 0.01, 6, false), materials.filament);
bulb.add(filamentMesh);

const bulbLight = new THREE.PointLight("#ffbd63", 0, 5);
bulbLight.position.set(0, 0.8, 0);
bulb.add(bulbLight);

makeTerminal(bulb, "bulbA", -0.5, 0.29, 0, "#dce7f5");
makeTerminal(bulb, "bulbB", 0.5, 0.29, 0, "#dce7f5");

/* =========================================================
   WIRES
   ========================================================= */
function makeConnector(mat) {
  const g = new THREE.Group();
  makeMesh(new THREE.CylinderGeometry(0.095, 0.082, 0.26, 14), mat, g, { x: 0, y: 0, z: 0 });
  makeMesh(new THREE.CylinderGeometry(0.048, 0.048, 0.13, 12), materials.metal, g, { x: 0, y: 0.175, z: 0 });
  makeMesh(new THREE.CylinderGeometry(0.065, 0.08, 0.08, 12), materials.metal, g, { x: 0, y: -0.15, z: 0 });
  return g;
}

function makeWire(mat, start, end, length) {
  const startConn = makeConnector(mat);
  const endConn = makeConnector(mat);
  startConn.position.copy(start);
  endConn.position.copy(end);
  startConn.userData.isWireEnd = true;
  endConn.userData.isWireEnd = true;
  scene.add(startConn, endConn);
  interactiveObjects.push(startConn, endConn);

  const particles = [];
  for (let i = 0; i < ROPE_PARTICLE_COUNT; i++) {
    const t = i / (ROPE_PARTICLE_COUNT - 1);
    const p = start.clone().lerp(end, t);
    p.y -= Math.sin(t * Math.PI) * 0.15;
    particles.push({ position: p.clone(), previous: p.clone() });
  }

  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(particles.map(p => p.position)), ROPE_PARTICLE_COUNT * 2, ROPE_RADIUS, 8, false),
    mat
  );
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  scene.add(mesh);

  const wire = {
    material: mat, length,
    ends: [{ connector: startConn, terminalId: null }, { connector: endConn, terminalId: null }],
    particles, mesh,
    segmentLength: length / (ROPE_PARTICLE_COUNT - 1)
  };

  startConn.userData.wire = wire;
  startConn.userData.endIndex = 0;
  endConn.userData.wire = wire;
  endConn.userData.endIndex = 1;
  return wire;
}

const redWire = makeWire(materials.red, new THREE.Vector3(-3.4, 0.41, 0), new THREE.Vector3(1.5, 0.3, 0.6), 5.9);
const blackWire = makeWire(materials.black, new THREE.Vector3(3.1, 0.29, 0), new THREE.Vector3(-1.5, 0.3, -0.6), 5.9);
const wires = [redWire, blackWire];
interactiveObjects.push(battery, bulb);

/* =========================================================
   TOOLBOX SYSTEM
   ========================================================= */
const tools = []; // all spawned tools

function createToolboxUI() {
  // Toolbox button
  if (!$("toolbox-button")) {
    const btn = document.createElement("button");
    btn.id = "toolbox-button";
    btn.textContent = "Toolbox";
    btn.style.cssText = `
      position:fixed; bottom:22px; left:22px; z-index:300;
      padding:12px 18px; border-radius:10px; border:1px solid #3a5a7c;
      background:#1a2f4a; color:#e8f4ff; font-size:14px; font-weight:600;
      cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,0.3);
    `;
    btn.onclick = toggleToolbox;
    document.body.appendChild(btn);
  }

  // Toolbox panel
  if (!$("toolbox-panel")) {
    const panel = document.createElement("div");
    panel.id = "toolbox-panel";
    panel.style.cssText = `
      position:fixed; bottom:80px; left:22px; z-index:300;
      width:280px; background:#0f1c2e; border:1px solid #2a4060;
      border-radius:14px; padding:16px; display:none;
      box-shadow:0 10px 30px rgba(0,0,0,0.45); color:#e0f0ff;
      font-family:system-ui,sans-serif;
    `;
    panel.innerHTML = `
      <div style="font-size:13px;font-weight:700;letter-spacing:1px;color:#64e4ff;margin-bottom:14px;">
        ELECTRICIAN TOOLBOX
      </div>
      <div id="tool-list" style="display:flex;flex-direction:column;gap:10px;"></div>
    `;
    document.body.appendChild(panel);

    const toolsData = [
      { id: "multimeter", name: "Multimeter", desc: "Red & black probes" },
      { id: "ammeter", name: "Inline Ammeter", desc: "Insert into circuit" },
      { id: "clamp", name: "Clamp Meter", desc: "Measure without breaking" },
      { id: "notepad", name: "Note Pad", desc: "Write formulas" },
    ];

    const list = panel.querySelector("#tool-list");
    toolsData.forEach(t => {
      const item = document.createElement("button");
      item.style.cssText = `
        display:flex;flex-direction:column;align-items:flex-start;
        padding:12px 14px; background:#162536; border:1px solid #2a4060;
        border-radius:10px; color:#e0f0ff; cursor:pointer; text-align:left;
      `;
      item.innerHTML = `
        <span style="font-weight:600;font-size:14px;">${t.name}</span>
        <span style="font-size:12px;color:#8aa4c0;margin-top:3px;">${t.desc}</span>
      `;
      item.onclick = () => spawnTool(t.id);
      list.appendChild(item);
    });
  }

  // Electron toggle
  if (!$("electron-toggle")) {
    const btn = document.createElement("button");
    btn.id = "electron-toggle";
    btn.textContent = "Electron Flow: OFF";
    btn.style.cssText = `
      position:fixed; bottom:22px; left:140px; z-index:300;
      padding:12px 16px; border-radius:10px; border:1px solid #2a3f5c;
      background:#122033; color:#e0f0ff; font-size:13px; cursor:pointer;
    `;
    btn.onclick = () => {
      showElectronFlow = !showElectronFlow;
      btn.textContent = `Electron Flow: ${showElectronFlow ? "ON" : "OFF"}`;
      btn.style.background = showElectronFlow ? "#1a4a70" : "#122033";
    };
    document.body.appendChild(btn);
  }
}

function toggleToolbox() {
  toolboxOpen = !toolboxOpen;
  const panel = $("toolbox-panel");
  if (panel) panel.style.display = toolboxOpen ? "block" : "none";
}

function spawnTool(type) {
  let tool;
  if (type === "multimeter") tool = createMultimeter();
  else if (type === "ammeter") tool = createInlineAmmeter();
  else if (type === "clamp") tool = createClampMeter();
  else if (type === "notepad") tool = createNotePad();

  if (tool) {
    tool.position.set(
      (Math.random() - 0.5) * 3,
      0.2,
      (Math.random() - 0.5) * 2 - 1.5
    );
    scene.add(tool);
    interactiveObjects.push(tool);
    tools.push(tool);
  }
  toggleToolbox(); // close after spawning
}

/* ---------- Tool creators ---------- */
function createMultimeter() {
  const group = new THREE.Group();
  group.userData.dragType = "tool";
  group.userData.toolType = "multimeter";

  // Body
  makeMesh(new THREE.BoxGeometry(0.7, 0.15, 1.1), materials.toolBody, group, { x: 0, y: 0.08, z: 0 });
  // Screen
  makeMesh(new THREE.BoxGeometry(0.5, 0.02, 0.35), materials.screen, group, { x: 0, y: 0.17, z: -0.25 });
  // Dial
  makeMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 24), materials.toolAccent, group, { x: 0, y: 0.18, z: 0.25 }).rotation.x = Math.PI / 2;

  // Probes (simple sticks for now)
  const redProbe = new THREE.Group();
  makeMesh(new THREE.CylinderGeometry(0.025, 0.02, 0.6, 10), materials.red, redProbe, { x: 0, y: 0.3, z: 0 });
  redProbe.position.set(0.25, 0.1, 0.7);
  group.add(redProbe);

  const blackProbe = new THREE.Group();
  makeMesh(new THREE.CylinderGeometry(0.025, 0.02, 0.6, 10), materials.black, blackProbe, { x: 0, y: 0.3, z: 0 });
  blackProbe.position.set(-0.25, 0.1, 0.7);
  group.add(blackProbe);

  return group;
}

function createInlineAmmeter() {
  const group = new THREE.Group();
  group.userData.dragType = "tool";
  group.userData.toolType = "ammeter";

  makeMesh(new THREE.BoxGeometry(0.55, 0.2, 0.55), materials.toolBody, group, { x: 0, y: 0.1, z: 0 });
  makeMesh(new THREE.BoxGeometry(0.35, 0.03, 0.25), materials.screen, group, { x: 0, y: 0.22, z: 0 });
  // Connection points
  makeMesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 12), materials.metal, group, { x: 0.32, y: 0.1, z: 0 });
  makeMesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 12), materials.metal, group, { x: -0.32, y: 0.1, z: 0 });

  return group;
}

function createClampMeter() {
  const group = new THREE.Group();
  group.userData.dragType = "tool";
  group.userData.toolType = "clamp";

  makeMesh(new THREE.BoxGeometry(0.45, 0.18, 0.9), materials.toolBody, group, { x: 0, y: 0.09, z: 0 });
  // Clamp jaw (simplified)
  makeMesh(new THREE.TorusGeometry(0.22, 0.04, 8, 20, Math.PI), materials.toolAccent, group, { x: 0, y: 0.35, z: -0.35 }).rotation.x = Math.PI / 2;
  makeMesh(new THREE.BoxGeometry(0.3, 0.02, 0.2), materials.screen, group, { x: 0, y: 0.2, z: 0.15 });

  return group;
}

function createNotePad() {
  const group = new THREE.Group();
  group.userData.dragType = "tool";
  group.userData.toolType = "notepad";

  makeMesh(new THREE.BoxGeometry(0.9, 0.03, 1.2), new THREE.MeshStandardMaterial({ color: "#f0e6d0", roughness: 0.8 }), group, { x: 0, y: 0.02, z: 0 });
  // Lines
  for (let i = 0; i < 8; i++) {
    makeMesh(new THREE.BoxGeometry(0.75, 0.005, 0.01), new THREE.MeshBasicMaterial({ color: "#a0b0c0" }), group, { x: 0, y: 0.04, z: -0.4 + i * 0.12 });
  }

  return group;
}

/* =========================================================
   REST OF THE CODE (wires, circuit, electrons, interaction...)
   ========================================================= */

// ... (I will continue in the next message because of length limits)

console.log("Toolbox system loaded. Click Toolbox button → choose a tool → it appears on the table.");
