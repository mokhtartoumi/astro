const $ = (id) => document.getElementById(id);
const canvas = $("signalChart");
const ctx = canvas.getContext("2d");

const controls = {
  speed: $("speedControl"),
  intensity: $("intensityControl"),
  noise: $("noiseControl"),
  frequency: $("frequencyControl"),
  autoRepeat: $("autoRepeat")
};

const state = {
  running: false, paused: false, startTime: 0, elapsed: 0, raf: null,
  eventCount: 0, detected: false, data: [], lastFrame: 0,
  injected: false, cycle: 0, cycleDuration: 7000, previewEvent: false, progress: 0
};

const stages = [
  { title: "Étape 1 — Signal stable", text: "Le récepteur observe un signal de fond presque constant. De petites fluctuations peuvent exister à cause du bruit, mais aucun événement n'est encore détecté.", caption: "Signal de fond stable : aucune perturbation." },
  { title: "Étape 2 — Entrée du météore", text: "Le météore entre dans l'atmosphère et laisse une traînée ionisée. Dans ce modèle pédagogique, l'intensité réglée détermine l'ampleur de la perturbation qui apparaîtra sur la courbe.", caption: "Le météore entre dans l'atmosphère." },
  { title: "Étape 3 — Perturbation du signal", text: "Quand la traînée atteint la zone de propagation, le modèle ajoute une variation temporaire au signal reçu. La courbe reste stable avant l'événement puis change au moment où le météore passe.", caption: "La traînée ionisée perturbe le signal reçu." },
  { title: "Étape 4 — Détection et analyse", text: "Le logiciel compare la variation au seuil de détection choisi dans le modèle, puis affiche l'heure, la durée et l'amplitude relative estimées. Les valeurs restent synthétiques.", caption: "Le logiciel caractérise la variation simulée." }
];

function currentSettings() {
  return {
    speed: Number(controls.speed.value),
    intensity: Number(controls.intensity.value) / 100,
    noise: Number(controls.noise.value) / 100,
    frequency: Number(controls.frequency.value)
  };
}

function updateControlLabels() {
  const s = currentSettings();
  $("speedLabel").textContent = `${s.speed.toFixed(1)}×`;
  $("intensityLabel").textContent = `${Math.round(s.intensity * 100)} %`;
  $("noiseLabel").textContent = s.noise < .08 ? "Faible" : s.noise < .19 ? "Modéré" : "Élevé";
  $("frequencyLabel").textContent = `${s.frequency} kHz`;
  $("freqValue").textContent = `${s.frequency}.0`;
}
Object.values(controls).forEach((control) => {
  if (control && control.type !== "checkbox") control.addEventListener("input", () => {
    updateControlLabels();
    if (!state.running) state.previewEvent = true;
    updateLiveChart();
  });
});

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawChart();
}
window.addEventListener("resize", resizeCanvas);

// Synthetic signal model: stable baseline + configurable noise + a localized meteor event.
// The curve is revealed progressively; the disturbance only appears when the meteor reaches it.
function sampleSignal(t, settings = currentSettings()) {
  // Smooth, continuous synthetic waveform. All controls feed this same model.
  const f = settings.frequency / 24;
  const baseline = 0.018 * Math.sin(t * 0.105 * f) + 0.010 * Math.sin(t * 0.245 * f);
  const n = settings.noise;
  const noise = n * (0.14 * Math.sin(t * 0.83) + 0.09 * Math.sin(t * 1.37) + 0.045 * Math.sin(t * 2.13));
  const center = Number.isFinite(state.eventCenter) ? state.eventCenter : 170;
  // Higher intensity creates a wider, stronger disturbance; speed moves the event in time.
  const width = 9 + settings.intensity * 15;
  const x = (t - center) / width;
  // Smooth envelope plus a decaying multi-cycle oscillation (never a single-point spike).
  const envelope = Math.exp(-0.5 * x * x);
  const oscillation = 0.68 * Math.sin((t - center) * (0.18 + f * 0.16)) +
                      0.32 * Math.sin((t - center) * (0.36 + f * 0.22));
  const showEvent = state.eventVisible || state.previewEvent;
  const pulse = showEvent ? settings.intensity * 0.72 * envelope * oscillation : 0;
  return { t, value: baseline + noise + pulse, disturbed: showEvent && envelope > 0.08 };
}

function drawChart() {
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 600, h = rect.height || 300;
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 43, r: 15, t: 22, b: 34 };
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  ctx.font = "11px system-ui";
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch * i / 4;
    ctx.strokeStyle = "#20364d"; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w-pad.r, y); ctx.stroke();
    ctx.fillStyle = "#7892ad"; ctx.fillText((1 - i*.5).toFixed(1), 10, y+4);
  }
  for (let i = 0; i <= 6; i++) {
    const x = pad.l + cw*i/6;
    ctx.strokeStyle = "#172b40"; ctx.beginPath(); ctx.moveTo(x,pad.t); ctx.lineTo(x,h-pad.b); ctx.stroke();
    ctx.fillStyle = "#7892ad"; ctx.fillText(String(i*50), x-9, h-11);
  }
  ctx.fillStyle = "#9bb1c8"; ctx.fillText("Amplitude relative (a.u.)", pad.l, 13);
  ctx.fillText("Temps (ms)", w-76, h-10);

  const visibleTime = state.running || state.elapsed > 0 ? Math.min(300, state.elapsed / ((state.cycleDuration / currentSettings().speed) / 300)) : 300;
  const settings = currentSettings();
  const points = [];
  const step = 1.5;
  for (let t = 0; t <= visibleTime; t += step) points.push(sampleSignal(t, settings));
  const xOf = (t) => pad.l + t/300*cw;
  const yOf = (v) => pad.t + ch * (0.5 - Math.max(-1, Math.min(1, v)) * .43);

  if ((state.eventVisible || state.previewEvent) && visibleTime > (state.eventCenter ?? 170) - 20) {
    const start = Math.max(0, (state.eventCenter ?? 170) - 20);
    const end = Math.min(300, (state.eventCenter ?? 170) + 20);
    ctx.fillStyle = "#ffb65d18"; ctx.fillRect(xOf(start), pad.t, xOf(end)-xOf(start), ch);
    ctx.setLineDash([4,4]); ctx.strokeStyle = "#ffb65d99";
    ctx.beginPath(); ctx.moveTo(xOf(state.eventCenter ?? 170),pad.t); ctx.lineTo(xOf(state.eventCenter ?? 170),h-pad.b); ctx.stroke(); ctx.setLineDash([]);
  }
  if (points.length) {
    ctx.beginPath();
    points.forEach((p,i) => { const x=xOf(p.t), y=yOf(p.value); if (!i) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
    ctx.strokeStyle = "#58d9ff"; ctx.lineWidth = 2; ctx.shadowColor = "#58d9ff66"; ctx.shadowBlur = 7; ctx.stroke(); ctx.shadowBlur = 0;
  }
  // A small moving cursor shows the current acquisition time.
  if (state.running && visibleTime > 0) {
    ctx.strokeStyle = "#d5f7ff88"; ctx.setLineDash([3,4]);
    ctx.beginPath(); ctx.moveTo(xOf(visibleTime), pad.t); ctx.lineTo(xOf(visibleTime), h-pad.b); ctx.stroke(); ctx.setLineDash([]);
  }
}

function setStage(index) {
  document.querySelectorAll(".step").forEach((el, i) => {
    el.classList.toggle("active", i === index);
    el.classList.toggle("done", i < index);
  });
  $("explanationTitle").textContent = stages[index].title;
  $("explanationText").textContent = stages[index].text;
  $("sceneCaption").textContent = stages[index].caption;
  $("progressBar").style.width = `${(index + 1) * 25}%`;
}

function setStatus(text, badge = text.toUpperCase()) {
  $("systemStatus").textContent = text.toUpperCase();
  $("sceneBadge").textContent = badge;
}

function updateLiveChart() {
  drawChart();
  const t = Math.min(300, state.elapsed / (state.cycleDuration / 300));
  $("chartTime").textContent = `Temps : ${Math.round(t)} ms`;
  const value = sampleSignal(state.running ? t : 170, currentSettings()).value;
  $("amplitudeValue").textContent = (1 + Math.abs(value)).toFixed(2);
  $("chartOverlay").textContent = (state.eventVisible || state.previewEvent) ? "PERTURBATION SIMULÉE" : "SIGNAL DE FOND";
  $("chartOverlay").style.color = (state.eventVisible || state.previewEvent) ? "#ffb65d" : "#7894b2";
}

function runFrame(now) {
  if (!state.running || state.paused) return;
  if (!state.startTime) state.startTime = now - state.elapsed;
  state.elapsed = now - state.startTime;
  const s = currentSettings();
  const cycleDuration = state.cycleDuration / s.speed;
  const progress = Math.min(1, state.elapsed / cycleDuration);
  const t = progress * 300;
  state.progress = progress;
  // Event location is fixed for this pass and depends on speed: faster meteor = earlier impact.
  if (!Number.isFinite(state.eventCenter) || state.eventCenter === 170) {
    state.eventCenter = Math.max(105, Math.min(205, 170 - (s.speed - 1) * 32));
  }
  state.previewEvent = false;
  const width = 9 + s.intensity * 15;
  const eventStart = state.eventCenter - width * 2.4;
  const eventEnd = state.eventCenter + width * 2.8;
  $("chartTime").textContent = `Temps : ${Math.round(t)} ms`;

  // The meteor and chart share a time axis. Once the trail reaches the layer,
  // the event stays in the recorded trace and naturally grows then decays after detection.
  if (t < state.eventCenter - width * 2.4) {
    setStage(progress < .34 ? 0 : 1);
    setStatus(progress < .34 ? "Signal stable" : "Météore en approche", progress < .34 ? "SIGNAL STABLE" : "MÉTÉORE");
    $("signalState").textContent = progress < .34 ? "Stable" : "Météore en approche";
    $("signalHint").textContent = progress < .34 ? "Aucune perturbation" : "Météore en mouvement";
    if (progress >= .34) $("meteor").classList.add("fly");
    $("trailLabel").classList.remove("show");
    state.eventVisible = false;
  } else if (t < state.eventCenter) {
    setStage(2); setStatus("Perturbation en cours", "COUCHE TRAVERSÉE");
    $("signalState").textContent = "Perturbé"; $("signalHint").textContent = "Variation en augmentation";
    state.eventVisible = true;
    $("trailLabel").classList.add("show");
  } else {
    setStage(3); setStatus("Événement détecté", "DÉTECTION");
    $("signalState").textContent = "Détecté — décroissance du signal";
    $("signalHint").textContent = t < eventEnd ? "La variation décroît progressivement" : "Retour progressif au signal de fond";
    state.eventVisible = true;
    $("trailLabel").classList.add("show");
    if (!state.detected) registerEvent();
  }
  const signalAtNow = sampleSignal(t, s).value;
  $("amplitudeValue").textContent = (1 + Math.abs(signalAtNow)).toFixed(2);
  $("chartOverlay").textContent = state.eventVisible ? "PERTURBATION SIMULÉE" : "SIGNAL DE FOND";
  $("chartOverlay").style.color = state.eventVisible ? "#ffb65d" : "#7894b2";
  drawChart();

  if (state.elapsed >= cycleDuration) {
    if (controls.autoRepeat.checked) {
      state.startTime = now; state.elapsed = 0; state.detected = false; state.eventVisible = false;
      state.cycle += 1; $("meteor").classList.remove("fly"); $("trailLabel").classList.remove("show");
    } else {
      state.running = false; state.paused = false;
      $("startBtn").disabled = false; $("pauseBtn").disabled = true;
      $("startBtn").innerHTML = "<span>↻</span> Relancer la simulation";
      setStatus("Simulation terminée", "TERMINÉE");
      return;
    }
  }
  state.raf = requestAnimationFrame(runFrame);
}

function registerEvent() {
  state.detected = true;
  state.eventCount += 1;
  $("eventCount").textContent = state.eventCount;
  const intensity = currentSettings().intensity;
  const peak = (1 + intensity * .46).toFixed(2);
  $("detectionText").textContent = "Confirmée";
  $("durationText").textContent = `≈ ${Math.round(25 + (1-intensity)*45)} ms`;
  $("peakText").textContent = `${peak} a.u.`;
  const item = document.createElement("div");
  item.className = "history-item";
  const time = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  item.innerHTML = `<div><strong>Événement simulé #${state.eventCount}</strong><small>${time} · perturbation transitoire</small></div><div class="history-value">+${Math.round(intensity*100)} %</div>`;
  const list = $("historyList");
  if (list.querySelector(".empty-history")) list.innerHTML = "";
  list.prepend(item);
}

function startSimulation() {
  if (state.running && state.paused) {
    state.paused = false; state.startTime = performance.now() - state.elapsed;
    $("pauseBtn").textContent = "Ⅱ Pause"; $("startBtn").disabled = true;
    state.raf = requestAnimationFrame(runFrame); return;
  }
  cancelAnimationFrame(state.raf);
  state.running = true; state.paused = false; state.startTime = 0; state.elapsed = 0;
  state.detected = false; state.eventVisible = false; state.previewEvent = false; state.eventCenter = null; state.data = [];
  $("meteor").classList.remove("fly"); void $("meteor").offsetWidth;
  $("trailLabel").classList.remove("show");
  $("startBtn").disabled = true; $("pauseBtn").disabled = false;
  $("startBtn").innerHTML = "<span>●</span> Simulation en cours";
  $("detectionText").textContent = "En attente"; $("durationText").textContent = "—"; $("peakText").textContent = "—";
  $("amplitudeValue").textContent = "1.00";
  state.cycleDuration = 7000;
  state.raf = requestAnimationFrame(runFrame);
}

function pauseSimulation() {
  if (!state.running) return;
  state.paused = !state.paused;
  if (state.paused) {
    cancelAnimationFrame(state.raf); $("pauseBtn").textContent = "▶ Reprendre"; setStatus("En pause", "PAUSE");
  } else {
    state.startTime = performance.now() - state.elapsed; $("pauseBtn").textContent = "Ⅱ Pause";
    state.raf = requestAnimationFrame(runFrame);
  }
}

function resetSimulation() {
  cancelAnimationFrame(state.raf);
  state.running = false; state.paused = false; state.startTime = 0; state.elapsed = 0;
  state.detected = false; state.eventVisible = false; state.previewEvent = false; state.data = [];
  $("meteor").classList.remove("fly"); $("trailLabel").classList.remove("show");
  $("startBtn").disabled = false; $("pauseBtn").disabled = true; $("pauseBtn").textContent = "Ⅱ Pause";
  $("startBtn").innerHTML = "<span>▶</span> Démarrer la simulation";
  $("signalState").textContent = "Stable"; $("signalHint").textContent = "En attente d'une simulation";
  $("amplitudeValue").textContent = "1.00"; $("chartTime").textContent = "Temps : 0 ms";
  $("chartOverlay").textContent = "En attente de données…"; $("chartOverlay").style.color = "#7894b2";
  $("detectionText").textContent = "Aucune"; $("durationText").textContent = "—"; $("peakText").textContent = "—";
  setStatus("Système prêt", "EN ATTENTE"); setStage(0); drawChart();
}

function injectTestEvent() {
  // A manual event starts the simulation and shifts the meteor disturbance earlier.
  startSimulation();
  state.eventCenter = 95;
  state.previewEvent = true;
  $("sceneCaption").textContent = "Événement test déclenché manuellement.";
  $("chartOverlay").textContent = "ÉVÉNEMENT TEST";
}

$("startBtn").addEventListener("click", startSimulation);
$("pauseBtn").addEventListener("click", pauseSimulation);
$("resetBtn").addEventListener("click", resetSimulation);
$("injectBtn").addEventListener("click", injectTestEvent);
$("clearHistoryBtn").addEventListener("click", () => {
  $("historyList").innerHTML = '<div class="empty-history">Aucun événement pour le moment.</div>';
});
$("freqValue").textContent = "24.0";
const stars = $("stars");
for (let i = 0; i < 28; i++) {
  const dot = document.createElement("span");
  dot.style.cssText = `position:absolute;left:${(i*37+11)%97}%;top:${(i*29+7)%62}%;width:${i%5===0?2:1}px;height:${i%5===0?2:1}px;background:#e2f6ff;border-radius:50%;opacity:${.25+(i%6)/10}`;
  stars.appendChild(dot);
}
updateControlLabels();
resizeCanvas();
setStage(0);
