/*
  WebGL Fluid (Lite)
  - WebGL2, float/half-float ping-pong FBOs
  - Semi-Lagrangian advection, divergence, pressure solve (Jacobi)
  - Vorticity confinement

  Run locally:
    - simplest: open index.html
    - if your browser blocks file:// texture ops, use a local server (e.g. `python -m http.server`)
*/

(() => {
  const canvas = document.getElementById('c');
  const warn = document.getElementById('warn');
  const hudStats = document.getElementById('stats');

  /** ----------------- Config ----------------- **/
  const config = {
    simScale: 1.0,          // base simulation resolution multiplier
    dyeScale: 1.0,
    dt: 0.016,
    velocityDissipation: 0.98,
    dyeDissipation: 0.985,
    pressureIters: 20,
    curl: 25.0,
    splatRadius: 0.012,
    splatForce: 600.0,
    splatDye: 2.0,
    wrap: false,
    paused: false,
  };

  /** ----------------- WebGL setup ----------------- **/
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });

  if (!gl) {
    showWarn('WebGL2 not available. Use a WebGL2-capable browser/GPU.');
    return;
  }

  const extColorBufferFloat = gl.getExtension('EXT_color_buffer_float');
  const extLinearFloat = gl.getExtension('OES_texture_float_linear');
  const extLinearHalfFloat = gl.getExtension('OES_texture_half_float_linear');

  if (!extColorBufferFloat) {
    showWarn('Missing EXT_color_buffer_float. This GPU/browser can\'t render to float textures.');
    return;
  }

  // We use half-float textures where possible.
  const TEX_TYPE = gl.HALF_FLOAT;
  const FILTER_LINEAR = !!(extLinearHalfFloat || extLinearFloat);

  const baseVertex = `#version 300 es
  precision highp float;
  out vec2 vUv;
  void main() {
    // Fullscreen triangle
    vec2 p = vec2((gl_VertexID == 2) ? 3.0 : -1.0, (gl_VertexID == 1) ? 3.0 : -1.0);
    vUv = 0.5 * (p + 1.0);
    gl_Position = vec4(p, 0.0, 1.0);
  }`;

  /** ----------------- Shaders ----------------- **/
  const clearFrag = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 o;
  uniform sampler2D uTex;
  uniform float value;
  void main() { o = texture(uTex, vUv) * value; }
  `;

  const displayFrag = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 o;
  uniform sampler2D uDye;
  uniform float exposure;
  vec3 tonemap(vec3 c) {
    c *= exposure;
    // simple filmic-ish curve
    c = max(c, 0.0);
    c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
    return clamp(c, 0.0, 1.0);
  }
  void main() {
    vec3 c = texture(uDye, vUv).rgb;
    o = vec4(tonemap(c), 1.0);
  }
  `;

  const splatFrag = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 o;
  uniform sampler2D uTarget;
  uniform vec2 point;
  uniform float radius;
  uniform vec3 color;
  uniform float aspect;
  void main() {
    vec2 p = vUv - point;
    p.x *= aspect;
    vec3 base = texture(uTarget, vUv).xyz;
    float r = exp(-dot(p,p) / radius);
    o = vec4(base + color * r, 1.0);
  }
  `;

  const advectFrag = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 o;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 texelSize;
  uniform float dt;
  uniform float dissipation;
  uniform bool wrap;

  vec4 sampleTex(sampler2D t, vec2 uv) {
    if (wrap) {
      uv = fract(uv);
      return texture(t, uv);
    }
    return texture(t, clamp(uv, 0.0, 1.0));
  }

  void main() {
    vec2 vel = texture(uVelocity, vUv).xy;
    vec2 coord = vUv - dt * vel * texelSize;
    vec4 src = sampleTex(uSource, coord);
    o = src * dissipation;
  }
  `;

  const divergenceFrag = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 o;
  uniform sampler2D uVelocity;
  uniform vec2 texelSize;
  uniform bool wrap;

  vec2 velAt(vec2 uv) {
    if (wrap) uv = fract(uv);
    return texture(uVelocity, clamp(uv, 0.0, 1.0)).xy;
  }

  void main() {
    vec2 L = velAt(vUv - vec2(texelSize.x, 0.0));
    vec2 R = velAt(vUv + vec2(texelSize.x, 0.0));
    vec2 B = velAt(vUv - vec2(0.0, texelSize.y));
    vec2 T = velAt(vUv + vec2(0.0, texelSize.y));

    float div = 0.5 * (R.x - L.x + T.y - B.y);
    o = vec4(div, 0.0, 0.0, 1.0);
  }
  `;

  const curlFrag = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 o;
  uniform sampler2D uVelocity;
  uniform vec2 texelSize;
  uniform bool wrap;

  vec2 velAt(vec2 uv) {
    if (wrap) uv = fract(uv);
    return texture(uVelocity, clamp(uv, 0.0, 1.0)).xy;
  }

  void main() {
    float L = velAt(vUv - vec2(texelSize.x, 0.0)).y;
    float R = velAt(vUv + vec2(texelSize.x, 0.0)).y;
    float B = velAt(vUv - vec2(0.0, texelSize.y)).x;
    float T = velAt(vUv + vec2(0.0, texelSize.y)).x;
    float c = R - L - (T - B);
    o = vec4(c, 0.0, 0.0, 1.0);
  }
  `;

  const vorticityFrag = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 o;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform vec2 texelSize;
  uniform float curl;
  uniform float dt;
  uniform bool wrap;

  float curlAt(vec2 uv) {
    if (wrap) uv = fract(uv);
    return texture(uCurl, clamp(uv, 0.0, 1.0)).x;
  }

  vec2 velAt(vec2 uv) {
    if (wrap) uv = fract(uv);
    return texture(uVelocity, clamp(uv, 0.0, 1.0)).xy;
  }

  void main() {
    float L = abs(curlAt(vUv - vec2(texelSize.x, 0.0)));
    float R = abs(curlAt(vUv + vec2(texelSize.x, 0.0)));
    float B = abs(curlAt(vUv - vec2(0.0, texelSize.y)));
    float T = abs(curlAt(vUv + vec2(0.0, texelSize.y)));

    float C = curlAt(vUv);
    vec2 force = 0.5 * vec2(R - L, T - B);
    float len = max(length(force), 1e-6);
    force = (force / len) * curl * C;

    vec2 v = velAt(vUv);
    v += force * dt;
    o = vec4(v, 0.0, 1.0);
  }
  `;

  const pressureFrag = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 o;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  uniform vec2 texelSize;
  uniform bool wrap;

  float pAt(vec2 uv) {
    if (wrap) uv = fract(uv);
    return texture(uPressure, clamp(uv, 0.0, 1.0)).x;
  }

  void main() {
    float L = pAt(vUv - vec2(texelSize.x, 0.0));
    float R = pAt(vUv + vec2(texelSize.x, 0.0));
    float B = pAt(vUv - vec2(0.0, texelSize.y));
    float T = pAt(vUv + vec2(0.0, texelSize.y));
    float div = texture(uDivergence, vUv).x;
    float p = (L + R + B + T - div) * 0.25;
    o = vec4(p, 0.0, 0.0, 1.0);
  }
  `;

  const gradSubtractFrag = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 o;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  uniform vec2 texelSize;
  uniform bool wrap;

  float pAt(vec2 uv) {
    if (wrap) uv = fract(uv);
    return texture(uPressure, clamp(uv, 0.0, 1.0)).x;
  }

  vec2 vAt(vec2 uv) {
    if (wrap) uv = fract(uv);
    return texture(uVelocity, clamp(uv, 0.0, 1.0)).xy;
  }

  void main() {
    float L = pAt(vUv - vec2(texelSize.x, 0.0));
    float R = pAt(vUv + vec2(texelSize.x, 0.0));
    float B = pAt(vUv - vec2(0.0, texelSize.y));
    float T = pAt(vUv + vec2(0.0, texelSize.y));
    vec2 v = vAt(vUv);
    v -= 0.5 * vec2(R - L, T - B);
    o = vec4(v, 0.0, 1.0);
  }
  `;

  /** ----------------- Small GL helpers ----------------- **/
  function showWarn(msg) {
    warn.style.display = 'block';
    warn.textContent = msg;
  }

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(info || 'Shader compile failed');
    }
    return s;
  }

  function createProgram(vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(info || 'Program link failed');
    }
    return p;
  }

  function getUniforms(program) {
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    const out = {};
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(program, i);
      out[info.name] = gl.getUniformLocation(program, info.name);
    }
    return out;
  }

  class Material {
    constructor(fsSrc) {
      this.program = createProgram(baseVertex, fsSrc);
      this.uniforms = getUniforms(this.program);
    }
    bind() {
      gl.useProgram(this.program);
    }
  }

  function createTexture(w, h, internalFormat, format, type, filtering) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtering);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  function createFBO(tex) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Framebuffer incomplete: ' + status.toString(16));
    }
    return fbo;
  }

  class PingPong {
    constructor(w, h, internalFormat, format, type, filtering) {
      this.w = w;
      this.h = h;
      this.readTex = createTexture(w, h, internalFormat, format, type, filtering);
      this.writeTex = createTexture(w, h, internalFormat, format, type, filtering);
      this.readFBO = createFBO(this.readTex);
      this.writeFBO = createFBO(this.writeTex);
    }
    swap() {
      [this.readTex, this.writeTex] = [this.writeTex, this.readTex];
      [this.readFBO, this.writeFBO] = [this.writeFBO, this.readFBO];
    }
    resize(w, h, internalFormat, format, type, filtering) {
      if (w === this.w && h === this.h) return;
      this.destroy();
      this.w = w; this.h = h;
      this.readTex = createTexture(w, h, internalFormat, format, type, filtering);
      this.writeTex = createTexture(w, h, internalFormat, format, type, filtering);
      this.readFBO = createFBO(this.readTex);
      this.writeFBO = createFBO(this.writeTex);
    }
    destroy() {
      gl.deleteTexture(this.readTex);
      gl.deleteTexture(this.writeTex);
      gl.deleteFramebuffer(this.readFBO);
      gl.deleteFramebuffer(this.writeFBO);
    }
  }

  // Fullscreen triangle draw
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  function blit(fbo, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function bindTex(unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  /** ----------------- Materials ----------------- **/
  const mClear = new Material(clearFrag);
  const mDisplay = new Material(displayFrag);
  const mSplat = new Material(splatFrag);
  const mAdvect = new Material(advectFrag);
  const mDiv = new Material(divergenceFrag);
  const mCurl = new Material(curlFrag);
  const mVort = new Material(vorticityFrag);
  const mPressure = new Material(pressureFrag);
  const mGrad = new Material(gradSubtractFrag);

  /** ----------------- Simulation buffers ----------------- **/
  const formats = chooseFormats();

  let velocity = null;
  let dye = null;
  let pressure = null;
  let divergence = null;
  let curlTex = null;

  let simW = 0, simH = 0;
  let dyeW = 0, dyeH = 0;

  function chooseFormats() {
    // For WebGL2, RG16F / RGBA16F work with EXT_color_buffer_float.
    // We'll keep all attachments in float-like formats.
    const filtering = FILTER_LINEAR ? gl.LINEAR : gl.NEAREST;
    return {
      filtering,
      vel: { internal: gl.RG16F, format: gl.RG },
      dye: { internal: gl.RGBA16F, format: gl.RGBA },
      r:   { internal: gl.R16F, format: gl.RED },
    };
  }

  function alloc() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(innerWidth * dpr);
    const h = Math.floor(innerHeight * dpr);
    canvas.width = w;
    canvas.height = h;

    const q = config.simScale;
    const dq = config.dyeScale;

    simW = Math.max(32, Math.floor(w * q));
    simH = Math.max(32, Math.floor(h * q));
    dyeW = Math.max(32, Math.floor(w * dq));
    dyeH = Math.max(32, Math.floor(h * dq));

    // Make sim resolution a bit smaller by default to keep it fast
    // (scale slider changes config.simScale)

    if (!velocity) {
      velocity = new PingPong(simW, simH, formats.vel.internal, formats.vel.format, TEX_TYPE, formats.filtering);
      dye = new PingPong(dyeW, dyeH, formats.dye.internal, formats.dye.format, TEX_TYPE, formats.filtering);
      pressure = new PingPong(simW, simH, formats.r.internal, formats.r.format, TEX_TYPE, gl.NEAREST);
      divergence = new PingPong(simW, simH, formats.r.internal, formats.r.format, TEX_TYPE, gl.NEAREST);
      curlTex = new PingPong(simW, simH, formats.r.internal, formats.r.format, TEX_TYPE, gl.NEAREST);
    } else {
      velocity.resize(simW, simH, formats.vel.internal, formats.vel.format, TEX_TYPE, formats.filtering);
      pressure.resize(simW, simH, formats.r.internal, formats.r.format, TEX_TYPE, gl.NEAREST);
      divergence.resize(simW, simH, formats.r.internal, formats.r.format, TEX_TYPE, gl.NEAREST);
      curlTex.resize(simW, simH, formats.r.internal, formats.r.format, TEX_TYPE, gl.NEAREST);
      dye.resize(dyeW, dyeH, formats.dye.internal, formats.dye.format, TEX_TYPE, formats.filtering);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
  }

  alloc();
  addResizeListeners();

  /** ----------------- Input ----------------- **/
  const pointers = [];
  const pointer = { id: -1, down: false, right: false, x: 0, y: 0, px: 0, py: 0, dx: 0, dy: 0, moved: false, color: [1, 1, 1] };

  function randColor() {
    // bright-ish
    const r = 0.25 + Math.random() * 0.75;
    const g = 0.25 + Math.random() * 0.75;
    const b = 0.25 + Math.random() * 0.75;
    return [r, g, b];
  }

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = 1.0 - (e.clientY - r.top) / r.height;
    return { x, y };
  }

  function onDown(e) {
    e.preventDefault();
    const p = getPos(e);
    pointer.down = true;
    pointer.right = (e.button === 2);
    pointer.x = pointer.px = p.x;
    pointer.y = pointer.py = p.y;
    pointer.dx = pointer.dy = 0;
    pointer.moved = false;
    pointer.color = randColor();
  }

  function onMove(e) {
    if (!pointer.down) return;
    e.preventDefault();
    const p = getPos(e);
    pointer.px = pointer.x;
    pointer.py = pointer.y;
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.dx = pointer.x - pointer.px;
    pointer.dy = pointer.y - pointer.py;
    pointer.moved = Math.abs(pointer.dx) + Math.abs(pointer.dy) > 0;
  }

  function onUp(e) {
    pointer.down = false;
  }

  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    const p = getPos(t);
    pointer.down = true;
    pointer.right = false;
    pointer.x = pointer.px = p.x;
    pointer.y = pointer.py = p.y;
    pointer.dx = pointer.dy = 0;
    pointer.moved = false;
    pointer.color = randColor();
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    const p = getPos(t);
    pointer.px = pointer.x;
    pointer.py = pointer.y;
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.dx = pointer.x - pointer.px;
    pointer.dy = pointer.y - pointer.py;
    pointer.moved = Math.abs(pointer.dx) + Math.abs(pointer.dy) > 0;
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    pointer.down = false;
  }, { passive: false });

  /** ----------------- UI controls ----------------- **/
  const qualityEl = document.getElementById('quality');
  const vortEl = document.getElementById('vort');
  const dissEl = document.getElementById('diss');
  const itersEl = document.getElementById('iters');
  const clearEl = document.getElementById('clear');
  const pauseEl = document.getElementById('pause');

  qualityEl.addEventListener('input', () => {
    const q = parseFloat(qualityEl.value);
    config.simScale = 0.55 * q;   // keep sim a bit cheaper than dye
    config.dyeScale = 0.85 * q;
    alloc();
  });

  vortEl.addEventListener('input', () => config.curl = parseFloat(vortEl.value));
  dissEl.addEventListener('input', () => config.dyeDissipation = parseFloat(dissEl.value));
  itersEl.addEventListener('input', () => config.pressureIters = parseInt(itersEl.value, 10));

  clearEl.addEventListener('click', () => {
    clear(velocity, 0.0);
    clear(dye, 0.0);
    clear(pressure, 0.0);
  });

  pauseEl.addEventListener('click', () => {
    config.paused = !config.paused;
    pauseEl.textContent = config.paused ? 'Resume' : 'Pause';
  });

  /** ----------------- Simulation steps ----------------- **/
  function clear(pp, value) {
    mClear.bind();
    bindTex(0, pp.readTex);
    gl.uniform1i(mClear.uniforms.uTex, 0);
    gl.uniform1f(mClear.uniforms.value, value);
    blit(pp.writeFBO, pp.w, pp.h);
    pp.swap();
  }

  function splat(pp, x, y, dx, dy, color3, radius, aspect, addVelocity) {
    mSplat.bind();
    gl.uniform2f(mSplat.uniforms.point, x, y);
    gl.uniform1f(mSplat.uniforms.radius, radius);
    gl.uniform1f(mSplat.uniforms.aspect, aspect);
    bindTex(0, pp.readTex);
    gl.uniform1i(mSplat.uniforms.uTarget, 0);

    const c = color3;
    gl.uniform3f(mSplat.uniforms.color, c[0], c[1], c[2]);

    blit(pp.writeFBO, pp.w, pp.h);
    pp.swap();
  }

  function advect(velPP, srcPP, dt, dissipation) {
    mAdvect.bind();
    gl.uniform2f(mAdvect.uniforms.texelSize, 1.0 / srcPP.w, 1.0 / srcPP.h);
    gl.uniform1f(mAdvect.uniforms.dt, dt);
    gl.uniform1f(mAdvect.uniforms.dissipation, dissipation);
    gl.uniform1i(mAdvect.uniforms.wrap, config.wrap ? 1 : 0);

    bindTex(0, velPP.readTex);
    bindTex(1, srcPP.readTex);
    gl.uniform1i(mAdvect.uniforms.uVelocity, 0);
    gl.uniform1i(mAdvect.uniforms.uSource, 1);

    blit(srcPP.writeFBO, srcPP.w, srcPP.h);
    srcPP.swap();
  }

  function computeDivergence(velPP, outPP) {
    mDiv.bind();
    gl.uniform2f(mDiv.uniforms.texelSize, 1.0 / velPP.w, 1.0 / velPP.h);
    gl.uniform1i(mDiv.uniforms.wrap, config.wrap ? 1 : 0);

    bindTex(0, velPP.readTex);
    gl.uniform1i(mDiv.uniforms.uVelocity, 0);
    blit(outPP.writeFBO, outPP.w, outPP.h);
    outPP.swap();
  }

  function computeCurl(velPP, outPP) {
    mCurl.bind();
    gl.uniform2f(mCurl.uniforms.texelSize, 1.0 / velPP.w, 1.0 / velPP.h);
    gl.uniform1i(mCurl.uniforms.wrap, config.wrap ? 1 : 0);

    bindTex(0, velPP.readTex);
    gl.uniform1i(mCurl.uniforms.uVelocity, 0);
    blit(outPP.writeFBO, outPP.w, outPP.h);
    outPP.swap();
  }

  function applyVorticity(velPP, curlPP, dt) {
    mVort.bind();
    gl.uniform2f(mVort.uniforms.texelSize, 1.0 / velPP.w, 1.0 / velPP.h);
    gl.uniform1f(mVort.uniforms.curl, config.curl);
    gl.uniform1f(mVort.uniforms.dt, dt);
    gl.uniform1i(mVort.uniforms.wrap, config.wrap ? 1 : 0);

    bindTex(0, velPP.readTex);
    bindTex(1, curlPP.readTex);
    gl.uniform1i(mVort.uniforms.uVelocity, 0);
    gl.uniform1i(mVort.uniforms.uCurl, 1);

    blit(velPP.writeFBO, velPP.w, velPP.h);
    velPP.swap();
  }

  function solvePressure(pressurePP, divergencePP, iters) {
    // Clear pressure each frame for stability
    clear(pressurePP, 0.0);

    mPressure.bind();
    gl.uniform2f(mPressure.uniforms.texelSize, 1.0 / pressurePP.w, 1.0 / pressurePP.h);
    gl.uniform1i(mPressure.uniforms.wrap, config.wrap ? 1 : 0);
    bindTex(1, divergencePP.readTex);
    gl.uniform1i(mPressure.uniforms.uDivergence, 1);

    for (let i = 0; i < iters; i++) {
      bindTex(0, pressurePP.readTex);
      gl.uniform1i(mPressure.uniforms.uPressure, 0);
      blit(pressurePP.writeFBO, pressurePP.w, pressurePP.h);
      pressurePP.swap();
    }
  }

  function subtractGradient(velPP, pressurePP) {
    mGrad.bind();
    gl.uniform2f(mGrad.uniforms.texelSize, 1.0 / velPP.w, 1.0 / velPP.h);
    gl.uniform1i(mGrad.uniforms.wrap, config.wrap ? 1 : 0);

    bindTex(0, pressurePP.readTex);
    bindTex(1, velPP.readTex);
    gl.uniform1i(mGrad.uniforms.uPressure, 0);
    gl.uniform1i(mGrad.uniforms.uVelocity, 1);

    blit(velPP.writeFBO, velPP.w, velPP.h);
    velPP.swap();
  }

  function render() {
    mDisplay.bind();
    bindTex(0, dye.readTex);
    gl.uniform1i(mDisplay.uniforms.uDye, 0);
    gl.uniform1f(mDisplay.uniforms.exposure, 1.25);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** ----------------- Main loop ----------------- **/
  let last = performance.now();
  let frames = 0;
  let fps = 0;
  let fpsLast = performance.now();

  function step(now) {
    requestAnimationFrame(step);

    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    // FPS stats
    frames++;
    if (now - fpsLast > 500) {
      fps = Math.round(1000 * frames / (now - fpsLast));
      frames = 0;
      fpsLast = now;
      hudStats.textContent = ` ${fps} fps`;
    }

    if (!config.paused) {
      // Handle input splats
      if (pointer.down && pointer.moved) {
        const aspect = canvas.width / canvas.height;
        const dx = pointer.dx;
        const dy = pointer.dy;

        // velocity splat
        const vColor = [dx * config.splatForce, dy * config.splatForce, 0.0];
        if (!pointer.right) {
          mSplat.bind();
          gl.uniform2f(mSplat.uniforms.point, pointer.x, pointer.y);
          gl.uniform1f(mSplat.uniforms.radius, config.splatRadius);
          gl.uniform1f(mSplat.uniforms.aspect, aspect);
          bindTex(0, velocity.readTex);
          gl.uniform1i(mSplat.uniforms.uTarget, 0);
          gl.uniform3f(mSplat.uniforms.color, vColor[0], vColor[1], 0.0);
          blit(velocity.writeFBO, velocity.w, velocity.h);
          velocity.swap();
        }

        // dye splat
        const c = pointer.color;
        const dyeCol = [c[0] * config.splatDye, c[1] * config.splatDye, c[2] * config.splatDye];
        mSplat.bind();
        gl.uniform2f(mSplat.uniforms.point, pointer.x, pointer.y);
        gl.uniform1f(mSplat.uniforms.radius, config.splatRadius);
        gl.uniform1f(mSplat.uniforms.aspect, aspect);
        bindTex(0, dye.readTex);
        gl.uniform1i(mSplat.uniforms.uTarget, 0);
        gl.uniform3f(mSplat.uniforms.color, dyeCol[0], dyeCol[1], dyeCol[2]);
        blit(dye.writeFBO, dye.w, dye.h);
        dye.swap();

        pointer.moved = false;
      }

      // Advect velocity by itself
      advect(velocity, velocity, dt, config.velocityDissipation);

      // Vorticity confinement for swirls
      computeCurl(velocity, curlTex);
      applyVorticity(velocity, curlTex, dt);

      // Divergence -> pressure -> project
      computeDivergence(velocity, divergence);
      solvePressure(pressure, divergence, config.pressureIters);
      subtractGradient(velocity, pressure);

      // Advect dye by velocity
      mAdvect.bind();
      gl.uniform2f(mAdvect.uniforms.texelSize, 1.0 / dye.w, 1.0 / dye.h);
      gl.uniform1f(mAdvect.uniforms.dt, dt);
      gl.uniform1f(mAdvect.uniforms.dissipation, config.dyeDissipation);
      gl.uniform1i(mAdvect.uniforms.wrap, config.wrap ? 1 : 0);
      bindTex(0, velocity.readTex);
      bindTex(1, dye.readTex);
      gl.uniform1i(mAdvect.uniforms.uVelocity, 0);
      gl.uniform1i(mAdvect.uniforms.uSource, 1);
      blit(dye.writeFBO, dye.w, dye.h);
      dye.swap();
    }

    render();
  }

  requestAnimationFrame(step);

  // Seed initial dye
  seed();

  function seed() {
    const aspect = canvas.width / canvas.height;
    for (let i = 0; i < 6; i++) {
      const x = Math.random();
      const y = Math.random();
      const c = randColor();
      mSplat.bind();
      gl.uniform2f(mSplat.uniforms.point, x, y);
      gl.uniform1f(mSplat.uniforms.radius, config.splatRadius * 1.25);
      gl.uniform1f(mSplat.uniforms.aspect, aspect);
      bindTex(0, dye.readTex);
      gl.uniform1i(mSplat.uniforms.uTarget, 0);
      gl.uniform3f(mSplat.uniforms.color, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2);
      blit(dye.writeFBO, dye.w, dye.h);
      dye.swap();
    }
  }

  function addResizeListeners() {
    let t = 0;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        alloc();
      }, 100);
    });
  }
})();
