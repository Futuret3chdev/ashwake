import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
  private parts: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; cr: number; cg: number; cb: number }[] = [];
  private camPos = new THREE.Vector3(140, 28, 40);
  private lookPos = new THREE.Vector3(96, 6, -36);
  private desired = new THREE.Vector3();
  private look = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private orbit = 0.2;
  private clock = 0;
  private disposed = false;
  private heatBucket = -1;
  private fogCool = new THREE.Color(0xc8bfa8);
  private fogHot = new THREE.Color(0x4a241c);
  private palette = new Map<string, THREE.MeshStandardMaterial>();
  private _facade: THREE.CanvasTexture | null = null;
  private _tread: THREE.CanvasTexture | null = null;
  private _photos = new Map<string, THREE.Texture>();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x0e1411, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.42;
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.4, 1600);

    this.fog = new THREE.FogExp2(0xc8bfa8, 0.0055);
    this.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xd7ecff, 0x6a8a3a, 1.45);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d0, 2.35);
    this.sun.position.set(-90, 64, 36);
    this.scene.add(this.sun);
    const fill = new THREE.DirectionalLight(0x8ea4b8, 0.42);
    fill.position.set(70, 30, -80);
    this.scene.add(fill);

    this.skyMat = new THREE.ShaderMaterial({
      toneMapped: false,
      side: THREE.BackSide,
      uniforms: {
        uHeat: { value: 0.12 },
        uTime: { value: 0 },
        uSun: { value: new THREE.Vector3(-0.55, 0.42, 0.22).normalize() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vDir = position; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        uniform float uHeat; uniform float uTime; uniform vec3 uSun; varying vec3 vDir;
        void main(){
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 zenG = vec3(0.36, 0.52, 0.72);
          vec3 horG = vec3(0.93, 0.78, 0.55);
          vec3 zenA = vec3(0.10, 0.06, 0.07);
          vec3 horA = vec3(0.72, 0.28, 0.12);
          vec3 zen = mix(zenG, zenA, uHeat);
          vec3 hor = mix(horG, horA, uHeat);
          vec3 col = mix(hor, zen, smoothstep(0.0, 0.42, h));
          float bands = sin(dir.x * 7.0 + dir.z * 3.0 + uTime * 0.05) * sin(dir.z * 5.0 - dir.y * 2.0);
          float cloud = smoothstep(0.15, 0.85, bands * 0.5 + 0.5) * smoothstep(0.02, 0.35, h) * (1.0 - h);
          vec3 cloudCol = mix(vec3(0.96, 0.93, 0.86), vec3(0.28, 0.16, 0.14), uHeat);
          col = mix(col, cloudCol, cloud * 0.55);
          float sun = pow(max(dot(dir, uSun), 0.0), 180.0);
          float glow = pow(max(dot(dir, uSun), 0.0), 8.0);
          col += vec3(1.0, 0.78, 0.42) * sun;
          col += vec3(1.0, 0.62, 0.32) * glow * 0.28 * (1.0 - uHeat * 0.4);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), this.skyMat);
    this.scene.add(sky);

    this.groundMat = new THREE.ShaderMaterial({
      uniforms: { uHeat: { value: 0.12 }, uTime: { value: 0 }, uSun: { value: new THREE.Vector3(-0.55, 0.42, 0.22).normalize() } },
      vertexShader: `
        ${TERRAIN}
        varying vec3 vPos; varying vec3 vN; varying float vH;
        void main(){
          vec3 p = position;
          float h = ashHeight(p.xz);
          float e = 3.0;
          float hx = ashHeight(p.xz + vec2(e, 0.0));
          float hz = ashHeight(p.xz + vec2(0.0, e));
          p.y += h;
          vPos = p; vH = h;
          vN = normalize(vec3(h - hx, e, h - hz));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float uHeat; uniform float uTime; uniform vec3 uSun;
        varying vec3 vPos; varying vec3 vN; varying float vH;
        void main(){
          float n = sin(vPos.x * 0.07) * sin(vPos.z * 0.06);
          float patch = sin(vPos.x * 0.021 + 2.0) * cos(vPos.z * 0.018);
          vec3 grass = vec3(0.45, 0.68, 0.24);
          vec3 lawn = vec3(0.62, 0.74, 0.28);
          vec3 dirt = vec3(0.62, 0.46, 0.26);
          vec3 ash = vec3(0.42, 0.36, 0.30);
          vec3 magma = vec3(0.55, 0.16, 0.06);
          float heat = uHeat;
          vec3 col = mix(grass, lawn, smoothstep(-0.2, 0.8, patch));
          col = mix(col, dirt, smoothstep(4.0, 9.0, vH) * 0.55);
          col = mix(col, ash, smoothstep(0.45, 0.8, heat));
          col = mix(col, magma, smoothstep(0.75, 1.0, heat));
          float lit = clamp(dot(normalize(vN), uSun), 0.0, 1.0);
          col *= 0.62 + lit * 0.7;
          col += vec3(0.02, 0.03, 0.01) * n * (1.0 - heat);
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
    this.scene.add(this.makeRuts());
    this.scene.add(this.makeGroveMark());

    const stormGeo = new THREE.BoxGeometry(22, 70, 1200);
    const stormMat = new THREE.MeshBasicMaterial({ color: 0xc47a48, transparent: true, opacity: 0.14, depthWrite: false });
    this.storm = new THREE.Mesh(stormGeo, stormMat);
    this.storm.position.y = 28;
    this.scene.add(this.storm);

    this.player = this.buildCity("player");
    this.scene.add(this.player);

    const pgeo = new THREE.BufferGeometry();
    const positions = new Float32Array(520 * 3);
    const colors = new Float32Array(520 * 3);
    pgeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pgeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.points = new THREE.Points(
      pgeo,
      new THREE.PointsMaterial({ vertexColors: true, size: 0.85, transparent: true, opacity: 0.72, depthWrite: false }),
    );
    this.scene.add(this.points);
    for (let i = 0; i < 520; i++) this.parts.push({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, cr: 1, cg: 1, cb: 1 });

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
    this.skyMat.uniforms.uTime!.value = this.clock;
    this.waterMat.uniforms.uTime!.value = this.clock;
    this.fog.color.copy(this.fogCool).lerp(this.fogHot, heat);
    this.fog.density = 0.0024 + heat * 0.008 + (sim.inStorm ? 0.014 : 0);
    this.hemi.color.setHex(heat < 0.55 ? 0xd8d2c4 : 0xc48a62);
    this.hemi.groundColor.setHex(heat < 0.55 ? 0x6a5340 : 0x3a2218);
    this.sun.intensity = 1.5 - heat * 0.55;
    this.sun.color.setHex(heat < 0.6 ? 0xfff1d2 : 0xffb088);
    const stormMat = this.storm.material as THREE.MeshBasicMaterial;
    stormMat.opacity = sim.heat > 24 ? 0.08 + (sim.inStorm ? 0.16 : 0.05) : 0.02;
    this.storm.rotation.y = -sim.stormAng;
    this.paintTrees(heat);

    const py = terrainHeight(sim.x, sim.z);
    const grown = 1 + Math.min(0.55, sim.cities * 0.08 + sim.rivalsDown * 0.06);
    this.player.position.set(sim.x, py, sim.z);
    this.player.rotation.y = sim.yaw;
    this.player.scale.setScalar(grown);
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
      if (e.id === sim.latchId && (e.kind === "prey" || e.kind === "rival")) {
        const fx = -Math.sin(sim.yaw);
        const fz = -Math.cos(sim.yaw);
        const t = Math.min(1, sim.latch);
        slot.mesh.position.x = e.x + (sim.x + fx * 8.4 * grown - e.x) * t * 0.94;
        slot.mesh.position.z = e.z + (sim.z + fz * 8.4 * grown - e.z) * t * 0.94;
        const base = (slot.mesh.userData.baseScale as number) || 1;
        slot.mesh.scale.setScalar(base * (1 - t * 0.72));
      } else if (e.kind === "prey" || e.kind === "rival") {
        const base = (slot.mesh.userData.baseScale as number) || 1;
        slot.mesh.scale.setScalar(base);
      }
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
      this.orbit += dt * 0.1;
      this.desired.set(sim.x + Math.sin(this.orbit) * 32, y + 6.2, sim.z + Math.cos(this.orbit) * 32);
      this.look.set(sim.x, y + 6.4, sim.z);
    } else if (sim.mode === "trailer") {
      const t = sim.trailerT;
      if (t < 6) {
        this.desired.set(sim.x - fx * 16 + rx * 28, y + 7, sim.z - fz * 16 + rz * 28);
        this.look.set(sim.x + fx * 12, y + 8, sim.z + fz * 12);
      } else if (t < 13) {
        this.desired.set(sim.x - fx * 28 - rx * 8, y + 6.5, sim.z - fz * 28 - rz * 8);
        this.look.set(sim.x + fx * 14, y + 6, sim.z + fz * 14);
      } else if (t < 18) {
        this.desired.set(sim.x - fx * 18 + rx * 8, y + 5.5, sim.z - fz * 18 + rz * 8);
        this.look.set(sim.x + fx * 10, y + 5, sim.z + fz * 10);
      } else {
        const k = (t - 18) / 8;
        this.desired.set(sim.x - fx * (24 + k * 30) + rx * 18, y + 8 + k * 16, sim.z - fz * (24 + k * 30) + rz * 18);
        this.look.set(sim.x, y + 8, sim.z);
      }
    } else {
      const back = 30;
      this.desired.set(sim.x - fx * back + rx * 12, y + 16, sim.z - fz * back + rz * 12);
      this.look.set(sim.x + fx * 4, y + 4.2, sim.z + fz * 4);
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
    const fov = 48 + Math.min(7, Math.abs(sim.speed) * 0.14);
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
    const town = kind === "prey";
    const rival = kind === "rival";
    const scale = rival ? 1.16 : town ? 0.62 : 1;
    const accentHex = kind === "player" ? 0xc6ef4a : town ? 0x7ec8c3 : 0xff5a3c;
    const wood = this.mat("wood-" + kind, town ? 0xd7b07a : 0xc4925a, { roughness: 0.82, metalness: 0.04 });
    const stone = this.mat("keep-" + kind, town ? 0xf3e6c8 : rival ? 0xe7d3c4 : 0xf4ead4, { roughness: 0.72, metalness: 0.02 });
    const roof = this.mat("roof-" + kind, town ? 0xd07a4a : rival ? 0xa33a32 : 0xc44732, { roughness: 0.66, metalness: 0.05 });
    const track = this.mat("track-" + kind, 0x4a3b32, { roughness: 0.78, metalness: 0.18 });
    const cleat = this.mat("cleat-" + kind, 0x6e5848, { roughness: 0.7, metalness: 0.22 });
    const tooth = this.mat("tooth", 0xf7f1e4, { roughness: 0.45, metalness: 0.08 });
    const lip = this.mat("lip-" + kind, rival ? 0x8d2e28 : 0xa34432, { roughness: 0.55, metalness: 0.12 });
    const glow = this.mat("glow-" + kind, 0xffd27a, { emissive: 0xffc14a, emissiveIntensity: 0.9, roughness: 0.4 });
    const accent = this.mat("accent-" + kind, accentHex, { emissive: accentHex, emissiveIntensity: 0.7, roughness: 0.4 });

    const hull: THREE.BufferGeometry[] = [];
    const walls: THREE.BufferGeometry[] = [];
    const roofs: THREE.BufferGeometry[] = [];
    const lights: THREE.BufferGeometry[] = [];
    const marks: THREE.BufferGeometry[] = [];
    const put = (
      list: THREE.BufferGeometry[],
      geo: THREE.BufferGeometry,
      x: number,
      y: number,
      z: number,
      sx = 1,
      sy = 1,
      sz = 1,
      ry = 0,
    ) => {
      geo.applyMatrix4(
        new THREE.Matrix4().compose(
          new THREE.Vector3(x, y, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
          new THREE.Vector3(sx, sy, sz),
        ),
      );
      list.push(geo);
    };

    put(hull, new THREE.BoxGeometry(8.2, 1.15, 13.6), 0, 2.55, 0.2);
    put(hull, new THREE.BoxGeometry(7.2, 0.35, 12.2), 0, 3.25, 0.35);
    put(hull, new THREE.BoxGeometry(6.4, 0.28, 9.4), 0, 3.5, 0.8);

    const houses: number[][] = town
      ? [
          [0, 0.4, 1.7, 1.35, 1.5],
          [-1.7, 1.8, 1.15, 1.05, 1.05],
          [1.6, 1.7, 1.1, 1.15, 1.0],
        ]
      : [
          [-2.15, -1.5, 1.7, 1.7, 1.45],
          [2.05, -0.9, 1.55, 1.9, 1.35],
          [-1.7, 1.35, 1.45, 1.55, 1.25],
          [1.85, 1.7, 1.35, 1.65, 1.2],
          [0.1, 3.55, 1.8, 1.45, 1.5],
          [-2.35, 3.5, 1.2, 1.25, 1.1],
          [2.4, 3.7, 1.15, 1.35, 1.05],
          [0, -2.6, 1.5, 1.15, 1.2],
        ];
    for (const [x, z, w, h, d] of houses) {
      const base = 3.62;
      put(walls, new THREE.BoxGeometry(w!, h!, d!), x!, base + h! / 2, z!);
      const cap = new THREE.ConeGeometry(Math.max(w!, d!) * 0.62, h! * 0.55, 4);
      cap.rotateY(Math.PI / 4);
      put(roofs, cap, x!, base + h! + h! * 0.22, z!);
      put(lights, new THREE.BoxGeometry(w! * 0.22, h! * 0.22, 0.08), x! - w! * 0.18, base + h! * 0.55, z! - d! * 0.5 - 0.02);
      put(lights, new THREE.BoxGeometry(w! * 0.22, h! * 0.22, 0.08), x! + w! * 0.18, base + h! * 0.55, z! - d! * 0.5 - 0.02);
    }

    if (!town) {
      put(walls, new THREE.CylinderGeometry(1.15, 1.35, 2.4, 10), 0, 6.5, 0.6);
      put(roofs, new THREE.ConeGeometry(1.7, 1.8, 10), 0, 8.4, 0.6);
      put(marks, new THREE.BoxGeometry(0.7, 0.9, 0.08), 0, 6.4, -0.7);
      put(hull, new THREE.CylinderGeometry(0.16, 0.22, 1.6, 6), -2.2, 6.6, 2.4);
      put(hull, new THREE.CylinderGeometry(0.16, 0.22, 1.9, 6), 2.1, 6.8, 3.1);
    } else {
      put(roofs, new THREE.ConeGeometry(0.7, 0.9, 8), 0, 5.5, 0.4);
    }

    const bake = (parts: THREE.BufferGeometry[], material: THREE.Material) => {
      if (!parts.length) return;
      const merged = mergeGeometries(parts, false);
      parts.forEach((p) => p.dispose());
      if (!merged) return;
      g.add(new THREE.Mesh(merged, material));
    };
    bake(hull, wood);
    bake(walls, stone);
    bake(roofs, roof);
    bake(lights, glow);
    bake(marks, accent);

    const mouthY = town ? 2.15 : 2.35;
    const mouthZ = town ? -6.15 : -6.7;
    const mouthR = town ? 1.15 : 1.7;
    const lipMesh = new THREE.Mesh(new THREE.TorusGeometry(mouthR, town ? 0.22 : 0.32, 8, 18), lip);
    lipMesh.position.set(0, mouthY, mouthZ);
    g.add(lipMesh);
    const throat = new THREE.Mesh(
      new THREE.CircleGeometry(mouthR * 0.82, 16),
      this.mat("throat", 0x1a1210, { roughness: 1, side: THREE.DoubleSide }),
    );
    throat.position.set(0, mouthY, mouthZ + 0.05);
    g.add(throat);

    const jawL = new THREE.Group();
    const jawR = new THREE.Group();
    jawL.position.set(0, mouthY, mouthZ);
    jawR.position.set(0, mouthY, mouthZ);
    const toothGeo = new THREE.ConeGeometry(town ? 0.12 : 0.16, town ? 0.42 : 0.58, 5);
    const count = town ? 5 : 7;
    for (let i = 0; i < count; i++) {
      const a = -0.7 + (1.4 * i) / (count - 1);
      const upper = new THREE.Mesh(toothGeo, tooth);
      upper.position.set(Math.sin(a) * mouthR * 0.92, Math.cos(a) * mouthR * 0.55 + 0.15, -0.15);
      upper.rotation.z = -a;
      upper.rotation.x = Math.PI;
      jawL.add(upper);
      const lower = new THREE.Mesh(toothGeo, tooth);
      lower.position.set(Math.sin(a) * mouthR * 0.92, -Math.cos(a) * mouthR * 0.45 - 0.05, -0.15);
      lower.rotation.z = a;
      jawR.add(lower);
    }
    g.add(jawL, jawR);

    const wheelGeo = new THREE.CylinderGeometry(town ? 0.55 : 0.72, town ? 0.55 : 0.72, 1.15, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheels: THREE.Object3D[] = [];
    const span = town ? 8.2 : 12.4;
    const cleatParts: THREE.BufferGeometry[] = [];
    for (const x of [town ? -4.35 : -5.15, town ? 4.35 : 5.15]) {
      const belt = new THREE.Mesh(new THREE.BoxGeometry(1.35, town ? 1.55 : 1.85, span), track);
      belt.position.set(x, town ? 1.15 : 1.25, 0.15);
      g.add(belt);
      const nCleat = town ? 8 : 11;
      for (let i = 0; i < nCleat; i++) {
        const z = -span / 2 + 0.4 + (i * (span - 0.6)) / (nCleat - 1);
        put(cleatParts, new THREE.BoxGeometry(1.7, 0.22, 0.42), x, 0.32, z);
      }
      const rollers = town ? [-2.8, 2.8] : [-4.6, -1.5, 1.6, 4.7];
      for (const z of rollers) {
        const w = new THREE.Mesh(wheelGeo, track);
        w.position.set(x, town ? 1.05 : 1.15, z);
        g.add(w);
        wheels.push(w);
      }
    }
    bake(cleatParts, cleat);

    const shade = new THREE.Mesh(
      new THREE.CircleGeometry(town ? 4.6 : 6.6, 24),
      new THREE.MeshBasicMaterial({ color: 0x1c2414, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    shade.rotation.x = -Math.PI / 2;
    shade.position.y = 0.05;
    g.add(shade);

    g.scale.setScalar(scale);
    g.userData.baseScale = scale;
    g.userData.rig = { jawL, jawR, wheels, spin: 0 } satisfies CityRig;
    return g;
  }

  private poseCity(mesh: THREE.Object3D, open: number, speed: number, dt: number, rig?: CityRig) {
    const r = rig ?? (mesh.userData.rig as CityRig | undefined);
    if (!r) return;
    const gap = open * 0.9;
    r.jawL.rotation.x += (-gap - r.jawL.rotation.x) * 0.18;
    r.jawR.rotation.x += (gap * 0.55 - r.jawR.rotation.x) * 0.18;
    r.spin += speed * dt * 0.35;
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

  private mat(key: string, color: number, extra: THREE.MeshStandardMaterialParameters = {}) {
    let m = this.palette.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, ...extra });
      this.palette.set(key, m);
    }
    return m;
  }

  private photo(key: string, url: string, repeatX = 1, repeatY = 1) {
    let tex = this._photos.get(key);
    if (!tex) {
      tex = new THREE.TextureLoader().load(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      tex.repeat.set(repeatX, repeatY);
      this._photos.set(key, tex);
    }
    return tex;
  }

  private facadeTex() {
    if (this._facade) return this._facade;
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#6d6256";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#3e352e";
    for (let y = 0; y < 128; y += 8) g.fillRect(0, y, 128, 1);
    for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 1, 128);
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 4; col++) {
        const n = row * 4 + col;
        const lit = n % 5 === 0 || n % 7 === 0;
        g.fillStyle = !lit ? "#14110e" : n % 2 === 0 ? "#ffb15a" : "#d7f06a";
        g.fillRect(8 + col * 30, 8 + row * 20, 14, 9);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this._facade = tex;
    return tex;
  }

  private treadTex() {
    if (this._tread) return this._tread;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#14110f";
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#3d342c";
    for (let i = 0; i < 8; i++) g.fillRect(i * 8, 0, 3, 64);
    g.fillStyle = "#6a4a34";
    g.fillRect(0, 3, 64, 4);
    g.fillRect(0, 57, 64, 4);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    this._tread = tex;
    return tex;
  }

  private makeForest() {
    const count = 260;
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.6, 5);
    const crownGeo = new THREE.IcosahedronGeometry(1.35, 1);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4e32, roughness: 0.9 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x3f9a3a, roughness: 0.75 });
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
      dummy.position.y = y + 2.05 * s;
      dummy.updateMatrix();
      crowns.setMatrixAt(n, dummy.matrix);
      color.setHex(0x3e9a34).offsetHSL((Math.random() - 0.5) * 0.06, 0.05, (Math.random() - 0.5) * 0.08);
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
      if (heat < 0.35) color.setHex(0x3e9a34);
      else if (heat < 0.62) color.setHex(0x8a7a3a);
      else if (heat < 0.82) color.setHex(0x6a5644);
      else color.setHex(0x3a2a24);
      attr.setXYZ(i, color.r, color.g, color.b);
    }
    attr.needsUpdate = true;
  }

  private makeMountains() {
    const geo = new THREE.ConeGeometry(46, 28, 5);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d8478, roughness: 0.96 });
    const mesh = new THREE.InstancedMesh(geo, mat, 28);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + (i % 3) * 0.04;
      const r = 700 + (i % 4) * 22;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      dummy.position.set(x, terrainHeight(x, z) + 6, z);
      dummy.scale.set(1.1 + (i % 3) * 0.35, 0.7 + (i % 5) * 0.22, 1.2 + (i % 4) * 0.2);
      dummy.rotation.y = a;
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    return mesh;
  }

  private makeRuts() {
    const geo = new THREE.BoxGeometry(1.4, 0.12, 22);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 1 });
    const mesh = new THREE.InstancedMesh(geo, mat, 40);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() - 0.5) * 900;
      const z = (Math.random() - 0.5) * 900;
      dummy.position.set(x, terrainHeight(x, z) + 0.04, z);
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.scale.set(0.5 + Math.random() * 0.8, 1, 0.7 + Math.random() * 1.6);
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
    const y = terrainHeight(sim.x, sim.z);
    this.puff(sim.x - f.x * 1.5, y + 12, sim.z - f.z * 1.5, 0x2a2622, 2);
    if (Math.abs(sim.speed) > 2 || sim.mode === "menu") {
      const rx = Math.cos(sim.yaw);
      const rz = -Math.sin(sim.yaw);
      this.puff(sim.x + rx * 5.2 - f.x * 2, y + 0.5, sim.z + rz * 5.2 - f.z * 2, 0xc4ae86, 1);
      this.puff(sim.x - rx * 5.2 - f.x * 2, y + 0.5, sim.z - rz * 5.2 - f.z * 2, 0xc4ae86, 1);
    }
  }

  private burst(x: number, y: number, z: number, n: number) {
    for (let i = 0; i < n; i++) this.puff(x, y, z, i % 2 ? 0xc8f542 : 0xff7a32, 1);
  }

  private puff(x: number, y: number, z: number, color: number, count: number) {
    const cr = ((color >> 16) & 255) / 255;
    const cg = ((color >> 8) & 255) / 255;
    const cb = (color & 255) / 255;
    for (let k = 0; k < count; k++) {
      const p = this.parts.find((q) => q.life <= 0);
      if (!p) return;
      p.x = x + (Math.random() - 0.5) * 2;
      p.y = y;
      p.z = z + (Math.random() - 0.5) * 2;
      p.vx = (Math.random() - 0.5) * 4;
      p.vy = 1.5 + Math.random() * 4;
      p.vz = (Math.random() - 0.5) * 4;
      p.life = 0.9 + Math.random() * 0.8;
      p.max = p.life;
      p.cr = cr;
      p.cg = cg;
      p.cb = cb;
    }
  }

  private stepParts(dt: number) {
    const attr = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.points.geometry.getAttribute("color") as THREE.BufferAttribute;
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
      p.vy += dt * 1.4;
      attr.setXYZ(i, p.x, p.y, p.z);
      col.setXYZ(i, p.cr, p.cg, p.cb);
    }
    attr.needsUpdate = true;
    col.needsUpdate = true;
  }
}
