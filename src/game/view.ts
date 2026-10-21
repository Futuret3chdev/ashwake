import * as THREE from "three";
import type { Ent, Sim } from "@/game/sim";
import { GROVE, LAKES, terrainHeight } from "@/game/world";

interface CityRig {
  jawL: THREE.Group;
  jawR: THREE.Group;
  wheels: THREE.Object3D[];
  spin: number;
}

const TERRAIN = /* glsl */ `
float ashHeight(vec2 p) {
  return sin(p.x * 0.02) * 7.0
    + cos(p.y * 0.016) * 5.0
    + sin((p.x + p.y) * 0.007) * 4.5
    + sin(p.x * 0.041 + p.y * 0.03) * 1.2;
}
`;

export class HuntView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private player: THREE.Group;
  private rigs = new Map<number, { mesh: THREE.Object3D; rig?: CityRig }>();
  private shotMeshes: THREE.Mesh[] = [];
  private groundMat: THREE.ShaderMaterial;
  private skyMat: THREE.ShaderMaterial;
  private waterMat: THREE.ShaderMaterial;
  private fog: THREE.FogExp2;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private storm: THREE.Mesh;
  private trees: THREE.InstancedMesh;
  private crowns: THREE.InstancedMesh;
  private points: THREE.Points;
  private parts: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number }[] = [];
  private camPos = new THREE.Vector3(140, 28, 40);
  private lookPos = new THREE.Vector3(96, 6, -36);
  private desired = new THREE.Vector3();
  private look = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private orbit = 0.2;
  private clock = 0;
  private disposed = false;
  private heatBucket = -1;
  private fogCool = new THREE.Color(0xc5d2c2);
  private fogHot = new THREE.Color(0x4a241c);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x0e1411, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.35, 1400);

    this.fog = new THREE.FogExp2(0xc5d2c2, 0.0085);
    this.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xc5d7c8, 0x3d4a32, 1.15);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d2, 1.45);
    this.sun.position.set(80, 140, 40);
    this.scene.add(this.sun);

    this.skyMat = new THREE.ShaderMaterial({
      toneMapped: false,
      side: THREE.BackSide,
      uniforms: { uHeat: { value: 0.15 }, uSun: { value: new THREE.Vector3(0.4, 0.75, 0.25).normalize() } },
      vertexShader: `varying vec3 vDir; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vDir = position; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        uniform float uHeat; uniform vec3 uSun; varying vec3 vDir;
        void main(){
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 zenG = vec3(0.33, 0.55, 0.72);
          vec3 horG = vec3(0.78, 0.84, 0.74);
          vec3 zenA = vec3(0.10, 0.07, 0.08);
          vec3 horA = vec3(0.62, 0.32, 0.16);
          vec3 zen = mix(zenG, zenA, uHeat);
          vec3 hor = mix(horG, horA, uHeat);
          vec3 col = mix(hor, zen, smoothstep(0.0, 0.55, h));
          float sun = pow(max(dot(dir, uSun), 0.0), 90.0);
          col += vec3(1.0, 0.86, 0.55) * sun * (1.0 - uHeat * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), this.skyMat);
    this.scene.add(sky);

    this.groundMat = new THREE.ShaderMaterial({
      uniforms: { uHeat: { value: 0.15 }, uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0.45, 0.85, 0.2).normalize() } },
      vertexShader: `
        ${TERRAIN}
        varying vec3 vPos; varying float vH;
        void main(){
          vec3 p = position;
          float h = ashHeight(p.xz);
          p.y += h;
          vPos = p; vH = h;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float uHeat; uniform float uTime; uniform vec3 uSun;
        varying vec3 vPos; varying float vH;
        void main(){
          float n = sin(vPos.x * 0.21 + uTime * 0.05) * sin(vPos.z * 0.19);
          vec3 grass = vec3(0.16, 0.34, 0.16);
          vec3 steppe = vec3(0.46, 0.38, 0.20);
          vec3 ash = vec3(0.28, 0.25, 0.22);
          vec3 magma = vec3(0.42, 0.12, 0.06);
          float heat = uHeat;
          vec3 col = mix(grass, steppe, smoothstep(0.22, 0.5, heat));
          col = mix(col, ash, smoothstep(0.48, 0.74, heat));
          col = mix(col, magma, smoothstep(0.72, 1.0, heat));
          float crack = smoothstep(0.86, 1.0, sin(vPos.x * 0.35) * sin(vPos.z * 0.31));
          col = mix(col, vec3(1.0, 0.42, 0.08), crack * smoothstep(0.55, 1.0, heat));
          vec3 dx = dFdx(vPos); vec3 dy = dFdy(vPos);
          vec3 nor = normalize(cross(dx, dy));
          float lit = clamp(dot(nor, uSun), 0.0, 1.0);
          col *= 0.42 + lit * 0.85;
          col += vec3(0.02, 0.03, 0.015) * n;
          col *= 0.92 + vH * 0.012;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const groundGeo = new THREE.PlaneGeometry(1700, 1700, 140, 140);
    groundGeo.rotateX(-Math.PI / 2);
    this.scene.add(new THREE.Mesh(groundGeo, this.groundMat));

    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform float uTime; varying vec2 vUv;
        void main(){
          float w = sin(vUv.x * 48.0 + uTime * 1.6) * sin(vUv.y * 42.0 - uTime * 1.2);
          float rim = smoothstep(0.46, 0.5, length(vUv - 0.5));
          vec3 col = mix(vec3(0.05, 0.28, 0.30), vec3(0.55, 0.86, 0.62), w * 0.5 + 0.5);
          gl_FragColor = vec4(col, (1.0 - rim) * 0.78);
        }`,
    });
    const lakeGeo = new THREE.CircleGeometry(1, 48);
    lakeGeo.rotateX(-Math.PI / 2);
    for (const lake of LAKES) {
      const mesh = new THREE.Mesh(lakeGeo, this.waterMat);
      mesh.position.set(lake.x, terrainHeight(lake.x, lake.z) + 0.55, lake.z);
      mesh.scale.setScalar(lake.r);
      this.scene.add(mesh);
    }

    const { trunks, crowns } = this.makeForest();
    this.trees = trunks;
    this.crowns = crowns;
    this.scene.add(trunks, crowns);
    this.scene.add(this.makeMountains());
    this.scene.add(this.makeGroveMark());

    const stormGeo = new THREE.BoxGeometry(22, 70, 1200);
    const stormMat = new THREE.MeshBasicMaterial({ color: 0xc47a48, transparent: true, opacity: 0.14, depthWrite: false });
    this.storm = new THREE.Mesh(stormGeo, stormMat);
    this.storm.position.y = 28;
    this.scene.add(this.storm);

    this.player = this.buildCity("player");
    this.scene.add(this.player);

    const pgeo = new THREE.BufferGeometry();
    const positions = new Float32Array(420 * 3);
    pgeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.points = new THREE.Points(
      pgeo,
      new THREE.PointsMaterial({ color: 0xe7f0e4, size: 0.55, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.scene.add(this.points);
    for (let i = 0; i < 420; i++) this.parts.push({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1 });

    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffb089 }),
      );
      m.visible = false;
      this.shotMeshes.push(m);
      this.scene.add(m);
    }
  }

  resize(w: number, h: number, dpr: number) {
    if (this.disposed || w < 2 || h < 2) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(dpr, w < 900 ? 1.35 : 1.75));
    this.renderer.setSize(w, h, false);
  }

  sync(sim: Sim, dt: number) {
    this.clock += dt;
    const heat = sim.heat / 100;
    this.groundMat.uniforms.uHeat!.value = heat;
    this.groundMat.uniforms.uTime!.value = this.clock;
    this.skyMat.uniforms.uHeat!.value = heat;
    this.waterMat.uniforms.uTime!.value = this.clock;
    this.fog.color.copy(this.fogCool).lerp(this.fogHot, heat);
    this.fog.density = 0.0065 + heat * 0.012 + (sim.inStorm ? 0.018 : 0);
    this.hemi.color.setHex(heat < 0.55 ? 0xc5d7c8 : 0xc48a62);
    this.hemi.groundColor.setHex(heat < 0.55 ? 0x3a4630 : 0x3a2218);
    this.sun.intensity = 1.5 - heat * 0.55;
    this.sun.color.setHex(heat < 0.6 ? 0xfff1d2 : 0xffb088);
    const stormMat = this.storm.material as THREE.MeshBasicMaterial;
    stormMat.opacity = sim.heat > 24 ? 0.08 + (sim.inStorm ? 0.16 : 0.05) : 0.02;
    this.storm.rotation.y = -sim.stormAng;
    this.paintTrees(heat);

    const py = terrainHeight(sim.x, sim.z);
    this.player.position.set(sim.x, py, sim.z);
    this.player.rotation.y = sim.yaw;
    this.poseCity(this.player, sim.jawAmt, sim.mode === "menu" ? 8 : sim.speed, dt);

    const alive = new Set<number>();
    for (const e of sim.ents) {
      alive.add(e.id);
      let slot = this.rigs.get(e.id);
      if (!slot) {
        const mesh = this.meshFor(e);
        this.scene.add(mesh);
        slot = { mesh, rig: mesh.userData.rig as CityRig | undefined };
        this.rigs.set(e.id, slot);
      }
      slot.mesh.visible = e.alive && e.kind !== "fissure" ? true : e.alive;
      if (!e.alive) continue;
      const y = terrainHeight(e.x, e.z);
      const bob = e.kind === "orb" ? Math.sin(this.clock * 3 + e.id) * 0.45 : e.kind === "beast" ? Math.sin(this.clock * 6 + e.id) * 0.08 : 0;
      slot.mesh.position.set(e.x, y + bob + (e.kind === "orb" ? 1.4 : 0), e.z);
      if (e.kind !== "orb" && e.kind !== "fissure") slot.mesh.rotation.y = e.yaw;
      if (slot.rig) {
        const open = e.id === sim.latchId ? 0.6 : 0.06;
        this.poseCity(slot.mesh, open, e.speed, dt, slot.rig);
      }
    }
    for (const [id, slot] of this.rigs) {
      if (!alive.has(id)) slot.mesh.visible = false;
    }

    for (let i = 0; i < this.shotMeshes.length; i++) {
      const shot = sim.shots[i];
      const mesh = this.shotMeshes[i]!;
      if (!shot) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(shot.x, terrainHeight(shot.x, shot.z) + 2.2, shot.z);
    }

    while (sim.bursts.length) {
      const b = sim.bursts.pop()!;
      this.burst(b.x, terrainHeight(b.x, b.z) + 3, b.z, 28);
    }
    this.exhaust(sim);
    this.stepParts(dt);
    this.frameCamera(sim, dt);
  }

  render() {
    if (!this.disposed) this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.renderer.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }

  private frameCamera(sim: Sim, dt: number) {
    const y = terrainHeight(sim.x, sim.z);
    const fx = -Math.sin(sim.yaw);
    const fz = -Math.cos(sim.yaw);
    const rx = Math.cos(sim.yaw);
    const rz = -Math.sin(sim.yaw);
    if (sim.mode === "menu" || sim.mode === "extract" || sim.mode === "down") {
      this.orbit += dt * 0.16;
      this.desired.set(sim.x + Math.sin(this.orbit) * 48, y + 16, sim.z + Math.cos(this.orbit) * 48);
      this.look.set(sim.x, y + 5, sim.z);
    } else if (sim.mode === "trailer") {
      const t = sim.trailerT;
      if (t < 6) {
        this.desired.set(sim.x - fx * 18 + rx * 36, y + 42, sim.z - fz * 18 + rz * 36);
        this.look.set(sim.x + fx * 24, y + 3, sim.z + fz * 24);
      } else if (t < 13) {
        this.desired.set(sim.x - fx * 30 - rx * 12, y + 11, sim.z - fz * 30 - rz * 12);
        this.look.set(sim.x + fx * 18, y + 4, sim.z + fz * 18);
      } else if (t < 18) {
        this.desired.set(sim.x - fx * 16 + rx * 7, y + 6.5, sim.z - fz * 16 + rz * 7);
        this.look.set(sim.x + fx * 14, y + 2.4, sim.z + fz * 14);
      } else {
        const k = (t - 18) / 8;
        this.desired.set(sim.x - fx * (28 + k * 36) + rx * 20, y + 16 + k * 36, sim.z - fz * (28 + k * 36) + rz * 20);
        this.look.set(sim.x, y + 6, sim.z);
      }
    } else {
      const back = 34;
      this.desired.set(sim.x - fx * back, y + 15, sim.z - fz * back);
      this.look.set(sim.x + fx * 12, y + 4.2, sim.z + fz * 12);
    }
    const k = 1 - Math.exp(-3.1 * dt);
    this.camPos.lerp(this.desired, k);
    this.lookPos.lerp(this.look, k);
    if (sim.shake > 0.02) {
      this.camPos.x += (Math.random() - 0.5) * sim.shake * 1.6;
      this.camPos.y += (Math.random() - 0.5) * sim.shake;
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.lookPos);
    const fov = 52 + Math.min(8, Math.abs(sim.speed) * 0.16);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private meshFor(e: Ent) {
    if (e.kind === "prey") return this.buildCity("prey");
    if (e.kind === "rival") return this.buildCity("rival");
    if (e.kind === "beast") return this.buildBeast();
    if (e.kind === "fissure") return this.buildFissure();
    return this.buildOrb();
  }

  private buildCity(kind: "player" | "prey" | "rival") {
    const g = new THREE.Group();
    const scale = kind === "rival" ? 1.22 : kind === "prey" ? 0.62 : 1;
    const hull = kind === "player" ? 0x2c3833 : kind === "prey" ? 0xc8bba6 : 0x1a1d20;
    const accent = kind === "player" ? 0xc8f542 : kind === "prey" ? 0x7ec8c3 : 0xe24b3a;
    const body = new THREE.MeshStandardMaterial({ color: hull, metalness: 0.72, roughness: 0.36 });
    const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.7, metalness: 0.3, roughness: 0.4 });
    const rust = new THREE.MeshStandardMaterial({ color: 0xe2834a, metalness: 0.5, roughness: 0.42 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x141816, metalness: 0.35, roughness: 0.72 });
    const deck = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), body);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    deck(8.4, 2.3, 14.2, 0, 2.5, 0.2);
    const nose = deck(6.2, 1.35, 3.6, 0, 2.15, -7.6);
    nose.rotation.x = 0.28;
    deck(6.5, 2.5, 8.2, 0, 4.6, 0.8);
    deck(4.2, 2.1, 4.4, 0, 6.6, 1.3);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.55, 4.2, 6), glow);
    spire.position.set(0, 9.4, 1.5);
    g.add(spire);
    const win = new THREE.Mesh(new THREE.BoxGeometry(6.3, 0.55, 0.18), glow);
    win.position.set(0, 5.15, -3.2);
    g.add(win);
    const win2 = win.clone();
    win2.position.set(0, 5.15, 4.6);
    g.add(win2);
    if (kind === "player") {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 0.12), glow);
      plate.position.set(0, 7.5, 3.5);
      g.add(plate);
    }
    const jawL = new THREE.Group();
    const jawR = new THREE.Group();
    jawL.position.set(-2.15, 1.7, -8.2);
    jawR.position.set(2.15, 1.7, -8.2);
    const jawGeo = new THREE.BoxGeometry(1.25, 1.05, 4.4);
    const jl = new THREE.Mesh(jawGeo, rust);
    jl.position.set(0, 0, -1.7);
    jawL.add(jl);
    const jr = new THREE.Mesh(jawGeo, rust);
    jr.position.set(0, 0, -1.7);
    jawR.add(jr);
    g.add(jawL, jawR);
    const wheelGeo = new THREE.CylinderGeometry(1.55, 1.55, 1.15, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheels: THREE.Object3D[] = [];
    for (const z of [-4.2, 0.5, 4.8]) {
      for (const x of [-4.7, 4.7]) {
        const w = new THREE.Mesh(wheelGeo, dark);
        w.position.set(x, 1.45, z);
        g.add(w);
        wheels.push(w);
      }
    }
    for (const [x, z] of [
      [-1.6, 3.6],
      [1.55, 4.3],
    ] as const) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.46, 2.3, 8), dark);
      stack.position.set(x, 7.5, z);
      g.add(stack);
    }
    const light = new THREE.PointLight(accent, kind === "player" ? 6 : 3, 22, 2);
    light.position.set(0, 6, -6);
    g.add(light);
    g.scale.setScalar(scale);
    const rig: CityRig = { jawL, jawR, wheels, spin: 0 };
    g.userData.rig = rig;
    return g;
  }

  private poseCity(mesh: THREE.Object3D, open: number, speed: number, dt: number, rig?: CityRig) {
    const r = rig ?? (mesh.userData.rig as CityRig | undefined);
    if (!r) return;
    r.jawL.rotation.y += (open - r.jawL.rotation.y) * 0.18;
    r.jawR.rotation.y += (-open - r.jawR.rotation.y) * 0.18;
    r.spin += speed * dt * 0.45;
    for (const w of r.wheels) w.rotation.x = r.spin;
  }

  private buildBeast() {
    const g = new THREE.Group();
    const hide = new THREE.MeshStandardMaterial({ color: 0x6d5a3a, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 1.5), hide);
    body.position.y = 0.85;
    g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.36, 0.55), hide);
    head.position.set(0, 1.05, -0.95);
    g.add(head);
    const horn = new THREE.MeshStandardMaterial({ color: 0xe7f0e4, roughness: 0.5 });
    for (const x of [-0.16, 0.16]) {
      const ant = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.45, 4), horn);
      ant.position.set(x, 1.45, -0.95);
      g.add(ant);
    }
    return g;
  }

  private buildOrb() {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.55, 0),
      new THREE.MeshStandardMaterial({ color: 0xc8f542, emissive: 0xc8f542, emissiveIntensity: 0.85, metalness: 0.2, roughness: 0.35 }),
    );
    return m;
  }

  private buildFissure() {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.4, 18),
      new THREE.MeshBasicMaterial({ color: 0xff6a2a, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    m.rotation.x = -Math.PI / 2;
    return m;
  }

  private makeForest() {
    const count = 420;
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.6, 5);
    const crownGeo = new THREE.ConeGeometry(1.15, 3.2, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.8, vertexColors: false });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
    crowns.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let n = 0;
    let guard = 0;
    while (n < count && guard < 4000) {
      guard += 1;
      const x = (Math.random() - 0.5) * 980;
      const z = (Math.random() - 0.5) * 980;
      if (Math.hypot(x, z) > 500) continue;
      if (LAKES.some((lake) => Math.hypot(x - lake.x, z - lake.z) < lake.r + 6)) continue;
      const y = terrainHeight(x, z);
      const s = 0.8 + Math.random() * 1.6;
      dummy.position.set(x, y + 0.8 * s, z);
      dummy.scale.setScalar(s);
      dummy.rotation.set(0, Math.random() * 6, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(n, dummy.matrix);
      dummy.position.y = y + 2.3 * s;
      dummy.updateMatrix();
      crowns.setMatrixAt(n, dummy.matrix);
      color.setHex(0x3e7a3a).offsetHSL((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.08);
      crowns.setColorAt(n, color);
      n += 1;
    }
    trunks.count = n;
    crowns.count = n;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    return { trunks, crowns };
  }

  private paintTrees(heat: number) {
    const bucket = Math.round(heat * 16);
    if (bucket === this.heatBucket) return;
    this.heatBucket = bucket;
    const color = new THREE.Color();
    const attr = this.crowns.instanceColor;
    if (!attr) return;
    for (let i = 0; i < this.crowns.count; i++) {
      if (heat < 0.35) color.setHex(0x3e7a3a);
      else if (heat < 0.62) color.setHex(0x8a7a3a);
      else if (heat < 0.82) color.setHex(0x6a5644);
      else color.setHex(0x3a2a24);
      attr.setXYZ(i, color.r, color.g, color.b);
    }
    attr.needsUpdate = true;
  }

  private makeMountains() {
    const geo = new THREE.ConeGeometry(28, 70, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6d7a72, roughness: 0.95 });
    const mesh = new THREE.InstancedMesh(geo, mat, 32);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const r = 640 + (i % 3) * 18;
      dummy.position.set(Math.cos(a) * r, terrainHeight(Math.cos(a) * r, Math.sin(a) * r) + 18, Math.sin(a) * r);
      dummy.scale.set(0.7 + (i % 4) * 0.25, 0.8 + (i % 5) * 0.2, 0.7 + (i % 4) * 0.25);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    return mesh;
  }

  private makeGroveMark() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8f542, emissive: 0xc8f542, emissiveIntensity: 0.4, roughness: 0.6 });
    const y = terrainHeight(GROVE.x, GROVE.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(GROVE.r * 0.55, 0.25, 6, 28), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(GROVE.x, y + 0.7, GROVE.z);
    g.add(ring);
    const light = new THREE.PointLight(0xc8f542, 8, 40, 2);
    light.position.set(GROVE.x, y + 6, GROVE.z);
    g.add(light);
    return g;
  }

  private exhaust(sim: Sim) {
    const moving = Math.abs(sim.speed) > 1 || sim.mode === "menu" || sim.mode === "trailer";
    if (!moving) return;
    const f = { x: -Math.sin(sim.yaw), z: -Math.cos(sim.yaw) };
    this.puff(sim.x - f.x * 4, terrainHeight(sim.x, sim.z) + 8, sim.z - f.z * 4, sim.heat > 60 ? 0xff8a4a : 0xd5ddd0, 2);
  }

  private burst(x: number, y: number, z: number, n: number) {
    for (let i = 0; i < n; i++) this.puff(x, y, z, i % 2 ? 0xc8f542 : 0xe2834a, 1);
  }

  private puff(x: number, y: number, z: number, _color: number, count: number) {
    for (let k = 0; k < count; k++) {
      const p = this.parts.find((q) => q.life <= 0);
      if (!p) return;
      p.x = x + (Math.random() - 0.5) * 2;
      p.y = y;
      p.z = z + (Math.random() - 0.5) * 2;
      p.vx = (Math.random() - 0.5) * 6;
      p.vy = 2 + Math.random() * 6;
      p.vz = (Math.random() - 0.5) * 6;
      p.life = 0.8 + Math.random() * 0.6;
      p.max = p.life;
    }
  }

  private stepParts(dt: number) {
    const attr = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]!;
      if (p.life <= 0) {
        attr.setXYZ(i, 0, -99, 0);
        continue;
      }
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= dt * 2;
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
  }
}
