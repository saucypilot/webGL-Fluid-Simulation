import { vertexSrc, fragmentSrc } from './shaders.js';
import { createProgram, createBuffer } from './gl-utils.js';
import { createSphereMesh } from './mesh.js';
import { mat4Perspective, mat4LookAt, mat4RotateY } from './math.js';
import { createPBF } from './pbf.js';

export function start() {
  const canvas = document.querySelector('canvas') || document.createElement('canvas');
  if (!canvas.parentElement) document.body.appendChild(canvas);
  canvas.style.display = 'block';

  const gl = canvas.getContext('webgl2');
  if (!gl) {
    console.error('WebGL2 not supported');
    return;
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(window.innerWidth * dpr));
    const height = Math.max(1, Math.floor(window.innerHeight * dpr));
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, width, height);
  }

  gl.clearColor(0.95, 0.95, 0.97, 1);

  const program = createProgram(gl, vertexSrc, fragmentSrc);
  if (!program) { console.error('Failed to create GL program'); return; }

  // Low-poly sphere is cheaper when drawing thousands of instances.
  const mesh = createSphereMesh(0.04, 10, 10);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  // positions
  const posBuf = createBuffer(gl, mesh.positions, gl.ARRAY_BUFFER);
  const posLoc = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(posLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

  // normals
  const nrmBuf = createBuffer(gl, mesh.normals, gl.ARRAY_BUFFER);
  const nrmLoc = gl.getAttribLocation(program, 'aNormal');
  gl.enableVertexAttribArray(nrmLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
  gl.vertexAttribPointer(nrmLoc, 3, gl.FLOAT, false, 0, 0);

  // indices
  const idxBuf = createBuffer(gl, mesh.indices, gl.ELEMENT_ARRAY_BUFFER);

  // ----------------- instancing -----------------
  const boundsMin = [-1.3, -0.2, -1.0];
  const boundsMax = [ 1.3,  1.6,  1.0];
  const sim = createPBF({
    count: 3000,
    // simulation space is a box; tune to your taste
    boundsMin,
    boundsMax,
    seed: false,
  });

  // per-instance offset (xyz)
  const offsetLoc = gl.getAttribLocation(program, 'aOffset');
  const offsetBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuf);
  gl.bufferData(gl.ARRAY_BUFFER, sim.positions, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(offsetLoc);
  gl.vertexAttribPointer(offsetLoc, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(offsetLoc, 1);

  // per-instance hue (float)
  const hueLoc = gl.getAttribLocation(program, 'aHue');
  const hueBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, hueBuf);
  gl.bufferData(gl.ARRAY_BUFFER, sim.hues, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(hueLoc);
  gl.vertexAttribPointer(hueLoc, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(hueLoc, 1);

  gl.bindVertexArray(null);

  const indexType = (mesh.indices instanceof Uint32Array) ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

  gl.enable(gl.DEPTH_TEST);

  const uModel = gl.getUniformLocation(program, 'uModel');
  const uView  = gl.getUniformLocation(program, 'uView');
  const uProj  = gl.getUniformLocation(program, 'uProj');
  const uLight = gl.getUniformLocation(program, 'uLightDir');
  const uColor = gl.getUniformLocation(program, 'uColor');

  // UI + controls
  let yaw = 0.4;
  let pitch = 0.2;
  let dragging = false;
  let spawnActive = false;
  let spawnX = 0;
  let spawnZ = 0;
  let spawnAccum = 0;
  let spawnRate = 450; // particles per second
  let spawnSpread = 0.045;
  let substeps = 2;
  const tint = [1.0, 1.0, 1.0];
  let lastX = 0, lastY = 0;

  const ui = document.createElement('div');
  ui.className = 'ui';
  ui.innerHTML = `
    <h1>Fluid Controls</h1>
    <div class="row">
      <label for="gravityY">Gravity Y</label>
      <span class="value" data-value="gravityY"></span>
      <input id="gravityY" type="range" min="-30" max="0" step="0.5">
    </div>
    <div class="row">
      <label for="gravityX">Gravity X</label>
      <span class="value" data-value="gravityX"></span>
      <input id="gravityX" type="range" min="-10" max="10" step="0.5">
    </div>
    <div class="row">
      <label for="gravityZ">Gravity Z</label>
      <span class="value" data-value="gravityZ"></span>
      <input id="gravityZ" type="range" min="-10" max="10" step="0.5">
    </div>
    <div class="row">
      <label for="damping">Damping</label>
      <span class="value" data-value="damping"></span>
      <input id="damping" type="range" min="0" max="1" step="0.01">
    </div>
    <div class="row">
      <label for="restDensity">Rest Density</label>
      <span class="value" data-value="restDensity"></span>
      <input id="restDensity" type="range" min="0.4" max="2.0" step="0.05">
    </div>
    <div class="row">
      <label for="solverIters">Solver Iters</label>
      <span class="value" data-value="solverIters"></span>
      <input id="solverIters" type="range" min="1" max="8" step="1">
    </div>
    <div class="row">
      <label for="viscosity">Viscosity</label>
      <span class="value" data-value="viscosity"></span>
      <input id="viscosity" type="range" min="0" max="0.3" step="0.01">
    </div>
    <div class="row">
      <label for="spawnRate">Spawn Rate</label>
      <span class="value" data-value="spawnRate"></span>
      <input id="spawnRate" type="range" min="0" max="2000" step="50">
    </div>
    <div class="row">
      <label for="substeps">Substeps</label>
      <span class="value" data-value="substeps"></span>
      <input id="substeps" type="range" min="1" max="4" step="1">
    </div>
    <div class="row">
      <label for="spawnSpread">Spawn Spread</label>
      <span class="value" data-value="spawnSpread"></span>
      <input id="spawnSpread" type="range" min="0.01" max="0.2" step="0.01">
    </div>
    <div class="row">
      <label for="tintR">Tint R</label>
      <span class="value" data-value="tintR"></span>
      <input id="tintR" type="range" min="0" max="2" step="0.05">
    </div>
    <div class="row">
      <label for="tintG">Tint G</label>
      <span class="value" data-value="tintG"></span>
      <input id="tintG" type="range" min="0" max="2" step="0.05">
    </div>
    <div class="row">
      <label for="tintB">Tint B</label>
      <span class="value" data-value="tintB"></span>
      <input id="tintB" type="range" min="0" max="2" step="0.05">
    </div>
    <button class="btn" id="resetSim" type="button">Reset</button>
    <div class="hint">Left press to pour particles. Right-click or Alt+drag to orbit.</div>
  `;
  document.body.appendChild(ui);

  ui.addEventListener('pointerdown', (e) => e.stopPropagation());
  ui.addEventListener('pointermove', (e) => e.stopPropagation());
  ui.addEventListener('pointerup', (e) => e.stopPropagation());

  function setValueLabel(name, value) {
    const el = ui.querySelector(`[data-value="${name}"]`);
    if (el) el.textContent = value;
  }

  const gravityYInput = ui.querySelector('#gravityY');
  const gravityXInput = ui.querySelector('#gravityX');
  const gravityZInput = ui.querySelector('#gravityZ');
  const dampingInput = ui.querySelector('#damping');
  const restDensityInput = ui.querySelector('#restDensity');
  const solverItersInput = ui.querySelector('#solverIters');
  const viscosityInput = ui.querySelector('#viscosity');
  const spawnRateInput = ui.querySelector('#spawnRate');
  const substepsInput = ui.querySelector('#substeps');
  const spawnSpreadInput = ui.querySelector('#spawnSpread');
  const tintRInput = ui.querySelector('#tintR');
  const tintGInput = ui.querySelector('#tintG');
  const tintBInput = ui.querySelector('#tintB');
  const resetBtn = ui.querySelector('#resetSim');

  gravityYInput.value = sim.params.gravity[1];
  gravityXInput.value = sim.params.gravity[0];
  gravityZInput.value = sim.params.gravity[2];
  dampingInput.value = sim.params.damping;
  restDensityInput.value = sim.params.restDensity;
  solverItersInput.value = sim.params.solverIters;
  viscosityInput.value = sim.params.viscosity;
  spawnRateInput.value = spawnRate;
  substepsInput.value = substeps;
  spawnSpreadInput.value = spawnSpread;
  tintRInput.value = tint[0];
  tintGInput.value = tint[1];
  tintBInput.value = tint[2];

  setValueLabel('gravityY', sim.params.gravity[1].toFixed(1));
  setValueLabel('gravityX', sim.params.gravity[0].toFixed(1));
  setValueLabel('gravityZ', sim.params.gravity[2].toFixed(1));
  setValueLabel('damping', sim.params.damping.toFixed(2));
  setValueLabel('restDensity', sim.params.restDensity.toFixed(2));
  setValueLabel('solverIters', sim.params.solverIters);
  setValueLabel('viscosity', sim.params.viscosity.toFixed(2));
  setValueLabel('spawnRate', spawnRate);
  setValueLabel('substeps', substeps);
  setValueLabel('spawnSpread', spawnSpread.toFixed(2));
  setValueLabel('tintR', tint[0].toFixed(2));
  setValueLabel('tintG', tint[1].toFixed(2));
  setValueLabel('tintB', tint[2].toFixed(2));

  gravityYInput.addEventListener('input', () => {
    const gy = parseFloat(gravityYInput.value);
    const gx = parseFloat(gravityXInput.value);
    const gz = parseFloat(gravityZInput.value);
    sim.setParams({ gravity: [gx, gy, gz] });
    setValueLabel('gravityY', gy.toFixed(1));
  });
  gravityXInput.addEventListener('input', () => {
    const gx = parseFloat(gravityXInput.value);
    const gy = parseFloat(gravityYInput.value);
    const gz = parseFloat(gravityZInput.value);
    sim.setParams({ gravity: [gx, gy, gz] });
    setValueLabel('gravityX', gx.toFixed(1));
  });
  gravityZInput.addEventListener('input', () => {
    const gx = parseFloat(gravityXInput.value);
    const gy = parseFloat(gravityYInput.value);
    const gz = parseFloat(gravityZInput.value);
    sim.setParams({ gravity: [gx, gy, gz] });
    setValueLabel('gravityZ', gz.toFixed(1));
  });
  dampingInput.addEventListener('input', () => {
    const v = parseFloat(dampingInput.value);
    sim.setParams({ damping: v });
    setValueLabel('damping', v.toFixed(2));
  });
  restDensityInput.addEventListener('input', () => {
    const v = parseFloat(restDensityInput.value);
    sim.setParams({ restDensity: v });
    setValueLabel('restDensity', v.toFixed(2));
  });
  solverItersInput.addEventListener('input', () => {
    const v = parseInt(solverItersInput.value, 10);
    sim.setParams({ solverIters: v });
    setValueLabel('solverIters', v);
  });
  viscosityInput.addEventListener('input', () => {
    const v = parseFloat(viscosityInput.value);
    sim.setParams({ viscosity: v });
    setValueLabel('viscosity', v.toFixed(2));
  });
  spawnRateInput.addEventListener('input', () => {
    spawnRate = parseFloat(spawnRateInput.value);
    setValueLabel('spawnRate', spawnRate);
  });
  substepsInput.addEventListener('input', () => {
    substeps = parseInt(substepsInput.value, 10);
    setValueLabel('substeps', substeps);
  });
  spawnSpreadInput.addEventListener('input', () => {
    spawnSpread = parseFloat(spawnSpreadInput.value);
    setValueLabel('spawnSpread', spawnSpread.toFixed(2));
  });
  function updateTint() {
    tint[0] = parseFloat(tintRInput.value);
    tint[1] = parseFloat(tintGInput.value);
    tint[2] = parseFloat(tintBInput.value);
    setValueLabel('tintR', tint[0].toFixed(2));
    setValueLabel('tintG', tint[1].toFixed(2));
    setValueLabel('tintB', tint[2].toFixed(2));
  }
  tintRInput.addEventListener('input', updateTint);
  tintGInput.addEventListener('input', updateTint);
  tintBInput.addEventListener('input', updateTint);
  resetBtn.addEventListener('click', () => {
    spawnAccum = 0;
    sim.clear();
  });
  function updateSpawnFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const x = boundsMin[0] + nx * (boundsMax[0] - boundsMin[0]);
    const z = boundsMax[2] - ny * (boundsMax[2] - boundsMin[2]);
    spawnX = x;
    spawnZ = z;
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 2 || e.altKey) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      return;
    }
    spawnActive = true;
    updateSpawnFromEvent(e);
  });
  canvas.addEventListener('pointerup', (e) => {
    canvas.releasePointerCapture(e.pointerId);
    dragging = false;
    spawnActive = false;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      yaw += dx * 0.005;
      pitch += dy * 0.005;
      pitch = Math.max(-1.2, Math.min(1.2, pitch));
      return;
    }
    if (spawnActive) updateSpawnFromEvent(e);
  });

  let lastT = 0;
  function render(tMs) {
    const t = tMs * 0.001;
    const dt = Math.min(1/30, Math.max(1/240, (tMs - lastT) * 0.001 || 1/60));
    lastT = tMs;

    if (spawnActive) {
      spawnAccum += dt * spawnRate;
      const n = Math.floor(spawnAccum);
      if (n > 0) {
        spawnAccum -= n;
        const py = boundsMax[1] - sim.params.particleRadius * 1.5;
        sim.spawnBurst([spawnX, py, spawnZ], [0, -0.35, 0], n, spawnSpread);
      }
    }

    // step simulation and upload offsets
    const steps = Math.max(1, substeps);
    const h = dt / steps;
    for (let s = 0; s < steps; s++) sim.step(h);
    gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sim.positions);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);

    const aspect = gl.canvas.width / gl.canvas.height;
    const proj = mat4Perspective(Math.PI / 3, aspect, 0.05, 100.0);

    const camR = 3.2;
    const cx = Math.cos(yaw) * Math.cos(pitch) * camR;
    const cy = Math.sin(pitch) * camR + 0.5;
    const cz = Math.sin(yaw) * Math.cos(pitch) * camR;
    const view = mat4LookAt([cx, cy, cz], [0, 0.6, 0], [0, 1, 0]);
    const model = mat4RotateY(0.0);

    gl.uniformMatrix4fv(uProj, false, proj);
    gl.uniformMatrix4fv(uView, false, view);
    gl.uniformMatrix4fv(uModel, false, model);

    gl.uniform3f(uLight, 0.3, 0.9, 0.15);
    gl.uniform3f(uColor, tint[0], tint[1], tint[2]);

    gl.bindVertexArray(vao);
    gl.drawElementsInstanced(gl.TRIANGLES, mesh.indices.length, indexType, 0, sim.activeCount);
    gl.bindVertexArray(null);

    requestAnimationFrame(render);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(render);
}
