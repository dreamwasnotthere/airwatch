import { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

// ─── AQI Helpers ────────────────────────────────────────────────────────────

const AQI_LEVELS = [
  { label: "Good",                          max: 50,       color: "#22c55e" },
  { label: "Moderate",                      max: 100,      color: "#eab308" },
  { label: "Unhealthy for Sensitive Groups",max: 150,      color: "#f97316" },
  { label: "Unhealthy",                     max: 200,      color: "#ef4444" },
  { label: "Very Unhealthy",                max: 300,      color: "#a855f7" },
  { label: "Hazardous",                     max: Infinity, color: "#be123c" },
];

function getAqiColor(aqi) {
  return (AQI_LEVELS.find((l) => aqi <= l.max) ?? AQI_LEVELS.at(-1)).color;
}
function getAqiLevel(aqi) {
  return (AQI_LEVELS.find((l) => aqi <= l.max) ?? AQI_LEVELS.at(-1)).label;
}

// ─── Seed cities (replaces cities.py — same world cities, no Python needed) ──
const SEED_CITIES = [
  { city: "Tokyo",            lat: 35.68,  lon: 139.69 },
  { city: "Delhi",            lat: 28.66,  lon: 77.22  },
  { city: "Shanghai",         lat: 31.22,  lon: 121.46 },
  { city: "Mumbai",           lat: 19.07,  lon: 72.87  },
  { city: "Beijing",          lat: 39.90,  lon: 116.40 },
  { city: "Lagos",            lat: 6.45,   lon: 3.39   },
  { city: "Istanbul",         lat: 41.01,  lon: 28.97  },
  { city: "Dhaka",            lat: 23.72,  lon: 90.40  },
  { city: "London",           lat: 51.50,  lon: -0.12  },
  { city: "New York",         lat: 40.71,  lon: -74.00 },
  { city: "Paris",            lat: 48.85,  lon: 2.35   },
  { city: "Berlin",           lat: 52.52,  lon: 13.40  },
  { city: "Sydney",           lat: -33.86, lon: 151.20 },
  { city: "São Paulo",        lat: -23.54, lon: -46.63 },
  { city: "Mexico City",      lat: 19.43,  lon: -99.13 },
  { city: "Cairo",            lat: 30.06,  lon: 31.24  },
  { city: "Jakarta",          lat: -6.21,  lon: 106.85 },
  { city: "Seoul",            lat: 37.56,  lon: 126.97 },
  { city: "Los Angeles",      lat: 34.05,  lon: -118.24 },
  { city: "Karachi",          lat: 24.86,  lon: 67.01  },
  { city: "Lahore",           lat: 31.55,  lon: 74.35  },
  { city: "Tehran",           lat: 35.69,  lon: 51.42  },
  { city: "Bangkok",          lat: 13.75,  lon: 100.52 },
  { city: "Nairobi",          lat: -1.29,  lon: 36.82  },
  { city: "Chicago",          lat: 41.88,  lon: -87.63 },
  { city: "Bogotá",           lat: 4.71,   lon: -74.07 },
  { city: "Kinshasa",         lat: -4.32,  lon: 15.32  },
  { city: "Chengdu",          lat: 30.57,  lon: 104.07 },
  { city: "Ho Chi Minh City", lat: 10.82,  lon: 106.63 },
  { city: "Kolkata",          lat: 22.57,  lon: 88.36  },
];

// ─── NASA POWER gas fetch — same logic as data_fetch.py:fetch_nasa_gases ─────
const MH = 1000;

async function fetchNasaGases(lat, lon) {
  const yesterday = new Date(Date.now() - 86400000);
  const yStr = yesterday.toISOString().slice(0, 10).replace(/-/g, "");
  try {
    const res = await fetch(
      `https://power.larc.nasa.gov/api/temporal/daily/point` +
      `?parameters=TO3,NO2,CO,SO2&community=AG` +
      `&longitude=${lon}&latitude=${lat}` +
      `&start=${yStr}&end=${yStr}&format=JSON&header=false`
    );
    if (!res.ok) return null;
    const j = await res.json();
    const props = j?.properties?.parameter || {};
    const val = (key) => {
      const d = props[key] || {};
      const v = Object.values(d)[0];
      return v == null || v <= -990 ? null : v;
    };
    const raw_no2 = val("NO2"); // mol/m²
    const raw_so2 = val("SO2"); // mol/m²
    const raw_co  = val("CO");  // kg/kg
    const raw_o3  = val("TO3"); // Dobson Units
    return {
      no2: raw_no2 != null ? +(raw_no2 * 46.0055 * 1e6 / MH).toFixed(2)    : null,
      so2: raw_so2 != null ? +(raw_so2 * 64.066  * 1e6 / MH).toFixed(2)    : null,
      co:  raw_co  != null ? +(raw_co  * (28.97 / 28.01) * 1e6).toFixed(4) : null,
      o3:  raw_o3  != null ? +(raw_o3  * 2.1415).toFixed(2)                : null,
    };
  } catch {
    return null;
  }
}

// ─── AQI + PM2.5 — Open-Meteo (replaces OpenWeatherMap, free, no key) ────────
async function fetchAqi(lat, lon) {
  const res = await fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5`
  );
  const j = await res.json();
  return {
    aqi:  Math.round(j.current?.us_aqi ?? 0),
    pm25: +(j.current?.pm2_5 ?? 0).toFixed(1),
  };
}

// ─── Source attribution — identical to data_fetch.py:infer_sources ───────────
function inferSources(gases, pm25) {
  const no2 = gases?.no2 || 0;
  const so2 = gases?.so2 || 0;
  const co  = gases?.co  || 0;
  const o3  = gases?.o3  || 0;
  const raw = {
    "Traffic":    Math.min(no2  / 40.0,  1.0) * 100,
    "Industrial": Math.min(so2  / 20.0,  1.0) * 100,
    "Combustion": Math.min(co   / 4.0,   1.0) * 100,
    "Smog/O₃":   Math.min(o3   / 100.0, 1.0) * 100,
    "Dust/Other": Math.min(pm25 / 75.0,  1.0) * 100,
  };
  const colorMap = {
    "Traffic":    "#38bdf8",
    "Industrial": "#f97316",
    "Combustion": "#ef4444",
    "Smog/O₃":   "#a855f7",
    "Dust/Other": "#eab308",
  };
  const total = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(raw)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ source: k, pct: Math.round(v / total * 100), color: colorMap[k] }))
    .sort((a, b) => b.pct - a.pct);
}

// ─── Fetch one city (replaces _fetch_one in data_fetch.py) ──────────────────
async function fetchOneCity(c) {
  try {
    const [{ aqi, pm25 }, gases] = await Promise.all([
      fetchAqi(c.lat, c.lon),
      fetchNasaGases(c.lat, c.lon),
    ]);
    return {
      city: c.city, lat: c.lat, lon: c.lon,
      pm25, aqi, level: getAqiLevel(aqi),
      no2: gases?.no2 ?? null,
      so2: gases?.so2 ?? null,
      co:  gases?.co  ?? null,
      o3:  gases?.o3  ?? null,
      sources: inferSources(gases, pm25),
    };
  } catch {
    return null;
  }
}

// ─── Replaces Flask /api/pollution entirely ───────────────────────────────────
async function loadPollutionData() {
  const results = await Promise.all(SEED_CITIES.map(fetchOneCity));
  return results.filter(Boolean);
}

// ─── City search (unchanged from original App.jsx) ───────────────────────────
async function searchAndFetchCity(name) {
  const geoRes  = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`
  );
  const geoJson = await geoRes.json();
  const r       = geoJson.results?.[0];
  if (!r) throw new Error(`City "${name}" not found`);
  const { name: city, latitude: lat, longitude: lon } = r;
  const [{ aqi, pm25 }, gases] = await Promise.all([
    fetchAqi(lat, lon),
    fetchNasaGases(lat, lon),
  ]);
  return {
    city, lat, lon, aqi, pm25, level: getAqiLevel(aqi),
    no2: gases?.no2 ?? null, so2: gases?.so2 ?? null,
    co:  gases?.co  ?? null, o3:  gases?.o3  ?? null,
    sources: inferSources(gases, pm25),
  };
}

// ─── Map Markers (unchanged) ──────────────────────────────────────────────────
function AqiMarkers({ data, selected, onSelect }) {
  const map = useMap();
  const markersRef = useRef([]);
  useEffect(() => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    data.forEach((city) => {
      const color = getAqiColor(city.aqi);
      const size  = city === selected ? 42 : 34;
      const icon = L.divIcon({
        className: "",
        html: `<div class="aqi-marker" style="
          width:${size}px;height:${size}px;background:${color};
          font-size:${city === selected ? 11 : 10}px;
          outline:${city === selected ? "3px solid white" : "none"};
        ">${city.aqi}</div>`,
        iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker([city.lat, city.lon], { icon })
        .addTo(map).on("click", () => onSelect(city));
      markersRef.current.push(marker);
    });
  }, [data, selected, map, onSelect]);
  return null;
}

// ─── FlyTo (unchanged) ────────────────────────────────────────────────────────
function FlyTo({ city }) {
  const map = useMap();
  useEffect(() => {
    if (city) map.flyTo([city.lat, city.lon], 7, { duration: 1.2 });
  }, [city, map]);
  return null;
}

// ─── TopCitiesChart (unchanged) ───────────────────────────────────────────────
function TopCitiesChart({ data }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const top = [...data].sort((a, b) => b.aqi - a.aqi).slice(0, 8);
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "bar",
      data: {
        labels: top.map((c) => c.city),
        datasets: [{ data: top.map((c) => c.aqi), backgroundColor: top.map((c) => getAqiColor(c.aqi)), borderRadius: 4, borderSkipped: false }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` AQI ${ctx.raw}  —  ${getAqiLevel(ctx.raw)}` }, backgroundColor: "#111827", borderColor: "#1f2d45", borderWidth: 1, titleColor: "#e8edf5", bodyColor: "#7a8faa" },
        },
        scales: {
          x: { ticks: { color: "#7a8faa", font: { family: "'DM Sans'", size: 10 }, maxRotation: 30 }, grid: { display: false }, border: { color: "#1f2d45" } },
          y: { ticks: { color: "#7a8faa", font: { family: "'Space Mono'", size: 9 }, maxTicksLimit: 5 }, grid: { color: "#1a2336" }, border: { color: "#1f2d45" } },
        },
      },
    });
    return () => chartRef.current?.destroy();
  }, [data]);
  return <div className="chart-wrap"><canvas ref={canvasRef} /></div>;
}

// ─── DetailPanel (unchanged) ──────────────────────────────────────────────────
function DetailPanel({ city }) {
  if (!city) {
    return (
      <div className="panel-section">
        <p className="panel-title">City Detail</p>
        <p className="empty-state">Select a city on the map or sidebar</p>
      </div>
    );
  }
  const color   = getAqiColor(city.aqi);
  const sources = city.sources ?? [];
  const hasSat  = city.no2 != null || city.so2 != null || city.co != null || city.o3 != null;
  return (
    <div className="panel-section" style={{ overflowY: "auto" }}>
      <p className="panel-title">City Detail</p>
      <div className="detail-grid">
        <div className="detail-item">
          <label>City</label>
          <div className="val" style={{ fontSize: 16 }}>{city.city}</div>
          <span className="level-pill" style={{ background: color }}>{city.level}</span>
        </div>
        <div className="detail-item">
          <label>AQI</label>
          <div className="val big" style={{ color }}>{city.aqi}</div>
        </div>
        <div className="detail-item">
          <label>PM2.5</label>
          <div className="val">{city.pm25.toFixed(1)}</div>
          <div style={{ fontSize: 10, color: "#7a8faa" }}>µg/m³</div>
        </div>
        <div className="detail-item">
          <label>Coordinates</label>
          <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#7a8faa", marginTop: 4 }}>
            {city.lat.toFixed(4)}°<br />{city.lon.toFixed(4)}°
          </div>
        </div>
      </div>
      {hasSat && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { key: "no2", label: "NO₂", unit: "µg/m³", tip: "Traffic/Industry" },
            { key: "so2", label: "SO₂", unit: "µg/m³", tip: "Power plants" },
            { key: "co",  label: "CO",  unit: "ppm",    tip: "Combustion" },
            { key: "o3",  label: "O₃",  unit: "µg/m³", tip: "Smog" },
          ].map(({ key, label, unit, tip }) =>
            city[key] != null ? (
              <div key={key} title={tip} style={{ background: "#0b0f1a", border: "1px solid #1f2d45", borderRadius: 6, padding: "4px 8px", textAlign: "center", minWidth: 52 }}>
                <div style={{ fontSize: 9, color: "#7a8faa", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
                <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 700, color: "#e8edf5" }}>{city[key]}</div>
                <div style={{ fontSize: 8, color: "#7a8faa" }}>{unit}</div>
              </div>
            ) : null
          )}
          <div style={{ alignSelf: "center", fontSize: 9, color: "#7a8faa", marginLeft: 2 }}>🛰 Satellite</div>
        </div>
      )}
      {sources.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, color: "#7a8faa", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Estimated Sources</div>
          <div style={{ display: "flex", height: 6, borderRadius: 4, overflow: "hidden", gap: 1 }}>
            {sources.map((s) => (
              <div key={s.source} style={{ width: `${s.pct}%`, background: s.color }} title={`${s.source}: ${s.pct}%`} />
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 5 }}>
            {sources.map((s) => (
              <div key={s.source} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#7a8faa" }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                {s.source} {s.pct}%
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LegendPanel (unchanged) ──────────────────────────────────────────────────
function LegendPanel() {
  return (
    <div className="panel-section">
      <p className="panel-title">AQI Scale</p>
      <div className="legend">
        {AQI_LEVELS.map((l) => (
          <div className="legend-row" key={l.label}>
            <div className="legend-swatch" style={{ background: l.color }} />
            <span>{l.label}</span>
            <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10 }}>
              {l.max === Infinity ? "301+" : `≤${l.max}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── App (unchanged) ──────────────────────────────────────────────────────────
export default function App() {
  const [data,        setData]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [selected,    setSelected]    = useState(null);
  const [query,       setQuery]       = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searching,   setSearching]   = useState(false);
  const [searchError, setSearchError] = useState(null);

  useEffect(() => {
    loadPollutionData()
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message ?? "Failed to load data"); setLoading(false); });
  }, []);

  const handleSelect = useCallback((city) => setSelected(city), []);

  async function handleCitySearch(e) {
    e.preventDefault();
    const name = searchInput.trim();
    if (!name) return;
    setSearching(true); setSearchError(null);
    try {
      const city = await searchAndFetchCity(name);
      setData((prev) => {
        const exists = prev.find((c) => c.city.toLowerCase() === city.city.toLowerCase());
        return exists ? prev : [...prev, city];
      });
      setSelected(city); setSearchInput("");
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearching(false);
    }
  }

  const filtered = data.filter((c) => c.city.toLowerCase().includes(query.toLowerCase()));
  const now = new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner" />
      <span>Fetching air quality data…</span>
    </div>
  );

  if (error) return (
    <div className="error-screen">
      <span style={{ fontSize: 24 }}>⚠</span>
      <strong>Could not load data</strong>
      <span style={{ color: "#7a8faa" }}>{error}</span>
    </div>
  );

  return (
    <div className="app">
      <header className="header">
        <div className="header-logo">AIR<span>WATCH</span></div>
        <div className="header-meta">{now} · {data.length} cities</div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-search" style={{ borderBottom: "1px solid var(--border)" }}>
          <p style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
            Add any city
          </p>
          <form onSubmit={handleCitySearch} style={{ display: "flex", gap: 6 }}>
            <input className="search-input" placeholder="e.g. Reykjavik, Timbuktu…" value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)} disabled={searching} style={{ flex: 1 }} />
            <button type="submit" disabled={searching || !searchInput.trim()} style={{
              background: "var(--accent-dim)", border: "1px solid var(--accent)", color: "var(--accent)",
              borderRadius: "var(--radius)", padding: "6px 12px", fontSize: 12, cursor: "pointer",
              fontFamily: "var(--font-mono)", flexShrink: 0, opacity: searching || !searchInput.trim() ? 0.5 : 1,
            }}>
              {searching ? "…" : "Go"}
            </button>
          </form>
          {searchError && <p style={{ fontSize: 11, color: "#ef4444", marginTop: 6 }}>⚠ {searchError}</p>}
        </div>

        <div className="sidebar-search">
          <input className="search-input" placeholder="Filter loaded cities…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="sidebar-list">
          {filtered.slice().sort((a, b) => b.aqi - a.aqi).map((city) => (
            <div key={city.city} className={`city-row${selected?.city === city.city ? " active" : ""}`} onClick={() => handleSelect(city)}>
              <div className="city-dot" style={{ background: getAqiColor(city.aqi) }} />
              <span className="city-name">{city.city}</span>
              <span className="city-aqi-badge" style={{ color: getAqiColor(city.aqi) }}>{city.aqi}</span>
            </div>
          ))}
        </div>
      </aside>

      <main className="main">
        <div className="map-container">
          <MapContainer center={[20, 10]} zoom={2} zoomControl={true} style={{ width: "100%", height: "100%" }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="" />
            <AqiMarkers data={filtered} selected={selected} onSelect={handleSelect} />
            <FlyTo city={selected} />
          </MapContainer>
        </div>
        <div className="bottom-panel">
          <DetailPanel city={selected} />
          <div className="panel-section">
            <p className="panel-title">Top Cities by AQI</p>
            <TopCitiesChart data={data} />
          </div>
          <LegendPanel />
        </div>
      </main>
    </div>
  );
}
