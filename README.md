# Mars Interloper

A browser-based 3D exploration game set on Mars, where players wake up in a habitat and venture out to explore the Martian surface.

**[Play Live Demo](https://mars.paulius.trade/)**

## Overview

Mars Interloper is a browser-based game that leverages modern web technologies to deliver an immersive Mars exploration experience. The game features:

- First-person exploration of a Mars habitat and the Martian surface
- Interactive technical components and objects
- A subtle storyline that players can discover at their own pace
- 3D graphics rendered using Three.js
- Go-powered backend

## Development Setup

### Prerequisites

- Go 1.18+
- Node.js and npm (for frontend development)
- Modern web browser (Chrome, Firefox, Edge)

### Getting Started

1. Clone the repository:
   ```
   git lfs install
   git clone https://github.com/ProgramComputer/marsinterloper.git
   cd marsinterloper
   ```

2. Install backend dependencies:
   ```
   go mod tidy
   ```

3. Install frontend dependencies:
   ```
   cd web
   npm install
   cd ..
   ```

4. Start the development server:
   ```
   go run cmd/server/main.go
   ```

5. Open your browser and navigate to `http://localhost:8080`

## Project Structure

- `cmd/server/`: Go backend entry point
- `web/js/`: Three.js implementation and game frontend
- `assets/`: Game assets (models, textures, audio)

## Features (Prototype)

- 3D environment with a Mars habitat (2-3 rooms)
- Explorable Martian surface with 2-3 points of interest
- First-person movement (WASD + mouse)
- Interactive objects and technical components
- Discoverable story elements

## License

This project is licensed under the BSD License - see the LICENSE file for details. 

## Acknowledgements
AllThingsSpace@SketchFab
https://creativecommons.org/licenses/by/4.0/

Mars Viking Color Mosaic (Mars_Viking_ClrMosaic_global_925m) data courtesy of USGS Astrogeology Science Center and the Viking mission team at NASA.

Smith, D.E., M.T. Zuber, G.A. Neumann, E.A. Guinness, and S. Slavney, Mars Global Surveyor Laser Altimeter Mission Experiment Gridded Data Record, MGS-M-MOLA-5-MEGDR-L3-V1.0, NASA Planetary Data System, 2003.

This project makes use of data from the European Space Agency (ESA) mission Hipparcos (1989-1993), as provided in ESA, 1997, The Hipparcos and Tycho Catalogues, ESA SP-1200.
