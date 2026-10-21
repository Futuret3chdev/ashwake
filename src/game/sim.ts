import type { InputFrame } from "@/game/input";
import {
  type Save,
  UPGRADE_COST,
  UPGRADE_MAX,
  type UpgradeKey,
  writeSave,
} from "@/game/save";
import {
  BIOME_LABEL,
  type Biome,
  GROVE,
  LAKES,
  WORLD_R,
  approachAngle,
  biomeOf,
  clamp,
  forwardOf,
  yawToward,
} from "@/game/world";

export type Mode = "menu" | "trailer" | "play" | "paused" | "extract" | "down";
export type EntKind = "prey" | "rival" | "beast" | "orb" | "fissure";

export type Ent = {
  id: number;
  kind: EntKind;
  name: string;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  hull: number;
  hullMax: number;
  r: number;
  alive: boolean;
  respawn: number;
  wander: number;
  wanderT: number;
  shotCd: number;
  hitCd: number;
  value: number;
};

export type Shot = { x: number; z: number; vx: number; vz: number; life: number; dmg: number };

export type RunResult = {
  kind: "down" | "extract";
  score: number;
  t3x: number;
  banked: number;
  cities: number;
  mercy: number;
  rivals: number;
  reason: string;
  survived: number;
};

const PREY = ["Hollowmarket", "Brinewheel", "Cinderham", "Mossferry", "Low Kiln", "Salt Orchard", "Pebble"];
const RIVALS = ["Iron Mother", "Haldred", "Black Saint"];

export class Sim {
  mode: Mode = "menu";
  x = 96;
  z = -36;
  yaw = 0.85;
  speed = 0;
  hull = 100;
  hullMax = 100;
  fuel = 100;
  fuelMax = 100;
  heat = 18;
  t3x = 0;
  cities = 0;
  mercy = 0;
  rivalsDown = 0;
  survived = 0;
  message = "The outland is still green.";
  messageT = 5;
  shake = 0;
  jawAmt = 0.08;
  latchId: number | null = null;
  latch = 0;
  aegisT = 0;
  overT = 0;
  cd = { jaw: 0, over: 0, aegis: 0, mercy: 0 };
  ents: Ent[] = [];
  shots: Shot[] = [];
  sfx: string[] = [];
  bursts: { x: number; z: number }[] = [];
  trailerT = 0;
  stormAng = 0.6;
  inStorm = false;
  biome: Biome = "verdant";
  save: Save;
  result: RunResult | null = null;
  private nextId = 1;
  private iFrame = 0;
  private said: Record<string, number> = {};
  private trailerAte = false;

  constructor(save: Save) {
    this.save = save;
    this.spawnWorld();
    this.park();
  }

  biomeLabel() {
    return BIOME_LABEL[this.biome];
  }

  score() {
    return Math.floor(this.t3x + this.cities * 30 + this.mercy * 12 + this.rivalsDown * 45 + this.survived * 1.5);
  }

  startHunt() {
    this.result = null;
    this.resetRun();
    this.mode = "play";
    this.say("VANTAGE rolls. Eat a town, or let the wild cool the plates.");
  }

  startTrailer() {
    this.mode = "trailer";
    this.trailerT = 0;
    this.trailerAte = false;
    this.heat = 12;
    this.biome = "verdant";
    this.latchId = null;
    this.messageT = 0;
    this.cities = 0;
    this.t3x = 0;
  }

  skipTrailer() {
    this.trailerAte = false;
    this.cities = 0;
    this.t3x = 0;
    this.heat = 18;
    this.biome = "verdant";
    this.trailerT = 0;
    this.park();
    this.mode = "menu";
  }

  dock() {
    if (this.mode !== "play" && this.mode !== "paused") return;
    this.mode = "play";
    this.finish("extract", "Docked at the Stack. t3x banked in full.");
  }

  abandon() {
    this.result = null;
    this.latchId = null;
    this.speed = 0;
    this.t3x = 0;
    this.cities = 0;
    this.mercy = 0;
    this.rivalsDown = 0;
    this.heat = 18;
    this.biome = "verdant";
    this.hull = this.hullMax;
    this.fuel = this.fuelMax;
    this.park();
    this.mode = "menu";
  }

  buy(key: UpgradeKey) {
    const lv = this.save.upgrades[key];
    if (lv >= UPGRADE_MAX) return false;
    const cost = UPGRADE_COST[lv] ?? 9999;
    if (this.save.bank < cost) return false;
    this.save.bank -= cost;
    this.save.upgrades[key] = lv + 1;
    writeSave(this.save);
    this.sfx.push("coin");
    return true;
  }

  tick(dt: number, inp: InputFrame) {
    if (inp.pause) {
      if (this.mode === "play") this.mode = "paused";
      else if (this.mode === "paused") this.mode = "play";
    }
    if (this.mode === "paused") return;

    this.cd.jaw = Math.max(0, this.cd.jaw - dt);
    this.cd.over = Math.max(0, this.cd.over - dt);
    this.cd.aegis = Math.max(0, this.cd.aegis - dt);
    this.cd.mercy = Math.max(0, this.cd.mercy - dt);
    this.aegisT = Math.max(0, this.aegisT - dt);
    this.overT = Math.max(0, this.overT - dt);
    this.shake = Math.max(0, this.shake - dt * 1.5);
    if (this.messageT > 0) this.messageT -= dt;
    this.stormAng += dt * (0.07 + this.heat * 0.0011);

    if (this.mode === "trailer") this.tickTrailer(dt);
    else if (this.mode === "play") this.tickPlayer(dt, inp);

    this.tickAI(dt);
    this.tickShots(dt);
    this.tickNature(dt);
    this.separate();

    const jawTarget = this.latchId != null || (this.mode === "trailer" && this.trailerT > 12 && this.trailerT < 18) ? 0.62 : 0.08;
    this.jawAmt += (jawTarget - this.jawAmt) * Math.min(1, dt * 7);

    const next = biomeOf(this.heat);
    if (next !== this.biome) {
      this.biome = next;
      const line: Record<Biome, string> = {
        verdant: "Moss climbs the ruts. The wake cools.",
        steppe: "Grass thins. The steppe takes the wheels.",
        ash: "Ash weather. The wild is answering.",
        magma: "Magma shelf. Keep moving or the drums melt.",
      };
      this.say(line[next]);
    }
    if (this.bursts.length > 24) this.bursts.splice(0, this.bursts.length - 24);
    if (this.sfx.length > 12) this.sfx.splice(0, this.sfx.length - 12);
  }

  private stats() {
    const u = this.save.upgrades;
    return {
      maxSpeed: 32 + u.engine * 2.4,
      turn: 1.55 + u.engine * 0.04,
      jawRange: 30 + u.jaw * 4.5,
      jawRate: 0.34 + u.jaw * 0.05,
      mercyMul: 1 + u.mercy * 0.25,
      aegisDur: 3.5 + u.plates * 0.6,
      hullMax: 100 + u.hull * 20,
      fuelMax: 100 + u.engine * 8,
    };
  }

  private park() {
    this.x = 96;
    this.z = -36;
    this.yaw = 0.85;
    this.speed = 0;
  }

  private resetRun() {
    const st = this.stats();
    this.hullMax = st.hullMax;
    this.fuelMax = st.fuelMax;
    this.hull = this.hullMax;
    this.fuel = this.fuelMax;
    this.heat = 18;
    this.biome = "verdant";
    this.t3x = 0;
    this.cities = 0;
    this.mercy = 0;
    this.rivalsDown = 0;
    this.survived = 0;
    this.latch = 0;
    this.latchId = null;
    this.aegisT = 0;
    this.overT = 0;
    this.iFrame = 0;
    this.speed = 0;
    this.x = 0;
    this.z = 30;
    this.yaw = 0.15;
    this.shots = [];
    this.said = {};
    for (const e of this.ents) {
      if (e.kind === "fissure") {
        e.alive = false;
        continue;
      }
      this.place(e, 80 + Math.random() * 360);
      e.alive = true;
      e.hull = e.hullMax;
      e.respawn = 0;
      e.speed = 0;
    }
  }

  private spawnWorld() {
    PREY.forEach((name, i) => this.make("prey", name, 6.2, 34, 5.1, i));
    RIVALS.forEach((name, i) => this.make("rival", name, 10.4, 90, 9.2, i + 3));
    for (let i = 0; i < 14; i++) this.make("beast", "herd", 1.5, 8, 1.7, i);
    for (let i = 0; i < 10; i++) this.make("orb", "t3x", 1, 1, 1.3, i);
    for (let i = 0; i < 5; i++) {
      const f = this.make("fissure", "fissure", 1, 1, 8, i);
      f.alive = false;
    }
  }

  private make(kind: EntKind, name: string, r: number, hull: number, radius: number, salt: number): Ent {
    const e: Ent = {
      id: this.nextId++,
      kind,
      name,
      x: 0,
      z: 0,
      yaw: salt,
      speed: 0,
      hull,
      hullMax: hull,
      r: radius,
      alive: true,
      respawn: 0,
      wander: salt * 1.7,
      wanderT: (salt % 4) + 1,
      shotCd: 1 + (salt % 3),
      hitCd: 0,
      value: kind === "orb" ? 4 : 0,
    };
    this.place(e, 70 + ((salt * 97) % 380));
    this.ents.push(e);
    return e;
  }

  private place(e: Ent, rad: number) {
    const ang = Math.random() * Math.PI * 2;
    e.x = Math.cos(ang) * rad;
    e.z = Math.sin(ang) * rad;
    if (Math.hypot(e.x - this.x, e.z - this.z) < 40) {
      e.x += 70;
      e.z += 40;
    }
  }

  private say(msg: string) {
    this.message = msg;
    this.messageT = 3.4;
  }

  private sayOnce(key: string, msg: string, every: number) {
    const now = this.survived;
    if ((this.said[key] ?? -999) + every > now) return;
    this.said[key] = now;
    this.say(msg);
  }

  private tickPlayer(dt: number, inp: InputFrame) {
    this.survived += dt;
    this.iFrame = Math.max(0, this.iFrame - dt);
    const st = this.stats();
    const throttle = clamp(inp.throttle, -1, 1);
    const steer = clamp(inp.steer, -1, 1);
    const max = (this.overT > 0 ? st.maxSpeed * 1.42 : st.maxSpeed) * (this.fuel > 0 ? 1 : 0.3);
    const target = throttle * max;
    const accel = throttle === 0 ? 16 : 24;
    const diff = target - this.speed;
    this.speed += Math.sign(diff) * Math.min(Math.abs(diff), accel * dt);
    if (Math.abs(this.speed) < 0.04 && throttle === 0) this.speed = 0;
    const reverse = this.speed >= 0 ? 1 : -1;
    const factor = clamp(Math.abs(this.speed) / 9, 0.5, 1);
    this.yaw += steer * st.turn * factor * reverse * dt;
    const f = forwardOf(this.yaw);
    this.x += f.x * this.speed * dt;
    this.z += f.z * this.speed * dt;
    const rad = Math.hypot(this.x, this.z);
    if (rad > WORLD_R) {
      this.x = (this.x / rad) * WORLD_R;
      this.z = (this.z / rad) * WORLD_R;
      this.speed *= 0.45;
      this.sayOnce("rim", "Rim cliffs turn the city back.", 6);
    }
    if (this.fuel > 0 && Math.abs(this.speed) > 0.4) {
      this.fuel = Math.max(0, this.fuel - dt * (0.7 + Math.abs(this.speed) * 0.05 + (this.overT > 0 ? 1.6 : 0)));
    }
    if (this.fuel <= 0) this.sayOnce("fuel", "Fuel dry. The wheels crawl.", 9);
    if (inp.jaw) this.tryJaw(f.x, f.z, st.jawRange);
    if (inp.over) this.tryOver();
    if (inp.aegis) this.tryAegis(st.aegisDur);
    if (inp.mercy) this.tryMercy(st.mercyMul);
    this.reel(dt, f.x, f.z, st.jawRate);
  }

  private tryJaw(fx: number, fz: number, range: number) {
    if (this.cd.jaw > 0 || this.latchId != null) return;
    let best: Ent | null = null;
    let bestD = range;
    for (const e of this.ents) {
      if (e.kind !== "prey" || !e.alive) continue;
      const dx = e.x - this.x;
      const dz = e.z - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range || dist < 0.001) continue;
      const dot = (dx * fx + dz * fz) / dist;
      if (dot < 0.5) continue;
      if (dist < bestD) {
        best = e;
        bestD = dist;
      }
    }
    this.cd.jaw = 0.7;
    if (!best) {
      this.say("Jaw closes on empty air.");
      this.sfx.push("miss");
      return;
    }
    this.latchId = best.id;
    this.latch = 0;
    this.say(`Jaw locked on ${best.name}.`);
    this.sfx.push("jaw");
  }

  private reel(dt: number, fx: number, fz: number, rate: number) {
    if (this.latchId == null) return;
    const prey = this.ents.find((e) => e.id === this.latchId && e.alive && e.kind === "prey");
    if (!prey) {
      this.latchId = null;
      this.latch = 0;
      return;
    }
    const tx = this.x + fx * 12;
    const tz = this.z + fz * 12;
    prey.x += (tx - prey.x) * Math.min(1, dt * 2.4);
    prey.z += (tz - prey.z) * Math.min(1, dt * 2.4);
    prey.speed = 0;
    this.speed *= 1 - Math.min(0.5, dt * 2);
    this.latch += dt * rate;
    if (this.latch >= 1) this.devour(prey, 1);
  }

  private tryOver() {
    if (this.cd.over > 0 || this.fuel < 8) {
      if (this.fuel < 8) this.say("Not enough fuel for overdrive.");
      return;
    }
    this.overT = 3.3;
    this.cd.over = 8;
    this.fuel -= 8;
    this.sfx.push("over");
    this.say("Overdrive. The stacks scream.");
  }

  private tryAegis(dur: number) {
    if (this.cd.aegis > 0) return;
    this.aegisT = dur;
    this.cd.aegis = 11;
    this.sfx.push("aegis");
    this.say("Aegis plates locked.");
  }

  private tryMercy(mul: number) {
    if (this.cd.mercy > 0) return;
    this.cd.mercy = 9.5;
    this.mercy += 1;
    this.sfx.push("mercy");
    if (this.latchId != null) {
      const prey = this.ents.find((e) => e.id === this.latchId);
      this.latchId = null;
      this.latch = 0;
      this.heat = Math.max(0, this.heat - 18);
      const bonus = Math.floor(16 * mul);
      this.t3x += bonus;
      if (prey) {
        const f = forwardOf(this.yaw);
        prey.x += f.x * 18;
        prey.z += f.z * 18;
        prey.speed = 20;
        this.say(`${prey.name} goes free. Steward yield +${bonus} t3x.`);
      }
      return;
    }
    this.heat = Math.max(0, this.heat - 12);
    let n = 0;
    for (const e of this.ents) {
      if (!e.alive || e.kind !== "beast") continue;
      if (Math.hypot(e.x - this.x, e.z - this.z) > 30) continue;
      e.alive = false;
      e.respawn = 11;
      this.t3x += Math.floor(3 * mul);
      this.bursts.push({ x: e.x, z: e.z });
      n += 1;
    }
    const inGrove = Math.hypot(this.x - GROVE.x, this.z - GROVE.z) < GROVE.r;
    if (inGrove) {
      this.heat = Math.max(0, this.heat - 12);
      this.t3x += Math.floor(18 * mul);
      this.hull = Math.min(this.hullMax, this.hull + 12);
      this.say("The grove drinks the heat and pays the steward.");
    } else if (n > 0) {
      this.say(`Mercy pulse. ${n} beasts scatter into t3x.`);
    } else {
      this.say("Mercy pulse. The air cools around the wheels.");
    }
  }

  private devour(e: Ent, pay: number) {
    if (!e.alive) return;
    e.alive = false;
    e.respawn = e.kind === "rival" ? 16 : 9;
    if (this.latchId === e.id) {
      this.latchId = null;
      this.latch = 0;
      this.cd.jaw = 2.2;
    }
    const gain = Math.floor((e.kind === "rival" ? 38 : 18) * pay);
    this.t3x += gain;
    this.fuel = Math.min(this.fuelMax, this.fuel + (e.kind === "rival" ? 8 : 20));
    this.heat = Math.min(100, this.heat + (e.kind === "rival" ? 8 : 14));
    this.hull = Math.min(this.hullMax, this.hull + (e.kind === "prey" ? 5 : 0));
    if (e.kind === "rival") this.rivalsDown += 1;
    else this.cities += 1;
    this.shake = Math.min(1.3, this.shake + 0.85);
    this.sfx.push("ingest");
    this.bursts.push({ x: e.x, z: e.z });
    this.say(`${e.name} taken. +${gain} t3x. The wake heats.`);
  }

  private hurt(amount: number, reason: string) {
    if (this.mode !== "play" || this.iFrame > 0) return;
    this.iFrame = 0.42;
    this.shake = Math.min(1.3, this.shake + 0.5);
    this.sfx.push("hit");
    this.chip(amount, reason);
  }

  private chip(amount: number, reason: string) {
    if (this.mode !== "play") return;
    const mul = this.aegisT > 0 ? 0.35 : 1;
    this.hull -= amount * mul;
    if (this.hull <= 0) {
      this.hull = 0;
      this.finish("down", reason);
    }
  }

  private finish(kind: "down" | "extract", reason: string) {
    if (this.mode !== "play" && this.mode !== "paused") return;
    const banked = kind === "extract" ? Math.floor(this.t3x) : Math.floor(this.t3x * 0.3);
    this.save.bank += banked;
    const score = this.score();
    if (score > this.save.best) this.save.best = score;
    if (this.cities > this.save.bestCities) this.save.bestCities = this.cities;
    this.save.hunts += 1;
    this.save.mercyActs += this.mercy;
    writeSave(this.save);
    this.result = {
      kind,
      score,
      t3x: Math.floor(this.t3x),
      banked,
      cities: this.cities,
      mercy: this.mercy,
      rivals: this.rivalsDown,
      reason,
      survived: this.survived,
    };
    this.mode = kind === "extract" ? "extract" : "down";
    this.latchId = null;
    this.speed = 0;
  }

  private tickTrailer(dt: number) {
    this.trailerT += dt;
    const t = this.trailerT;
    const u = Math.min(1, t / 24);
    const k = u * u * (3 - 2 * u);
    const x0 = -130;
    const z0 = 90;
    const x1 = 170;
    const z1 = -50;
    this.x = x0 + (x1 - x0) * k;
    this.z = z0 + (z1 - z0) * k;
    this.yaw = yawToward(x1 - x0, z1 - z0);
    this.speed = 20;
    this.heat = Math.min(78, 12 + Math.max(0, t - 11) * 5);
    const prey = this.ents.find((e) => e.kind === "prey");
    if (prey) {
      const lead = t < 14.5 ? 28 : Math.max(3.5, 28 - (t - 14.5) * 10);
      const f = forwardOf(this.yaw);
      prey.alive = t < 17.4;
      prey.x = this.x + f.x * lead;
      prey.z = this.z + f.z * lead;
      prey.yaw = this.yaw;
      prey.speed = 16;
    }
    if (t > 16.6 && !this.trailerAte) {
      this.trailerAte = true;
      this.cities = 1;
      this.t3x = 40;
      this.shake = 1;
      this.sfx.push("ingest");
      this.bursts.push({ x: this.x, z: this.z });
    }
    if (t > 27) this.skipTrailer();
  }

  private tickAI(dt: number) {
    const preds = [{ x: this.x, z: this.z }];
    for (const e of this.ents) {
      if (e.kind === "rival" && e.alive) preds.push({ x: e.x, z: e.z });
    }
    for (const e of this.ents) {
      e.hitCd = Math.max(0, e.hitCd - dt);
      if (!e.alive) {
        if (this.mode === "trailer") continue;
        e.respawn -= dt;
        if (e.respawn <= 0 && e.kind !== "fissure") {
          this.place(e, 200 + Math.random() * 260);
          e.alive = true;
          e.hull = e.hullMax;
          e.speed = 0;
        }
        continue;
      }
      if (this.mode === "trailer" && e.kind === "prey" && e === this.ents.find((p) => p.kind === "prey")) continue;
      if (e.kind === "prey") this.drivePrey(e, dt, preds);
      else if (e.kind === "rival") this.driveRival(e, dt);
      else if (e.kind === "beast") this.driveBeast(e, dt);
      else if (e.kind === "orb") this.driveOrb(e, dt);
      else if (e.kind === "fissure") this.driveFissure(e, dt);
    }
  }

  private drivePrey(e: Ent, dt: number, preds: { x: number; z: number }[]) {
    let fx = Math.cos(e.wander);
    let fz = Math.sin(e.wander);
    let flee = false;
    let nearest = 170;
    for (const p of preds) {
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < nearest && d > 0.01) {
        nearest = d;
        fx = dx / d;
        fz = dz / d;
        flee = true;
      }
    }
    if (!flee) {
      e.wanderT -= dt;
      if (e.wanderT <= 0) {
        e.wanderT = 2 + Math.random() * 3;
        e.wander += (Math.random() - 0.5) * 2.2;
      }
    }
    e.yaw = approachAngle(e.yaw, yawToward(fx, fz), dt * (flee ? 2.4 : 0.8));
    const spd = flee ? 17 : 7;
    e.speed += (spd - e.speed) * Math.min(1, dt * 2);
    this.advance(e, dt);
    if (this.mode === "play") {
      const d = Math.hypot(e.x - this.x, e.z - this.z);
      if (d < e.r + 7.2 && Math.abs(this.speed) > 10 && e.hitCd <= 0 && this.latchId !== e.id) {
        e.hull -= 9 + Math.abs(this.speed) * 0.3;
        e.hitCd = 0.5;
        this.hurt(4, `${e.name} scrapes the jaw`);
        if (e.hull <= 0) this.devour(e, 0.7);
      }
    }
  }

  private driveRival(e: Ent, dt: number) {
    let tx = this.x;
    let tz = this.z;
    let best = this.hull < 46 && this.mode === "play" ? Math.hypot(this.x - e.x, this.z - e.z) : 1e9;
    for (const p of this.ents) {
      if (p.kind !== "prey" || !p.alive) continue;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < best) {
        best = d;
        tx = p.x;
        tz = p.z;
      }
    }
    const dx = tx - e.x;
    const dz = tz - e.z;
    const dist = Math.hypot(dx, dz) || 1;
    e.yaw = approachAngle(e.yaw, yawToward(dx, dz), dt * 1.15);
    e.speed += (19 - e.speed) * Math.min(1, dt * 1.4);
    this.advance(e, dt);
    e.shotCd -= dt;
    if (e.shotCd <= 0 && dist < 78 && dist > 18) {
      const f = forwardOf(e.yaw);
      const dot = (dx * f.x + dz * f.z) / dist;
      if (dot > 0.82) {
        e.shotCd = 3.4;
        this.shots.push({ x: e.x + f.x * 10, z: e.z + f.z * 10, vx: f.x * 32, vz: f.z * 32, life: 2.1, dmg: 10 });
      }
    }
    if (this.mode === "play") {
      const pd = Math.hypot(e.x - this.x, e.z - this.z);
      if (pd < e.r + 7.5 && e.hitCd <= 0) {
        e.hitCd = 0.7;
        const blow = 8 + Math.abs(this.speed) * 0.35;
        e.hull -= blow;
        const nx = (this.x - e.x) / (pd || 1);
        const nz = (this.z - e.z) / (pd || 1);
        this.x += nx * 4;
        this.z += nz * 4;
        if (e.hull <= 0) this.devour(e, 1);
        this.hurt(12, `${e.name} rams the hull`);
      }
    }
  }

  private driveBeast(e: Ent, dt: number) {
    let tx = Math.cos(e.wander);
    let tz = Math.sin(e.wander);
    if (this.heat > 58) {
      let best = 1e9;
      for (const lake of LAKES) {
        const dx = lake.x - e.x;
        const dz = lake.z - e.z;
        const d = Math.hypot(dx, dz);
        if (d < best && d > 0.1) {
          best = d;
          tx = dx / d;
          tz = dz / d;
        }
      }
    } else {
      e.wanderT -= dt;
      if (e.wanderT <= 0) {
        e.wanderT = 1.5 + Math.random() * 2.5;
        e.wander += (Math.random() - 0.5) * 2;
      }
    }
    e.yaw = approachAngle(e.yaw, yawToward(tx, tz), dt * 2);
    e.speed += ((this.heat > 58 ? 10 : 5) - e.speed) * Math.min(1, dt * 2);
    this.advance(e, dt);
    if (this.mode !== "play") return;
    const d = Math.hypot(e.x - this.x, e.z - this.z);
    if (d < e.r + 7 && Math.abs(this.speed) > 14 && e.hitCd <= 0) {
      e.hitCd = 1;
      e.alive = false;
      e.respawn = 12;
      this.heat = Math.min(100, this.heat + 4);
      this.sayOnce("trample", "The wheels take a life. The wild notices.", 5);
      this.bursts.push({ x: e.x, z: e.z });
    }
  }

  private driveOrb(e: Ent, dt: number) {
    if (this.mode !== "play") return;
    const dx = this.x - e.x;
    const dz = this.z - e.z;
    const d = Math.hypot(dx, dz);
    if (d < 18 && d > 0.01) {
      e.x += (dx / d) * 26 * dt;
      e.z += (dz / d) * 26 * dt;
    }
    if (d < 7) {
      e.alive = false;
      e.respawn = 9;
      this.t3x += e.value;
      this.sfx.push("coin");
    }
  }

  private driveFissure(e: Ent, dt: number) {
    const on = this.biome === "magma" && this.mode === "play";
    if (!on) {
      e.alive = false;
      return;
    }
    if (!e.alive) {
      e.alive = true;
      const ang = Math.random() * Math.PI * 2;
      const rad = 18 + Math.random() * 50;
      e.x = this.x + Math.cos(ang) * rad;
      e.z = this.z + Math.sin(ang) * rad;
    }
    e.x += Math.cos(e.wander) * dt * 3;
    e.z += Math.sin(e.wander) * dt * 3;
    e.wander += dt * 0.2;
    if (Math.hypot(e.x - this.x, e.z - this.z) < e.r && Math.abs(this.speed) < 11) {
      this.chip(16 * dt, "A fissure cooked a stopped wheel.");
    }
  }

  private advance(e: Ent, dt: number) {
    const f = forwardOf(e.yaw);
    e.x += f.x * e.speed * dt;
    e.z += f.z * e.speed * dt;
    const d = Math.hypot(e.x, e.z);
    if (d > WORLD_R - 10) {
      e.x *= (WORLD_R - 14) / d;
      e.z *= (WORLD_R - 14) / d;
      e.yaw += Math.PI * 0.5;
    }
  }

  private tickShots(dt: number) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      s.life -= dt;
      const d = Math.hypot(s.x - this.x, s.z - this.z);
      if (d < 7 && this.mode === "play") {
        this.hurt(s.dmg, "Harpoon punched the outer ward.");
        s.life = 0;
      }
      if (s.life <= 0) this.shots.splice(i, 1);
    }
    if (this.shots.length > 16) this.shots.splice(0, this.shots.length - 16);
  }

  private tickNature(dt: number) {
    this.heat = clamp(this.heat - dt * 0.38, 0, 100);
    const band = Math.abs(this.x * Math.cos(this.stormAng) + this.z * Math.sin(this.stormAng));
    this.inStorm = band < 26;
    if (this.mode !== "play") return;
    for (const lake of LAKES) {
      if (Math.hypot(this.x - lake.x, this.z - lake.z) < lake.r) {
        this.heat = Math.max(0, this.heat - dt * 3.8);
        this.hull = Math.min(this.hullMax, this.hull + dt * 3.2);
        this.fuel = Math.min(this.fuelMax, this.fuel + dt * 1.7);
        this.sayOnce("lake", "Lake water climbs the wheels. Heat bleeds off.", 11);
      }
    }
    if (this.inStorm && this.heat > 26) {
      this.chip(dt * (1.15 + this.heat * 0.02), "The ash storm peeled the decks.");
      this.sayOnce("storm", "Ash storm across the bow. Drive through it.", 10);
    }
    if (this.biome === "ash") this.chip(dt * 0.45, "Ash eats the seals.");
    if (this.biome === "magma") this.chip(dt * 1.45, "The shelf softened a wheel drum.");
    if (this.biome === "verdant") this.hull = Math.min(this.hullMax, this.hull + dt * 0.4);
  }

  private separate() {
    const bodies = this.ents.filter((e) => e.alive && (e.kind === "prey" || e.kind === "rival" || e.kind === "beast"));
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]!;
        const b = bodies[j]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz) || 0.001;
        const min = a.r + b.r;
        if (d < min) {
          const push = (min - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
        }
      }
    }
  }
}
