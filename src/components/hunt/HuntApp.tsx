import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CircleHelp, Clapperboard, Eye, Gem, Home, Leaf, Lock, Pause, Play, Shield, Volume2, VolumeX, Warehouse, Zap } from "lucide-react";
import { AudioBus } from "@/game/audio";
import { Input } from "@/game/input";
import { UPGRADE_COST, UPGRADE_MAX, UPGRADE_META, defaultSave, loadSave, writeSave, type DecorKind, type Save } from "@/game/save";
import { Sim, type Mode, type RunResult, type TownBuy } from "@/game/sim";
import { HuntView } from "@/game/view";
import { clamp } from "@/game/world";

const CAPTIONS = [
  { t: 0, k: "THE OUTLAND", s: "Before the cities woke, this ground was green." },
  { t: 4.6, k: "TRACTION", s: "Towns grew wheels. Hunger grew a jaw." },
  { t: 9.2, k: "VANTAGE", s: "A futuret3ch predator. This is the public beta." },
  { t: 13.6, k: "THE WAKE", s: "Every town you eat heats the world." },
  { t: 18.2, k: "MERCY", s: "Spare the wild. Lakes and the grove cool the plates." },
  { t: 22.4, k: "ASHWAKE", s: "Earn t3x. Nature adapts." },
];

export function HuntApp() {
  const mountRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Sim | null>(null);
  const inputRef = useRef<Input | null>(null);
  const audioRef = useRef<AudioBus | null>(null);
  const pending = useRef<"hunt" | "trailer" | null>(null);
  const [mode, setMode] = useState<Mode>("menu");
  const [panel, setPanel] = useState<"help" | "dock" | null>(null);
  const [save, setSave] = useState<Save>(defaultSave);
  const [result, setResult] = useState<RunResult | null>(null);
  const [muted, setMuted] = useState(false);
  const [film, setFilm] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [civic, setCivic] = useState<{ form: "machine" | "town"; eye: boolean; decor: DecorKind[]; t3x: number }>({
    form: "machine",
    eye: false,
    decor: [],
    t3x: 0,
  });
  const hullRef = useRef<HTMLSpanElement>(null);
  const fuelRef = useRef<HTMLSpanElement>(null);
  const heatRef = useRef<HTMLSpanElement>(null);
  const heatRow = useRef<HTMLDivElement>(null);
  const t3xRef = useRef<HTMLElement>(null);
  const cityRef = useRef<HTMLElement>(null);
  const natureRef = useRef<HTMLDivElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const capK = useRef<HTMLParagraphElement>(null);
  const capS = useRef<HTMLParagraphElement>(null);
  const capLock = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    mount.appendChild(canvas);
    const sim = new Sim(loadSave());
    const input = new Input();
    const audio = new AudioBus();
    audio.muted = sim.save.muted;
    const view = (() => {
      try {
        return new HuntView(canvas);
      } catch (err) {
        console.error(err);
        return null;
      }
    })();
    simRef.current = sim;
    inputRef.current = input;
    audioRef.current = audio;
    input.attach();
    setSave({ ...sim.save, upgrades: { ...sim.save.upgrades } });
    setMuted(sim.save.muted);
    if (pending.current === "hunt") sim.startHunt();
    if (pending.current === "trailer") sim.startTrailer();
    pending.current = null;

    window.__controlsTest = {
      getYaw: () => sim.yaw,
      getSpeed: () => sim.speed,
      setKeys: (codes) => input.setKeys(codes),
      setSteer: (v) => input.setSteer(v),
    };

    const resize = () => {
      if (!view) return;
      const r = mount.getBoundingClientRect();
      view.resize(r.width, r.height, window.devicePixelRatio || 1);
    };
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(mount);

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let shown: Mode = sim.mode;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      acc += dt;
      const frame = input.sample();
      let steps = 0;
      let first = true;
      while (acc >= 1 / 60 && steps < 5) {
        sim.tick(1 / 60, first ? frame : { ...frame, jaw: false, over: false, aegis: false, mercy: false, pause: false });
        acc -= 1 / 60;
        steps += 1;
        first = false;
      }
      if (view) {
        view.sync(sim, dt);
        view.render();
      }
      audio.sync(sim);
      paint(sim);
      if (sim.mode !== shown) {
        shown = sim.mode;
        setMode(sim.mode);
        setResult(sim.result);
        setSave({ ...sim.save, upgrades: { ...sim.save.upgrades } });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      input.detach();
      if (view) view.dispose();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      delete window.__controlsTest;
      canvas.remove();
      simRef.current = null;
    };
    // HUD nodes are stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function paint(sim: Sim) {
    const hull = clamp(sim.hull / sim.hullMax, 0, 1);
    const fuel = clamp(sim.fuel / sim.fuelMax, 0, 1);
    const heat = clamp(sim.heat / 100, 0, 1);
    if (hullRef.current) hullRef.current.style.transform = `scaleX(${hull})`;
    if (fuelRef.current) fuelRef.current.style.transform = `scaleX(${fuel})`;
    if (heatRef.current) heatRef.current.style.transform = `scaleX(${heat})`;
    if (heatRow.current) heatRow.current.dataset.cool = sim.heat < 52 ? "1" : "0";
    if (t3xRef.current) t3xRef.current.textContent = String(Math.floor(sim.t3x));
    if (cityRef.current) cityRef.current.textContent = String(sim.cities);
    if (natureRef.current) natureRef.current.textContent = `${sim.biomeLabel()} wake`;
    if (toastRef.current) {
      toastRef.current.hidden = sim.messageT <= 0;
      toastRef.current.textContent = sim.message;
    }
    const cap = [...CAPTIONS].reverse().find((c) => sim.trailerT >= c.t) ?? CAPTIONS[0]!;
    if (capK.current) capK.current.textContent = cap.k;
    if (capS.current) capS.current.textContent = cap.s;
    if (capLock.current) capLock.current.hidden = sim.trailerT < 22;
    const mini = miniRef.current;
    if (mini) drawMini(mini, sim);
  }

  function refreshSave(sim: Sim) {
    setSave({ ...sim.save, upgrades: { ...sim.save.upgrades } });
  }

  function onStart() {
    const sim = simRef.current;
    if (!sim) {
      pending.current = "hunt";
      return;
    }
    audioRef.current?.unlock();
    sim.startHunt();
    setMode(sim.mode);
    setPanel(null);
    setSheet(false);
    setCivic({ form: "machine", eye: false, decor: [...sim.decor], t3x: 0 });
    setResult(null);
  }

  function onTrailer() {
    setFilm(true);
  }

  function toggleMute() {
    const audio = audioRef.current;
    const sim = simRef.current;
    if (!audio || !sim) return;
    audio.muted = !audio.muted;
    sim.save.muted = audio.muted;
    writeSave(sim.save);
    setMuted(audio.muted);
  }

  const playing = mode === "play" || mode === "paused";
  const pullCivic = () => {
    const sim = simRef.current;
    if (!sim) return;
    setCivic({ form: sim.form, eye: sim.eye, decor: [...sim.decor], t3x: Math.floor(sim.t3x) });
  };
  const onUnpack = () => {
    const sim = simRef.current;
    if (!sim) return;
    sim.toggleTown();
    pullCivic();
    setSheet(sim.form === "town");
  };
  const onEye = () => {
    simRef.current?.toggleEye();
    pullCivic();
  };
  const onBuy = (kind: TownBuy) => {
    simRef.current?.buyTown(kind);
    pullCivic();
  };

  return (
    <div className="game-root">
      <div className="game-canvas" ref={mountRef} />
      <div className="overlay">
        {playing && (
          <>
            <div className="hud-top">
              <div className="hud-cluster">
                <div className="bar-row">
                  <span>Hull</span>
                  <div className="bar hull">
                    <span ref={hullRef} />
                  </div>
                  <span />
                </div>
                <div className="bar-row">
                  <span>Fuel</span>
                  <div className="bar fuel">
                    <span ref={fuelRef} />
                  </div>
                  <span />
                </div>
                <div className="bar-row">
                  <span>Wake</span>
                  <div className="bar heat" ref={heatRow}>
                    <span ref={heatRef} />
                  </div>
                  <span />
                </div>
                <div className="nature-chip" ref={natureRef}>
                  Verdant wake
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="hud-cluster stat-block">
                  <strong ref={t3xRef}>0</strong>
                  <span>t3x</span>
                  <strong ref={cityRef}>0</strong>
                  <span>towns</span>
                </div>
                <button className="icon-btn" type="button" aria-label="Pause" onClick={() => inputRef.current?.tap("pause")}>
                  <Pause size={18} />
                </button>
              </div>
            </div>
            <div className="toast" ref={toastRef} hidden />
            <div className="key-hints">
              <span>
                <kbd>W</kbd> drive
              </span>
              <span>
                <kbd>A</kbd> left <kbd>D</kbd> right
              </span>
              <span>
                <kbd>Space</kbd> jaw
              </span>
              <span>
                <kbd>Shift</kbd> overdrive
              </span>
              <span>
                <kbd>Q</kbd> aegis
              </span>
              <span>
                <kbd>E</kbd> mercy
              </span>
            </div>
            <div className="town-bar">
              <button className="town-btn" type="button" onClick={onUnpack}>
                <Home size={15} />
                {civic.form === "town" ? "Pack" : "Unpack"}
              </button>
              <button className="town-btn" type="button" onClick={onEye}>
                <Eye size={15} />
                {civic.eye ? "City" : "Eyes"}
              </button>
              {civic.form === "town" && (
                <button className="town-btn" type="button" onClick={() => setSheet((v) => !v)}>
                  Town
                </button>
              )}
            </div>
            {sheet && civic.form === "town" && (
              <div className="town-sheet">
                <div className="eyebrow">
                  <span>unpacked</span>
                  <span className="pill">
                    <Gem size={14} /> {civic.t3x} t3x
                  </span>
                </div>
                <h2>Vantage is a town</h2>
                <p>Trade, dress the decks, set the guns and shields. Pack when you need the jaw.</p>
                <div className="town-grid">
                  <button type="button" onClick={() => onBuy("fuel")}>Fuel · 12</button>
                  <button type="button" onClick={() => onBuy("plate")}>Plate · 18</button>
                  <button type="button" onClick={() => onBuy("banner")}>Banner · 10</button>
                  <button type="button" onClick={() => onBuy("lamp")}>Lamp · 8</button>
                  <button type="button" onClick={() => onBuy("turret")}>Turret · 40</button>
                  <button type="button" onClick={() => onBuy("shield")}>Shield · 36</button>
                </div>
                <p className="fine">{civic.decor.length ? civic.decor.join(" · ") : "No fittings yet. Six hardpoints."}</p>
                <div className="actions">
                  <button className="btn" type="button" onClick={() => { simRef.current?.stripDecor(); pullCivic(); }}>
                    Strip last
                  </button>
                  <button className="btn btn-primary" type="button" onClick={onUnpack}>
                    Pack into a machine
                  </button>
                </div>
              </div>
            )}
            <canvas className="minimap" ref={miniRef} width={180} height={180} />
            <div className="touch-ui">
              <div
                className="stick"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  stickTo(e, inputRef.current, knobRef.current);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) stickTo(e, inputRef.current, knobRef.current);
                }}
                onPointerUp={(e) => releaseStick(e, inputRef.current, knobRef.current)}
                onPointerCancel={(e) => releaseStick(e, inputRef.current, knobRef.current)}
              >
                <i ref={knobRef} />
              </div>
              <div className="skill-pad">
                <button className="skill" type="button" data-ready="1" onClick={() => inputRef.current?.tap("jaw")}>
                  <Zap size={16} />
                  Jaw
                </button>
                <button className="skill" type="button" data-ready="1" onClick={() => inputRef.current?.tap("over")}>
                  <Play size={16} />
                  Drive
                </button>
                <button className="skill" type="button" data-ready="1" onClick={() => inputRef.current?.tap("aegis")}>
                  <Shield size={16} />
                  Aegis
                </button>
                <button className="skill" type="button" data-ready="1" onClick={() => inputRef.current?.tap("mercy")}>
                  <Leaf size={16} />
                  Mercy
                </button>
              </div>
            </div>
          </>
        )}

        {mode === "menu" && (
          <div className="menu-wrap">
            <section className="card">
              <div className="eyebrow">
                <span>futuret3ch</span>
                <span className="beta">Public beta</span>
              </div>
              <h1 className="logo">ASHWAKE</h1>
              <p className="tag">Pilot the traction city VANTAGE. Unpack it into a town to trade and arm the walls, then fold it back into a machine.</p>
              <div className="token-row">
                <span className="pill">
                  <Gem size={14} /> t3x token
                </span>
                <span className="pill">Best {save.best}</span>
                <span className="pill">Bank {save.bank}</span>
              </div>
              <div className="actions">
                <button className="btn btn-primary" type="button" onClick={onStart}>
                  <Play size={18} /> Start hunt
                </button>
                <button className="btn" type="button" onClick={onTrailer}>
                  <Clapperboard size={18} /> Watch trailer
                </button>
                <button className="btn" type="button" onClick={() => setPanel("dock")}>
                  <Warehouse size={18} /> The Stack
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setPanel("help")}>
                  <CircleHelp size={18} /> How the wake works
                </button>
                <button className="btn btn-ghost" type="button" disabled>
                  <Lock size={16} /> Multiplayer sorties after beta
                </button>
              </div>
              <p className="fine">Mobile: stick to steer, buttons for jaw, overdrive, aegis, mercy. Nature shifts as your heat rises. Dock to bank t3x.</p>
            </section>
          </div>
        )}

        {film && (
          <div className="film" role="dialog" aria-label="ASHWAKE trailer">
            <video src="/ashwake-trailer.mp4?v=4" controls autoPlay playsInline />
            <button className="btn" type="button" onClick={() => setFilm(false)}>
              Close
            </button>
          </div>
        )}

        {mode === "trailer" && (
          <>
            <div className="letter top" />
            <div className="letter bot" />
            <div className="caption">
              <p className="k" ref={capK}>
                THE OUTLAND
              </p>
              <p className="s" ref={capS}>
                Before the cities woke, this ground was green.
              </p>
              <div className="brand-lock" ref={capLock} hidden>
                futuret3ch · t3x
              </div>
            </div>
            <button className="btn skip" type="button" onClick={() => simRef.current?.skipTrailer()}>
              Skip
            </button>
          </>
        )}

        {mode === "paused" && (
          <div className="modal-wrap">
            <section className="card end">
              <h2>Hold</h2>
              <p>The city idles. Dock to bank every t3x, or roll on.</p>
              <div className="actions">
                <button className="btn btn-primary" type="button" onClick={() => inputRef.current?.tap("pause")}>
                  Resume
                </button>
                <button className="btn" type="button" onClick={() => simRef.current?.dock()}>
                  Dock and bank t3x
                </button>
                <button className="btn btn-ghost" type="button" onClick={toggleMute}>
                  {muted ? <VolumeX size={16} /> : <Volume2 size={16} />} {muted ? "Sound off" : "Sound on"}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => simRef.current?.abandon()}>
                  Abandon run
                </button>
              </div>
            </section>
          </div>
        )}

        {(mode === "down" || mode === "extract") && result && (
          <div className="modal-wrap">
            <section className="card end">
              <div className="eyebrow">
                <span>futuret3ch beta</span>
                <span className="beta">{result.kind === "down" ? "City down" : "Docked"}</span>
              </div>
              <h2>{result.kind === "down" ? "The wake wins" : "t3x secured"}</h2>
              <p>{result.reason}</p>
              <div className="end-grid">
                <div>
                  <strong>{result.score}</strong>
                  <span>score</span>
                </div>
                <div>
                  <strong>{result.banked}</strong>
                  <span>t3x banked</span>
                </div>
                <div>
                  <strong>{result.cities}</strong>
                  <span>towns</span>
                </div>
                <div>
                  <strong>{result.mercy}</strong>
                  <span>mercy</span>
                </div>
              </div>
              <div className="actions">
                <button className="btn btn-primary" type="button" onClick={onStart}>
                  Hunt again
                </button>
                <button className="btn" type="button" onClick={() => setPanel("dock")}>
                  Spend t3x at the Stack
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => simRef.current?.abandon()}>
                  Back to the vista
                </button>
              </div>
            </section>
          </div>
        )}

        {panel === "help" && (
          <div className="modal-wrap">
            <section className="card help">
              <h2>How the wake works</h2>
              <p>You are VANTAGE, a predator municipality. Towns flee. Rivals hunt. The land keeps score.</p>
              <ul>
                <li>Drive with W and S. A turns left, D turns right. The stick matches that on a phone.</li>
                <li>Jaw latches a town in front of you and ingests it for t3x, fuel, and heat.</li>
                <li>Heat is the wake. Verdant heals. Ash storms and magma punish a greedy city.</li>
                <li>Mercy releases a latched town or scatters beasts into t3x and cools the air.</li>
                <li>Lakes and the lime grove cool the plates. Trampling herds heats the world.</li>
                <li>Unpack to settle the city. Trade t3x, dress the decks, and mount turrets and shields. Pack to hunt again.</li>
                <li>First person walks the decks while the town is open, or rides the bridge while it is a machine.</li>
                <li>Dock from pause to bank all t3x. If the city falls, you keep a third.</li>
              </ul>
              <button className="btn btn-primary" type="button" onClick={() => setPanel(null)}>
                Close
              </button>
            </section>
          </div>
        )}

        {panel === "dock" && (
          <div className="modal-wrap">
            <section className="card dock">
              <div className="eyebrow">
                <span>the stack</span>
                <span className="pill">
                  <Gem size={14} /> {save.bank} t3x
                </span>
              </div>
              <h2>Spend the token</h2>
              <p>Upgrades stay on this device. They ride with the next hunt.</p>
              {UPGRADE_META.map((row) => {
                const lv = save.upgrades[row.key];
                const cost = lv >= UPGRADE_MAX ? null : UPGRADE_COST[lv];
                return (
                  <div className="upgrade" key={row.key}>
                    <b>
                      {row.name} · {lv}/{UPGRADE_MAX}
                    </b>
                    <button
                      className="btn"
                      type="button"
                      disabled={cost == null || save.bank < cost}
                      onClick={() => {
                        const sim = simRef.current;
                        if (!sim) return;
                        if (sim.buy(row.key)) refreshSave(sim);
                      }}
                    >
                      {cost == null ? "Max" : `${cost} t3x`}
                    </button>
                    <span>{row.blurb}</span>
                  </div>
                );
              })}
              <div className="actions mt-3">
                <button className="btn btn-primary" type="button" onClick={() => setPanel(null)}>
                  Close
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function stickTo(e: ReactPointerEvent<HTMLDivElement>, input: Input | null, knob: HTMLElement | null) {
  if (!input) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const dx = clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
  const dy = clamp(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
  const mag = Math.hypot(dx, dy);
  const dead = mag < 0.18;
  input.stick.steer = dead ? 0 : clamp(-dx, -1, 1);
  input.stick.throttle = dead ? 0 : clamp(-dy, -1, 1);
  if (knob) {
    knob.style.left = `${50 + dx * 28}%`;
    knob.style.top = `${50 + dy * 28}%`;
  }
}

function releaseStick(e: ReactPointerEvent<HTMLDivElement>, input: Input | null, knob: HTMLElement | null) {
  if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  if (input) {
    input.stick.steer = 0;
    input.stick.throttle = 0;
  }
  if (knob) {
    knob.style.left = "50%";
    knob.style.top = "50%";
  }
}

function drawMini(canvas: HTMLCanvasElement, sim: Sim) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(14,20,17,0.72)";
  ctx.fillRect(0, 0, w, h);
  const scale = w / 1100;
  const X = (x: number) => w / 2 + (x - sim.x) * scale;
  const Y = (z: number) => h / 2 + (z - sim.z) * scale;
  ctx.fillStyle = "#7ec8c3";
  for (const e of sim.ents) {
    if (!e.alive) continue;
    if (e.kind === "prey") ctx.fillStyle = "#e7f0e4";
    else if (e.kind === "rival") ctx.fillStyle = "#e2834a";
    else if (e.kind === "beast") ctx.fillStyle = "#93a396";
    else if (e.kind === "orb") ctx.fillStyle = "#c8f542";
    else continue;
    ctx.fillRect(X(e.x) - 2, Y(e.z) - 2, 4, 4);
  }
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(sim.yaw);
  ctx.fillStyle = "#c8f542";
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 6);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setKeys?: (codes: string[]) => void;
      setSteer?: (v: number) => void;
    };
  }
}
