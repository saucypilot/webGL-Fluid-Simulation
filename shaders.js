export const vertexSrc = `#version 300 es
precision highp float;

in vec3 aPosition;
in vec3 aNormal;
in vec3 aOffset;   // per-instance particle offset
in float aHue;     // 0..1

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;

out vec3 vNormal;
out vec3 vColor;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  // model transform is used for global scene transforms; particle offset is applied in world space.
  vec4 local = vec4(aPosition, 1.0);
  vec4 worldPos = uModel * local;
  worldPos.xyz += aOffset;

  vNormal = mat3(uModel) * aNormal;
  vColor = hsv2rgb(vec3(aHue, 0.7, 0.95));
  gl_Position = uProj * uView * worldPos;
}
`;

export const fragmentSrc = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vColor;

uniform vec3 uLightDir;
uniform vec3 uColor; // optional tint (set to 1,1,1 for none)

out vec4 outColor;

void main() {
  vec3 N = normalize(vNormal);
  float ndl = max(dot(N, normalize(uLightDir)), 0.0);
  vec3 base = vColor * uColor;
  vec3 ambient = 0.18 * base;
  vec3 diffuse = ndl * base;
  outColor = vec4(ambient + diffuse, 1.0);
}
`;
