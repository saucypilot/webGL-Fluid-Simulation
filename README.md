# WebGL Fluid (Lite)

A high‑performance, real‑time 2‑D fluid dynamics simulation powered entirely by GPU compute in the browser using **WebGL 2**, implementing core Navier–Stokes steps (advection, diffusion, pressure projection, and vorticity confinement) in fragment shaders to deliver smooth, physically inspired flow at triple‑digit frame rates. Originally derived from Pavel Dobryakov’s WebGL fluid work, this version refactors and streamlines the pipeline into a lightweight, dependency‑free interactive system focused on clarity, performance, and visual impact.

---

## Demo

![1771991591753](https://github.com/user-attachments/assets/ffbc0f57-c646-4985-a005-f9316c76a2c1)

---

## Features

* Fragment‑shader Navier‑Stokes solver (advection, diffusion, pressure projection)
* Real‑time performance (100‑200 FPS on desktop GPUs)
* Adjustable **Quality** (grid resolution scale)
* **Vorticity confinement** knob to keep nice swirls alive
* **Dissipation** slider to control dye fade‑out speed
* Configurable number of **Pressure iterations** for steadier incompressible flow
* Mouse/touch injection of velocity and dye
* Zero external dependencies—pure JavaScript + GLSL

---

## Getting Started

1. **Clone or download** the repository.
2. Copy the attachments provided with this project (`fluidSimulation.gif`, `Screenshot-2026-02-24-215027.png`) into the project root (or `docs/assets/`).
3. Open `index.html` directly in a modern browser **or** serve locally:

   ```bash
   python -m http.server 8080
   ```

   Then navigate to `http://localhost:8080`.

> **Requirements:** Any up‑to‑date browser with WebGL 2 support (Chrome 57+, Firefox 53+, Safari 15+, Edge 79+).

---

## Usage & Controls

| Action                    | Effect                                                             |
| ------------------------- | ------------------------------------------------------------------ |
| **Left‑click / drag**     | Injects velocity **and** dye along the drag vector                 |
| **Right‑click / drag**    | Injects dye only (no momentum)                                     |
| **Quality** slider        | Down‑scales the simulation grid (lower → faster, higher → sharper) |
| **Vorticity** slider      | Strength of vorticity confinement (0 = off)                        |
| **Dissipation** slider    | Rate at which dye diffuses/fades                                   |
| **Pressure iters** slider | Number of Jacobi iterations for pressure solve                     |
| **Clear** button          | Resets velocity & dye fields                                       |
| **Pause** button          | Toggles simulation step                                            |

---

## Project Structure

```
webGL-Fluid-Simulation/
├── index.html        # Entry point + UI
├── script.js         # JS driver (initialises GL, GUI, event handlers)
├── shaders/          # *.glsl files (advection, divergence, pressure, gradient, vorticity)
├── media/
│   ├── fluidSimulation.gif
│   └── Screenshot-2026-02-24-215027.png
├── LICENSE
└── README.md
```

---

## Customisation Tips

* **Default parameters** live at the top of `script.js`; tweak to change startup look.
* Replace the `dyeColor` uniform in the fragment shader for different colour schemes.
* Embed the `<canvas>` into your own framework (React/Vue/etc.) by importing `script.js` and passing a DOM element.
* Want post‑processing? Pipe the framebuffer through a bloom or tone‑mapping pass before presenting.

---

## Roadmap / Ideas

* Add multi‑touch support for mobile devices
* Bloom/tonemap + HDR colour buffer
* Save/load preset parameter sets
* GPU‑based curl noise injection for more chaotic flow

---

## License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

## Acknowledgements

* Original implementation by [Pavel Dobryakov](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)
* GUI inspired by **dat.GUI** aesthetics (no dependency used here)
