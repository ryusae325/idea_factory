import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { BufferGeometryLoader } from 'three';
import { CSG } from 'three-csg-ts';
import fontUrl from 'three/examples/fonts/helvetiker_regular.typeface.json?url';
import type { Idea, Profile } from '../lib/types';
import { fmtYen } from '../lib/types';
import { getStlDownloadUrl, setIdeaStl, updateIdeaStatus, uploadStl } from '../lib/data';
import { toast } from '../lib/toast';

interface Props {
  idea: Idea;
  profile: Profile;
  onClose: () => void;
  onChanged: () => void;
}

interface StudioApi {
  addPrim(kind: string): void;
  deleteSelected(): void;
  deleteById(id: number): void;
  duplicateSelected(): void;
  selectById(id: number, additive?: boolean): void;
  resizeSelected(axis: 'x' | 'y' | 'z', value: number): void;
  addText(): void;
  booleanOperation(operation: 'union' | 'subtract'): void;
  renameObj(id: number): void;
  toggleVisible(id: number): void;
  applyMaterial(patch: { color?: string; roughness?: number; metalness?: number }): void;
  focusSelected(): void;
  resetView(): void;
  undo(): void;
  redo(): void;
  importExistingStl(): void;
  exportSTL(): void;
  exportGLB(): void;
  saveToServer(): void;
  submitForReview(): void;
  setMode(m: Mode): void;
  setSnap(v: boolean): void;
  setSpace(s: 'world' | 'local'): void;
}

type Mode = 'translate' | 'rotate' | 'scale';

interface ObjInfo {
  id: number;
  name: string;
  kind: string;
  visible: boolean;
  color: string;
}

interface SnapObj {
  kind: string;
  name: string;
  visible: boolean;
  color: string;
  roughness: number;
  metalness: number;
  position: number[];
  rotation: number[];
  scale: number[];
  geoId: number | null;
  geometry: Record<string, unknown> | null;
}

const PRIMS = [
  { kind: 'box', label: '直方体', icon: '🧱' },
  { kind: 'sphere', label: '球', icon: '⚪' },
  { kind: 'cylinder', label: '円柱', icon: '🛢️' },
  { kind: 'cone', label: '円錐', icon: '🔺' },
  { kind: 'torus', label: 'トーラス', icon: '🍩' },
  { kind: 'plate', label: '平板', icon: '▭' },
];

const KIND_LABEL: Record<string, string> = Object.fromEntries(PRIMS.map((p) => [p.kind, p.label]));
const DEFAULT_COLOR = '#f97316';

function makeGeometry(kind: string): THREE.BufferGeometry | null {
  switch (kind) {
    case 'box':
      return new THREE.BoxGeometry(20, 20, 20);
    case 'sphere':
      return new THREE.SphereGeometry(12, 32, 20);
    case 'cylinder':
      return new THREE.CylinderGeometry(10, 10, 24, 32);
    case 'cone':
      return new THREE.ConeGeometry(12, 24, 32);
    case 'torus':
      return new THREE.TorusGeometry(12, 4.5, 16, 48);
    case 'plate':
      return new THREE.BoxGeometry(48, 4, 48);
    default:
      return null;
  }
}

function primBaseY(kind: string): number {
  switch (kind) {
    case 'box':
      return 10;
    case 'sphere':
      return 12;
    case 'cylinder':
      return 12;
    case 'cone':
      return 12;
    case 'torus':
      return 4.5;
    case 'plate':
      return 2;
    default:
      return 10;
  }
}

function safeName(title: string): string {
  return (title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'planmo-model');
}

export default function ModelStudio({ idea, profile, onClose, onChanged }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<StudioApi | null>(null);

  const [objects, setObjects] = useState<ObjInfo[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [dimensions, setDimensions] = useState<{ x: number; y: number; z: number } | null>(null);
  const [dimensionInputs, setDimensionInputs] = useState<{ x: string; y: string; z: string }>({ x: '', y: '', z: '' });
  const [textValue, setTextValue] = useState('');
  const [selMat, setSelMat] = useState<{ color: string; roughness: number; metalness: number } | null>(null);
  const [mode, setModeState] = useState<Mode>('translate');
  const [snap, setSnapState] = useState(true);
  const [space, setSpaceState] = useState<'world' | 'local'>('world');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frame = 0;

    // ---- Scene setup ----
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#eef1f6');

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
    camera.position.set(130, 95, 130);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      toast('WebGLを初期化できません。ブラウザ設定を確認してください', 'error');
      onClose();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.touchAction = 'none';
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(90, 160, 70);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -200;
    dir.shadow.camera.right = 200;
    dir.shadow.camera.top = 200;
    dir.shadow.camera.bottom = -200;
    dir.shadow.camera.far = 600;
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0xdbeafe, 0.5);
    fill.position.set(-80, 60, -100);
    scene.add(fill);

    const grid = new THREE.GridHelper(400, 40, 0xb6c2d4, 0xd8e0ea);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.8;
    scene.add(grid);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.ShadowMaterial({ opacity: 0.12 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const modelRoot = new THREE.Group();
    modelRoot.name = 'planmo-model';
    scene.add(modelRoot);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.target.set(0, 20, 0);
    orbit.maxPolarAngle = Math.PI / 2 - 0.01;
    orbit.update();

    const tctrl = new TransformControls(camera, renderer.domElement);
    tctrl.setSize(0.9);
    scene.add(tctrl.getHelper());
    tctrl.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !(e as unknown as { value: boolean }).value;
      if (!(e as unknown as { value: boolean }).value) {
        pushHistory();
        syncObjects();
      }
    });

    // ---- History (snapshot-based undo/redo) ----
    const history: string[] = [];
    const redoStack: string[] = [];
    const geoCache = new Map<number, THREE.BufferGeometry>();
    const selectedIdsRef = { current: [] as number[] };
    const activeIdRef = { current: null as number | null };
    let fontPromise: Promise<Font> | null = null;
    let geoSeq = 1;
    let nameSeq: Record<string, number> = {};

    const serialize = (): string =>
      JSON.stringify(
        modelRoot.children.map((m) => {
          const mesh = m as THREE.Mesh;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          return {
            kind: String(mesh.userData.kind ?? ''),
            name: String(mesh.userData.name ?? 'Object'),
            visible: mesh.visible,
            color: '#' + mat.color.getHexString(),
            roughness: mat.roughness,
            metalness: mat.metalness,
            position: mesh.position.toArray(),
            rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
            scale: mesh.scale.toArray(),
            geoId: (mesh.userData.geoId as number | undefined) ?? null,
            geometry: ['boolean', 'text', 'import'].includes(String(mesh.userData.kind))
              ? (mesh.geometry.toJSON() as unknown as Record<string, unknown>)
              : null,
          } satisfies SnapObj;
        }),
      );

    const applySnapshot = (json: string, silent = false): void => {
      let snaps: SnapObj[];
      try {
        snaps = JSON.parse(json) as SnapObj[];
      } catch {
        return;
      }
      for (const child of [...modelRoot.children]) modelRoot.remove(child);
      let missing = 0;
      for (const s of snaps) {
        let geo: THREE.BufferGeometry | null = null;
        if (s.geoId != null) {
          geo = geoCache.get(s.geoId) ?? null;
          if (!geo && s.geometry) geo = new BufferGeometryLoader().parse(s.geometry);
          if (!geo) {
            missing++;
            continue;
          }
        } else if (s.geometry) {
          geo = new BufferGeometryLoader().parse(s.geometry);
        } else {
          geo = makeGeometry(s.kind);
        }
        if (!geo) continue;
        const mesh = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            color: s.color,
            roughness: s.roughness,
            metalness: s.metalness,
          }),
        );
        mesh.userData = { kind: s.kind, name: s.name, geoId: s.geoId ?? undefined };
        mesh.visible = s.visible;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.fromArray(s.position);
        mesh.rotation.set(s.rotation[0], s.rotation[1], s.rotation[2]);
        mesh.scale.fromArray(s.scale);
        modelRoot.add(mesh);
      }
      select(null);
      syncObjects();
      if (missing > 0 && !silent) {
        toast(`${missing}件のSTL読み込みオブジェクトは再読込できませんでした（📥で再読み込みしてください）`, 'info');
      }
    };

    const saveDraft = (): void => {
      try {
        localStorage.setItem(`planmo-studio-${idea.id}`, serialize());
      } catch {
        /* quota exceeded - ignore */
      }
    };

    const pushHistory = (): void => {
      const snap = serialize();
      if (history[history.length - 1] === snap) return;
      history.push(snap);
      if (history.length > 60) history.shift();
      redoStack.length = 0;
      setCanUndo(true);
      setCanRedo(false);
      saveDraft();
    };

    const undo = (): void => {
      if (history.length <= 1) return;
      redoStack.push(history.pop()!);
      applySnapshot(history[history.length - 1]);
      setCanUndo(history.length > 1);
      setCanRedo(true);
      saveDraft();
    };

    const redo = (): void => {
      const snap = redoStack.pop();
      if (!snap) return;
      history.push(snap);
      applySnapshot(snap);
      setCanUndo(history.length > 1);
      setCanRedo(redoStack.length > 0);
      saveDraft();
    };

    // ---- Selection ----
    const select = (mesh: THREE.Object3D | null, additive = false): void => {
      let nextIds: number[];
      if (!mesh) {
        nextIds = [];
      } else if (additive) {
        nextIds = selectedIdsRef.current.includes(mesh.id)
          ? selectedIdsRef.current.filter((id) => id !== mesh.id)
          : [...selectedIdsRef.current, mesh.id];
        if (nextIds.length === 0) nextIds = [mesh.id];
      } else {
        nextIds = [mesh.id];
      }
      selectedIdsRef.current = nextIds;
      setSelectedIds(nextIds);
      const activeId = mesh && nextIds.includes(mesh.id) ? mesh.id : nextIds[nextIds.length - 1];
      const activeMesh = modelRoot.children.find((child) => child.id === activeId) as THREE.Mesh | undefined;
      if (activeMesh) {
        activeIdRef.current = activeMesh.id;
        tctrl.attach(activeMesh);
        const mat = activeMesh.material as THREE.MeshStandardMaterial;
        setSelId(activeMesh.id);
        setSelMat({
          color: '#' + mat.color.getHexString(),
          roughness: mat.roughness,
          metalness: mat.metalness,
        });
        const rawSize = activeMesh.geometry.boundingBox?.getSize(new THREE.Vector3());
        const size = rawSize && new THREE.Vector3(
          rawSize.x * Math.abs(activeMesh.scale.x),
          rawSize.y * Math.abs(activeMesh.scale.y),
          rawSize.z * Math.abs(activeMesh.scale.z),
        );
        const nextDimensions = size ? { x: size.x, y: size.y, z: size.z } : null;
        setDimensions(nextDimensions);
        if (nextDimensions) setDimensionInputs({
          x: nextDimensions.x.toFixed(1),
          y: nextDimensions.y.toFixed(1),
          z: nextDimensions.z.toFixed(1),
        });
      } else {
        activeIdRef.current = null;
        tctrl.detach();
        setSelId(null);
        setSelMat(null);
        setDimensions(null);
      }
    };

    const syncObjects = (): void => {
      setObjects(
        modelRoot.children.map((m) => {
          const mesh = m as THREE.Mesh;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          return {
            id: mesh.id,
            name: String(mesh.userData.name ?? 'Object'),
            kind: String(mesh.userData.kind ?? ''),
            visible: mesh.visible,
            color: '#' + mat.color.getHexString(),
          };
        }),
      );
      const active = modelRoot.children.find((m) => m.id === activeIdRef.current) as THREE.Mesh | undefined;
      if (active) {
        active.geometry.computeBoundingBox();
        const rawSize = active.geometry.boundingBox?.getSize(new THREE.Vector3());
        if (rawSize) {
          const nextDimensions = {
            x: rawSize.x * Math.abs(active.scale.x),
            y: rawSize.y * Math.abs(active.scale.y),
            z: rawSize.z * Math.abs(active.scale.z),
          };
          setDimensions(nextDimensions);
          setDimensionInputs({
            x: nextDimensions.x.toFixed(1),
            y: nextDimensions.y.toFixed(1),
            z: nextDimensions.z.toFixed(1),
          });
        }
      }
    };
    tctrl.addEventListener('objectChange', syncObjects);

    // ---- Object operations ----
    const addPrim = (kind: string): void => {
      const geo = makeGeometry(kind);
      if (!geo) return;
      nameSeq[kind] = (nameSeq[kind] ?? 0) + 1;
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: DEFAULT_COLOR, roughness: 0.55, metalness: 0.1 }),
      );
      mesh.userData = { kind, name: `${KIND_LABEL[kind] ?? kind} ${nameSeq[kind]}` };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(0, primBaseY(kind), 0);
      modelRoot.add(mesh);
      select(mesh);
      syncObjects();
      pushHistory();
    };

    const deleteIds = (ids: number[]): void => {
      const targets = modelRoot.children.filter((child) => ids.includes(child.id));
      if (targets.length === 0) return toast('削除するオブジェクトを選択してください', 'info');
      tctrl.detach();
      for (const target of targets) {
        const mesh = target as THREE.Mesh;
        modelRoot.remove(target);
        const stillUsed = modelRoot.children.some((child) => (child as THREE.Mesh).geometry === mesh.geometry);
        if (mesh.userData.geoId == null && !stillUsed) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      }
      select(null);
      syncObjects();
      pushHistory();
      toast(`${targets.length}個のオブジェクトを削除しました（Ctrl+Zで復元できます）`);
    };

    const deleteSelected = (): void => deleteIds(selectedIdsRef.current);
    const deleteById = (id: number): void => deleteIds([id]);

    const duplicateSelected = (): void => {
      const sel = tctrl.object as THREE.Mesh | null;
      if (!sel) return toast('複製するオブジェクトを選択してください', 'info');
      const clone = new THREE.Mesh(sel.geometry as THREE.BufferGeometry, (sel.material as THREE.Material).clone());
      clone.userData = { ...sel.userData, name: `${sel.userData.name ?? 'Object'} のコピー` };
      clone.castShadow = true;
      clone.receiveShadow = true;
      clone.position.copy(sel.position).add(new THREE.Vector3(6, 0, 6));
      clone.rotation.copy(sel.rotation);
      clone.scale.copy(sel.scale);
      modelRoot.add(clone);
      select(clone);
      syncObjects();
      pushHistory();
    };

    const renameObj = (id: number): void => {
      const mesh = modelRoot.children.find((m) => m.id === id) as THREE.Mesh | undefined;
      if (!mesh) return;
      const name = window.prompt('オブジェクト名を変更', String(mesh.userData.name ?? ''));
      if (name === null || !name.trim()) return;
      mesh.userData.name = name.trim();
      syncObjects();
      pushHistory();
    };

    const toggleVisible = (id: number): void => {
      const mesh = modelRoot.children.find((m) => m.id === id);
      if (!mesh) return;
      mesh.visible = !mesh.visible;
      syncObjects();
      pushHistory();
    };

    const applyMaterial = (patch: { color?: string; roughness?: number; metalness?: number }): void => {
      const sel = tctrl.object as THREE.Mesh | null;
      if (!sel) return;
      const mat = sel.material as THREE.MeshStandardMaterial;
      if (patch.color !== undefined) mat.color.set(patch.color);
      if (patch.roughness !== undefined) mat.roughness = patch.roughness;
      if (patch.metalness !== undefined) mat.metalness = patch.metalness;
      setSelMat({
        color: '#' + mat.color.getHexString(),
        roughness: mat.roughness,
        metalness: mat.metalness,
      });
      syncObjects();
      pushHistory();
    };

    const resizeSelected = (axis: 'x' | 'y' | 'z', value: number): void => {
      const mesh = tctrl.object as THREE.Mesh | null;
      if (!mesh || !Number.isFinite(value) || value <= 0) return;
      mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox;
      if (!bounds) return;
      const base = bounds.getSize(new THREE.Vector3())[axis];
      if (base <= 0) return;
      const sign = Math.sign(mesh.scale[axis]) || 1;
      mesh.scale[axis] = sign * value / base;
      syncObjects();
      pushHistory();
    };

    const addText = async (): Promise<void> => {
      const text = textValue.trim().slice(0, 80);
      if (!text) return toast('文字を入力してください', 'info');
      setBusy('フォントを読み込み中…');
      try {
        if (!fontPromise) fontPromise = new FontLoader().loadAsync(fontUrl);
        const font = await fontPromise;
        const geometry = new TextGeometry(text, {
          font,
          size: 14,
          depth: 3,
          curveSegments: 8,
          bevelEnabled: true,
          bevelThickness: 0.35,
          bevelSize: 0.2,
          bevelSegments: 2,
        });
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (bounds) {
          const centerX = (bounds.min.x + bounds.max.x) / 2;
          geometry.translate(-centerX, -bounds.min.y, 0);
        }
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({ color: DEFAULT_COLOR, roughness: 0.55, metalness: 0.1 }),
        );
        mesh.userData = { kind: 'text', name: `テキスト: ${text.slice(0, 18)}`, text };
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(0, 0, 0);
        modelRoot.add(mesh);
        select(mesh);
        syncObjects();
        pushHistory();
        toast('立体テキストを追加しました');
      } catch (e) {
        toast((e as Error).message || 'フォントを読み込めませんでした', 'error');
      } finally {
        setBusy(null);
      }
    };

    const booleanOperation = (operation: 'union' | 'subtract'): void => {
      const selected = selectedIdsRef.current
        .map((id) => modelRoot.children.find((child) => child.id === id) as THREE.Mesh | undefined)
        .filter((mesh): mesh is THREE.Mesh => Boolean(mesh?.visible));
      if (selected.length < 2) return toast('ブーリアン演算には表示中のオブジェクトを2個以上選択してください', 'info');
      try {
        for (const mesh of selected) {
          mesh.updateMatrix();
          mesh.updateMatrixWorld(true);
        }
        let result = selected[0];
        for (const next of selected.slice(1)) {
          result = operation === 'union' ? CSG.union(result, next) : CSG.subtract(result, next);
          result.updateMatrix();
          result.updateMatrixWorld(true);
        }
        result.userData = {
          kind: 'boolean',
          name: operation === 'union' ? '合体メッシュ' : 'くり抜きメッシュ',
        };
        result.material = (selected[0].material as THREE.MeshStandardMaterial).clone();
        result.castShadow = true;
        result.receiveShadow = true;
        for (const mesh of selected) {
          modelRoot.remove(mesh);
          const stillUsed = modelRoot.children.some((child) => (child as THREE.Mesh).geometry === mesh.geometry);
          if (mesh.userData.geoId == null && !stillUsed) mesh.geometry.dispose();
          const material = mesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material.dispose();
        }
        modelRoot.add(result);
        select(result);
        syncObjects();
        pushHistory();
        toast(operation === 'union' ? '選択した形状を合体しました' : '先頭の形状から後続の形状をくり抜きました');
      } catch (e) {
        toast(`ブーリアン演算に失敗しました: ${(e as Error).message}`, 'error');
      }
    };

    // ---- View helpers ----
    const selectById = (id: number, additive = false): void => {
      const mesh = modelRoot.children.find((m) => m.id === id);
      if (mesh) select(mesh, additive);
    };

    const focusSelected = (): void => {
      const sel = tctrl.object;
      if (!sel) return;
      orbit.target.copy(sel.position);
      orbit.update();
    };

    const resetView = (): void => {
      camera.position.set(130, 95, 130);
      orbit.target.set(0, 20, 0);
      orbit.update();
    };

    // ---- Import / Export ----
    const importExistingStl = async (): Promise<void> => {
      if (!idea.stl_path) return toast('この案件にはまだSTLが登録されていません', 'info');
      setBusy('STLを読み込み中…');
      try {
        const url = await getStlDownloadUrl(idea.stl_path);
        const res = await fetch(url);
        if (!res.ok) throw new Error('STLの取得に失敗しました');
        const buf = await res.arrayBuffer();
        const geo = new STLLoader().parse(buf);
        geo.center();
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        const id = geoSeq++;
        geoCache.set(id, geo);
        const mesh = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.5, metalness: 0.15 }),
        );
        mesh.userData = { kind: 'import', name: `STL読み込み ${nameSeq['import'] = (nameSeq['import'] ?? 0) + 1}`, geoId: id };
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.y = (bb.max.y - bb.min.y) / 2;
        modelRoot.add(mesh);
        select(mesh);
        syncObjects();
        pushHistory();
        toast('STLを読み込みました');
      } catch (e) {
        toast((e as Error).message, 'error');
      } finally {
        setBusy(null);
      }
    };

    const buildStlBlob = (): { blob: Blob; name: string } | null => {
      if (modelRoot.children.length === 0) {
        toast('オブジェクトがありません。先に形状を追加してください', 'error');
        return null;
      }
      const data = new STLExporter().parse(modelRoot, { binary: true }) as unknown as DataView;
      const name = safeName(idea.title);
      return { blob: new Blob([data], { type: 'model/stl' }), name };
    };

    const exportSTL = (): void => {
      const built = buildStlBlob();
      if (!built) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(built.blob);
      a.download = `${built.name}.stl`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('STLをダウンロードしました');
    };

    const exportGLB = (): void => {
      if (modelRoot.children.length === 0) return toast('オブジェクトがありません', 'error');
      new GLTFExporter().parse(
        modelRoot,
        (result) => {
          const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${safeName(idea.title)}.glb`;
          a.click();
          URL.revokeObjectURL(a.href);
          toast('GLBをダウンロードしました');
        },
        (err) => toast(((err as unknown as Error).message || 'GLBエクスポートに失敗しました'), 'error'),
        { binary: true },
      );
    };

    const saveToServer = async (): Promise<void> => {
      const built = buildStlBlob();
      if (!built) return;
      setBusy('3Dデータを保存中…');
      try {
        const file = new File([built.blob], `${built.name}.stl`, { type: 'model/stl' });
        const path = await uploadStl(profile.id, file);
        await setIdeaStl(idea.id, path);
        toast('3Dデータを案件に保存しました');
        onChanged();
      } catch (e) {
        toast((e as Error).message, 'error');
      } finally {
        setBusy(null);
      }
    };

    const submitForReview = async (): Promise<void> => {
      const built = buildStlBlob();
      if (!built) return;
      setBusy('提出中…');
      try {
        const file = new File([built.blob], `${built.name}.stl`, { type: 'model/stl' });
        const path = await uploadStl(profile.id, file);
        await setIdeaStl(idea.id, path);
        const msg = await updateIdeaStatus(idea.id, '提出中');
        toast(msg);
        onChanged();
        setShowSubmit(false);
        onClose();
      } catch (e) {
        toast((e as Error).message, 'error');
      } finally {
        setBusy(null);
      }
    };

    apiRef.current = {
      addPrim,
      deleteSelected,
      deleteById,
      duplicateSelected,
      selectById,
      resizeSelected,
      addText,
      booleanOperation,
      renameObj,
      toggleVisible,
      applyMaterial,
      focusSelected,
      resetView,
      undo,
      redo,
      importExistingStl,
      exportSTL,
      exportGLB,
      saveToServer,
      submitForReview,
      setMode: (m: Mode) => {
        tctrl.setMode(m);
        setModeState(m);
      },
      setSnap: (v: boolean) => {
        tctrl.setTranslationSnap(v ? 5 : null);
        tctrl.setRotationSnap(v ? THREE.MathUtils.degToRad(15) : null);
        tctrl.setScaleSnap(v ? 0.1 : null);
        setSnapState(v);
      },
      setSpace: (s: 'world' | 'local') => {
        tctrl.setSpace(s);
        setSpaceState(s);
      },
    };

    // ---- Picking ----
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    const onPointerDown = (e: PointerEvent): void => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onPointerUp = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      if (tctrl.dragging || tctrl.axis !== null) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(modelRoot.children, false);
      select(hits.length > 0 ? hits[0].object : null, e.shiftKey);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // ---- Keyboard ----
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIdsRef.current.length > 0) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (e.key.toLowerCase() === 'g') apiRef.current?.setMode('translate');
      else if (e.key.toLowerCase() === 'r') apiRef.current?.setMode('rotate');
      else if (e.key.toLowerCase() === 's' && !ctrl) apiRef.current?.setMode('scale');
      else if (e.key.toLowerCase() === 'f') focusSelected();
    };
    window.addEventListener('keydown', onKey);

    // ---- Resize ----
    const resize = (): void => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    // ---- Restore draft ----
    const draftKey = `planmo-studio-${idea.id}`;
    let draft: string | null = null;
    try {
      draft = localStorage.getItem(draftKey);
    } catch {
      draft = null;
    }
    if (draft) applySnapshot(draft, true);
    history.push(serialize());
    syncObjects();

    // ---- Loop ----
    const loop = (): void => {
      if (disposed) return;
      frame = requestAnimationFrame(loop);
      orbit.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      ro.disconnect();
      tctrl.dispose();
      orbit.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea.id]);

  const btn = 'rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition';
  const toolBtn = (active: boolean) =>
    `${btn} ${active ? 'bg-orange-600 text-white shadow-sm shadow-orange-500/30' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-stone-100">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 bg-white px-3 shadow-sm ring-1 ring-stone-200">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-lg">🧊</span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold leading-tight text-stone-900">3Dスタジオ</p>
            <p className="truncate text-[10px] leading-tight text-stone-400">{idea.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="hidden items-center gap-1 sm:flex">
            <button onClick={() => apiRef.current?.setMode('translate')} className={toolBtn(mode === 'translate')} title="移動 (G)">✥ 移動</button>
            <button onClick={() => apiRef.current?.setMode('rotate')} className={toolBtn(mode === 'rotate')} title="回転 (R)">⟳ 回転</button>
            <button onClick={() => apiRef.current?.setMode('scale')} className={toolBtn(mode === 'scale')} title="スケール (S)">⤢ サイズ</button>
            <span className="mx-1 h-5 w-px bg-stone-200" />
            <button onClick={() => apiRef.current?.setSnap(!snap)} className={toolBtn(snap)} title="グリッドにスナップ">🧲</button>
            <button onClick={() => apiRef.current?.setSpace(space === 'world' ? 'local' : 'world')} className={toolBtn(space === 'local')} title="ローカル/ワールド座標">
              {space === 'world' ? '🌍' : '📦'}
            </button>
            <span className="mx-1 h-5 w-px bg-stone-200" />
            <button onClick={() => apiRef.current?.undo()} disabled={!canUndo} className={`${btn} bg-stone-100 text-stone-700 disabled:opacity-40`} title="元に戻す (Ctrl+Z)">↩️</button>
            <button onClick={() => apiRef.current?.redo()} disabled={!canRedo} className={`${btn} bg-stone-100 text-stone-700 disabled:opacity-40`} title="やり直し (Ctrl+Y)">↪️</button>
          </div>
          <button
            onClick={() => setShowPanel((v) => !v)}
            className={`${btn} bg-stone-100 text-stone-700 lg:hidden`}
          >
            ☰
          </button>
          <button
            onClick={() => {
              if (confirm('3Dスタジオを閉じますか？（作業内容は自動保存されています）')) onClose();
            }}
            className={`${btn} bg-stone-800 text-white hover:bg-stone-900`}
          >
            ✕ 閉じる
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Left: primitives */}
        <aside className="flex w-16 shrink-0 flex-col items-center gap-1.5 overflow-y-auto bg-white p-2 ring-1 ring-stone-200">
          <p className="text-[9px] font-bold text-stone-400">追加</p>
          {PRIMS.map((p) => (
            <button
              key={p.kind}
              onClick={() => apiRef.current?.addPrim(p.kind)}
              title={`${p.label}を追加`}
              className="grid h-11 w-11 place-items-center rounded-xl bg-stone-50 text-xl ring-1 ring-stone-200 transition hover:bg-orange-50 hover:ring-orange-300 active:scale-95"
            >
              {p.icon}
            </button>
          ))}
          <button
            onClick={() => {
              setShowPanel(true);
              window.setTimeout(() => document.getElementById('studio-text-input')?.focus(), 0);
            }}
            title="テキストを作成"
            className="grid h-11 w-11 place-items-center rounded-xl bg-sky-50 text-xl ring-1 ring-sky-200 transition hover:bg-sky-100 active:scale-95"
          >
            🔤
          </button>
          <span className="my-1 h-px w-8 bg-stone-200" />
          <button
            onClick={() => apiRef.current?.duplicateSelected()}
            title="複製 (Ctrl+D)"
            className="grid h-11 w-11 place-items-center rounded-xl bg-stone-50 text-lg ring-1 ring-stone-200 transition hover:bg-stone-100 active:scale-95"
          >
            ⧉
          </button>
          <button
            onClick={() => apiRef.current?.deleteSelected()}
            title="削除 (Delete)"
            className="grid h-11 w-11 place-items-center rounded-xl bg-rose-50 text-lg text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-100 active:scale-95"
          >
            🗑
          </button>
          <button
            onClick={() => apiRef.current?.focusSelected()}
            title="選択を中央に (F)"
            className="grid h-11 w-11 place-items-center rounded-xl bg-stone-50 text-lg ring-1 ring-stone-200 transition hover:bg-stone-100 active:scale-95"
          >
            🎯
          </button>
        </aside>

        {/* Viewport */}
        <div ref={mountRef} className="relative min-w-0 flex-1" />

        {/* Right panel */}
        <aside
          className={`${showPanel ? 'flex' : 'hidden'} absolute inset-y-0 right-0 z-10 w-64 flex-col gap-3 overflow-y-auto bg-white/95 p-3 shadow-lg backdrop-blur lg:relative lg:z-0 lg:w-72 lg:shadow-none lg:ring-1 lg:ring-stone-200`}
        >
          <div>
            <p className="text-[11px] font-bold text-stone-500">📂 オブジェクト（{objects.length}）</p>
            <div className="mt-1.5 space-y-1">
              {objects.length === 0 && (
                <p className="rounded-lg bg-stone-50 px-2.5 py-3 text-center text-[10px] text-stone-400 ring-1 ring-stone-200">
                  左のパレットから形状を追加してモデリングを始めましょう
                </p>
              )}
              {objects.map((o) => (
                <div
                  key={o.id}
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] transition ${
                    selectedIds.includes(o.id) ? 'bg-orange-50 ring-1 ring-orange-300' : 'bg-stone-50 ring-1 ring-stone-200 hover:bg-stone-100'
                  }`}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-stone-300" style={{ background: o.color }} />
                  <button
                    onClick={(e) => apiRef.current?.selectById(o.id, e.shiftKey)}
                    className="min-w-0 flex-1 truncate text-left font-semibold text-stone-700"
                    title="クリックで選択。Shift+クリックで複数選択"
                  >
                    {o.name}
                  </button>
                  <button onClick={() => apiRef.current?.toggleVisible(o.id)} title="表示/非表示" className="shrink-0 text-[11px] opacity-70 hover:opacity-100">
                    {o.visible ? '👁' : '🚫'}
                  </button>
                  <button onClick={() => apiRef.current?.renameObj(o.id)} title="名前変更" className="shrink-0 text-[11px] opacity-70 hover:opacity-100">✎</button>
                  <button
                    onClick={() => apiRef.current?.deleteById(o.id)}
                    title={`${o.name}を削除（Ctrl+Zで復元）`}
                    aria-label={`${o.name}を削除`}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-rose-600 transition hover:bg-rose-100"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-stone-500">🔤 立体テキスト（Latin）</p>
            <div className="mt-1.5 flex gap-1.5">
              <input
                id="studio-text-input"
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') apiRef.current?.addText(); }}
                maxLength={80}
                placeholder="Tanaka など"
                className="min-w-0 flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-xs outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
              <button
                onClick={() => apiRef.current?.addText()}
                disabled={!!busy || !textValue.trim()}
                className="shrink-0 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
              >
                追加
              </button>
            </div>
            <p className="mt-1 text-[9px] text-stone-400">英数字向けフォント。1単位=1mm、立体厚み3mm</p>
          </div>

          <div>
            <p className="text-[11px] font-bold text-stone-500">📐 寸法（mm）</p>
            {dimensions && selId !== null ? (
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {([['x', '幅'], ['y', '高さ'], ['z', '奥行']] as const).map(([axis, label]) => (
                  <label key={axis} className="text-[9px] font-semibold text-stone-500">
                    {label}
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={dimensionInputs[axis] || Number(dimensions[axis].toFixed(1))}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setDimensionInputs((current) => ({ ...current, [axis]: raw }));
                        const nextValue = Number(raw);
                        if (raw.trim() && Number.isFinite(nextValue) && nextValue > 0) {
                          apiRef.current?.resizeSelected(axis, nextValue);
                        }
                      }}
                      onBlur={() => setDimensionInputs({
                        x: dimensions.x.toFixed(1),
                        y: dimensions.y.toFixed(1),
                        z: dimensions.z.toFixed(1),
                      })}
                      className="mt-1 w-full rounded-md border border-stone-300 px-1.5 py-1.5 text-[11px] font-bold text-stone-800 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    />
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-1.5 rounded-lg bg-stone-50 px-2.5 py-2 text-center text-[10px] text-stone-400 ring-1 ring-stone-200">形状を選択すると寸法を表示します</p>
            )}
          </div>

          <div>
            <p className="text-[11px] font-bold text-stone-500">🧩 ブーリアン演算（選択 {selectedIds.length}個）</p>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <button
                onClick={() => apiRef.current?.booleanOperation('union')}
                disabled={selectedIds.length < 2}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-2 text-[10px] font-bold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
                title="Shift+クリックで選択し、形状を合体"
              >
                合体 Union
              </button>
              <button
                onClick={() => apiRef.current?.booleanOperation('subtract')}
                disabled={selectedIds.length < 2}
                className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-2 text-[10px] font-bold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                title="最初に選んだ形状から後続をくり抜く"
              >
                差・穴あけ
              </button>
            </div>
            <p className="mt-1 text-[9px] text-stone-400">一覧またはビューポートでShift+クリックして複数選択。差は選択順がベース→カッターです。</p>
          </div>

          <div>
            <p className="text-[11px] font-bold text-stone-500">🎨 マテリアル</p>
            {selMat ? (
              <div className="mt-1.5 space-y-2.5 rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-stone-600">色</label>
                  <input
                    type="color"
                    value={selMat.color}
                    onChange={(e) => apiRef.current?.applyMaterial({ color: e.target.value })}
                    className="h-7 w-14 cursor-pointer rounded border border-stone-300 bg-white"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] font-semibold text-stone-600">
                    <span>粗さ</span>
                    <span>{Math.round(selMat.roughness * 100)}%</span>
                  </div>
                  <input
                    type="range" min={0} max={1} step={0.01} value={selMat.roughness}
                    onChange={(e) => apiRef.current?.applyMaterial({ roughness: Number(e.target.value) })}
                    className="w-full accent-orange-600"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] font-semibold text-stone-600">
                    <span>金属感</span>
                    <span>{Math.round(selMat.metalness * 100)}%</span>
                  </div>
                  <input
                    type="range" min={0} max={1} step={0.01} value={selMat.metalness}
                    onChange={(e) => apiRef.current?.applyMaterial({ metalness: Number(e.target.value) })}
                    className="w-full accent-orange-600"
                  />
                </div>
              </div>
            ) : (
              <p className="mt-1.5 rounded-lg bg-stone-50 px-2.5 py-3 text-center text-[10px] text-stone-400 ring-1 ring-stone-200">
                オブジェクトを選択すると色や質感を編集できます
              </p>
            )}
          </div>

          <div className="rounded-xl bg-sky-50 p-3 text-[10px] leading-relaxed text-sky-900 ring-1 ring-sky-200">
            <p className="font-bold">💡 操作ガイド</p>
            <p className="mt-1">・ドラッグ: 視点回転 ／ 右ドラッグ: 移動 ／ ホイール: ズーム</p>
            <p>・オブジェクトをクリックで選択 → ギズモで変形</p>
            <p>・G/R/S: 移動・回転・サイズ ／ Ctrl+Z/Y: 元に戻す・やり直し</p>
            <p>・Ctrl+D: 複製 ／ Delete: 削除 ／ F: 選択を中央に</p>
            <p className="mt-1">※ 1単位 = 1mm として書き出されます</p>
          </div>

          {idea.stl_path && (
            <button
              onClick={() => apiRef.current?.importExistingStl()}
              disabled={!!busy}
              className="w-full rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-[11px] font-bold text-teal-700 transition hover:bg-teal-100 disabled:opacity-50"
            >
              📥 案件のSTLを読み込む
            </button>
          )}
        </aside>
      </div>

      {/* Bottom bar */}
      <footer className="flex h-14 shrink-0 items-center gap-2 overflow-x-auto bg-white px-3 ring-1 ring-stone-200">
        <span className="hidden text-[10px] text-stone-400 sm:block">オブジェクト {objects.length}件</span>
        <span className="mx-1 hidden h-5 w-px bg-stone-200 sm:block" />
        <button
          onClick={() => apiRef.current?.exportSTL()}
          className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-[11px] font-bold text-stone-700 transition hover:bg-stone-100"
        >
          💾 STLでエクスポート
        </button>
        <button
          onClick={() => apiRef.current?.exportGLB()}
          className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-[11px] font-bold text-stone-700 transition hover:bg-stone-100"
        >
          💾 GLBでエクスポート
        </button>
        <button
          onClick={() => apiRef.current?.saveToServer()}
          disabled={!!busy}
          className="shrink-0 rounded-lg border border-teal-400 bg-teal-50 px-3 py-2 text-[11px] font-bold text-teal-700 transition hover:bg-teal-100 disabled:opacity-50"
        >
          📦 案件に保存
        </button>
        <span className="flex-1" />
        <button
          onClick={() => setShowSubmit(true)}
          disabled={!!busy || objects.length === 0}
          className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-[11px] font-bold text-white shadow-sm shadow-violet-500/30 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ✨ この3Dモデルで完成！提出する
        </button>
      </footer>

      {/* Busy overlay */}
      {busy && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-white/60 backdrop-blur-sm">
          <div className="rounded-2xl bg-white px-6 py-4 text-sm font-bold text-stone-700 shadow-lg ring-1 ring-stone-200">
            ⏳ {busy}
          </div>
        </div>
      )}

      {/* Submit confirm modal */}
      {showSubmit && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-stone-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h4 className="text-base font-bold text-stone-900">✨ 完成提出の確認</h4>
            <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
              現在の3DモデルをSTLとして書き出し、案件に保存してプランナーへ提出します。
              プランナーの承認後に「販売中」になり、ショップに出品されます。
            </p>
            <dl className="mt-3 space-y-1.5 rounded-xl bg-stone-50 p-3 text-[12px] ring-1 ring-stone-200">
              <div className="flex justify-between"><dt className="text-stone-500">物理プリント価格</dt><dd className="font-bold text-stone-800">{fmtYen(idea.price_physical)}円</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">STLデータ価格</dt><dd className="font-bold text-stone-800">{fmtYen(idea.price_digital)}円</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">収益分配</dt><dd className="font-bold text-stone-800">プランナー {idea.creator_share}% ／ モデラー {idea.modeler_share}%</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">サイズ</dt><dd className="font-bold text-stone-800">{idea.size_tier}サイズ</dd></div>
            </dl>
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
              ⚠️ 既存のSTLデータがある場合、上書きされます。
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowSubmit(false)}
                className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-xs font-bold text-stone-700 transition hover:bg-stone-100"
              >
                キャンセル
              </button>
              <button
                onClick={() => apiRef.current?.submitForReview()}
                disabled={!!busy}
                className="flex-1 rounded-lg bg-violet-600 px-3 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50"
              >
                提出する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
