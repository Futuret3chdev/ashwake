import type { Sim } from "@/game/sim";

export class AudioBus {
  private ctx: AudioContext | null = null;
  private engine: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  muted = false;

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 40;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 160;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      this.engine = osc;
      this.gain = gain;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  sync(sim: Sim) {
    const sfx = sim.sfx.splice(0, sim.sfx.length);
    if (!this.ctx || !this.gain || !this.engine) return;
    const moving = sim.mode === "play" || sim.mode === "trailer" || sim.mode === "menu";
    const target = this.muted || !moving ? 0 : Math.min(0.045, 0.008 + Math.abs(sim.speed) * 0.0014);
    this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
    this.engine.frequency.setTargetAtTime(34 + Math.abs(sim.speed) * 1.5, this.ctx.currentTime, 0.08);
    if (this.muted) return;
    for (const name of sfx) this.blip(name);
  }

  private blip(name: string) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.connect(g);
    g.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    let freq = 220;
    let dur = 0.12;
    let type: OscillatorType = "square";
    let vol = 0.05;
    if (name === "ingest") {
      freq = 90;
      dur = 0.35;
      type = "sawtooth";
      vol = 0.07;
    } else if (name === "jaw") {
      freq = 140;
      dur = 0.16;
      type = "triangle";
    } else if (name === "mercy") {
      freq = 520;
      dur = 0.22;
      type = "sine";
      vol = 0.04;
    } else if (name === "coin") {
      freq = 880;
      dur = 0.08;
      type = "sine";
      vol = 0.03;
    } else if (name === "hit") {
      freq = 70;
      dur = 0.14;
      type = "square";
      vol = 0.05;
    } else if (name === "over") {
      freq = 180;
      dur = 0.2;
      type = "sawtooth";
    } else if (name === "miss") {
      freq = 110;
      dur = 0.08;
      type = "triangle";
      vol = 0.03;
    }
    o.type = type;
    o.frequency.setValueAtTime(freq, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.6), now + dur);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.start(now);
    o.stop(now + dur + 0.02);
  }
}
