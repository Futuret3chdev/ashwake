import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
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
  private groundMat: THREE.MeshStandardMaterial;
  private groundHeat = { value: 0.12 };
  private composer: EffectComposer | null = null;
  private wallMap!: THREE.CanvasTexture;
  private glowMap!: THREE.CanvasTexture;
  private plateMap!: THREE.CanvasTexture;
  private treadMap!: THREE.CanvasTexture;
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
    this.renderer.toneMappingExposure = 1.28;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.paintSurfaces();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.4, 1600);

    this.fog = new THREE.FogExp2(0xc8bfa8, 0.0055);
    this.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xd7ecff, 0x6a8a3a, 0.72);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d0, 2.8);
    this.sun.position.set(-40, 70, 28);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 8;
    this.sun.shadow.camera.far = 160;
    this.sun.shadow.camera.left = -46;
    this.sun.shadow.camera.right = 46;
    this.sun.shadow.camera.top = 46;
    this.sun.shadow.camera.bottom = -46;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight(0x8ea4b8, 0.55);
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

    const grass = this.grassTex();
    this.groundMat = new THREE.MeshStandardMaterial({
      map: grass,
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0.02,
    });
    this.groundMat.onBeforeCompile = (shader) => {
      shader.uniforms.uHeat = this.groundHeat;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          float ashH(vec2 p){
            return sin(p.x * 0.02) * 7.0 + cos(p.y * 0.016) * 5.0 + sin((p.x + p.y) * 0.007) * 4.5 + sin(p.x * 0.041 + p.y * 0.03) * 1.2;
          }`,
        )
        .replace(
          "#include <beginnormal_vertex>",
          `#include <beginnormal_vertex>
          float e = 3.0;
          vec2 xz = vec2(position.x, position.z);
          float h0 = ashH(xz);
          objectNormal = normalize(vec3(h0 - ashH(xz + vec2(e, 0.0)), e, h0 - ashH(xz + vec2(0.0, e))));`,
        )
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n transformed.y += ashH(vec2(position.x, position.z));`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\n uniform float uHeat;")
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.46, 0.32), smoothstep(0.35, 0.7, uHeat));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.16, 0.08), smoothstep(0.72, 1.0, uHeat));`,
        );
    };
    const groundGeo = new THREE.PlaneGeometry(1700, 1700, 140, 140);
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(groundGeo, this.groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);

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

    this.player = this.buildCity("player", 0);
    this.dressTown(this.player);
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
    const fine = typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches;
    if (fine) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.18, 0.4, 0.88));
      this.composer.addPass(new OutputPass());
    }
  }

  resize(w: number, h: number, dpr: number) {
    if (this.disposed || w < 2 || h < 2) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(dpr, w < 900 ? 1.25 : 1.5));
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
  }

  sync(sim: Sim, dt: number) {
    this.clock += dt;
    const heat = sim.heat / 100;
    this.groundHeat.value = heat;
    this.skyMat.uniforms.uHeat!.value = heat;
    this.skyMat.uniforms.uTime!.value = this.clock;
    this.waterMat.uniforms.uTime!.value = this.clock;
    this.fog.color.copy(this.fogCool).lerp(this.fogHot, heat);
    this.fog.density = 0.0024 + heat * 0.008 + (sim.inStorm ? 0.014 : 0);
    this.hemi.color.setHex(heat < 0.55 ? 0xd8d2c4 : 0xc48a62);
    this.hemi.groundColor.setHex(heat < 0.55 ? 0x6a5340 : 0x3a2218);
    this.sun.intensity = 2.5 - heat * 0.7;
    this.sun.color.setHex(heat < 0.6 ? 0xfff1d2 : 0xffb088);
    const stormMat = this.storm.material as THREE.MeshBasicMaterial;
    stormMat.opacity = sim.heat > 24 ? 0.08 + (sim.inStorm ? 0.16 : 0.05) : 0.02;
    this.storm.rotation.y = -sim.stormAng;
    this.paintTrees(heat);

    const py = terrainHeight(sim.x, sim.z);
    this.sun.position.set(sim.x - 36, py + 62, sim.z + 22);
    this.sun.target.position.set(sim.x, py, sim.z);
    const grown = 1 + Math.min(0.55, sim.cities * 0.08 + sim.rivalsDown * 0.06);
    this.player.position.set(sim.x, py, sim.z);
    this.player.rotation.y = sim.yaw;
    this.player.scale.setScalar(grown);
    this.poseCity(this.player, sim.jawAmt, sim.mode === "menu" ? 8 : sim.speed, dt);
    const district = this.player.userData.district as THREE.Group | undefined;
    if (district) {
      const open = sim.townOpen;
      district.scale.set(0.45 + open * 0.7, 0.05 + open * 0.95, 0.45 + open * 0.7);
      district.position.y = (open - 1) * 2.4;
    }
    const slots = this.player.userData.slots as { kind: string; mesh: THREE.Object3D }[][] | undefined;
    if (slots) {
      const kinds = ["banner", "lamp", "turret", "shield"];
      for (let i = 0; i < slots.length; i++) {
        const on = sim.decor[i];
        for (const piece of slots[i]!) piece.mesh.visible = piece.kind === on;
      }
    }

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
    if (this.disposed) return;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
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
    } else if (sim.eye && (sim.mode === "play" || sim.mode === "paused")) {
      const px = sim.x + rx * sim.walkX + fx * sim.walkZ;
      const pz = sim.z + rz * sim.walkX + fz * sim.walkZ;
      const eyeY = y + (sim.form === "town" ? 6.6 : 5.2);
      this.desired.set(px - fx * 0.35, eyeY, pz - fz * 0.35);
      this.look.set(px + fx * 14, eyeY - 0.15, pz + fz * 14);
    } else if (sim.townOpen > 0.35 && sim.mode === "play") {
      this.desired.set(sim.x - fx * 24 + rx * 18, y + 20, sim.z - fz * 24 + rz * 18);
      this.look.set(sim.x, y + 3.5, sim.z);
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
    const fov = sim.eye ? 68 : 48 + Math.min(7, Math.abs(sim.speed) * 0.14);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private meshFor(e: Ent) {
    if (e.kind === "prey") return this.buildCity("prey", e.id);
    if (e.kind === "rival") return this.buildCity("rival", e.id);
    if (e.kind === "beast") return this.buildBeast();
    if (e.kind === "fissure") return this.buildFissure();
    return this.buildOrb();
  }

  private specFor(kind: "player" | "prey" | "rival", id: number) {
    const prey = [
      { key: "market", scale: 0.62, iron: 0xc4a06a, plate: 0xe7c48a, bronze: 0xb07a45, glow: 0x7ec8c3, len: 11, beam: 7.4, crown: "masts" as const, jaw: "gate" as const, stacks: 1, tiers: [{ w: 6.2, h: 1.15, d: 6.4, y: 3.35, z: 0.4 }] },
      { key: "brine", scale: 0.66, iron: 0xb7c4c8, plate: 0xd5e4ea, bronze: 0x8aa8b0, glow: 0x7ee0d0, len: 12.5, beam: 5.6, crown: "dome" as const, jaw: "gate" as const, stacks: 1, tiers: [{ w: 4.4, h: 1.3, d: 5.2, y: 3.35, z: 0.8 }] },
      { key: "cinder", scale: 0.7, iron: 0x4a382f, plate: 0x6a4a38, bronze: 0xa85a32, glow: 0xff6a22, len: 11.5, beam: 6.4, crown: "kiln" as const, jaw: "kiln" as const, stacks: 4, tiers: [{ w: 5.2, h: 1.5, d: 5.6, y: 3.35, z: 0.6 }] },
      { key: "moss", scale: 0.64, iron: 0x6d8a62, plate: 0x8eaa78, bronze: 0xc4a15a, glow: 0xd6ef6a, len: 13, beam: 5.2, crown: "dome" as const, jaw: "gate" as const, stacks: 2, tiers: [{ w: 4.2, h: 1.05, d: 7.2, y: 3.3, z: 0.5 }] },
      { key: "kiln", scale: 0.68, iron: 0x8a5a3c, plate: 0xc47a48, bronze: 0xd4894a, glow: 0xffa040, len: 10, beam: 6.8, crown: "kiln" as const, jaw: "kiln" as const, stacks: 2, tiers: [{ w: 5.4, h: 1.2, d: 4.4, y: 3.3, z: 0.2 }] },
      { key: "orchard", scale: 0.6, iron: 0xe4d2b4, plate: 0xf3e6cc, bronze: 0xc4a574, glow: 0xffe08a, len: 12, beam: 5.4, crown: "masts" as const, jaw: "gate" as const, stacks: 0, tiers: [{ w: 4.6, h: 1.25, d: 6.2, y: 3.3, z: 0.6 }] },
      { key: "pebble", scale: 0.52, iron: 0x9a8b78, plate: 0xd8cbb6, bronze: 0xa89078, glow: 0xffd27a, len: 9, beam: 5.2, crown: "dome" as const, jaw: "gate" as const, stacks: 1, tiers: [{ w: 3.6, h: 1.4, d: 3.6, y: 3.3, z: 0.2 }] },
    ];
    const rivals = [
      { key: "mother", scale: 1.22, iron: 0x5a463c, plate: 0x7a6254, bronze: 0xc47a42, glow: 0xff4a32, len: 16.5, beam: 8.4, crown: "wolf" as const, jaw: "wolf" as const, stacks: 4, tiers: [{ w: 6.8, h: 2.1, d: 8.4, y: 3.45, z: 1.1 }, { w: 5.1, h: 1.8, d: 5.6, y: 5.55, z: 1.5 }, { w: 3.4, h: 1.6, d: 3.6, y: 7.35, z: 1.7 }] },
      { key: "haldred", scale: 1.08, iron: 0x6e5c48, plate: 0x8d7860, bronze: 0xd8a05a, glow: 0xffe08a, len: 18, beam: 5.8, crown: "hawk" as const, jaw: "beak" as const, stacks: 2, tiers: [{ w: 4.6, h: 1.15, d: 9.2, y: 3.35, z: 1.4 }, { w: 3.2, h: 1.05, d: 5.4, y: 4.5, z: 2.2 }] },
      { key: "saint", scale: 1.12, iron: 0x3c3834, plate: 0x5c564e, bronze: 0x8a7048, glow: 0xf2e2a8, len: 13, beam: 6.2, crown: "spire" as const, jaw: "gate" as const, stacks: 0, tiers: [{ w: 4.4, h: 2.4, d: 5.2, y: 3.4, z: 0.8 }, { w: 2.6, h: 2.2, d: 2.8, y: 5.8, z: 0.9 }, { w: 1.5, h: 1.8, d: 1.6, y: 8.0, z: 0.9 }] },
    ];
    if (kind === "player") {
      return { key: "vantage", scale: 1, iron: 0x6b5344, plate: 0x8a705c, bronze: 0xc4844a, glow: 0xffb15a, len: 15.2, beam: 7.2, crown: "wolf" as const, jaw: "wolf" as const, stacks: 3, tiers: [{ w: 5.8, h: 1.9, d: 7.6, y: 3.45, z: 1.2 }, { w: 4.2, h: 1.7, d: 5.0, y: 5.35, z: 1.5 }, { w: 2.7, h: 1.45, d: 3.2, y: 7.05, z: 1.7 }] };
    }
    if (kind === "rival") return rivals[Math.abs(id) % rivals.length]!;
    return prey[Math.abs(id) % prey.length]!;
  }

  private buildCity(kind: "player" | "prey" | "rival", id = 0) {
    const spec = this.specFor(kind, id);
    const g = new THREE.Group();
    const iron = this.mat(spec.key + "-iron", spec.iron, { map: this.plateMap, roughness: 0.62, metalness: 0.48 });
    const plate = this.mat(spec.key + "-plate", spec.plate, {
      map: this.wallMap,
      emissive: spec.glow,
      emissiveMap: this.glowMap,
      emissiveIntensity: 1.15,
      roughness: 0.58,
      metalness: 0.18,
    });
    const bronze = this.mat(spec.key + "-bronze", spec.bronze, { map: this.plateMap, roughness: 0.38, metalness: 0.62 });
    const glow = this.mat(spec.key + "-glow", spec.glow, { emissive: spec.glow, emissiveIntensity: 1.1, roughness: 0.3 });
    const track = this.mat(spec.key + "-track", 0x8a8074, { map: this.treadMap, roughness: 0.72, metalness: 0.28 });
    const cleatMat = this.mat(spec.key + "-cleat", 0x6a5648, { roughness: 0.66, metalness: 0.28 });
    const tooth = this.mat("ivory", 0xf4eee4, { roughness: 0.42, metalness: 0.06 });
    const ironP: THREE.BufferGeometry[] = [];
    const plateP: THREE.BufferGeometry[] = [];
    const bronzeP: THREE.BufferGeometry[] = [];
    const glowP: THREE.BufferGeometry[] = [];
    const cleatP: THREE.BufferGeometry[] = [];
    const put = (list: THREE.BufferGeometry[], geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
      list.push(geo);
    };
    const box = (w: number, h: number, d: number) => this.tile(new THREE.BoxGeometry(w, h, d), Math.max(1, w / 2.4), Math.max(1, h / 1.8));

    put(ironP, box(spec.beam, 1.65, spec.len), 0, 2.2, 0.15);
    put(ironP, box(spec.beam - 0.7, 0.42, spec.len - 1.8), 0, 3.22, 0.25);
    const nose = box(spec.beam * 0.7, 1.05, 2.2);
    nose.applyMatrix4(new THREE.Matrix4().makeRotationX(0.42));
    put(ironP, nose, 0, 2.35, -spec.len * 0.46);

    for (const t of spec.tiers) {
      put(plateP, box(t.w, t.h, t.d), 0, t.y + t.h / 2, t.z);
      const cols = Math.max(3, Math.round(t.w));
      const rows = Math.max(2, Math.round(t.h));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if ((c + r) % 4 === 0) continue;
          const x = (c - (cols - 1) / 2) * ((t.w * 0.78) / cols);
          const y = t.y + 0.4 + (r * (t.h - 0.7)) / rows;
          put(glowP, new THREE.BoxGeometry(0.34, 0.48, 0.08), x, y, t.z - t.d / 2 - 0.05);
        }
      }
    }

    const deck = spec.tiers[0]!;
    for (let i = 0; i < spec.stacks; i++) {
      const x = (i - (spec.stacks - 1) / 2) * 1.25;
      const h = 1.6 + (i % 3) * 0.85;
      put(ironP, new THREE.CylinderGeometry(0.16, 0.26, h, 7), x, deck.y + deck.h + h / 2, spec.len * 0.26);
      put(glowP, new THREE.CylinderGeometry(0.09, 0.09, 0.14, 6), x, deck.y + deck.h + h, spec.len * 0.26);
    }

    const top = spec.tiers[spec.tiers.length - 1]!;
    const crownY = top.y + top.h;
    if (spec.crown === "spire") put(plateP, new THREE.ConeGeometry(Math.max(0.7, top.w * 0.38), 3.6, 6), 0, crownY + 1.8, top.z);
    if (spec.crown === "dome") {
      const dome = new THREE.SphereGeometry(Math.max(1.1, top.w * 0.38), 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      put(bronzeP, dome, 0, crownY, top.z);
    }
    if (spec.crown === "kiln") {
      put(plateP, new THREE.CylinderGeometry(1.35, 1.55, 1.8, 12), 0, crownY + 0.9, top.z);
      const cap = new THREE.TorusGeometry(0.7, 0.12, 6, 14);
      cap.rotateX(Math.PI / 2);
      put(glowP, cap, 0, crownY + 1.75, top.z);
    }
    if (spec.crown === "masts") {
      for (const x of [-1.4, 1.4]) put(ironP, new THREE.CylinderGeometry(0.08, 0.1, 2.4, 5), x, crownY + 1.2, top.z);
    }

    const headZ = -spec.len * 0.4;
    if (spec.jaw === "wolf") {
      put(bronzeP, box(spec.beam * 0.58, 1.25, 2.5), 0, 3.65, headZ);
      put(bronzeP, new THREE.ConeGeometry(0.26, 0.7, 5), -0.95, 4.45, headZ);
      put(bronzeP, new THREE.ConeGeometry(0.26, 0.7, 5), 0.95, 4.45, headZ);
      put(glowP, new THREE.SphereGeometry(0.16, 8, 8), -0.48, 3.75, headZ - 1.15);
      put(glowP, new THREE.SphereGeometry(0.16, 8, 8), 0.48, 3.75, headZ - 1.15);
    }
    if (spec.jaw === "beak") {
      const beak = new THREE.ConeGeometry(0.62, 3.1, 5);
      beak.rotateX(-Math.PI / 2);
      put(bronzeP, beak, 0, 3.15, headZ - 1.8);
      put(glowP, new THREE.SphereGeometry(0.12, 8, 8), -0.28, 3.45, headZ - 0.4);
      put(glowP, new THREE.SphereGeometry(0.12, 8, 8), 0.28, 3.45, headZ - 0.4);
    }

    const bake = (parts: THREE.BufferGeometry[], material: THREE.Material) => {
      if (!parts.length) return;
      const merged = mergeGeometries(parts, false);
      parts.forEach((p) => p.dispose());
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    };
    bake(ironP, iron);
    bake(plateP, plate);
    bake(bronzeP, bronze);
    bake(glowP, glow);

    const wide = spec.jaw === "wolf" ? 1 : spec.jaw === "beak" ? 0.62 : spec.jaw === "kiln" ? 0.9 : 0.72;
    const mouthZ = -spec.len * 0.5 - 0.15;
    const mouthY = 2.45;
    const jawL = new THREE.Group();
    const jawR = new THREE.Group();
    jawL.position.set(0, mouthY + 0.55, mouthZ);
    jawR.position.set(0, mouthY - 0.15, mouthZ);
    const upper = new THREE.Mesh(box(spec.beam * 0.5 * wide + 1.2, 0.42, spec.jaw === "beak" ? 3.2 : 2.4), bronze);
    upper.position.set(0, 0.15, -1.15);
    jawL.add(upper);
    const lower = new THREE.Mesh(box(spec.beam * 0.48 * wide + 1.1, 0.48, spec.jaw === "beak" ? 3.4 : 2.6), bronze);
    lower.position.set(0, -0.12, -1.25);
    jawR.add(lower);
    const toothGeo = new THREE.ConeGeometry(0.13, spec.jaw === "kiln" ? 0.36 : 0.5, 5);
    const teeth = spec.jaw === "gate" ? 4 : 6;
    for (let i = 0; i < teeth; i++) {
      const x = (i - (teeth - 1) / 2) * (0.42 * wide + 0.28);
      const t1 = new THREE.Mesh(toothGeo, tooth);
      t1.position.set(x, -0.12, spec.jaw === "beak" ? -2.4 : -2.05);
      t1.rotation.x = Math.PI;
      jawL.add(t1);
      const t2 = new THREE.Mesh(toothGeo, tooth);
      t2.position.set(x, 0.16, spec.jaw === "beak" ? -2.5 : -2.15);
      jawR.add(t2);
    }
    if (spec.jaw === "kiln") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.14, 6, 14), glow);
      ring.position.set(0, mouthY, mouthZ);
      g.add(ring);
    }
    g.add(jawL, jawR);

    const wheels: THREE.Object3D[] = [];
    const span = spec.len - 1.6;
    const idlerGeo = new THREE.CylinderGeometry(1.05, 1.05, 1.15, 16);
    idlerGeo.rotateZ(Math.PI / 2);
    const roadGeo = new THREE.CylinderGeometry(0.48, 0.48, 1.05, 12);
    roadGeo.rotateZ(Math.PI / 2);
    for (const x of [-spec.beam / 2 - 0.85, spec.beam / 2 + 0.85]) {
      const belt = new THREE.Mesh(box(1.25, 1.7, span), track);
      belt.position.set(x, 1.2, 0.1);
      g.add(belt);
      for (const z of [-span / 2 + 0.15, span / 2 - 0.15]) {
        const idler = new THREE.Mesh(idlerGeo, track);
        idler.position.set(x, 1.15, z);
        g.add(idler);
        wheels.push(idler);
      }
      for (const z of [-span * 0.22, 0, span * 0.22]) {
        const road = new THREE.Mesh(roadGeo, cleatMat);
        road.position.set(x, 0.85, z);
        g.add(road);
        wheels.push(road);
      }
      const n = Math.max(7, Math.round(span / 1.15));
      for (let i = 0; i < n; i++) {
        const z = -span / 2 + 0.3 + (i * (span - 0.5)) / (n - 1);
        put(cleatP, box(1.55, 0.2, 0.36), x, 0.28, z);
      }
    }
    bake(cleatP, cleatMat);

    const shade = new THREE.Mesh(
      new THREE.CircleGeometry(spec.len * 0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0x1c2414, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    shade.rotation.x = -Math.PI / 2;
    shade.position.y = 0.04;
    g.add(shade);

    g.scale.setScalar(spec.scale);
    g.userData.baseScale = spec.scale;
    g.userData.rig = { jawL, jawR, wheels, spin: 0 } satisfies CityRig;
    return g;
  }

  private dressTown(city: THREE.Group) {
    const district = new THREE.Group();
    const wall = this.mat("town-wall", 0xd8c7a4, {
      map: this.wallMap,
      emissive: 0xffc27a,
      emissiveMap: this.glowMap,
      emissiveIntensity: 1.05,
      roughness: 0.55,
      metalness: 0.16,
    });
    const street = new THREE.Mesh(
      new THREE.RingGeometry(7.4, 11.2, 28),
      new THREE.MeshStandardMaterial({ color: 0x6a5848, roughness: 0.92, metalness: 0.08 }),
    );
    street.rotation.x = -Math.PI / 2;
    street.position.y = 0.12;
    street.receiveShadow = true;
    district.add(street);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.2;
      const rad = 9.2 + (i % 3) * 1.5;
      const h = 3.2 + (i % 4) * 1.4;
      const w = 2.4 + (i % 2) * 0.8;
      const block = new THREE.Mesh(this.tile(new THREE.BoxGeometry(w, h, w * 0.72), w / 2.2, h / 1.8), wall);
      block.position.set(Math.cos(a) * rad, h / 2, Math.sin(a) * rad);
      block.rotation.y = -a;
      block.castShadow = true;
      block.receiveShadow = true;
      district.add(block);
      if (i % 2 === 0) {
        const upper = new THREE.Mesh(this.tile(new THREE.BoxGeometry(w * 0.62, h * 0.45, w * 0.48), 1, 1), wall);
        upper.position.set(block.position.x, h + h * 0.22, block.position.z);
        upper.castShadow = true;
        district.add(upper);
      }
    }
    city.add(district);
    city.userData.district = district;

    const slots: { kind: string; mesh: THREE.Object3D }[][] = [];
    const points: [number, number, number][] = [
      [-2.4, 5.4, -0.6],
      [2.4, 5.4, -0.6],
      [-2.2, 7.1, 1.8],
      [2.2, 7.1, 1.8],
      [0, 8.6, 1.5],
      [-3.4, 3.8, 3.2],
    ];
    const bannerMat = this.mat("fit-banner", 0xc6ef4a, { emissive: 0xc6ef4a, emissiveIntensity: 0.45, roughness: 0.4 });
    const lampMat = this.mat("fit-lamp", 0xffe08a, { emissive: 0xffe08a, emissiveIntensity: 1, roughness: 0.3 });
    const gunMat = this.mat("fit-gun", 0x3a3028, { roughness: 0.45, metalness: 0.6 });
    const shieldMat = this.mat("fit-shield", 0x9fd0ff, { emissive: 0x7eb6ff, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.4 });
    for (const [x, y, z] of points) {
      const banner = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.7), bannerMat);
      banner.position.set(x, y + 0.7, z);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lampMat);
      lamp.position.set(x, y + 0.9, z);
      const turret = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.7, 0.9), gunMat);
      turret.position.set(x, y + 0.45, z);
      const shield = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.08, 6, 14), shieldMat);
      shield.position.set(x, y + 0.8, z);
      for (const mesh of [banner, lamp, turret, shield]) {
        mesh.visible = false;
        city.add(mesh);
      }
      slots.push([
        { kind: "banner", mesh: banner },
        { kind: "lamp", mesh: lamp },
        { kind: "turret", mesh: turret },
        { kind: "shield", mesh: shield },
      ]);
    }
    city.userData.slots = slots;
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

  private tile(geo: THREE.BufferGeometry, su: number, sv: number) {
    const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    return geo;
  }

  private paintSurfaces() {
    const wall = document.createElement("canvas");
    wall.width = 512;
    wall.height = 512;
    const glow = document.createElement("canvas");
    glow.width = 512;
    glow.height = 512;
    const wg = wall.getContext("2d")!;
    const gg = glow.getContext("2d")!;
    wg.fillStyle = "#e4ddd2";
    wg.fillRect(0, 0, 512, 512);
    gg.fillStyle = "#000";
    gg.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 64) {
      wg.fillStyle = "#8d867c";
      wg.fillRect(0, y, 512, 4);
      wg.fillStyle = "#f3efe8";
      wg.fillRect(0, y + 4, 512, 2);
    }
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const x = 22 + col * 62;
        const y = 16 + row * 64;
        const lit = (col * 3 + row) % 5 !== 0;
        wg.fillStyle = lit ? "#2c261f" : "#171410";
        wg.fillRect(x, y, 26, 34);
        if (lit) {
          gg.fillStyle = (col + row) % 3 === 0 ? "#ffe1b0" : "#ffb15c";
          gg.fillRect(x + 3, y + 3, 20, 28);
        }
      }
    }
    this.wallMap = new THREE.CanvasTexture(wall);
    this.glowMap = new THREE.CanvasTexture(glow);
    this.wallMap.colorSpace = THREE.SRGBColorSpace;
    this.glowMap.colorSpace = THREE.SRGBColorSpace;
    for (const tex of [this.wallMap, this.glowMap]) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
    }

    const plate = document.createElement("canvas");
    plate.width = 256;
    plate.height = 256;
    const pg = plate.getContext("2d")!;
    pg.fillStyle = "#cfc8bc";
    pg.fillRect(0, 0, 256, 256);
    pg.strokeStyle = "#6d675e";
    pg.lineWidth = 3;
    for (let i = 0; i <= 256; i += 64) {
      pg.beginPath();
      pg.moveTo(i, 0);
      pg.lineTo(i, 256);
      pg.stroke();
      pg.beginPath();
      pg.moveTo(0, i);
      pg.lineTo(256, i);
      pg.stroke();
    }
    pg.fillStyle = "#8a847a";
    for (let y = 16; y < 256; y += 64) {
      for (let x = 16; x < 256; x += 64) {
        pg.beginPath();
        pg.arc(x, y, 3, 0, Math.PI * 2);
        pg.fill();
      }
    }
    this.plateMap = new THREE.CanvasTexture(plate);
    this.plateMap.colorSpace = THREE.SRGBColorSpace;
    this.plateMap.wrapS = this.plateMap.wrapT = THREE.RepeatWrapping;
    this.plateMap.anisotropy = 8;

    const tread = document.createElement("canvas");
    tread.width = 128;
    tread.height = 128;
    const tg = tread.getContext("2d")!;
    tg.fillStyle = "#3a342e";
    tg.fillRect(0, 0, 128, 128);
    tg.fillStyle = "#8d8478";
    for (let y = 4; y < 128; y += 16) tg.fillRect(0, y, 128, 7);
    tg.fillStyle = "#2a241f";
    tg.fillRect(0, 0, 6, 128);
    tg.fillRect(122, 0, 6, 128);
    this.treadMap = new THREE.CanvasTexture(tread);
    this.treadMap.colorSpace = THREE.SRGBColorSpace;
    this.treadMap.wrapS = this.treadMap.wrapT = THREE.RepeatWrapping;
    this.treadMap.anisotropy = 8;
  }

  private grassTex() {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const g = c.getContext("2d")!;
    const img = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const f = n - Math.floor(n);
        const blot = Math.sin(x * 0.07) * Math.cos(y * 0.05);
        const i = (y * 256 + x) * 4;
        img.data[i] = 62 + f * 40 + blot * 10;
        img.data[i + 1] = 108 + f * 50 + blot * 16;
        img.data[i + 2] = 38 + f * 18;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(18, 18);
    tex.anisotropy = 8;
    return tex;
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
