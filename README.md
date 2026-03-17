# AirWatch — Global Air Quality Dashboard

A real-time global air quality monitoring dashboard built with React + Vite.

## Features
- Live AQI and PM2.5 data for 30+ world cities
- NASA POWER satellite data: NO₂, SO₂, CO, O₃ readings
- Pollution source attribution (Traffic, Industrial, Combustion, Smog, Dust)
- Interactive Leaflet map with AQI markers
- Search any city in the world on demand
- Top Cities by AQI bar chart
- Fully client-side — no backend, no API keys required

## Architecture

```
Browser
  ├── Open-Meteo Air Quality API  → AQI + PM2.5 (free, no key)
  ├── NASA POWER API              → NO₂, SO₂, CO, O₃ (free, no key)
  └── Open-Meteo Geocoding API    → City search (free, no key)
```

All data is fetched directly from public APIs in the browser.  
No server, no environment variables, no setup beyond `npm install`.

## Tech Stack
- React 19 + Vite
- React-Leaflet (interactive map)
- Chart.js (bar chart)
- Open-Meteo API (AQI/PM2.5)
- NASA POWER API (satellite gas readings)

## Setup & Run

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Deploy to Vercel / Netlify

```bash
npm run build
# drag-drop the dist/ folder to netlify.com, or:
npx vercel
```

No environment variables needed. Works out of the box.

## Theme
**Smart City & Sustainability** — Real-time environmental monitoring using satellite data to track urban air quality globally.
