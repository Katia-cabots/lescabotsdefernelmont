// © 2026 Hélène Laruelle. Tous droits réservés.
// Ce code ne peut être utilisé, copié ou modifié sans autorisation
// écrite d'Hélène Laruelle — voir LICENSE.txt à la racine du dépôt.
// Contenu du site sous la responsabilité de Katia Renard (LES BEAUX CABOTS SRL).

// ==========================================================================
// Météo — Andenne (5300), via Open-Meteo (gratuit, sans clé)
// ==========================================================================

const LAT = 50.4881;
const LON = 5.0956;

let cachePromise = null;
let cacheAt = 0;

function chargerMeteo() {
  const maintenant = Date.now();
  // On revalide toutes les 55 minutes (les prévisions horaires n'ont pas
  // besoin d'être rafraîchies plus souvent que ça).
  if (!cachePromise || (maintenant - cacheAt) > 55 * 60 * 1000) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=temperature_2m,precipitation_probability,weathercode&current=temperature_2m,weathercode&timezone=Europe%2FBrussels&forecast_days=16`;
    cacheAt = maintenant;
    cachePromise = fetch(url).then(r => r.json()).catch(() => null);
  }
  return cachePromise;
}

export async function meteoActuelle() {
  const data = await chargerMeteo();
  if (!data || !data.current) return null;
  return {
    temperature: Math.round(data.current.temperature_2m),
    description: descriptionCode(data.current.weathercode),
    code: data.current.weathercode
  };
}

// dateISO: "2026-08-10", heureHHMM: "18:00"
export async function meteoPour(dateISO, heureHHMM) {
  const data = await chargerMeteo();
  if (!data || !data.hourly) return null;
  const heure = heureHHMM.slice(0, 2);
  const idx = data.hourly.time.findIndex(t => t.startsWith(dateISO) && t.slice(11, 13) === heure);
  if (idx === -1) return null;
  return {
    temperature: Math.round(data.hourly.temperature_2m[idx]),
    pluie: data.hourly.precipitation_probability[idx],
    code: data.hourly.weathercode[idx],
    description: descriptionCode(data.hourly.weathercode[idx])
  };
}

export function alerteMeteo(m) {
  if (!m) return null;
  if (m.pluie >= 70) return { niveau: 'danger', texte: `Risque de pluie important (${m.pluie}%)` };
  if (typeof m.temperature === 'number' && m.temperature >= 30) return { niveau: 'danger', texte: `Chaleur extrême (${m.temperature}°C)` };
  if (m.pluie >= 40) return { niveau: 'warn', texte: `Pluie possible (${m.pluie}%)` };
  if (typeof m.temperature === 'number' && m.temperature >= 26) return { niveau: 'warn', texte: `Forte chaleur (${m.temperature}°C)` };
  return null;
}

function descriptionCode(code) {
  const map = {
    0: 'Ciel dégagé', 1: 'Peu nuageux', 2: 'Partiellement nuageux', 3: 'Couvert',
    45: 'Brouillard', 48: 'Brouillard givrant',
    51: 'Bruine légère', 53: 'Bruine', 55: 'Bruine forte',
    61: 'Pluie légère', 63: 'Pluie', 65: 'Pluie forte',
    71: 'Neige légère', 73: 'Neige', 75: 'Neige forte',
    80: 'Averses', 81: 'Averses fortes', 82: 'Averses violentes',
    95: 'Orage', 96: 'Orage avec grêle', 99: 'Orage violent'
  };
  return map[code] || 'Météo';
}

export function iconeCode(code) {
  if (code === 0 || code === 1) return '☀️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if ([45, 48].includes(code)) return '🌫️';
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return '🌧️';
  if ([71, 73, 75].includes(code)) return '❄️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  return '🌡️';
}
