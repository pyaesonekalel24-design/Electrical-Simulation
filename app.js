
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

/* =========================================================
   ELECTRICITY LAB — LEVEL 1
   ========================================================= */

/*
  This is a simplified DC circuit model.

  Battery voltage: adjustable
  Bulb resistance: fixed at 6 ohms
  Current: I = V / R
  Power: P = V * I

  Current is zero unless both wires complete the circuit.
*/

const BULB_RESISTANCE = 6;
const MIN_VOLTAGE = 0.5;
const MAX_VOLTAGE = 12;
const VOLTAGE_STEP = 0.5;

let voltage = 3;
let circuitComplete = false;

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
    // Allow the renderer to resize after the game becomes visible.
    requestAnimationFrame(resizeRenderer);
  }
}

$("learn-button").addEventListener("click", () => {
  showScreen("levels");
});

$("sandbox-button").addEventListener("click", () => {
  showScreen("sandbox");
});

$("levels-back-button").addEventListener("click", () => {
  showScreen("home");
});

document.querySelectorAll(".back-home-button").forEach((button) => {
  button.addEventListener("click", () => showScreen("home"));
});

$("level-one-button").addEventListener("click", () => {
  showScreen("game");
});

$("game-back-button").addEventListener("click", () => {
  showScreen("levels");
});

/* =========================================================
   THREE.JS STATE
   ========================================================= */

const canvas = $("scene-canvas");
const container = $("scene-container");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0c1523");

const camera = new THREE.PerspectiveCamera(
  43,
  1,
  0.1,
  100
);

camera.position.set(0, 10, 7.5);
camera.lookAt(0, 0, 0);
camera.up.set(0, 1, 0);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

/* =========================================================
   LIGHTING AND WORKBENCH
   ========================================================= */

scene.add(new THREE.HemisphereLight("#dceaff", "#17243a", 2.0));

const keyLight = new THREE.DirectionalLight("#ffffff", 2.2);
keyLight.position.set(-4, 9, 5);
keyLight.castShadow = true;
scene.add(keyLight);

const fillLight = new THREE.PointLight("#438bff", 35, 18);
fillLight.position.set(4, 4, -4);
scene.add(fillLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(18, 12),
  new THREE.MeshStandardMaterial({
    color: "#101b2b",
    roughness: 0.92,
    metalness: 0.05,
  })
);

floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.03;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(18, 36, "#29415b", "#1a2b40");
grid.position.y = 0.005;
scene.add(grid);

// Invisible plane used to find where the user is dragging.
const dragPlane = new THREE.Plane(
  new THREE.Vector3(0, 1, 0),
  0
);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPoint = new THREE.Vector3();

let dragging = null;
let dragOffset = new THREE.Vector3();

/* =========================================================
   MATERIALS
   ========================================================= */

const materials = {
  battery: new THREE.MeshStandardMaterial({
    color: "#263b58",
    metalness: 0.55,
    roughness: 0.32,
  }),

  metal: new THREE.MeshStandardMaterial({
    color: "#b9c9d9",
    metalness: 0.9,
    roughness: 0.22,
  }),

  red: new THREE.MeshStandardMaterial({
    color: "#ff535d",
    emissive: "#63141b",
    emissiveIntensity: 0.3,
    roughness: 0.4,
  }),

  black: new THREE.MeshStandardMaterial({
    color: "#303b4b",
    roughness: 0.48,
  }),

  bulbBase: new THREE.MeshStandardMaterial({
    color: "#8b9db3",
    metalness: 0.7,
    roughness: 0.28,
  }),

  bulbGlass: new THREE.MeshStandardMaterial({
    color: "#fff1c7",
    emissive: "#ffad35",
    emissiveIntensity: 0.04,
    roughness: 0.25,
    metalness: 0,
  }),

  terminal: new THREE.MeshStandardMaterial({
    color: "#d7e6f7",
    metalness: 0.75,
    roughness: 0.2,
    emissive: "#25364b",
    emissiveIntensity: 0.2,
  }),
};

/* =========================================================
   OBJECT HELPERS
   ========================================================= */

function makeMesh(geometry, material, parent, position) {
  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.set(position.x, position.y, position.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  parent.add(mesh);
  return mesh;
}

function makeTerminal(parent, id, x, y, z, color) {
  const terminal = makeMesh(
    new THREE.SphereGeometry(0.13, 18, 12),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.16,
      metalness: 0.45,
      roughness: 0.25,
    }),
    parent,
    { x, y, z }
  );

  terminal.userData.terminalId = id;
  terminal.userData.isTerminal = true;

  terminals[id] = {
    id,
    parent,
    localPosition: new THREE.Vector3(x, y, z),
    mesh: terminal,
  };

  return terminal;
}

const terminals = {};
const interactiveObjects = [];

/* =========================================================
   BATTERY
   ========================================================= */

const battery = new THREE.Group();
battery.position.set(-2.5, 0, 0);
battery.userData.dragType = "component";
battery.userData.componentName = "battery";
scene.add(battery);

const batteryBody = makeMesh(
  new THREE.CylinderGeometry(0.43, 0.43, 1.35, 32),
  materials.battery,
  battery,
  { x: 0, y: 0.43, z: 0 }
);

batteryBody.rotation.z = Math.PI / 2;

const batteryPositiveCap = makeMesh(
  new THREE.CylinderGeometry(0.24, 0.24, 0.13, 24),
  materials.red,
  battery,
  { x: -0.72, y: 0.43, z: 0 }
);

batteryPositiveCap.rotation.z = Math.PI / 2;

const batteryNegativeCap = makeMesh(
  new THREE.CylinderGeometry(0.24, 0.24, 0.13, 24),
  materials.metal,
  battery,
  { x: 0.72, y: 0.43, z: 0 }
);

batteryNegativeCap.rotation.z = Math.PI / 2;

makeTerminal(battery, "batteryPlus", -0.83, 0.43, 0, "#ff626b");
makeTerminal(battery, "batteryMinus", 0.83, 0.43, 0, "#cbd7e6");

// Simple 3D + and - markings.
function makeTextSprite(text, color) {
  const textCanvas = document.createElement("canvas");
  textCanvas.width = 128;
  textCanvas.height = 128;

  const context = textCanvas.getContext("2d");
  context.clearRect(0, 0, 128, 128);
  context.fillStyle = color;
  context.font = "bold 82px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 64, 65);

  const texture = new THREE.CanvasTexture(textCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    })
  );

  sprite.scale.set(0.34, 0.34, 1);
  return sprite;
}

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

makeMesh(
  new THREE.CylinderGeometry(0.34, 0.29, 0.36, 28),
  materials.bulbBase,
  bulb,
  { x: 0, y: 0.3, z: 0 }
);

makeMesh(
  new THREE.CylinderGeometry(0.28, 0.28, 0.08, 28),
  materials.metal,
  bulb,
  { x: 0, y: 0.1, z: 0 }
);

const bulbGlobe = makeMesh(
  new THREE.SphereGeometry(0.39, 32, 24),
  materials.bulbGlass,
  bulb,
  { x: 0, y: 0.78, z: 0 }
);

bulbGlobe.scale.set(1, 1.12, 1);

const bulbLight = new THREE.PointLight("#ffbd63", 0, 5);
bulbLight.position.set(0, 0.9, 0);
bulb.add(bulbLight);

makeTerminal(bulb, "bulbA", -0.53, 0.32, 0, "#dce7f5");
makeTerminal(bulb, "bulbB", 0.53, 0.32, 0, "#dce7f5");

/* =========================================================
   WIRES
   ========================================================= */

/*
  Each wire has:
  - One anchored end that follows a component terminal.
  - One loose end the player can drag.
  - A connection that snaps to a terminal when released nearby.

  Red wire: battery positive -> bulb terminal A
  Black wire: bulb terminal B -> battery negative
*/

function makeWire(color, material, anchorTerminal, initialFreePosition) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);

  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      linewidth: 2,
    })
  );

  line.frustumCulled = false;
  scene.add(line);

  const freeEnd = makeMesh(
    new THREE.SphereGeometry(0.16, 20, 16),
    material,
    scene,
    initialFreePosition
  );

  freeEnd.userData.isWireEnd = true;

  const wire = {
    anchorTerminal,
    freeEnd,
    line,
    attachedTerminal: null,
    initialPosition: initialFreePosition.clone(),
  };

  freeEnd.userData.wire = wire;
  interactiveObjects.push(freeEnd);

  return wire;
}

const redWire = makeWire(
  "#ff535d",
  materials.red,
  "batteryPlus",
  new THREE.Vector3(1.45, 0.35, 0.7)
);

const blackWire = makeWire(
  "#b5c3d5",
  materials.black,
  "bulbB",
  new THREE.Vector3(-1.45, 0.35, -0.7)
);

const wires = [redWire, blackWire];

interactiveObjects.push(battery, bulb);

/* =========================================================
   WORLD POSITIONS AND WIRE UPDATES
   ========================================================= */

function getTerminalPosition(terminalId) {
  const terminal = terminals[terminalId];

  if (!terminal) {
    return new THREE.Vector3();
  }

  const position = terminal.localPosition.clone();
  terminal.parent.localToWorld(position);

  return position;
}

function getWireFreePosition(wire) {
  if (wire.attachedTerminal) {
    return getTerminalPosition(wire.attachedTerminal);
  }

  return wire.freeEnd.position.clone();
}

function updateWires() {
  for (const wire of wires) {
    const start = getTerminalPosition(wire.anchorTerminal);
    const end = getWireFreePosition(wire);

    // Replace the tiny line geometry with the latest endpoints.
    const newGeometry = new THREE.BufferGeometry().setFromPoints([
      start,
      end,
    ]);

    wire.line.geometry.dispose();
    wire.line.geometry = newGeometry;

    wire.freeEnd.position.copy(end);
  }
}

function updateTerminalPositions() {
  // Terminal meshes are children of their components, so they move with them.
  // Updating the world matrices ensures their positions are current.
  battery.updateMatrixWorld(true);
  bulb.updateMatrixWorld(true);
}

/* =========================================================
   CIRCUIT CONNECTION CHECK
   ========================================================= */

function updateCircuit() {
  const redConnected =
    redWire.attachedTerminal === "bulbA";

  const blackConnected =
    blackWire.attachedTerminal === "batteryMinus";

  const nowComplete = redConnected && blackConnected;

  if (nowComplete !== circuitComplete) {
    circuitComplete = nowComplete;
  }

  updateReadings();
  updateBulbAppearance();
  updateStatus();
}

function updateStatus() {
  const status = $("circuit-status");
  const hint = $("scene-hint");

  status.classList.toggle("complete", circuitComplete);

  if (circuitComplete) {
    status.innerHTML =
      '<span class="status-dot"></span> Circuit complete';

    hint.textContent =
      "Nice! The loop is complete. Adjust the voltage and watch the readings change.";
  } else {
    status.innerHTML =
      '<span class="status-dot"></span> Circuit incomplete';

    if (!redWire.attachedTerminal) {
      hint.textContent =
        "Drag the loose red wire end to the bulb's left terminal.";
    } else if (!blackWire.attachedTerminal) {
      hint.textContent =
        "Now drag the loose black wire end to the battery's negative terminal.";
    } else {
      hint.textContent =
        "Check the connections: red to bulb left, black to battery negative.";
    }
  }
}

/* =========================================================
   PHYSICS CALCULATIONS
   ========================================================= */

function calculateCircuit() {
  if (!circuitComplete) {
    return {
      current: 0,
      power: 0,
    };
  }

  const current = voltage / BULB_RESISTANCE;
  const power = voltage * current;

  return {
    current,
    power,
  };
}

function updateReadings() {
  const { current, power } = calculateCircuit();

  $("voltage-value").textContent = voltage.toFixed(1);
  $("current-value").textContent = current.toFixed(3);
  $("power-value").textContent = power.toFixed(3);
  $("resistance-value").textContent = BULB_RESISTANCE.toFixed(1);

  const fillPercentage =
    ((voltage - MIN_VOLTAGE) / (MAX_VOLTAGE - MIN_VOLTAGE)) * 100;

  $("voltage-track-fill").style.width =
    `${Math.max(0, Math.min(100, fillPercentage))}%`;

  const note = $("measurement-note");

  if (!circuitComplete) {
    note.classList.remove("active");
    note.textContent =
      "No complete path: the model calculates zero current and zero bulb power.";
  } else {
    note.classList.add("active");
    note.textContent =
      `Complete circuit: ${voltage.toFixed(1)} V / ` +
      `${BULB_RESISTANCE.toFixed(1)} Ω = ${current.toFixed(3)} A.`;
  }
}

function updateBulbAppearance() {
  const { power } = calculateCircuit();

  // This is a visual effect, not a full thermal or filament simulation.
  const brightness = Math.min(power / 24, 1);

  materials.bulbGlass.emissiveIntensity = 0.04 + brightness * 2.8;
  bulbLight.intensity = brightness * 3.2;

  bulbLight.color.set("#ffbd63");
}

/* =========================================================
   VOLTAGE CONTROLS
   ========================================================= */

function setVoltage(nextVoltage) {
  voltage = THREE.MathUtils.clamp(
    Math.round(nextVoltage * 10) / 10,
    MIN_VOLTAGE,
    MAX_VOLTAGE
  );

  updateReadings();
  updateBulbAppearance();
}

$("voltage-down").addEventListener("click", () => {
  setVoltage(voltage - VOLTAGE_STEP);
});

$("voltage-up").addEventListener("click", () => {
  setVoltage(voltage + VOLTAGE_STEP);
});

/* =========================================================
   POINTER HELPERS
   ========================================================= */

function setPointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function getGroundPoint(event) {
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);

  const hit = raycaster.ray.intersectPlane(dragPlane, dragPoint);

  return hit ? dragPoint.clone() : null;
}

function findComponentGroup(object) {
  let current = object;

  while (current && current !== scene) {
    if (current.userData.dragType === "component") {
      return current;
    }

    current = current.parent;
  }

  return null;
}

function findWireEnd(object) {
  let current = object;

  while (current && current !== scene) {
    if (current.userData.isWireEnd) {
      return current;
    }

    current = current.parent;
  }

  return null;
}

/* =========================================================
   DRAGGING AND SNAPPING
   ========================================================= */

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.pointerType !== "touch") {
    return;
  }

  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(interactiveObjects, true);

  if (hits.length === 0) {
    return;
  }

  const hit = hits[0];
  const wireEnd = findWireEnd(hit.object);

  if (wireEnd) {
    const wire = wireEnd.userData.wire;

    // Detach from the terminal so the endpoint can be dragged away.
    wire.attachedTerminal = null;

    dragging = {
      type: "wireEnd",
      object: wireEnd,
      wire,
    };

    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }

  const component = findComponentGroup(hit.object);

  if (component) {
    const point = getGroundPoint(event);

    if (!point) {
      return;
    }

    dragging = {
      type: "component",
      object: component,
    };

    dragOffset.set(
      component.position.x - point.x,
      0,
      component.position.z - point.z
    );

    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) {
    return;
  }

  const point = getGroundPoint(event);

  if (!point) {
    return;
  }

  if (dragging.type === "wireEnd") {
    const wire = dragging.wire;

    wire.freeEnd.position.set(point.x, 0.35, point.z);
    wire.freeEnd.position.y = 0.35;

    updateWires();
  } else if (dragging.type === "component") {
    const component = dragging.object;

    component.position.x = point.x + dragOffset.x;
    component.position.z = point.z + dragOffset.z;

    updateTerminalPositions();
    updateWires();
  }
});

function snapWireEnd(wire) {
  const freePosition = wire.freeEnd.position;
  let closestTerminal = null;
  let closestDistance = Infinity;

  for (const terminalId of Object.keys(terminals)) {
    const terminalPosition = getTerminalPosition(terminalId);
    const distance = freePosition.distanceTo(terminalPosition);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestTerminal = terminalId;
    }
  }

  const snapDistance = 0.48;

  if (closestTerminal && closestDistance <= snapDistance) {
    wire.attachedTerminal = closestTerminal;
    wire.freeEnd.position.copy(getTerminalPosition(closestTerminal));
  }

  updateWires();
}

function finishDragging(event) {
  if (!dragging) {
    return;
  }

  if (dragging.type === "wireEnd") {
    snapWireEnd(dragging.wire);
    updateCircuit();
  }

  dragging = null;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

canvas.addEventListener("pointerup", finishDragging);
canvas.addEventListener("pointercancel", finishDragging);

/* =========================================================
   RESET
   ========================================================= */

function resetLayout() {
  battery.position.set(-2.5, 0, 0);
  bulb.position.set(2.5, 0, 0);

  redWire.attachedTerminal = null;
  redWire.freeEnd.position.copy(redWire.initialPosition);

  blackWire.attachedTerminal = null;
  blackWire.freeEnd.position.copy(blackWire.initialPosition);

  dragging = null;

  updateTerminalPositions();
  updateWires();
  updateCircuit();
}

$("reset-button").addEventListener("click", resetLayout);

/* =========================================================
   RESIZE AND ANIMATION
   ========================================================= */

function resizeRenderer() {
  const width = container.clientWidth;
  const height = container.clientHeight;

  if (width <= 0 || height <= 0) {
    return;
  }

  renderer.setSize(width, height, false);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resizeRenderer);

function animate() {
  requestAnimationFrame(animate);

  updateTerminalPositions();
  updateWires();

  renderer.render(scene, camera);
}

/* =========================================================
   STARTUP
   ========================================================= */

resizeRenderer();
updateWires();
updateCircuit();
animate();

showScreen("home");
