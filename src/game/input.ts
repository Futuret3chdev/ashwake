import { clamp } from "@/game/world";

export type InputFrame = {
  throttle: number;
  steer: number;
  jaw: boolean;
  over: boolean;
  aegis: boolean;
  mercy: boolean;
  pause: boolean;
};

export class Input {
  keys = new Set<string>();
  private qa: Set<string> | null = null;
  private steerOverride: number | null = null;
  stick = { throttle: 0, steer: 0 };
  private prev = { jaw: false, over: false, aegis: false, mercy: false, pause: false };
  private pulses = { jaw: false, over: false, aegis: false, mercy: false, pause: false };
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onBlur: () => void;

  constructor() {
    this.onKeyDown = (e) => {
      const code = e.code;
      const tracked =
        code === "KeyW" ||
        code === "KeyA" ||
        code === "KeyS" ||
        code === "KeyD" ||
        code === "ArrowUp" ||
        code === "ArrowDown" ||
        code === "ArrowLeft" ||
        code === "ArrowRight" ||
        code === "Space" ||
        code === "KeyJ" ||
        code === "ShiftLeft" ||
        code === "ShiftRight" ||
        code === "KeyQ" ||
        code === "KeyE" ||
        code === "Escape";
      if (!tracked) return;
      e.preventDefault();
      this.keys.add(code);
    };
    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this.onBlur = () => {
      this.keys.clear();
      this.stick.throttle = 0;
      this.stick.steer = 0;
    };
  }

  attach() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  detach() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  setKeys(codes: string[]) {
    this.qa = codes.length === 0 ? null : new Set(codes);
  }

  setSteer(v: number) {
    this.steerOverride = v;
  }

  tap(which: "jaw" | "over" | "aegis" | "mercy" | "pause") {
    this.pulses[which] = true;
  }

  sample(): InputFrame {
    const down = (code: string) => (this.qa ? this.qa.has(code) : this.keys.has(code));
    let steer = 0;
    let throttle = 0;
    if (down("KeyA") || down("ArrowLeft")) steer += 1;
    if (down("KeyD") || down("ArrowRight")) steer -= 1;
    if (down("KeyW") || down("ArrowUp")) throttle += 1;
    if (down("KeyS") || down("ArrowDown")) throttle -= 1;
    if (!this.qa) {
      steer = clamp(steer + this.stick.steer, -1, 1);
      throttle = clamp(throttle + this.stick.throttle, -1, 1);
    }
    if (this.steerOverride !== null && this.qa) steer = this.steerOverride;

    const jawDown = down("Space") || down("KeyJ");
    const overDown = down("ShiftLeft") || down("ShiftRight");
    const aegisDown = down("KeyQ");
    const mercyDown = down("KeyE");
    const pauseDown = down("Escape");

    const edge = (now: boolean, key: "jaw" | "over" | "aegis" | "mercy" | "pause") => {
      const fired = (now && !this.prev[key]) || this.pulses[key];
      this.prev[key] = now;
      this.pulses[key] = false;
      return fired;
    };

    return {
      throttle,
      steer,
      jaw: edge(jawDown, "jaw"),
      over: edge(overDown, "over"),
      aegis: edge(aegisDown, "aegis"),
      mercy: edge(mercyDown, "mercy"),
      pause: edge(pauseDown, "pause"),
    };
  }
}
