// Position Based Fluids (Macklin & Müller 2013) - CPU implementation.
// Designed for clarity and decent performance up to a few thousand particles.

// Kernel helpers (poly6 and spiky).
function poly6(r2, h) {
  const h2 = h * h;
  if (r2 >= h2) return 0.0;
  const x = h2 - r2;
  // 315/(64*pi*h^9) * (h^2 - r^2)^3
  const k = 315.0 / (64.0 * Math.PI * Math.pow(h, 9));
  return k * x * x * x;
}

function spikyGrad(rx, ry, rz, r, h) {
  if (r <= 1e-6 || r >= h) return [0, 0, 0];
  // -45/(pi*h^6) * (h - r)^2 * (r_vec / r)
  const k = -45.0 / (Math.PI * Math.pow(h, 6));
  const x = (h - r);
  const s = k * x * x / r;
  return [s * rx, s * ry, s * rz];
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

// Simple integer spatial hashing.
function hash3(ix, iy, iz) {
  // large primes
  return (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791);
}

export function createPBF({
  count = 2000,
  boundsMin = [-1, 0, -1],
  boundsMax = [ 1, 2,  1],
  seed = true,
} = {}) {
  // Core sim params (tune these first)
  const h = 0.11;             // smoothing radius
  let restDensity = 1.4;
  const eps = 1e-6;
  let solverIters = 5;
  const gravity = [0, -9.8, 0];
  const particleRadius = 0.04; // for collisions only
  let damping = 0.15;        // boundary collision damping
  let viscosity = 0.08;      // XSPH viscosity

  // s_corr params (keeps particles from clumping)
  const corrK = 0.01;
  const corrN = 4.0;
  const q = 0.3 * h;
  const wq = poly6(q * q, h);

  // Typed arrays
  const positions = new Float32Array(count * 3);
  const prev = new Float32Array(count * 3);
  const predicted = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const velocitiesTmp = new Float32Array(count * 3);
  const lambdas = new Float32Array(count);
  const densities = new Float32Array(count);

  // For nice color gradient
  const hues = new Float32Array(count);

  let activeCount = 0;

  function seedBlock() {
    let idx = 0;
    const spacing = particleRadius * 2.05;
    const startX = -0.9;
    const startY = 0.2;
    const startZ = -0.6;
    const nx = 25, ny = 20, nz = 5;
    for (let y = 0; y < ny && idx < count; y++) {
      for (let z = 0; z < nz && idx < count; z++) {
        for (let x = 0; x < nx && idx < count; x++) {
          const px = startX + x * spacing;
          const py = startY + y * spacing;
          const pz = startZ + z * spacing;
          positions[idx*3+0] = px;
          positions[idx*3+1] = py;
          positions[idx*3+2] = pz;
          prev[idx*3+0] = px;
          prev[idx*3+1] = py;
          prev[idx*3+2] = pz;
          predicted[idx*3+0] = px;
          predicted[idx*3+1] = py;
          predicted[idx*3+2] = pz;
          hues[idx] = clamp((py - boundsMin[1]) / (boundsMax[1] - boundsMin[1]), 0, 1);
          idx++;
        }
      }
    }
    activeCount = idx;
  }

  if (seed) seedBlock();

  // Neighbor structure built each step.
  const cellSize = h;
  const grid = new Map(); // hash -> particle indices

  function buildGrid() {
    grid.clear();
    for (let i = 0; i < activeCount; i++) {
      const x = predicted[i*3+0];
      const y = predicted[i*3+1];
      const z = predicted[i*3+2];
      const ix = Math.floor(x / cellSize);
      const iy = Math.floor(y / cellSize);
      const iz = Math.floor(z / cellSize);
      const hkey = hash3(ix, iy, iz);
      let bucket = grid.get(hkey);
      if (!bucket) {
        bucket = [];
        grid.set(hkey, bucket);
      }
      bucket.push(i);
    }
  }

  function forNeighbors(i, fn) {
    const x = predicted[i*3+0];
    const y = predicted[i*3+1];
    const z = predicted[i*3+2];
    const ix = Math.floor(x / cellSize);
    const iy = Math.floor(y / cellSize);
    const iz = Math.floor(z / cellSize);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const key = hash3(ix + dx, iy + dy, iz + dz);
          const bucket = grid.get(key);
          if (!bucket) continue;
          for (let k = 0; k < bucket.length; k++) {
            const j = bucket[k];
            if (j === i) continue;
            fn(j);
          }
        }
      }
    }
  }

  function confineToBounds(i) {
    let x = predicted[i*3+0];
    let y = predicted[i*3+1];
    let z = predicted[i*3+2];

    const minX = boundsMin[0] + particleRadius;
    const minY = boundsMin[1] + particleRadius;
    const minZ = boundsMin[2] + particleRadius;
    const maxX = boundsMax[0] - particleRadius;
    const maxY = boundsMax[1] - particleRadius;
    const maxZ = boundsMax[2] - particleRadius;

    if (x < minX) x = minX;
    if (x > maxX) x = maxX;
    if (y < minY) y = minY;
    if (y > maxY) y = maxY;
    if (z < minZ) z = minZ;
    if (z > maxZ) z = maxZ;

    predicted[i*3+0] = x;
    predicted[i*3+1] = y;
    predicted[i*3+2] = z;
  }

  function step(dt) {
    if (activeCount === 0) return;
    // Semi-implicit / PBF style: integrate velocities, predict positions.
    for (let i = 0; i < activeCount; i++) {
      const vx = velocities[i*3+0] + gravity[0] * dt;
      const vy = velocities[i*3+1] + gravity[1] * dt;
      const vz = velocities[i*3+2] + gravity[2] * dt;

      velocities[i*3+0] = vx;
      velocities[i*3+1] = vy;
      velocities[i*3+2] = vz;

      prev[i*3+0] = positions[i*3+0];
      prev[i*3+1] = positions[i*3+1];
      prev[i*3+2] = positions[i*3+2];

      predicted[i*3+0] = positions[i*3+0] + vx * dt;
      predicted[i*3+1] = positions[i*3+1] + vy * dt;
      predicted[i*3+2] = positions[i*3+2] + vz * dt;
    }

    buildGrid();

    // Solve constraints.
    for (let iter = 0; iter < solverIters; iter++) {
      // 1) densities + lambdas
      for (let i = 0; i < activeCount; i++) {
        const xi = predicted[i*3+0];
        const yi = predicted[i*3+1];
        const zi = predicted[i*3+2];

        let density = poly6(0.0, h); // self contribution
        forNeighbors(i, (j) => {
          const dx = xi - predicted[j*3+0];
          const dy = yi - predicted[j*3+1];
          const dz = zi - predicted[j*3+2];
          const r2 = dx*dx + dy*dy + dz*dz;
          density += poly6(r2, h);
        });
        densities[i] = density;

        const C = density / restDensity - 1.0;

        // sum of squared gradients
        let sumGrad2 = 0.0;
        let gradXiX = 0.0, gradXiY = 0.0, gradXiZ = 0.0;

        forNeighbors(i, (j) => {
          const rx = xi - predicted[j*3+0];
          const ry = yi - predicted[j*3+1];
          const rz = zi - predicted[j*3+2];
          const r = Math.hypot(rx, ry, rz);
          const g = spikyGrad(rx, ry, rz, r, h);
          // ∇_xj C_i = (1/restDensity) * ∇W
          const gx = g[0] / restDensity;
          const gy = g[1] / restDensity;
          const gz = g[2] / restDensity;
          sumGrad2 += gx*gx + gy*gy + gz*gz;
          gradXiX -= gx;
          gradXiY -= gy;
          gradXiZ -= gz;
        });

        // include i's gradient
        sumGrad2 += gradXiX*gradXiX + gradXiY*gradXiY + gradXiZ*gradXiZ;

        lambdas[i] = -C / (sumGrad2 + eps);
      }

      // 2) position deltas
      for (let i = 0; i < activeCount; i++) {
        const xi = predicted[i*3+0];
        const yi = predicted[i*3+1];
        const zi = predicted[i*3+2];

        let dpx = 0.0, dpy = 0.0, dpz = 0.0;
        forNeighbors(i, (j) => {
          const xj = predicted[j*3+0];
          const yj = predicted[j*3+1];
          const zj = predicted[j*3+2];
          const rx = xi - xj;
          const ry = yi - yj;
          const rz = zi - zj;
          const r = Math.hypot(rx, ry, rz);
          if (r >= h || r <= 1e-6) return;

          // s_corr
          const w = poly6(r*r, h);
          const scorr = -corrK * Math.pow(w / wq, corrN);

          const g = spikyGrad(rx, ry, rz, r, h);
          const s = (lambdas[i] + lambdas[j] + scorr);
          dpx += s * g[0];
          dpy += s * g[1];
          dpz += s * g[2];
        });

        predicted[i*3+0] = xi + dpx / restDensity;
        predicted[i*3+1] = yi + dpy / restDensity;
        predicted[i*3+2] = zi + dpz / restDensity;

        confineToBounds(i);
      }
    }

    // Update velocities and commit positions.
    for (let i = 0; i < activeCount; i++) {
      const px = predicted[i*3+0];
      const py = predicted[i*3+1];
      const pz = predicted[i*3+2];

      const ox = prev[i*3+0];
      const oy = prev[i*3+1];
      const oz = prev[i*3+2];

      let vx = (px - ox) / dt;
      let vy = (py - oy) / dt;
      let vz = (pz - oz) / dt;

      // crude boundary damping: if we clamped, damp velocity
      const minX = boundsMin[0] + particleRadius;
      const minY = boundsMin[1] + particleRadius;
      const minZ = boundsMin[2] + particleRadius;
      const maxX = boundsMax[0] - particleRadius;
      const maxY = boundsMax[1] - particleRadius;
      const maxZ = boundsMax[2] - particleRadius;
      if (px <= minX + 1e-4 || px >= maxX - 1e-4) vx *= -damping;
      if (py <= minY + 1e-4 || py >= maxY - 1e-4) vy *= -damping;
      if (pz <= minZ + 1e-4 || pz >= maxZ - 1e-4) vz *= -damping;

      velocities[i*3+0] = vx;
      velocities[i*3+1] = vy;
      velocities[i*3+2] = vz;

      positions[i*3+0] = px;
      positions[i*3+1] = py;
      positions[i*3+2] = pz;
    }

    if (viscosity > 0.0) {
      // XSPH viscosity for smoother, more fluid-like motion.
      for (let i = 0; i < activeCount; i++) {
        const xi = positions[i*3+0];
        const yi = positions[i*3+1];
        const zi = positions[i*3+2];
        const vix = velocities[i*3+0];
        const viy = velocities[i*3+1];
        const viz = velocities[i*3+2];

        let sumX = 0.0, sumY = 0.0, sumZ = 0.0;
        forNeighbors(i, (j) => {
          const dx = xi - positions[j*3+0];
          const dy = yi - positions[j*3+1];
          const dz = zi - positions[j*3+2];
          const r2 = dx*dx + dy*dy + dz*dz;
          const w = poly6(r2, h);
          sumX += (velocities[j*3+0] - vix) * w;
          sumY += (velocities[j*3+1] - viy) * w;
          sumZ += (velocities[j*3+2] - viz) * w;
        });
        const j = i * 3;
        velocitiesTmp[j+0] = vix + viscosity * sumX;
        velocitiesTmp[j+1] = viy + viscosity * sumY;
        velocitiesTmp[j+2] = viz + viscosity * sumZ;
      }

      for (let i = 0; i < activeCount; i++) {
        const j = i * 3;
        velocities[j+0] = velocitiesTmp[j+0];
        velocities[j+1] = velocitiesTmp[j+1];
        velocities[j+2] = velocitiesTmp[j+2];
      }
    }
  }

  return {
    count,
    get activeCount() { return activeCount; },
    positions,
    hues,
    step,
    spawnBurst(pos, vel, n = 1, spread = particleRadius) {
      const px = pos[0], py = pos[1], pz = pos[2];
      const vx = vel[0] || 0, vy = vel[1] || 0, vz = vel[2] || 0;
      const minX = boundsMin[0] + particleRadius;
      const minY = boundsMin[1] + particleRadius;
      const minZ = boundsMin[2] + particleRadius;
      const maxX = boundsMax[0] - particleRadius;
      const maxY = boundsMax[1] - particleRadius;
      const maxZ = boundsMax[2] - particleRadius;

      for (let k = 0; k < n && activeCount < count; k++) {
        const i = activeCount++;
        const j = i * 3;
        const sx = clamp(px + (Math.random() - 0.5) * spread, minX, maxX);
        const sy = clamp(py + (Math.random() - 0.5) * spread, minY, maxY);
        const sz = clamp(pz + (Math.random() - 0.5) * spread, minZ, maxZ);
        positions[j+0] = sx;
        positions[j+1] = sy;
        positions[j+2] = sz;
        prev[j+0] = sx;
        prev[j+1] = sy;
        prev[j+2] = sz;
        predicted[j+0] = sx;
        predicted[j+1] = sy;
        predicted[j+2] = sz;
        velocities[j+0] = vx;
        velocities[j+1] = vy;
        velocities[j+2] = vz;
        hues[i] = clamp((sy - boundsMin[1]) / (boundsMax[1] - boundsMin[1]), 0, 1);
      }
    },
    clear() {
      activeCount = 0;
    },
    setParams(next = {}) {
      if (Array.isArray(next.gravity) && next.gravity.length === 3) {
        gravity[0] = next.gravity[0];
        gravity[1] = next.gravity[1];
        gravity[2] = next.gravity[2];
      }
      if (typeof next.damping === 'number') damping = clamp(next.damping, 0, 1);
      if (typeof next.restDensity === 'number') restDensity = Math.max(1e-4, next.restDensity);
      if (typeof next.solverIters === 'number') solverIters = Math.max(1, Math.floor(next.solverIters));
      if (typeof next.viscosity === 'number') viscosity = clamp(next.viscosity, 0, 1);
    },
    params: {
      get h() { return h; },
      get restDensity() { return restDensity; },
      get solverIters() { return solverIters; },
      get particleRadius() { return particleRadius; },
      get damping() { return damping; },
      get viscosity() { return viscosity; },
      get gravity() { return gravity.slice(); },
    },
  };
}
