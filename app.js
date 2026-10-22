
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

/* =========================================================
   ELECTRICITY LAB — LEVEL 1
   Flexible wires, independent connectors, bulb inspection
   ========================================================= */

/*
  SIMPLIFIED CIRCUIT MODEL

  Bulb resistance: 6 ohms (fixed)
  Nominal voltage: 3 volts
  Nominal power: 1.5 watts

  I = V / R
  P = V * I

  WIRE MODEL

  Each cable has a fixed total length.
  Verlet particles + distance constraints approximate rope physics.
  This is not a full rigid-body physics engine.

  BULB MODEL

  Brightness responds to electrical power.
  Sustained excessive power accumulates filament damage.
  Once the filament fails, the bulb becomes an open circuit.
*/

const BULB_RESISTANCE = 6;
const BULB_RATED_VOLTAGE = 3;
const BULB_RATED_POWER =
  BULB_RATED_VOLTAGE * BULB_RATED_VOLTAGE / BULB_RESISTANCE;

const MIN_VOLTAGE = 0.5;
const MAX_VOLTAGE = 12;
const VOLTAGE_STEP = 0.5;

const ROPE_PARTICLE_COUNT = 25;
const ROPE_SOLVER_ITERATIONS = 12;
const ROPE_GRAVITY = 3.8;
const ROPE_DAMPING = 0.99;
const ROPE_RADIUS = 0.045;
const ROPE_GROUND_HEIGHT = 0.075;

let voltage = 3;
let circuitComplete = false;
let bulbFailed = false;
let filamentDamage = 0;
let lastFrameTime = 0;

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

$("learn-button").addEventListener("click", () => showScreen("levels"));
$("sandbox-button").addEventListener("click", () => showScreen("sandbox"));
$("levels-back-button").addEventListener("click", () => showScreen("home"));
$("game-back-button").addEventListener("click", () => showScreen("levels"));

document.querySelectorAll(".back-home-button").forEach((button) => {
  button.addEventListener("click", () => showScreen("home"));
});

$("level-one-button").addEventListener("click", () => showScreen("game"));

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

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
});

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

const dragPlane = new THREE.Plane(
  new THREE.Vector3(0, 1, 0),
  0
);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPoint = new THREE.Vector3();

let dragging = null;
const interactiveObjects = [];

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

  bulbGlass: new THREE.MeshPhysicalMaterial({
    color: "#fff6df",
    emissive: "#ffad35",
    emissiveIntensity: 0.04,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.88,
    transparent: true,
    opacity: 0.28,
    thickness: 0.12,
    ior: 1.45,
    depthWrite: false,
  }),

  filament: new THREE.MeshStandardMaterial({
    color: "#ffcb74",
    emissive: "#ff6b20",
    emissiveIntensity: 0.04,
    metalness: 0.35,
    roughness: 0.38,
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

const terminals = {};

function makeTerminal(parent, id, x, y, z, color) {
  // A small metal contact pad instead of a large visible ball.
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);

  const padMaterial = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.82,
    roughness: 0.24,
  });

  makeMesh(
    new THREE.CylinderGeometry(0.135, 0.135, 0.075, 24),
    padMaterial,
    group,
    { x: 0, y: 0, z: 0 }
  );

  makeMesh(
    new THREE.CylinderGeometry(0.075, 0.075, 0.035, 20),
    materials.metal,
    group,
    { x: 0, y: 0.045, z: 0 }
  );

  terminals[id] = {
    id,
    parent,
    localPosition: new THREE.Vector3(x, y, z),
    mesh: group,
  };

  return group;
}

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

const positiveCap = makeMesh(
  new THREE.CylinderGeometry(0.24, 0.24, 0.13, 24),
  materials.red,
  battery,
  { x: -0.72, y: 0.43, z: 0 }
);
positiveCap.rotation.z = Math.PI / 2;

const negativeCap = makeMesh(
  new THREE.CylinderGeometry(0.24, 0.24, 0.13, 24),
  materials.metal,
  battery,
  { x: 0.72, y: 0.43, z: 0 }
);
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

// Metal screw base.
makeMesh(
  new THREE.CylinderGeometry(0.29, 0.27, 0.36, 32),
  materials.bulbBase,
  bulb,
  { x: 0, y: 0.3, z: 0 }
);

// Visible screw ridges.
for (let i = 0; i < 4; i++) {
  makeMesh(
    new THREE.TorusGeometry(0.277, 0.025, 8, 28),
    materials.metal,
    bulb,
    { x: 0, y: 0.16 + i * 0.085, z: 0 }
  ).rotation.x = Math.PI / 2;
}

// Glass globe.
const bulbGlobe = makeMesh(
  new THREE.SphereGeometry(0.39, 40, 32),
  materials.bulbGlass,
  bulb,
  { x: 0, y: 0.78, z: 0 }
);

bulbGlobe.scale.set(1, 1.12, 1);

// Central support wires.
const supportMaterial = new THREE.MeshStandardMaterial({
  color: "#c4cbd2",
  metalness: 0.8,
  roughness: 0.28,
});

function makeFilamentSupport(points, material, radius = 0.018) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
  );

  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 20, radius, 6, false),
    material
  );

  mesh.castShadow = true;
  bulb.add(mesh);
  return mesh;
}

makeFilamentSupport([
  [0, 0.45, 0],
  [0, 0.62, 0],
  [0, 0.86, 0],
], supportMaterial, 0.016);

makeFilamentSupport([
  [-0.13, 0.61, 0],
  [-0.13, 0.79, 0],
  [-0.10, 0.93, 0],
], supportMaterial, 0.012);

makeFilamentSupport([
  [0.13, 0.61, 0],
  [0.13, 0.79, 0],
  [0.10, 0.93, 0],
], supportMaterial, 0.012);

// A coiled filament rather than a glowing ball.
const filamentPoints = [];
const coilTurns = 8;
const coilRadius = 0.09;
const coilHeight = 0.22;

for (let i = 0; i <= 100; i++) {
  const t = i / 100;
  const angle = t * Math.PI * 2 * coilTurns;

  filamentPoints.push(
    new THREE.Vector3(
      Math.cos(angle) * coilRadius,
      0.77 + t * coilHeight,
      Math.sin(angle) * coilRadius
    )
  );
}

const filamentCurve = new THREE.CatmullRomCurve3(filamentPoints);

const filamentMesh = new THREE.Mesh(
  new THREE.TubeGeometry(filamentCurve, 240, 0.012, 8, false),
  materials.filament
);

bulb.add(filamentMesh);

const bulbLight = new THREE.PointLight("#ffbd63", 0, 5);
bulbLight.position.set(0, 0.85, 0);
bulb.add(bulbLight);

// Two contact pads on the bulb's base.
makeTerminal(bulb, "bulbA", -0.53, 0.32, 0, "#dce7f5");
makeTerminal(bulb, "bulbB", 0.53, 0.32, 0, "#dce7f5");

/* =========================================================
   INDEPENDENT WIRE CONNECTORS
   ========================================================= */

function makeConnector(colorMaterial) {
  const connector = new THREE.Group();

  // Insulated plug handle.
  makeMesh(
    new THREE.CylinderGeometry(0.105, 0.09, 0.30, 16),
    colorMaterial,
    connector,
    { x: 0, y: 0, z: 0 }
  );

  // Exposed metal contact.
  makeMesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.16, 16),
    materials.metal,
    connector,
    { x: 0, y: 0.20, z: 0 }
  );

  // Cable-entry collar.
  makeMesh(
    new THREE.CylinderGeometry(0.075, 0.09, 0.12, 16),
    materials.metal,
    connector,
    { x: 0, y: -0.17, z: 0 }
  );

  // The cable must end inside the collar, not at the plug's center.
  connector.userData.cableEntry = new THREE.Vector3(0, -0.22, 0);

  return connector;
}

function makeWireEnd(position, material) {
  const connector = makeConnector(material);
  connector.position.copy(position);
  connector.userData.isWireEnd = true;
  scene.add(connector);
  interactiveObjects.push(connector);
  return connector;
}

/* =========================================================
   ROPE PHYSICS
   ========================================================= */

function makeWire(color, material, startPosition, endPosition, length) {
  const startEnd = makeWireEnd(startPosition, material);
  const finishEnd = makeWireEnd(endPosition, material);

  const points = [];

  for (let i = 0; i < ROPE_PARTICLE_COUNT; i++) {
    const t = i / (ROPE_PARTICLE_COUNT - 1);
    const position = startPosition.clone().lerp(endPosition, t);

    // Start with a little slack instead of a perfectly straight cable.
position.y -= Math.sin(t * Math.PI) * 0.13;

    points.push({
      position,
      previous: position.clone(),
    });
  }

  const initialCurve = new THREE.CatmullRomCurve3(
    points.map((point) => point.position)
  );

  const cableMesh = new THREE.Mesh(
    new THREE.TubeGeometry(
      initialCurve,
      ROPE_PARTICLE_COUNT * 2,
      ROPE_RADIUS,
      8,
      false
    ),
    material
  );

  cableMesh.frustumCulled = false;
  cableMesh.castShadow = true;
  scene.add(cableMesh);

  const wire = {
    color,
    material,
    length,
    ends: [
      {
        connector: startEnd,
        terminalId: null,
      },
      {
        connector: finishEnd,
        terminalId: null,
      },
    ],
    particles: points,
    mesh: cableMesh,
    segmentLength: length / (ROPE_PARTICLE_COUNT - 1),
  };

  startEnd.userData.wire = wire;
  startEnd.userData.endIndex = 0;

  finishEnd.userData.wire = wire;
  finishEnd.userData.endIndex = 1;

  return wire;
}

/*
  Both ends are independent at startup.
  Their initial positions are near the components, but they are NOT attached.
*/

const redWire = makeWire(
  "#ff535d",
  materials.red,
  new THREE.Vector3(-3.33, 0.43, 0),
  new THREE.Vector3(1.45, 0.35, 0.7),
  6.2
);

const blackWire = makeWire(
  "#b5c3d5",
  materials.black,
  new THREE.Vector3(3.03, 0.32, 0),
  new THREE.Vector3(-1.45, 0.35, -0.7),
  6.2
);

const wires = [redWire, blackWire];

interactiveObjects.push(battery, bulb);

/* =========================================================
   TERMINAL AND WIRE END POSITIONS
   ========================================================= */

function getTerminalPosition(terminalId) {
  const terminal = terminals[terminalId];

  if (!terminal) {
    return new THREE.Vector3();
  }

  terminal.parent.updateMatrixWorld(true);

  return terminal.localPosition.clone().applyMatrix4(
    terminal.parent.matrixWorld
  );
}

function getEndPosition(wire, endIndex) {
  const end = wire.ends[endIndex];

  // The cable endpoint is the connector's cable-entry point.
  const entry =
    end.connector.userData.cableEntry ||
    new THREE.Vector3(0, -0.22, 0);

  if (end.terminalId) {
    // Keep the connector centered on its attached terminal.
    const terminalPosition = getTerminalPosition(end.terminalId);

    end.connector.position.copy(terminalPosition);

    return terminalPosition.add(entry);
  }

  // When disconnected, the cable follows the connector itself.
  return end.connector.position.clone().add(entry);
}

/* =========================================================
   VERLET ROPE INTEGRATION
   ========================================================= */

function simulateWire(wire, deltaTime) {
  const particles = wire.particles;
  const lastIndex = particles.length - 1;

  // Keep both cable endpoints at their current connector/terminal positions.
  particles[0].position.copy(getEndPosition(wire, 0));
  particles[lastIndex].position.copy(getEndPosition(wire, 1));

  particles[0].previous.copy(particles[0].position);
  particles[lastIndex].previous.copy(particles[lastIndex].position);

  const dt = Math.min(deltaTime, 0.025);
  const gravityStep = ROPE_GRAVITY * dt * dt;

  // Verlet integration: position plus the previous frame's displacement.
  for (let i = 1; i < lastIndex; i++) {
    const particle = particles[i];

    const current = particle.position.clone();
    const velocity = particle.position
      .clone()
      .sub(particle.previous)
      .multiplyScalar(ROPE_DAMPING);

    particle.position.add(velocity);
    particle.position.y -= gravityStep;
    particle.previous.copy(current);

    // Workbench floor collision.
    if (particle.position.y < ROPE_GROUND_HEIGHT) {
      particle.position.y = ROPE_GROUND_HEIGHT;

      // Reduce downward velocity when the cable contacts the floor.
      if (particle.previous.y > particle.position.y) {
        particle.previous.y = particle.position.y;
      }
    }
  }

  // Solve fixed-length constraints several times per frame.
  for (let iteration = 0; iteration < ROPE_SOLVER_ITERATIONS; iteration++) {
    particles[0].position.copy(getEndPosition(wire, 0));
    particles[lastIndex].position.copy(getEndPosition(wire, 1));

    for (let i = 0; i < lastIndex; i++) {
      const a = particles[i];
      const b = particles[i + 1];

      const difference = b.position.clone().sub(a.position);
      const distance = difference.length();

      if (distance < 0.00001) {
        continue;
      }

      const correction = difference.multiplyScalar(
        (distance - wire.segmentLength) / distance
      );

      const isFirst = i === 0;
      const isLast = i + 1 === lastIndex;

      if (isFirst && !isLast) {
        b.position.sub(correction);
      } else if (isLast && !isFirst) {
        a.position.add(correction);
      } else if (!isFirst && !isLast) {
        a.position.addScaledVector(correction, 0.5);
        b.position.addScaledVector(correction, -0.5);
      }
    }
  }

  particles[0].position.copy(getEndPosition(wire, 0));
  particles[lastIndex].position.copy(getEndPosition(wire, 1));

  // Render a smooth tube along the simulated rope particles.
  const curve = new THREE.CatmullRomCurve3(
    particles.map((particle) => particle.position)
  );

  const oldGeometry = wire.mesh.geometry;

  wire.mesh.geometry = new THREE.TubeGeometry(
    curve,
    (ROPE_PARTICLE_COUNT - 1) * 3,
    ROPE_RADIUS,
    8,
    false
  );

  oldGeometry.dispose();
}

/* =========================================================
   CIRCUIT CONNECTIONS
   ========================================================= */

function wireConnects(wire, terminalA, terminalB) {
  const attached = wire.ends.map((end) => end.terminalId);

  return (
    attached.includes(terminalA) &&
    attached.includes(terminalB)
  );
}

function isTerminalOccupied(terminalId, exceptEnd = null) {
  return wires.some((wire) =>
    wire.ends.some((end) =>
      end.terminalId === terminalId && end !== exceptEnd
    )
  );
}

function updateCircuit() {
  circuitComplete =
    wireConnects(redWire, "batteryPlus", "bulbA") &&
    wireConnects(blackWire, "bulbB", "batteryMinus");

  updateReadings();
  updateBulbAppearance();
  updateStatus();
   updateElectronOverlay(0);
}

function updateStatus() {
  const status = $("circuit-status");
  const hint = $("scene-hint");

  status.classList.toggle(
    "complete",
    circuitComplete && !bulbFailed
  );

  if (bulbFailed) {
    status.innerHTML =
      '<span class="status-dot"></span> Bulb burned out';

    hint.textContent =
      "The filament has failed. Reset the bulb to try again.";
    return;
  }

  if (circuitComplete) {
    status.innerHTML =
      '<span class="status-dot"></span> Circuit complete';

    hint.textContent =
      "The loop is complete. Adjust the voltage and watch the bulb.";
    return;
  }

  status.innerHTML =
    '<span class="status-dot"></span> Circuit incomplete';

  if (
    !redWire.ends.some((end) => end.terminalId === "bulbA")
  ) {
    hint.textContent =
      "Connect one red wire end to battery + and the other to the bulb's left terminal.";
  } else if (
    !blackWire.ends.some((end) => end.terminalId === "batteryMinus")
  ) {
    hint.textContent =
      "Connect the black wire between the bulb's right terminal and battery −.";
  } else {
    hint.textContent =
      "Connect both ends of each wire to the correct terminals.";
  }
}

updateInstrumentReadings();

/* =========================================================
   PHYSICS CALCULATIONS
   ========================================================= */

function calculateCircuit() {
  if (!circuitComplete || bulbFailed) {
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

  const percentage =
    ((voltage - MIN_VOLTAGE) / (MAX_VOLTAGE - MIN_VOLTAGE)) * 100;

  $("voltage-track-fill").style.width =
    `${Math.max(0, Math.min(100, percentage))}%`;

  const note = $("measurement-note");

  if (bulbFailed) {
    note.classList.remove("active");
    note.textContent =
      "Filament broken: the bulb is now an open circuit. Current is zero.";
  } else if (!circuitComplete) {
    note.classList.remove("active");
    note.textContent =
      "No complete path: current and bulb power are zero.";
  } else {
    note.classList.add("active");
    note.textContent =
      `${voltage.toFixed(1)} V ÷ ${BULB_RESISTANCE.toFixed(1)} Ω = ` +
      `${current.toFixed(3)} A. Bulb power: ${power.toFixed(3)} W.`;
  }
}

/* =========================================================
   BULB HEAT AND FILAMENT FAILURE
   ========================================================= */

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

  // Higher power produces a hotter-looking filament.
  if (power > BULB_RATED_POWER) {
    materials.filament.emissive.set("#fff0a1");
  }
}

function updateBulbDamage(deltaTime) {
  if (!circuitComplete || bulbFailed) {
    return;
  }

  const { power } = calculateCircuit();

  /*
    A simple overload model:
    - At or below the rated power, no permanent damage accumulates.
    - Above 115% rated power, damage accumulates.
    - The higher the overload, the faster the filament fails.

    This is a gameplay approximation, not a real filament-lifetime formula.
  */

  const overloadRatio = power / BULB_RATED_POWER;

  if (overloadRatio > 1.15) {
    const overload = overloadRatio - 1.15;

    filamentDamage += deltaTime * overload * 0.07;
    filamentDamage = Math.min(filamentDamage, 1);

    // The filament glows more intensely while overheating.
    materials.filament.emissiveIntensity =
      2.6 + Math.min(overloadRatio, 8) * 0.3;

    if (filamentDamage >= 1) {
      bulbFailed = true;
      updateReadings();
      updateBulbAppearance();
      updateStatus();
    }
  }
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
   POINTER AND DRAG HELPERS
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
    if (
      current.userData.dragType === "component" ||
      current.userData.dragType === "instrument"
    ) {
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

function getOtherEndPosition(wire, endIndex) {
  return getEndPosition(wire, endIndex === 0 ? 1 : 0);
}

function clampEndpointToCableLength(wire, endIndex, candidate) {
  const other = getOtherEndPosition(wire, endIndex);
  const difference = candidate.clone().sub(other);
  const distance = difference.length();

  if (distance <= wire.length || distance < 0.0001) {
    return candidate;
  }

  return other.add(difference.multiplyScalar(wire.length / distance));
}

/* =========================================================
   SNAP CONNECTORS TO TERMINALS
   ========================================================= */

function snapWireEnd(wire, endIndex) {
  const end = wire.ends[endIndex];
  const position = end.connector.position;

  let closestId = null;
  let closestDistance = Infinity;

  for (const terminalId of Object.keys(terminals)) {
    const terminalPosition = getTerminalPosition(terminalId);
    const distance = position.distanceTo(terminalPosition);

    if (
      distance < closestDistance &&
      !isTerminalOccupied(terminalId, end)
    ) {
      closestDistance = distance;
      closestId = terminalId;
    }
  }

  const snapDistance = 0.43;

  if (closestId && closestDistance <= snapDistance) {
    end.terminalId = closestId;
    end.connector.position.copy(getTerminalPosition(closestId));
  }
}

/* =========================================================
   POINTER INTERACTION
   ========================================================= */

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.pointerType !== "touch") {
    return;
  }

  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(interactiveObjects, true);

  if (!hits.length) {
    return;
  }

  const hit = hits[0];
  const wireEnd = findWireEnd(hit.object);

  if (wireEnd) {
    const wire = wireEnd.userData.wire;
    const endIndex = wireEnd.userData.endIndex;

    // Pulling a connector away releases it from its terminal.
    wire.ends[endIndex].terminalId = null;

    dragging = {
      type: "wireEnd",
      object: wireEnd,
      wire,
      endIndex,
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
      originalPosition: component.position.clone(),
    };

    dragging.offset = new THREE.Vector3(
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
    const { wire, endIndex } = dragging;

    const candidate = new THREE.Vector3(
      point.x,
      0.35,
      point.z
    );

    const limited = clampEndpointToCableLength(
      wire,
      endIndex,
      candidate
    );

    setEndPosition(wire, endIndex, limited);
    return;
  }

  if (dragging.type === "component") {
    const component = dragging.object;

    component.position.x = point.x + dragging.offset.x;
    component.position.z = point.z + dragging.offset.z;

    updateTerminalPositions();
  }
});

function finishDragging(event) {
  if (!dragging) {
    return;
  }

  if (dragging.type === "wireEnd") {
    snapWireEnd(dragging.wire, dragging.endIndex);
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
   BULB INSPECTION VIEW
   ========================================================= */

/*
  The inspection view is created in JavaScript, so HTML/CSS files
  don't need to change.

  Drag the model to rotate it.
  Use the mouse wheel to zoom.
*/

const inspectButton = document.createElement("button");

inspectButton.className = "small-button";
inspectButton.textContent = "Inspect 3D bulb ↗";
inspectButton.style.cssText = `
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 50;
  padding: 12px 16px;
  border: 1px solid #45617f;
  border-radius: 10px;
  background: #142238;
  color: #edf3ff;
  font: 600 13px system-ui, sans-serif;
  cursor: pointer;
`;

document.body.appendChild(inspectButton);

const inspector = document.createElement("div");

inspector.style.cssText = `
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: none;
  grid-template-rows: auto minmax(0, 1fr) auto;
  padding: 18px;
  background: rgba(5, 10, 19, 0.97);
  color: #edf3ff;
  font-family: Inter, system-ui, sans-serif;
`;

inspector.innerHTML = `
  <div style="
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    max-width:1000px;
    width:100%;
    margin:0 auto;
  ">
    <div>
      <div style="
        color:#64e4ff;
        font-size:10px;
        font-weight:800;
        letter-spacing:2px;
      ">COMPONENT INSPECTION</div>
      <div style="margin-top:5px;font-size:20px;font-weight:750;">
        Incandescent bulb
      </div>
    </div>
    <button id="close-inspector" style="
      padding:10px 14px;
      border:1px solid #34445c;
      border-radius:8px;
      background:#111c2d;
      color:#edf3ff;
      cursor:pointer;
    ">Close ×</button>
  </div>

  <div id="inspector-model" style="
    position:relative;
    width:100%;
    max-width:1000px;
    min-height:250px;
    margin:12px auto;
    overflow:hidden;
    border:1px solid #26364c;
    border-radius:12px;
    background:
      radial-gradient(ellipse at center, #192a40 0%, #0a1220 72%);
  ">
    <div style="
      position:absolute;
      top:14px;
      left:14px;
      z-index:2;
      color:#9eb1ca;
      font-size:10px;
      pointer-events:none;
    ">DRAG TO ROTATE · SCROLL TO ZOOM</div>
  </div>

  <div style="
    max-width:1000px;
    width:100%;
    margin:0 auto;
    padding:18px;
    border:1px solid #26364c;
    border-radius:12px;
    background:#101827;
  ">
    <div style="
      color:#64e4ff;
      font-size:10px;
      font-weight:800;
      letter-spacing:1.8px;
    ">ELECTRICAL SPECIFICATION</div>

    <div style="
      display:flex;
      align-items:baseline;
      gap:8px;
      margin-top:10px;
    ">
      <span style="font-size:32px;font-weight:800;">6.0</span>
      <span style="color:#9aacc4;">Ω resistance</span>
    </div>

    <p style="
      margin:8px 0 0;
      color:#9aacc4;
      font-size:12px;
      line-height:1.8;
    ">
      This learning model uses a fixed resistance of 6 ohms.
      Real incandescent filament resistance increases as the filament heats up.
    </p>
  </div>
`;

document.body.appendChild(inspector);

let inspectorRenderer = null;
let inspectorScene = null;
let inspectorCamera = null;
let inspectedBulb = null;
let inspectorAnimationId = 0;
let inspectorDragging = false;
let inspectorLastX = 0;
let inspectorLastY = 0;
let inspectorZoom = 3.8;

function resizeInspector() {
  if (!inspectorRenderer || inspector.style.display === "none") {
    return;
  }

  const modelArea = $("inspector-model");
  const width = modelArea.clientWidth;
  const height = modelArea.clientHeight;

  if (!width || !height) {
    return;
  }

  inspectorRenderer.setSize(width, height, false);
  inspectorCamera.aspect = width / height;
  inspectorCamera.updateProjectionMatrix();
}

function openInspector() {
  inspector.style.display = "grid";

  if (!inspectorRenderer) {
    const modelArea = $("inspector-model");
    const inspectorCanvas = document.createElement("canvas");

    inspectorCanvas.style.cssText =
      "display:block;width:100%;height:100%;touch-action:none;";

    modelArea.appendChild(inspectorCanvas);

    inspectorRenderer = new THREE.WebGLRenderer({
      canvas: inspectorCanvas,
      antialias: true,
      alpha: true,
    });

    inspectorRenderer.setPixelRatio(
      Math.min(window.devicePixelRatio, 1.5)
    );

    inspectorRenderer.outputColorSpace = THREE.SRGBColorSpace;
    inspectorRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    inspectorRenderer.toneMappingExposure = 1.1;

    inspectorScene = new THREE.Scene();

    inspectorScene.add(
      new THREE.HemisphereLight("#ffffff", "#25364b", 2.2)
    );

    const inspectionLight = new THREE.DirectionalLight("#ffffff", 2.8);
    inspectionLight.position.set(-3, 5, 5);
    inspectorScene.add(inspectionLight);

    const inspectionFill = new THREE.PointLight("#64caff", 18, 12);
    inspectionFill.position.set(3, 2, -2);
    inspectorScene.add(inspectionFill);

    inspectedBulb = bulb.clone(true);
    inspectedBulb.position.set(0, -0.6, 0);
    inspectedBulb.rotation.set(0.12, 0, 0);
    inspectorScene.add(inspectedBulb);

    inspectorCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    inspectorCamera.position.set(0, 0.15, inspectorZoom);
    inspectorCamera.lookAt(0, 0.1, 0);

    inspectorCanvas.addEventListener("pointerdown", (event) => {
      inspectorDragging = true;
      inspectorLastX = event.clientX;
      inspectorLastY = event.clientY;
      inspectorCanvas.setPointerCapture(event.pointerId);
    });

    inspectorCanvas.addEventListener("pointermove", (event) => {
      if (!inspectorDragging || !inspectedBulb) {
        return;
      }

      const dx = event.clientX - inspectorLastX;
      const dy = event.clientY - inspectorLastY;

      inspectedBulb.rotation.y += dx * 0.009;
      inspectedBulb.rotation.x += dy * 0.009;

      inspectorLastX = event.clientX;
      inspectorLastY = event.clientY;
    });

    function stopInspectorDrag(event) {
      inspectorDragging = false;

      if (inspectorCanvas.hasPointerCapture(event.pointerId)) {
        inspectorCanvas.releasePointerCapture(event.pointerId);
      }
    }

    inspectorCanvas.addEventListener("pointerup", stopInspectorDrag);
    inspectorCanvas.addEventListener("pointercancel", stopInspectorDrag);

    inspectorCanvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();

        inspectorZoom = THREE.MathUtils.clamp(
          inspectorZoom + event.deltaY * 0.005,
          2.1,
          6.5
        );

        inspectorCamera.position.z = inspectorZoom;
      },
      { passive: false }
    );
  }

  resizeInspector();

  function renderInspector() {
    if (inspector.style.display === "none") {
      cancelAnimationFrame(inspectorAnimationId);
      return;
    }

    inspectorRenderer.render(inspectorScene, inspectorCamera);
    inspectorAnimationId = requestAnimationFrame(renderInspector);
  }

  cancelAnimationFrame(inspectorAnimationId);
  renderInspector();
}

function closeInspector() {
  inspector.style.display = "none";
  inspectorDragging = false;
  cancelAnimationFrame(inspectorAnimationId);
}

inspectButton.addEventListener("click", openInspector);
$("close-inspector").addEventListener("click", closeInspector);

inspector.addEventListener("pointerdown", (event) => {
  if (event.target === inspector) {
    closeInspector();
  }
});

window.addEventListener("resize", resizeInspector);

/* =========================================================
   RESET
   ========================================================= */

function resetLayout() {
  battery.position.set(-2.5, 0, 0);
  bulb.position.set(2.5, 0, 0);

  for (const wire of wires) {
    for (const end of wire.ends) {
      end.terminalId = null;
    }
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
      const point = first.clone().lerp(last, t);

      point.y -= Math.sin(t * Math.PI) * 0.13;

      wire.particles[i].position.copy(point);
      wire.particles[i].previous.copy(point);
    }
  }

  voltage = 3;
  filamentDamage = 0;
  bulbFailed = false;

  materials.filament.color.set("#ffcb74");
  materials.filament.emissive.set("#ff6b20");

  updateTerminalPositions();
  updateCircuit();
}

$("reset-button").addEventListener("click", resetLayout);

/* =========================================================
   RESIZE AND MAIN LOOP
   ========================================================= */

function resizeRenderer() {
  const width = container.clientWidth;
  const height = container.clientHeight;

  if (!width || !height) {
    return;
  }

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resizeRenderer);

function animate(timestamp) {
  requestAnimationFrame(animate);

  const deltaTime = lastFrameTime
    ? Math.min((timestamp - lastFrameTime) / 1000, 0.025)
    : 0;

  lastFrameTime = timestamp;

  updateTerminalPositions();

  for (const wire of wires) {
    simulateWire(wire, deltaTime);
  }

  updateBulbDamage(deltaTime);

  renderer.render(scene, camera);

   updateElectronOverlay(deltaTime);
}

/* =========================================================
   TOOLBOX PANEL — LEVEL 1
   ========================================================= */

const toolboxStyle = document.createElement("style");

toolboxStyle.textContent = `
  #electrician-toolbox {
    position: fixed;
    z-index: 50;
    top: 76px;
    left: 18px;
    width: min(290px, calc(100vw - 36px));
    padding: 16px;
    border: 1px solid #30435d;
    border-radius: 14px;
    background: rgba(10, 19, 33, 0.97);
    color: #edf3ff;
    font-family: Inter, system-ui, sans-serif;
    box-shadow: 0 18px 60px #0008;
    display: none;
  }

  #electrician-toolbox.open {
    display: block;
  }

  #electrician-toolbox h3 {
    margin: 0 0 5px;
    font-size: 17px;
  }

  #electrician-toolbox p {
    color: #9aacc4;
    font-size: 12px;
    line-height: 1.6;
    margin: 0 0 13px;
  }

  #electrician-toolbox button,
  #toolbox-toggle {
    border: 1px solid #344c69;
    border-radius: 8px;
    background: #14243a;
    color: #eaf4ff;
    cursor: pointer;
    padding: 10px 12px;
    font: inherit;
  }

  #electrician-toolbox button {
    width: 100%;
    text-align: left;
    margin-top: 7px;
  }

  #electrician-toolbox button:hover,
  #toolbox-toggle:hover {
    background: #1b3552;
  }

  #toolbox-toggle {
    position: fixed;
    z-index: 51;
    top: 18px;
    left: 18px;
    font-weight: 700;
  }

  #electrician-toolbox .tool-note {
    margin-top: 12px;
    font-size: 11px;
    color: #7890ad;
  }
`;

document.head.appendChild(toolboxStyle);

const toolboxToggle = document.createElement("button");
toolboxToggle.id = "toolbox-toggle";
toolboxToggle.textContent = "▦ Toolbox";
document.body.appendChild(toolboxToggle);

const toolbox = document.createElement("section");
toolbox.id = "electrician-toolbox";

toolbox.innerHTML = `
  <h3>Electrician's toolbox</h3>
  <p>Choose a tool to place it on the workbench.</p>

  <button data-tool="ammeter">◉ Ammeter — A</button>
  <button data-tool="multimeter">▣ Digital multimeter</button>
  <button data-tool="voltmeter">◉ Voltmeter — V</button>
  <button data-tool="continuity">⌁ Continuity tester</button>
  <button data-tool="clamp">⊂ Clamp meter</button>

  <div class="tool-note">
    Instruments are introduced progressively. Their readings
    must come from the circuit model, not decorative text.
  </div>
`;

document.body.appendChild(toolbox);

toolboxToggle.addEventListener("click", () => {
  toolbox.classList.toggle("open");
});

toolbox.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tool]");

  if (!button) {
    return;
  }

  spawnInstrument(button.dataset.tool);
  toolbox.classList.remove("open");
});

/* =========================================================
   PHYSICAL INSTRUMENT MODELS
   ========================================================= */

const spawnedInstruments = [];

function makeInstrumentLabel(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#dfe8f2";
  ctx.font = "bold 44px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
  });
}

function spawnInstrument(type) {
  const group = new THREE.Group();

  group.position.set(
    (Math.random() - 0.5) * 2,
    0.15,
    (Math.random() - 0.5) * 1.5
  );

  group.userData.dragType = "instrument";
  group.userData.instrumentType = type;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: type === "multimeter" || type === "clamp"
      ? "#e2a52e"
      : "#26364b",
    roughness: 0.48,
    metalness: 0.2,
  });

  makeMesh(
    new THREE.BoxGeometry(0.75, 0.22, 0.95),
    bodyMaterial,
    group,
    { x: 0, y: 0, z: 0 }
  );

  const face = makeMesh(
    new THREE.BoxGeometry(0.57, 0.025, 0.43),
    new THREE.MeshStandardMaterial({
      color: "#101722",
      roughness: 0.3,
      metalness: 0.1,
    }),
    group,
    { x: 0, y: 0.125, z: 0 }
  );

  const labelText = {
    ammeter: "A",
    multimeter: "MULTI",
    voltmeter: "V",
    continuity: "Ω",
    clamp: "A",
  }[type] || "?";

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.47, 0.22),
    makeInstrumentLabel(labelText)
  );

  label.position.set(0, 0.143, 0);
  label.rotation.x = -Math.PI / 2;
  group.add(label);

  // A display that is updated from the actual circuit calculation.
  const readout = makeMesh(
    new THREE.BoxGeometry(0.40, 0.025, 0.13),
    new THREE.MeshStandardMaterial({
      color: "#86efac",
      emissive: "#1e9b55",
      emissiveIntensity: 0.25,
    }),
    group,
    { x: 0, y: 0.15, z: -0.14 }
  );

  group.userData.readout = readout;

  // Keep the instrument movable.
  scene.add(group);
  interactiveObjects.push(group);
  spawnedInstruments.push(group);

  updateInstrumentReadings();

  return group;
}

function updateInstrumentReadings() {
  const { current, power } = calculateCircuit();

  for (const instrument of spawnedInstruments) {
    const type = instrument.userData.instrumentType;
    const readout = instrument.userData.readout;

    // The display brightness indicates whether the instrument has a
    // meaningful reading. A proper physical readout is the next step.
    const hasReading = circuitComplete && !bulbFailed;

    readout.material.emissiveIntensity = hasReading ? 1.2 : 0.05;

    instrument.userData.measurement = {
      current,
      voltage: hasReading ? voltage : 0,
      resistance: hasReading ? BULB_RESISTANCE : Infinity,
      power,
      connected: hasReading,
      mode: type,
    };
  }
}

/* =========================================================
   OPTIONAL ELECTRON-DRIFT VISUALIZATION
   ========================================================= */

const overlayStyle = document.createElement("style");

overlayStyle.textContent = `
  #electricity-overlay-toggle {
    position: fixed;
    right: 18px;
    top: 18px;
    z-index: 51;
    border: 1px solid #344c69;
    border-radius: 8px;
    padding: 10px 12px;
    color: #eaf4ff;
    background: #14243a;
    cursor: pointer;
    font: inherit;
  }
`;

document.head.appendChild(overlayStyle);

const overlayToggle = document.createElement("button");
overlayToggle.id = "electricity-overlay-toggle";
overlayToggle.textContent = "◎ Electron overlay: OFF";
document.body.appendChild(overlayToggle);

let electronOverlayEnabled = false;
const electronParticles = [];

const electronMaterial = new THREE.MeshBasicMaterial({
  color: "#55cfff",
  transparent: true,
  opacity: 0.9,
});

const electronGeometry = new THREE.SphereGeometry(0.035, 8, 8);

for (let i = 0; i < 36; i++) {
  const particle = new THREE.Mesh(
    electronGeometry,
    electronMaterial
  );

  particle.visible = false;
  particle.userData.progress = i / 36;

  scene.add(particle);
  electronParticles.push(particle);
}

overlayToggle.addEventListener("click", () => {
  electronOverlayEnabled = !electronOverlayEnabled;

  overlayToggle.textContent = electronOverlayEnabled
    ? "◎ Electron overlay: ON"
    : "◎ Electron overlay: OFF";

  for (const particle of electronParticles) {
    particle.visible = electronOverlayEnabled && circuitComplete && !bulbFailed;
  }
});

function updateElectronOverlay(deltaTime) {
  const active = electronOverlayEnabled && circuitComplete && !bulbFailed;

  for (const particle of electronParticles) {
    particle.visible = active;
  }

  if (!active) {
    return;
  }

  /*
    Electron drift is opposite to conventional current:
    battery negative -> bulb -> battery positive through the
    external metallic path.

    This first visualization follows a simplified route around
    the connected loop; it is not a microscopic field solver.
  */

  const route = [
    getTerminalPosition("batteryMinus"),
    getTerminalPosition("bulbB"),
    getTerminalPosition("bulbA"),
    getTerminalPosition("batteryPlus"),
  ];

  for (const particle of electronParticles) {
    particle.userData.progress =
      (particle.userData.progress + deltaTime * 0.09) % 1;

    const scaled = particle.userData.progress * (route.length - 1);
    const segment = Math.min(Math.floor(scaled), route.length - 2);
    const localT = scaled - segment;

    particle.position.copy(
      route[segment].clone().lerp(route[segment + 1], localT)
    );

    particle.position.y += 0.13;
  }
}

/* =========================================================
   STARTUP
   ========================================================= */

resizeRenderer();
updateCircuit();
animate(0);
showScreen("home");
