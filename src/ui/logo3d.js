/**
 * 3D rotational logo — extruded SVG metallic mark (pxpush-style).
 * Slow Y spin + scroll-velocity kick; shrinks sticky on scroll.
 */

import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import logoUrl from '../assets/logo.svg?url';

const BASE_SPIN = -0.012;
const VEL_SCALE = 0.000025;
const VEL_CLAMP = 0.09;

export function initLogo3d() {
  const root = document.getElementById('logo3d');
  const mount = document.getElementById('logo3dCanvas');
  if (!root || !mount) return;

  const fine = window.matchMedia('(pointer: fine)').matches;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canWebGL = (() => {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  })();

  if (!canWebGL) {
    root.classList.add('is-fallback');
    return;
  }

  let renderer;
  let scene;
  let camera;
  let group;
  let sizeHint;
  let raf = 0;
  let running = false;
  let disposed = false;
  let visible = true;
  let vel = 0;
  let smoothVel = 0;
  let lastScrollY = window.scrollY;
  let lastScrollT = performance.now();
  let stickyActive = false;

  const getSize = () => {
    const r = mount.getBoundingClientRect();
    return {
      width: Math.max(1, mount.clientWidth || r.width || 1),
      height: Math.max(1, mount.clientHeight || r.height || 1),
    };
  };

  const fit = () => {
    if (!camera || !group || !sizeHint) return;
    const { width, height } = getSize();
    const viewH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const viewW = viewH * (width / height);
    const scale = Math.min((viewW * 0.78) / sizeHint.x, (viewH * 0.78) / sizeHint.y);
    group.scale.setScalar(scale);
  };

  const updateSticky = () => {
    if (!root) return;
    // Corner mark stays top-left; slight shrink on scroll
    const t = Math.min(1, Math.max(0, window.scrollY / 420));
    const scale = 1 - t * 0.18;
    stickyActive = true;

    root.style.setProperty('--logo-scale', scale.toFixed(4));
    root.style.setProperty('--logo-top', '14px');
    root.style.setProperty('--logo-left', 'clamp(14px, 3vw, 28px)');
    root.classList.toggle('is-docked', window.scrollY > 40);
    root.style.pointerEvents = 'auto';
  };

  const onScroll = () => {
    const now = performance.now();
    const dy = window.scrollY - lastScrollY;
    const dt = Math.max(1, now - lastScrollT);
    const raw = (-dy / dt) * 16.7;
    vel = THREE.MathUtils.clamp(raw * VEL_SCALE * 1000, -VEL_CLAMP, VEL_CLAMP);
    lastScrollY = window.scrollY;
    lastScrollT = now;
    updateSticky();
    kick();
  };

  const tick = () => {
    if (disposed || !running) return;
    if (!visible || document.hidden) {
      running = false;
      raf = 0;
      return;
    }

    if (group) {
      vel *= 0.9;
      smoothVel += (vel - smoothVel) * 0.16;
      group.rotation.y += BASE_SPIN + smoothVel;
    }
    renderer?.render(scene, camera);

    if (Math.abs(smoothVel) < 0.00005 && Math.abs(vel) < 0.00005) {
      // Keep a light idle spin — always schedule next frame while visible
    }
    raf = requestAnimationFrame(tick);
  };

  const kick = () => {
    if (running || disposed || !visible || document.hidden || reduce) return;
    running = true;
    raf = requestAnimationFrame(tick);
  };

  const onResize = () => {
    if (!renderer || !camera) return;
    const { width, height } = getSize();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    fit();
    updateSticky();
  };

  // Scene
  scene = new THREE.Scene();
  const { width, height } = getSize();
  camera = new THREE.PerspectiveCamera(10, width / height, 0.1, 100);
  camera.position.set(0, 0, 13);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  mount.appendChild(renderer.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(3, 4, 8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa8c0ff, 1.15);
  fill.position.set(-4, -1, 6);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1);
  rim.position.set(0, 2, -8);
  scene.add(rim);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));

  group = new THREE.Group();
  scene.add(group);

  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xe8e4dc),
    metalness: 0.92,
    roughness: 0.06,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.65,
    side: THREE.DoubleSide,
  });

  const extrudeOpts = {
    depth: 18,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 4,
    bevelSize: 0.45,
    bevelThickness: 0.9,
    curveSegments: 24,
  };

  /** pxpush-style outer elliptical ring — matches logo.svg viewBox 0 0 200 110 */
  const makeEllipseRing = (cx = 100, cy = 55, rx = 96, ry = 50, irx = 86, iry = 42, segs = 72) => {
    const shape = new THREE.Shape();
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = cx + Math.cos(a) * rx;
      const y = cy + Math.sin(a) * ry;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const hole = new THREE.Path();
    for (let i = 0; i <= segs; i++) {
      const a = -(i / segs) * Math.PI * 2;
      const x = cx + Math.cos(a) * irx;
      const y = cy + Math.sin(a) * iry;
      if (i === 0) hole.moveTo(x, y);
      else hole.lineTo(x, y);
    }
    shape.holes.push(hole);
    return new THREE.ExtrudeGeometry(shape, {
      ...extrudeOpts,
      depth: 22,
      bevelSize: 0.6,
      bevelThickness: 1.1,
    });
  };

  const finalizeLogo = () => {
    if (disposed) return;
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    group.children.forEach((child) => {
      if (child.isMesh) {
        child.geometry.translate(-center.x, -center.y, -center.z);
        child.geometry.scale(1, -1, 1);
        child.geometry.computeVertexNormals();
      }
    });
    sizeHint = size.clone();
    group.rotation.set(0.08, -0.55, 0);
    fit();
    root.classList.add('is-ready');
    if (!reduce) kick();
    else renderer.render(scene, camera);
  };

  // Outer ellipse first (same coordinate space as logo.svg viewBox 0 0 200 110)
  group.add(new THREE.Mesh(makeEllipseRing(), material));

  const loader = new SVGLoader();
  loader.load(
    logoUrl,
    (data) => {
      if (disposed) return;
      data.paths.forEach((path) => {
        SVGLoader.createShapes(path).forEach((shape) => {
          const geo = new THREE.ExtrudeGeometry(shape, extrudeOpts);
          group.add(new THREE.Mesh(geo, material));
        });
      });
      finalizeLogo();
    },
    undefined,
    () => {
      // Ring alone is still a usable mark if SVG fails
      finalizeLogo();
      if (!group.children.length) root.classList.add('is-fallback');
    }
  );

  updateSticky();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting || stickyActive;
        if (visible) kick();
        else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
          running = false;
        }
      },
      { threshold: 0.01 }
    );
    io.observe(root);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) kick();
  });

  root.addEventListener('click', () => {
    const home = document.getElementById('brandHome');
    if (home) home.click();
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Always keep a gentle spin while on-screen (even without scroll)
  if (!reduce) kick();

  return () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    group?.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
        else obj.material?.dispose?.();
      }
    });
    scene?.environment?.dispose?.();
    pmrem?.dispose();
    renderer?.dispose();
    mount.innerHTML = '';
  };
}
