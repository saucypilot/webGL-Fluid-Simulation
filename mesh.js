export function createSphereMesh(radius = 1, latBands = 48, lonBands = 48) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (let lat = 0; lat <= latBands; lat++) {
    const v = lat / latBands;
    const theta = v * Math.PI; // 0..PI
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);

    for (let lon = 0; lon <= lonBands; lon++) {
      const u = lon / lonBands;
      const phi = u * 2 * Math.PI; // 0..2PI
      const sinP = Math.sin(phi);
      const cosP = Math.cos(phi);

      const x = cosP * sinT;
      const y = cosT;
      const z = sinP * sinT;

      positions.push(radius * x, radius * y, radius * z);
      normals.push(x, y, z);
    }
  }

  const stride = lonBands + 1;
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const a = lat * stride + lon;
      const b = a + stride;
      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }

  const indexArray = (positions.length / 3 > 65535) ? new Uint32Array(indices) : new Uint16Array(indices);
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: indexArray,
  };
}
