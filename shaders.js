export const vertexSrc = `#version 300 es
precision highp float;

in vec3 aPosition;
in vec3 aNormal;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;

out vec3 vNormal;

void main() {
  vec4 worldPos = uModel * vec4(aPosition, 1.0);
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uProj * uView * worldPos;
}
`;

export const fragmentSrc = `#version 300 es
precision highp float;

in vec3 vNormal;

uniform vec3 uLightDir;
uniform vec3 uColor;

out vec4 outColor;

void main() {
  vec3 N = normalize(vNormal);
  float ndl = max(dot(N, normalize(uLightDir)), 0.0);
  vec3 ambient = 0.15 * uColor;
  vec3 diffuse = ndl * uColor;
  outColor = vec4(ambient + diffuse, 1.0);
}
`;
