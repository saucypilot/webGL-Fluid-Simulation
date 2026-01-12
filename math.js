export function mat4Identity() {
  return new Float32Array([
    1,0,0,0,
    0,1,0,0,
    0,0,1,0,
    0,0,0,1
  ]);
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[c + r*4] =
        a[0 + r*4] * b[c + 0*4] +
        a[1 + r*4] * b[c + 1*4] +
        a[2 + r*4] * b[c + 2*4] +
        a[3 + r*4] * b[c + 3*4];
    }
  }
  return out;
}

export function mat4Perspective(fovyRad, aspect, near, far) {
  const f = 1.0 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f/aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0
  ]);
}

export function vec3Normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0]/len, v[1]/len, v[2]/len];
}

export function vec3Cross(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0]
  ];
}

export function vec3Sub(a, b) {
  return [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
}

export function mat4LookAt(eye, center, up) {
  const f = vec3Normalize(vec3Sub(center, eye));
  const s = vec3Normalize(vec3Cross(f, up));
  const u = vec3Cross(s, f);

  return new Float32Array([
     s[0],  u[0], -f[0], 0,
     s[1],  u[1], -f[1], 0,
     s[2],  u[2], -f[2], 0,
    -(s[0]*eye[0] + s[1]*eye[1] + s[2]*eye[2]),
    -(u[0]*eye[0] + u[1]*eye[1] + u[2]*eye[2]),
     (f[0]*eye[0] + f[1]*eye[1] + f[2]*eye[2]),
     1
  ]);
}

export function mat4RotateY(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return new Float32Array([
     c, 0, s, 0,
     0, 1, 0, 0,
    -s, 0, c, 0,
     0, 0, 0, 1
  ]);
}
