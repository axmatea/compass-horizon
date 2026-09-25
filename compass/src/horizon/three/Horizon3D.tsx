import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { Html, Line, QuadraticBezierLine } from "@react-three/drei";
import * as THREE from "three";
import type { LedgerEntry, WorldView } from "../contract";
import { beliefLabels } from "../ui/story";
import "./horizon3d.css";

export type HorizonProps = {
  frame: WorldView;
  day: number;
  lastDay: number;
  reducedMotion: boolean;
  onScrub: (d: number) => void;
};

type Vec3 = [number, number, number];

const BG = "#0d0d0c";
const GOLD = "#d4b876";
const CREAM = "#efe7d6";
const MUTED = "#77726a";

const DAY_W = 0.9;
const MAX_SHOWN = 9;
const COLS = 3;
const CAPACITY = 640;
const RISE_S = 0.7;
const STAGGER_S = 0.035;
const DOT_R = 0.06;

const LANES: { key: string; name: string; color: string; z: number }[] = [
  { key: "A", name: "A", color: "#c9c2b3", z: -2.7 },
  { key: "B", name: "B", color: "#d4b876", z: -0.9 },
  { key: "Unknown", name: "Unknown", color: "#77726a", z: 0.9 },
  { key: "Agent", name: "Agent", color: "#8f897c", z: 2.7 },
];
const LANE_Z = new Map<string, number>(LANES.map((l) => [l.key, l.z] as [string, number]));
const LANE_COLOR = new Map<string, string>(LANES.map((l) => [l.key, l.color] as [string, string]));
const AXIS_Z = 3.9;
const PIVOT_Z = (LANES[0].z + LANES[1].z) / 2;
const NEEDLE_Y = 1.3;
const AGENT_Z = LANES[3].z;

/** Same ordering as the 2D Horizon: what matters most is drawn first and never folded away. */
const IMPORTANCE: Record<string, number> = {
  "belief.recorded": 0,
  "lesson.recorded": 1,
  "outcome.recorded": 2,
  "lead.qualified": 3,
  "lead.replied": 4,
  "webhook.duplicate_ignored": 5,
};

const xOf = (d: number) => d * DAY_W;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function laneOf(frame: WorldView, e: LedgerEntry): string {
  if (e.lane === "agent" || e.lane === "market") return "Agent";
  if (e.lane === "unknown") return "Unknown";
  return frame.campaigns.find((c) => c.id === e.lane)?.key ?? e.lane;
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function styleOf(type: string, base: string): { color: THREE.Color; scale: number } {
  const c = new THREE.Color(base);
  switch (type) {
    case "belief.recorded":
      return { color: new THREE.Color(GOLD).multiplyScalar(1.25), scale: 1.7 };
    case "lesson.recorded":
      return { color: new THREE.Color(CREAM), scale: 1.4 };
    case "outcome.recorded":
      return { color: c.multiplyScalar(1.2), scale: 1.35 };
    case "lead.qualified":
      return { color: c.multiplyScalar(1.1), scale: 1.1 };
    case "lead.captured":
      return { color: c.multiplyScalar(0.55), scale: 0.85 };
    case "webhook.duplicate_ignored":
    case "policy.versioned":
    case "rules.versioned":
    case "market.scanned":
      return { color: new THREE.Color(MUTED), scale: 0.75 };
    default:
      return { color: c.multiplyScalar(0.85), scale: 1 };
  }
}

interface Dot {
  x: number;
  y: number;
  z: number;
  color: THREE.Color;
  scale: number;
  fresh: boolean;
  order: number;
}

/** Visible = learned on or before the current day. Compacted to MAX_SHOWN per lane per day. */
function buildDots(frame: WorldView, day: number): Dot[] {
  const cells = new Map<string, LedgerEntry[]>();
  for (const e of frame.ledger) {
    if (e.learnedDay > day) continue;
    const lane = laneOf(frame, e);
    if (!LANE_Z.has(lane)) continue;
    const k = `${lane}|${e.learnedDay}`;
    const arr = cells.get(k) ?? [];
    arr.push(e);
    cells.set(k, arr);
  }
  const out: Dot[] = [];
  let order = 0;
  for (const [k, arr] of cells) {
    arr.sort((a, b) => (IMPORTANCE[a.type] ?? 9) - (IMPORTANCE[b.type] ?? 9));
    const [lane, dayStr] = k.split("|");
    const d = Number(dayStr);
    const z0 = LANE_Z.get(lane) ?? 0;
    const base = LANE_COLOR.get(lane) ?? CREAM;
    const shown = arr.slice(0, MAX_SHOWN);
    const rows = Math.ceil(shown.length / COLS);
    shown.forEach((e, i) => {
      const row = Math.floor(i / COLS);
      const inRow = row === rows - 1 ? shown.length - row * COLS : COLS;
      const col = i % COLS;
      const j = hash01(e.id);
      const s = styleOf(e.type, base);
      const fresh = e.learnedDay === day;
      out.push({
        x: xOf(d) + (col - (inRow - 1) / 2) * 0.2 + (j - 0.5) * 0.03,
        y: 0.08 + j * 0.05,
        z: z0 + (row - (rows - 1) / 2) * 0.2,
        color: s.color,
        scale: s.scale,
        fresh,
        order: fresh ? Math.min(order++, 40) : 0,
      });
    });
  }
  return out.slice(0, CAPACITY);
}

function makeInstanced(geo: THREE.SphereGeometry, mat: THREE.MeshBasicMaterial) {
  const m = new THREE.InstancedMesh(geo, mat, CAPACITY);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

function Dots({ dots, day, reducedMotion }: { dots: Dot[]; day: number; reducedMotion: boolean }) {
  const { core, halo } = useMemo(() => {
    const geo = new THREE.SphereGeometry(DOT_R, 14, 10);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    coreMat.toneMapped = false;
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    haloMat.toneMapped = false;
    return { core: makeInstanced(geo, coreMat), halo: makeInstanced(geo, haloMat) };
  }, []);

  useEffect(
    () => () => {
      core.geometry.dispose();
      core.material.dispose();
      halo.material.dispose();
      core.dispose();
      halo.dispose();
    },
    [core, halo],
  );

  const tmp = useMemo(() => new THREE.Object3D(), []);
  const anim = useRef({ start: -1, dirty: true });
  const maxOrder = useMemo(() => dots.reduce((m, d) => (d.fresh ? Math.max(m, d.order) : m), 0), [dots]);

  useEffect(() => {
    anim.current.dirty = true;
  }, [dots]);
  useEffect(() => {
    anim.current.start = -1; // restart the rise only when the day changes
  }, [day]);

  useFrame((state) => {
    const a = anim.current;
    const t = state.clock.elapsedTime;
    if (a.start < 0) a.start = t;
    const elapsed = t - a.start;
    const tweening = !reducedMotion && elapsed < RISE_S + maxOrder * STAGGER_S + 0.05;
    if (!a.dirty && !tweening) return;
    const n = dots.length;
    for (let i = 0; i < n; i++) {
      const d = dots[i];
      const p = d.fresh && !reducedMotion ? clamp((elapsed - d.order * STAGGER_S) / RISE_S, 0, 1) : 1;
      const ease = 1 - Math.pow(1 - p, 3);
      const s = d.scale * (0.15 + 0.85 * ease);
      tmp.position.set(d.x, d.y - (1 - ease) * 0.9, d.z);
      tmp.scale.setScalar(s);
      tmp.updateMatrix();
      core.setMatrixAt(i, tmp.matrix);
      tmp.scale.setScalar(s * 2.8);
      tmp.updateMatrix();
      halo.setMatrixAt(i, tmp.matrix);
      core.setColorAt(i, d.color);
      halo.setColorAt(i, d.color);
    }
    core.count = n;
    halo.count = n;
    core.instanceMatrix.needsUpdate = true;
    halo.instanceMatrix.needsUpdate = true;
    if (core.instanceColor) core.instanceColor.needsUpdate = true;
    if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
    a.dirty = tweening; // one more final write after the tween ends
  });

  return (
    <>
      <primitive object={core} />
      <primitive object={halo} />
    </>
  );
}

function Arcs({ frame, day }: { frame: WorldView; day: number }) {
  const arcs = useMemo(
    () =>
      frame.ledger
        .filter((e) => e.type === "outcome.recorded" && e.late && e.learnedDay > e.occurredDay && e.learnedDay <= day)
        .flatMap((e) => {
          const z = LANE_Z.get(laneOf(frame, e));
          if (z === undefined) return [];
          const x1 = xOf(e.occurredDay);
          const x2 = xOf(e.learnedDay);
          const apex = Math.min(1.4, 0.35 + (x2 - x1) * 0.18);
          const start: Vec3 = [x1, 0.1, z];
          const end: Vec3 = [x2, 0.1, z];
          const mid: Vec3 = [(x1 + x2) / 2, 0.1 + apex * 2, z];
          return [{ id: e.id, start, end, mid, fresh: e.learnedDay === day }];
        })
        .slice(0, 48),
    [frame, day],
  );
  return (
    <>
      {arcs.map((a) => (
        <group key={a.id}>
          <QuadraticBezierLine
            start={a.start}
            end={a.end}
            mid={a.mid}
            color={GOLD}
            lineWidth={a.fresh ? 2 : 1.3}
            transparent
            opacity={a.fresh ? 0.95 : 0.6}
          />
          <mesh position={a.start}>
            <sphereGeometry args={[0.045, 10, 8]} />
            <meshBasicMaterial color={GOLD} transparent opacity={0.55} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Ground({ day, lastDay, onScrub }: { day: number; lastDay: number; onScrub: (d: number) => void }) {
  const gl = useThree((s) => s.gl);
  const x0 = xOf(0) - 0.5;
  const x1 = xOf(lastDay) + 0.5;
  const zMin = LANES[0].z - 0.8;
  const zMax = AXIS_Z + 0.6;
  const xDay = xOf(day);

  const tickGeo = useMemo(() => {
    const pts: number[] = [];
    for (let d = 0; d <= lastDay; d++) {
      const x = xOf(d);
      const h = d % 5 === 0 ? 0.26 : 0.12;
      pts.push(x, 0, AXIS_Z - h, x, 0, AXIS_Z + h);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [lastDay]);
  useEffect(() => () => tickGeo.dispose(), [tickGeo]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onScrub(clamp(Math.round(e.point.x / DAY_W), 0, lastDay));
  };

  return (
    <>
      {LANES.map((l) => (
        <group key={l.key}>
          {day > 0 && (
            <Line points={[[xOf(0), 0, l.z], [xDay, 0, l.z]]} color={l.color} lineWidth={1} transparent opacity={0.32} />
          )}
          {day < lastDay && (
            <Line points={[[xDay, 0, l.z], [xOf(lastDay), 0, l.z]]} color={l.color} lineWidth={1} transparent opacity={0.1} />
          )}
        </group>
      ))}
      {/* the horizon: a thin gold line with a soft wide glow under it */}
      <Line points={[[x0, 0, AXIS_Z], [x1, 0, AXIS_Z]]} color={GOLD} lineWidth={6} transparent opacity={0.07} depthWrite={false} />
      <Line points={[[x0, 0, AXIS_Z], [x1, 0, AXIS_Z]]} color={GOLD} lineWidth={1.2} transparent opacity={0.9} />
      <lineSegments geometry={tickGeo}>
        <lineBasicMaterial color={GOLD} transparent opacity={0.3} />
      </lineSegments>
      {/* invisible floor: click anywhere on the timeline to scrub */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(x0 + x1) / 2, -0.01, (zMin + zMax) / 2]}
        onClick={onClick}
        onPointerOver={() => {
          gl.domElement.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          gl.domElement.style.cursor = "";
        }}
      >
        <planeGeometry args={[x1 - x0, zMax - zMin]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </>
  );
}

function BeliefTags({ frame, day }: { frame: WorldView; day: number }) {
  const tags = useMemo(() => beliefLabels(frame).filter((b) => b.day <= day).slice(-6), [frame, day]);
  return (
    <>
      {tags.map((b, i) => {
        const x = xOf(b.day);
        const y = i % 2 === 0 ? 0.75 : 1.15;
        return (
          <group key={`b-${b.version}`}>
            <Line points={[[x, 0.12, AGENT_Z], [x, y - 0.14, AGENT_Z]]} color={GOLD} lineWidth={1} transparent opacity={0.35} />
            <Html position={[x, y, AGENT_Z]} center zIndexRange={[20, 0]} pointerEvents="none" wrapperClass="h3d-html">
              <div className={`h3d-tag${b.day === day ? " is-current" : ""}`}>
                {b.text}
                {b.num && <span className="h3d-num">{` ${b.num}`}</span>}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

function NowMarker({
  frame,
  day,
  reducedMotion,
  camX,
}: {
  frame: WorldView;
  day: number;
  reducedMotion: boolean;
  camX: RefObject<number>;
}) {
  const group = useRef<THREE.Group>(null);
  const needle = useRef<THREE.Group>(null);
  const stretch = useRef<THREE.Group>(null);

  const b = frame.currentBelief;
  const key = b?.favors ? (frame.campaigns.find((c) => c.id === b.favors)?.key ?? b.favors) : null;
  const side = key === "A" ? 1 : key === "B" ? -1 : 0; // +Y rotation swings the tip toward -Z (lane A)
  const p = clamp(b?.probability ?? 0, 0, 1);
  const targetAngle = side * (0.28 + 0.62 * p);
  const targetLen = 0.9 + 1.2 * p;
  const glow = 0.12 + 0.45 * p;

  useFrame((_, dt) => {
    if (group.current) group.current.position.x = camX.current;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 4);
    if (needle.current) needle.current.rotation.y += (targetAngle - needle.current.rotation.y) * k;
    if (stretch.current) stretch.current.scale.x += (targetLen - stretch.current.scale.x) * k;
  });

  return (
    <group ref={group}>
      <Line points={[[0, 0.004, LANES[0].z - 0.6], [0, 0.004, AXIS_Z]]} color={GOLD} lineWidth={1} transparent opacity={0.5} />
      <Line points={[[0, 0, PIVOT_Z], [0, NEEDLE_Y, PIVOT_Z]]} color={GOLD} lineWidth={1} transparent opacity={0.3} />
      <mesh position={[0, 0, AXIS_Z]}>
        <sphereGeometry args={[0.06, 12, 8]} />
        <meshBasicMaterial color={GOLD} toneMapped={false} />
      </mesh>
      <group position={[0, NEEDLE_Y, PIVOT_Z]}>
        <mesh>
          <sphereGeometry args={[0.07, 16, 12]} />
          <meshBasicMaterial color={GOLD} toneMapped={false} />
        </mesh>
        <mesh scale={1 + p}>
          <sphereGeometry args={[0.3, 20, 14]} />
          <meshBasicMaterial
            color={GOLD}
            transparent
            opacity={glow * 0.5}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <group ref={needle}>
          <group ref={stretch}>
            <mesh position={[0.5, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
              <coneGeometry args={[0.055, 1, 20]} />
              <meshBasicMaterial color={GOLD} toneMapped={false} />
            </mesh>
            <mesh position={[0.5, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
              <coneGeometry args={[0.13, 1.08, 20]} />
              <meshBasicMaterial
                color={GOLD}
                transparent
                opacity={glow}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          </group>
          <mesh position={[-0.16, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <coneGeometry args={[0.055, 0.32, 20]} />
            <meshBasicMaterial color="#5c574d" toneMapped={false} />
          </mesh>
        </group>
        <Html position={[0, 0.55, 0]} center zIndexRange={[20, 0]} pointerEvents="none" wrapperClass="h3d-html">
          <div className="h3d-day">{`Day ${day}`}</div>
        </Html>
      </group>
      {LANES.map((l) => (
        <Html key={l.key} position={[-0.45, 0.02, l.z]} center zIndexRange={[20, 0]} pointerEvents="none" wrapperClass="h3d-html">
          <div className={`h3d-lane is-${l.key.toLowerCase()}`}>{l.name}</div>
        </Html>
      ))}
    </group>
  );
}

/** Camera follows the current day; tiny drift unless reduced motion. No controls, so page scroll is never hijacked. */
function Rig({ day, reducedMotion, camX }: { day: number; reducedMotion: boolean; camX: RefObject<number> }) {
  useFrame((state, dt) => {
    const target = xOf(day);
    camX.current = reducedMotion ? target : camX.current + (target - camX.current) * (1 - Math.exp(-dt * 3.2));
    const c = camX.current;
    const t = state.clock.elapsedTime;
    const drift = reducedMotion ? 0 : Math.sin(t * 0.12) * 0.25;
    const bob = reducedMotion ? 0 : Math.sin(t * 0.09 + 1) * 0.12;
    const aspect = state.size.width / Math.max(1, state.size.height);
    const back = clamp(1.7 / aspect, 1, 1.8); // pull back on narrow screens
    state.camera.position.set(c + 2.2 * back + drift, 6.6 * back + bob, 12.5 * back);
    state.camera.lookAt(c - 4.2, 0, 0.4);
  });
  return null;
}

function Scene({ frame, day, lastDay, reducedMotion, onScrub }: HorizonProps) {
  const camX = useRef<number>(xOf(day));
  const dots = useMemo(() => buildDots(frame, day), [frame, day]);
  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 14, 34]} />
      <Rig day={day} reducedMotion={reducedMotion} camX={camX} />
      <Ground day={day} lastDay={lastDay} onScrub={onScrub} />
      <Arcs frame={frame} day={day} />
      <Dots dots={dots} day={day} reducedMotion={reducedMotion} />
      <BeliefTags frame={frame} day={day} />
      <NowMarker frame={frame} day={day} reducedMotion={reducedMotion} camX={camX} />
    </>
  );
}

export default function Horizon3D(props: HorizonProps) {
  const lastDay = Math.max(1, props.lastDay);
  const day = clamp(Math.round(props.day), 0, lastDay);
  return (
    <div
      className="h3d"
      role="img"
      aria-label={`Horizon in 3D, Day 0 to Day ${lastDay}. Showing what the agent knew on Day ${day}.`}
    >
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ position: [xOf(day) - 3, 6.2, 10], fov: 36, near: 0.1, far: 200 }}
      >
        <Scene
          frame={props.frame}
          day={day}
          lastDay={lastDay}
          reducedMotion={props.reducedMotion}
          onScrub={props.onScrub}
        />
      </Canvas>
    </div>
  );
}

export function hasWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
