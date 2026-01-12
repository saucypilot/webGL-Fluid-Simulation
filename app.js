import { vertexSrc, fragmentSrc } from './shaders.js';
import { createProgram, createBuffer } from './gl-utils.js';
import { createSphereMesh } from './mesh.js';
import { mat4Perspective, mat4LookAt, mat4RotateY } from './math.js';

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

  gl.clearColor(0.2, 0.5, 0.7, 1);

  const program = createProgram(gl, vertexSrc, fragmentSrc);
  if (!program) { console.error('Failed to create GL program'); return; }

  const mesh = createSphereMesh(0.8, 48, 48);

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

  gl.bindVertexArray(null);

  const indexType = (mesh.indices instanceof Uint32Array) ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

  gl.enable(gl.DEPTH_TEST);

  const uModel = gl.getUniformLocation(program, 'uModel');
  const uView  = gl.getUniformLocation(program, 'uView');
  const uProj  = gl.getUniformLocation(program, 'uProj');
  const uLight = gl.getUniformLocation(program, 'uLightDir');
  const uColor = gl.getUniformLocation(program, 'uColor');

  function render(tMs) {
    const t = tMs * 0.001;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);

    const aspect = gl.canvas.width / gl.canvas.height;
    const proj = mat4Perspective(Math.PI / 3, aspect, 0.1, 100.0);
    const view = mat4LookAt([0, 0, 2.5], [0, 0, 0], [0, 1, 0]);
    const model = mat4RotateY(t);

    gl.uniformMatrix4fv(uProj, false, proj);
    gl.uniformMatrix4fv(uView, false, view);
    gl.uniformMatrix4fv(uModel, false, model);

    gl.uniform3f(uLight, 0.6, 0.8, 0.2);
    gl.uniform3f(uColor, 1.0, 0.9, 0.3);

    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, indexType, 0);
    gl.bindVertexArray(null);

    requestAnimationFrame(render);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(render);
}
