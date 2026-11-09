import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/* ------------------------------------------------------------------ *
 *  Constants                                                         *
 * ------------------------------------------------------------------ */
const storageNames = { colorsArray: 'colorsArray', myColor: 'myColor' };
const colors = ['red', 'blue', 'green', 'orange', 'pink', 'yellow', 'cyan'];
const palette = {
    red: 0xff3b5c, blue: 0x3b7bff, green: 0x2dff8a, orange: 0xff8a2d,
    pink: 0xff5ce1, yellow: 0xffe53b, cyan: 0x3bf2ff
};
const STALE_MS = 2500;       // ignore windows that stopped reporting
const HEARTBEAT_MS = 400;    // still runs (throttled) while a window is hidden
const PUBLISH_MS = 30;       // minimum gap between position writes
const CELL_RADIUS = 150;     // px at full size
const RIPPLES = 4;           // simultaneous membrane ripples per cell
const RIPPLE_LIFE = 3;       // seconds

const coarse = matchMedia('(pointer: coarse)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_PIXEL_RATIO = coarse ? 1.5 : 2;
const MIN_PIXEL_RATIO = 0.75;

/* ------------------------------------------------------------------ *
 *  Cross-window sync (localStorage + storage events)                 *
 * ------------------------------------------------------------------ */
const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
const getLS = (k) => parse(localStorage.getItem(k));
const setLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const getSS = (k) => parse(sessionStorage.getItem(k));
const setSS = (k, v) => sessionStorage.setItem(k, JSON.stringify(v));
const pushLS = (k, v) => { const a = getLS(k) ?? []; if (!a.includes(v)) a.push(v); setLS(k, a); };
const popLS = (k) => { const a = getLS(k) ?? []; const v = a.pop(); setLS(k, a); return v; };

function claimColor() {
    let mine = getSS(storageNames.myColor);
    if (mine) return mine;                         // survives reloads in the same tab
    const pool = getLS(storageNames.colorsArray);
    if (!(pool && pool.length)) setLS(storageNames.colorsArray, colors);
    mine = popLS(storageNames.colorsArray) ?? colors[Math.floor(Math.random() * colors.length)];
    setSS(storageNames.myColor, mine);
    return mine;
}
const myColor = claimColor();

addEventListener('beforeunload', () => {
    clearInterval(heartbeat);
    pushLS(storageNames.colorsArray, myColor);
    localStorage.removeItem(myColor);
});

/* Peers arrive by event, so nothing is parsed from storage per frame. */
const peers = new Map();
for (const c of colors) if (c !== myColor) { const o = getLS(c); if (o) peers.set(c, o); }
addEventListener('storage', (e) => {
    if (e.key === null) { peers.clear(); return; }
    if (e.key === myColor || !colors.includes(e.key)) return;
    const o = parse(e.newValue);
    if (o) peers.set(e.key, o); else peers.delete(e.key);
});
const isLive = (o, now) => now - (o.t ?? 0) <= STALE_MS;

/* Writes only when the window moved or the heartbeat is due. */
const published = { x: NaN, y: NaN, w: NaN, h: NaN, t: 0 };
function publishSelf() {
    const now = Date.now();
    const x = window.screenX, y = window.screenY, w = innerWidth, h = innerHeight;
    const moved = x !== published.x || y !== published.y || w !== published.w || h !== published.h;
    if (now - published.t < (moved ? PUBLISH_MS : HEARTBEAT_MS)) return;
    Object.assign(published, { x, y, w, h, t: now });
    setLS(myColor, { screenX: x, screenY: y, centerX: w / 2, centerY: h / 2, color: myColor, t: now });
}
const heartbeat = setInterval(publishSelf, HEARTBEAT_MS);
publishSelf();

/** Other window's center, in this window's pixel coordinates (origin = window center, y up). */
function otherOffset(other, out) {
    const x = other.screenX - window.screenX + other.centerX - innerWidth / 2;
    const y = other.screenY - window.screenY + other.centerY - innerHeight / 2;
    return out.set(x, -y, 0);
}

/* ------------------------------------------------------------------ *
 *  Three.js scene: camera tuned so 1 world unit == 1 CSS pixel       *
 * ------------------------------------------------------------------ */
const root = document.getElementById('root');
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio, MAX_PIXEL_RATIO);
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
root.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const uPR = { value: pixelRatio };
const uCamZ = { value: 1000 };

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.0006);
const FOV = 45;
const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 6000);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.55, 0.22);
composer.addPass(bloom);

let viewScale = 1;           // shrinks cells to fit phone-sized viewports
let needsResize = true;
function resize() {
    needsResize = false;
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h); composer.setSize(w, h);
    camera.aspect = w / h;
    uCamZ.value = (h / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    camera.position.set(0, 0, uCamZ.value);
    camera.updateProjectionMatrix();
    viewScale = Math.min(1, Math.min(w, h) / 520);
}
addEventListener('resize', () => { needsResize = true; });

function setPixelRatio(pr) {
    pixelRatio = pr; uPR.value = pr;
    renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
}

scene.add(new THREE.AmbientLight(0x223344, 1.2));
const keyLight = new THREE.PointLight(0xffffff, 3, 0, 0); keyLight.position.set(400, 500, 800); scene.add(keyLight);
const rimLight = new THREE.PointLight(0x88aaff, 2, 0, 0); rimLight.position.set(-600, -300, 300); scene.add(rimLight);
const cursorLight = new THREE.PointLight(palette[myColor] ?? 0xffffff, 0, 0, 0); cursorLight.position.z = 240; scene.add(cursorLight);

/* Soft radial texture shared by every halo and nebula sprite */
const glowTexture = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(.35, 'rgba(255,255,255,.35)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
})();
const glowMaterial = (color, opacity) => new THREE.SpriteMaterial({
    map: glowTexture, color, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
});

/* Background nebula */
const nebulae = [
    { color: palette[myColor] ?? 0x2dff8a, x: -520, y: 240, z: -900, size: 2300, opacity: .10 },
    { color: 0x5a2dff, x: 640, y: -260, z: -1200, size: 2800, opacity: .13 },
    { color: 0x13a8c9, x: 120, y: 520, z: -1500, size: 2600, opacity: .08 }
].map((n) => {
    const s = new THREE.Sprite(glowMaterial(n.color, n.opacity));
    s.position.set(n.x, n.y, n.z); s.scale.setScalar(n.size);
    s.userData = n; scene.add(s); return s;
});

/* Plankton: all motion, twinkle and pointer push happen on the GPU */
const uDustTime = { value: 0 };
const uDustPointer = { value: new THREE.Vector3() };
(() => {
    const n = coarse ? 800 : 1500;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n * 2), tint = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - .5) * 4000;
        pos[i * 3 + 1] = (Math.random() - .5) * 3000;
        pos[i * 3 + 2] = -Math.random() * 2500 + 300;
        seed[i * 2] = 2 + Math.random() * 5;
        seed[i * 2 + 1] = Math.random() * 100;
        c.setHSL(.42 + Math.random() * .3, .9, .72).toArray(tint, i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: uDustTime, uPointer: uDustPointer, uPR, uCamZ },
        vertexShader: /* glsl */`
            uniform float uTime, uPR, uCamZ; uniform vec3 uPointer;
            attribute vec2 aSeed; attribute vec3 aTint;
            varying vec3 vTint; varying float vA;
            void main(){
                vec3 p = position;
                p.x += sin(uTime*.12 + aSeed.y)*34.;
                p.y += cos(uTime*.09 + aSeed.y*1.7)*34.;
                vec2 d = p.xy - uPointer.xy; float l2 = dot(d,d);
                if (l2 > 1.) p.xy += d/sqrt(l2) * uPointer.z * 110. * exp(-l2/42000.);
                vec4 mv = modelViewMatrix*vec4(p,1.);
                vTint = aTint;
                vA = .22 + .28*(.5+.5*sin(uTime*1.3 + aSeed.y*6.));
                gl_PointSize = min(aSeed.x * uPR * uCamZ / max(1., -mv.z), 22. * uPR);
                gl_Position = projectionMatrix*mv;
            }`,
        fragmentShader: /* glsl */`
            varying vec3 vTint; varying float vA;
            void main(){
                float a = smoothstep(.5, 0., length(gl_PointCoord-.5));
                gl_FragColor = vec4(vTint*a, a*vA);
            }`
    });
    const p = new THREE.Points(g, m); p.frustumCulled = false; scene.add(p);
})();

/* ---- Shared noise (GLSL) for organic membrane wobble ---- */
const NOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;
vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
i=mod289(i);vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}`;

function membraneMaterial(color) {
    const base = new THREE.Color(color), hsl = {};
    base.getHSL(hsl);
    const accent = new THREE.Color().setHSL((hsl.h + .13) % 1, Math.min(1, hsl.s), Math.min(.75, hsl.l + .08));
    return new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: {
            uTime: { value: 0 }, uColor: { value: base }, uAccent: { value: accent }, uGlow: { value: 0 },
            uPinch: { value: new THREE.Vector3() }, uPinchAmt: { value: 0 },
            uHover: { value: new THREE.Vector3(0, 0, 1) }, uHoverAmt: { value: 0 },
            uRipples: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, 1, 99)) }
        },
        vertexShader: NOISE + /* glsl */`
            uniform float uTime, uPinchAmt, uHoverAmt; uniform vec3 uPinch, uHover;
            uniform vec4 uRipples[${RIPPLES}];
            varying vec3 vN; varying vec3 vView; varying float vN2; varying float vRip;
            void main(){
                vec3 nrm = normalize(normal);
                float n = snoise(nrm*1.6 + uTime*.35);
                float n2 = snoise(nrm*4.0 - uTime*.6);
                float rip = 0.;
                for (int i = 0; i < ${RIPPLES}; i++) {
                    vec4 r = uRipples[i];
                    if (r.w < ${RIPPLE_LIFE}.) {
                        float a = acos(clamp(dot(nrm, r.xyz), -1., 1.));
                        float front = a - r.w*3.2;
                        rip += sin(front*9.) * exp(-r.w*1.6) * smoothstep(.9, 0., abs(front));
                    }
                }
                float reach = pow(max(dot(nrm, uPinch), 0.), 6.) * uPinchAmt;
                float hover = pow(max(dot(nrm, uHover), 0.), 8.) * uHoverAmt;
                vec3 p = position + nrm * (n*12. + n2*4. + reach + hover + rip*22.);
                vN2 = n2; vRip = rip;
                vN = normalize(normalMatrix*nrm);
                vec4 mv = modelViewMatrix*vec4(p,1.);
                vView = normalize(-mv.xyz);
                gl_Position = projectionMatrix*mv;
            }`,
        fragmentShader: /* glsl */`
            uniform vec3 uColor, uAccent; uniform float uGlow, uTime;
            varying vec3 vN; varying vec3 vView; varying float vN2; varying float vRip;
            void main(){
                float fres = pow(1. - abs(dot(vN, vView)), 2.4);
                vec3 tone = mix(uColor, uAccent, .5 + .5*sin(vN.y*3. + vN.x*2. + uTime*.5));
                vec3 c = tone * (fres*1.6 + .06) + vec3(1.)*pow(fres,6.)*.5;
                c += tone * smoothstep(.55,.9,vN2) * .25;      // shimmering patches
                c += tone * abs(vRip) * .9;                    // ripples catch the light
                c *= 1. + uGlow*.25;
                gl_FragColor = vec4(c, fres*.9 + .05 + abs(vRip)*.3);
            }`
    });
}

/* ---- Geometry shared by every cell ---- */
const membraneGeo = new THREE.IcosahedronGeometry(CELL_RADIUS, coarse ? 20 : 32);
const unitSphere = new THREE.SphereGeometry(1, 32, 32);
const unitSphereLow = new THREE.SphereGeometry(1, 10, 10);
const unitIco = new THREE.IcosahedronGeometry(1, 5);

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _dummy = new THREE.Object3D();

/* ---- A Cell: membrane + cytoplasm + nucleus + organelles ---- */
class Cell {
    constructor(colorName) {
        const color = palette[colorName] ?? 0xffffff;
        this.group = new THREE.Group();
        this.base = new THREE.Vector3();       // synced window position
        this.target = new THREE.Vector3();
        this.offset = new THREE.Vector3();     // local jelly displacement
        this.velocity = new THREE.Vector3();
        this.grabPoint = null;                 // Vector3 while being dragged
        this.phase = Math.random() * 100;
        this.birth = performance.now();
        this.glow = 0;
        this.nextRipple = 0;

        this.halo = new THREE.Sprite(glowMaterial(color, .34));
        this.halo.scale.setScalar(CELL_RADIUS * 4);
        this.group.add(this.halo);

        this.membrane = new THREE.Mesh(membraneGeo, membraneMaterial(color));
        this.group.add(this.membrane);

        const cyto = new THREE.Mesh(unitSphere, new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: .06, depthWrite: false, blending: THREE.AdditiveBlending
        }));
        cyto.scale.setScalar(CELL_RADIUS * .93);
        this.group.add(cyto);

        this.nucleus = new THREE.Mesh(unitIco,
            new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .9, roughness: .35, metalness: .1 }));
        this.group.add(this.nucleus);
        const nucleolus = new THREE.Mesh(unitSphere, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        nucleolus.position.set(.25, .19, .47);
        nucleolus.scale.setScalar(.31);
        this.nucleus.add(nucleolus);

        // Organelles: one instanced draw call per cell
        const count = 22;
        this.organelles = new THREE.InstancedMesh(unitSphereLow, new THREE.MeshBasicMaterial({ color: 0xffffff }), count);
        this.organelles.frustumCulled = false;
        this.orbits = [];
        const tint = new THREE.Color();
        for (let i = 0; i < count; i++) {
            const s = 4 + Math.random() * 9;
            this.orbits.push({
                r: CELL_RADIUS * (.45 + Math.random() * .4),
                speed: (.2 + Math.random() * .6) * (Math.random() < .5 ? -1 : 1),
                axis: new THREE.Vector3().randomDirection(),
                angle: Math.random() * Math.PI * 2,
                base: new THREE.Vector3().randomDirection(),
                scale: new THREE.Vector3(s, s * (.6 + Math.random() * .6), s)
            });
            this.organelles.setColorAt(i, tint.set(color).multiplyScalar(.7 + Math.random() * .9));
        }
        this.group.add(this.organelles);

        this.group.scale.setScalar(0.001);
        scene.add(this.group);
    }
    get radius() { return CELL_RADIUS * viewScale; }
    update(t, dt) {
        this.base.lerp(this.target, 1 - Math.pow(0.001, dt));   // smooth follow

        // Jelly spring: chases the pointer while grabbed, otherwise returns home
        const grabbed = this.grabPoint !== null;
        const k = grabbed ? 220 : 130, damping = grabbed ? 18 : 8;
        if (grabbed) _v1.copy(this.grabPoint).sub(this.base); else _v1.set(0, 0, 0);
        this.velocity.addScaledVector(_v1.sub(this.offset), k * dt);
        this.velocity.multiplyScalar(Math.exp(-damping * dt));
        this.offset.addScaledVector(this.velocity, dt);
        this.group.position.copy(this.base).add(this.offset);

        const age = (performance.now() - this.birth) / 1000;
        const pop = Math.min(1, age / .8);
        const ease = 1 + 2.7 * Math.pow(pop - 1, 3) + 1.7 * Math.pow(pop - 1, 2); // easeOutBack
        const breathe = 1 + Math.sin(t * 1.6 + this.phase) * .025;
        this.group.scale.setScalar(Math.max(.001, ease * breathe * viewScale));
        this.group.rotation.y = t * .25 + this.phase;
        this.group.rotation.x = Math.sin(t * .3 + this.phase) * .4;

        const u = this.membrane.material.uniforms;
        u.uTime.value = t + this.phase;
        for (const r of u.uRipples.value) if (r.w < RIPPLE_LIFE) r.w += dt;
        u.uGlow.value = this.glow;
        this.halo.material.opacity = .09 + this.glow * .08 + Math.sin(t * 1.6 + this.phase) * .02;

        this.nucleus.rotation.set(t * .5, t * .7, 0);
        this.nucleus.scale.setScalar(CELL_RADIUS * .32 * (1 + Math.sin(t * 2.3 + this.phase) * .05));

        for (let i = 0; i < this.orbits.length; i++) {
            const o = this.orbits[i];
            o.angle += o.speed * dt;
            _dummy.position.copy(o.base).applyAxisAngle(o.axis, o.angle).multiplyScalar(o.r);
            _dummy.rotation.set(t + i, 0, t * .7);
            _dummy.scale.copy(o.scale);
            _dummy.updateMatrix();
            this.organelles.setMatrixAt(i, _dummy.matrix);
        }
        this.organelles.instanceMatrix.needsUpdate = true;
    }
    reachToward(worldPoint, amount) {
        const u = this.membrane.material.uniforms;
        u.uPinch.value.lerp(this.group.worldToLocal(_v2.copy(worldPoint)).normalize(), .2);
        u.uPinchAmt.value += (amount - u.uPinchAmt.value) * .1;
    }
    /** Screen point projected onto the front of the sphere, as a local unit direction. */
    localDirection(x, y, out) {
        const dx = x - this.group.position.x, dy = y - this.group.position.y;
        const z = Math.sqrt(Math.max(this.radius ** 2 - dx * dx - dy * dy, 0));
        return this.group.worldToLocal(out.set(x, y, this.group.position.z + z)).normalize();
    }
    setHover(x, y, strength) {
        const u = this.membrane.material.uniforms;
        if (strength > 0) u.uHover.value.lerp(this.localDirection(x, y, _v2), .25);
        u.uHoverAmt.value += (strength * 42 - u.uHoverAmt.value) * .15;
        this.glow += (strength - this.glow) * .12;
    }
    ripple(x, y) {
        const list = this.membrane.material.uniforms.uRipples.value;
        const r = list[this.nextRipple++ % RIPPLES];
        this.localDirection(x, y, _v2);
        r.set(_v2.x, _v2.y, _v2.z, 0);
    }
    contains(x, y) {
        return Math.hypot(x - this.group.position.x, y - this.group.position.y) <= this.radius * 1.05;
    }
    dispose() {
        scene.remove(this.group);
        this.organelles.dispose();
        this.group.traverse((o) => o.material?.dispose());   // geometry is shared
    }
}

/* ---- Bridge: curve evaluated in the vertex shader, no per-frame geometry ---- */
const BEZIER = /* glsl */`
uniform vec3 uP0, uP1, uP2;
vec3 bez(float u){ float v = 1.-u; return v*v*uP0 + 2.*v*u*uP1 + u*u*uP2; }
vec3 bezTan(float u){ return 2.*(1.-u)*(uP1-uP0) + 2.*u*(uP2-uP1); }`;

const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 64, true);
const SPARKS = 18;
const sparkGeo = (() => {
    const off = new Float32Array(SPARKS * 3);
    for (let i = 0; i < SPARKS; i++) off[i * 3] = i / SPARKS;
    return new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(off, 3));
})();
let bridgeBoost = 0;
const uBridgeBoost = { value: 0 };

class Bridge {
    constructor(colorA, colorB) {
        const shared = {
            uTime: { value: 0 }, uA: { value: new THREE.Color(palette[colorA]) }, uB: { value: new THREE.Color(palette[colorB]) },
            uP0: { value: new THREE.Vector3() }, uP1: { value: new THREE.Vector3() }, uP2: { value: new THREE.Vector3() },
            uRadius: { value: 6 }, uBoost: uBridgeBoost, uPR
        };
        this.uniforms = shared;
        this.tubeMat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: shared, side: THREE.DoubleSide,
            vertexShader: BEZIER + /* glsl */`
                uniform float uRadius; varying float vAlong; varying float vAround;
                void main(){
                    float u = position.y + .5;
                    vec3 T = normalize(bezTan(u) + vec3(0., 1e-4, 0.));
                    vec3 N = normalize(cross(T, vec3(0., 0., 1.)) + vec3(1e-4, 0., 0.));
                    vec3 B = cross(T, N);
                    vec3 p = bez(u) + (N*position.x + B*position.z) * uRadius;
                    vAlong = u; vAround = uv.x;
                    gl_Position = projectionMatrix*viewMatrix*vec4(p,1.);
                }`,
            fragmentShader: /* glsl */`
                uniform float uTime, uBoost; uniform vec3 uA, uB; varying float vAlong; varying float vAround;
                void main(){
                    vec3 c = mix(uA, uB, vAlong);
                    float pulse = pow(.5+.5*sin(vAlong*40.-uTime*6.), 4.);
                    float edge = abs(sin(vAround*6.28318));
                    float gain = 1. + uBoost*1.5;
                    gl_FragColor = vec4(c*(.35+pulse*.9)*gain, .25 + edge*(.4+pulse*.6));
                }`
        });
        this.sparkMat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: shared,
            vertexShader: BEZIER + /* glsl */`
                uniform float uTime, uPR; uniform vec3 uA, uB; varying vec3 vCol;
                void main(){
                    float u = fract(position.x + uTime*.18);
                    vCol = mix(uA, uB, u) * 1.6;
                    gl_PointSize = (8. + sin(u*3.14159)*22.) * uPR;
                    gl_Position = projectionMatrix*viewMatrix*vec4(bez(u),1.);
                }`,
            fragmentShader: /* glsl */`
                varying vec3 vCol;
                void main(){
                    float a = smoothstep(.5, 0., length(gl_PointCoord-.5));
                    gl_FragColor = vec4(mix(vCol, vec3(1.), a*a*.6)*a, a);
                }`
        });
        this.tube = new THREE.Mesh(tubeGeo, this.tubeMat);
        this.sparks = new THREE.Points(sparkGeo, this.sparkMat);
        this.tube.frustumCulled = this.sparks.frustumCulled = false;
        scene.add(this.tube, this.sparks);
    }
    update(a, b, t) {
        const u = this.uniforms;
        u.uP0.value.copy(a); u.uP2.value.copy(b);
        u.uP1.value.copy(a).add(b).multiplyScalar(.5);
        u.uP1.value.z += Math.min(220, a.distanceTo(b) * .18) + Math.sin(t) * 20;   // arc out of the screen
        u.uRadius.value = 6 + Math.sin(t * 3) * 1.5;
        u.uTime.value = t;
    }
    dispose() {
        scene.remove(this.tube, this.sparks);
        this.tubeMat.dispose(); this.sparkMat.dispose();
    }
}

/* ---- Shockwave rings from a small fixed pool ---- */
const ringGeo = new THREE.RingGeometry(.985, 1, 64);
const rings = Array.from({ length: 6 }, () => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    }));
    m.visible = false; m.userData.age = 0; scene.add(m); return m;
});
let nextRing = 0;
function fireRing(x, y, color) {
    const r = rings[nextRing++ % rings.length];
    r.position.set(x, y, 20); r.material.color.set(color);
    r.userData.age = 0; r.visible = true;
}
function updateRings(dt) {
    for (const r of rings) {
        if (!r.visible) continue;
        r.userData.age += dt;
        const k = r.userData.age / .8;
        if (k >= 1) { r.visible = false; continue; }
        r.scale.setScalar(16 + (1 - (1 - k) ** 3) * 340);
        r.material.opacity = (1 - k) ** 2 * .85;
    }
}

/* ------------------------------------------------------------------ *
 *  Main objects                                                      *
 * ------------------------------------------------------------------ */
const me = new Cell(myColor);
const others = new Map();   // color -> Cell
const bridges = new Map();  // color -> Bridge

const hexStr = '#' + new THREE.Color(palette[myColor]).getHexString();
const peersEl = document.getElementById('peers');
const hintEl = document.getElementById('hint');
document.getElementById('cellName').textContent = myColor.toUpperCase();
document.documentElement.style.setProperty('--cell', hexStr);
document.title = `Cell ${myColor} · 3D`;
hintEl.textContent = coarse ? 'drag or tap a cell' : 'drag a cell · open more windows';

/* ------------------------------------------------------------------ *
 *  Pointer input: one code path for mouse, pen and multi-touch       *
 * ------------------------------------------------------------------ */
const pointer = { x: 0, y: 0, nx: 0, ny: 0, active: false };
const pressed = new Map();  // pointerId -> { cell, point }
const toWorldX = (e) => e.clientX - innerWidth / 2;
const toWorldY = (e) => innerHeight / 2 - e.clientY;
let cursor = '';

function trackPointer(e) {
    pointer.x = toWorldX(e); pointer.y = toWorldY(e);
    pointer.nx = e.clientX / innerWidth - .5; pointer.ny = e.clientY / innerHeight - .5;
    pointer.active = true;
}
function cellAt(x, y) {
    let best = null, bestD = Infinity;
    for (const c of allCells()) {
        if (c.grabPoint || !c.contains(x, y)) continue;
        const d = Math.hypot(x - c.group.position.x, y - c.group.position.y);
        if (d < bestD) { best = c; bestD = d; }
    }
    return best;
}
function* allCells() { yield me; yield* others.values(); }

canvas.addEventListener('pointerdown', (e) => {
    trackPointer(e);
    hintEl.classList.add('faded');
    canvas.setPointerCapture(e.pointerId);
    const cell = cellAt(pointer.x, pointer.y);
    const point = new THREE.Vector3(pointer.x, pointer.y, 0);
    if (cell) { cell.grabPoint = point; cell.ripple(pointer.x, pointer.y); bridgeBoost = 1; }
    pressed.set(e.pointerId, { cell, point });
    if (!reducedMotion) fireRing(pointer.x, pointer.y, cell ? cell.membrane.material.uniforms.uColor.value : palette[myColor]);
});
canvas.addEventListener('pointermove', (e) => {
    trackPointer(e);
    pressed.get(e.pointerId)?.point.set(pointer.x, pointer.y, 0);
});
function releasePointer(e) {
    const p = pressed.get(e.pointerId);
    if (p?.cell) { p.cell.grabPoint = null; }
    pressed.delete(e.pointerId);
    if (e.pointerType !== 'mouse' && pressed.size === 0) pointer.active = false;
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('pointerleave', (e) => { if (!pressed.size && e.pointerType === 'mouse') pointer.active = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());   // long-press on touch

function updatePointerEffects(dt) {
    let hovered = false;
    for (const c of allCells()) {
        let strength = 0;
        if (pointer.active) {
            const d = Math.hypot(pointer.x - c.group.position.x, pointer.y - c.group.position.y);
            strength = THREE.MathUtils.clamp(1 - (d - c.radius) / 240, 0, 1);
            if (d <= c.radius * 1.05) hovered = true;
        }
        c.setHover(pointer.x, pointer.y, c.grabPoint ? 1 : strength);
    }
    cursorLight.position.x = pointer.x; cursorLight.position.y = pointer.y;
    cursorLight.intensity += ((pointer.active ? 1 : 0) - cursorLight.intensity) * Math.min(1, dt * 8);
    uDustPointer.value.x = pointer.x; uDustPointer.value.y = pointer.y;
    uDustPointer.value.z += ((pointer.active ? 1 : 0) - uDustPointer.value.z) * Math.min(1, dt * 5);

    const next = pressed.size ? 'grabbing' : hovered ? 'grab' : '';
    if (next !== cursor) { cursor = next; canvas.style.cursor = next; }
}

/* ------------------------------------------------------------------ *
 *  Main loop                                                         *
 * ------------------------------------------------------------------ */
const clock = new THREE.Clock();
const reachSum = new THREE.Vector3();
const FALLBACK_REACH = new THREE.Vector3(1, 0, 0);
const parallax = reducedMotion ? 0 : 1;
let lastPeerCount = -1, frames = 0, frameTime = 0, warmup = 60;

function adaptQuality(rawDt) {
    if (rawDt > .25) return;                 // tab was hidden or stalled
    if (warmup > 0) { warmup--; return; }
    frames++; frameTime += rawDt;
    if (frames < 60) return;
    if (frameTime / frames > .024 && pixelRatio > MIN_PIXEL_RATIO) {
        setPixelRatio(Math.max(MIN_PIXEL_RATIO, pixelRatio - .25));
        warmup = 30;
    }
    frames = 0; frameTime = 0;
}

function frame() {
    requestAnimationFrame(frame);
    if (!innerWidth || !innerHeight) return;   // collapsed view has nothing to draw
    if (needsResize) resize();
    const rawDt = clock.getDelta(), dt = Math.min(rawDt, .05), t = clock.elapsedTime;
    const now = Date.now();
    adaptQuality(rawDt);
    publishSelf();

    for (const [c, o] of peers) {
        if (!isLive(o, now)) continue;
        let cell = others.get(c);
        if (!cell) {
            cell = new Cell(c);
            otherOffset(o, cell.target);
            cell.base.copy(cell.target);
            others.set(c, cell);
            bridges.set(c, new Bridge(myColor, c));
        }
        otherOffset(o, cell.target);
    }
    for (const [c, cell] of others) {
        const o = peers.get(c);
        if (o && isLive(o, now)) continue;
        for (const p of pressed.values()) if (p.cell === cell) p.cell = null;
        cell.dispose(); others.delete(c);
        bridges.get(c).dispose(); bridges.delete(c);
    }

    me.update(t, dt);
    reachSum.set(0, 0, 0);
    const pa = me.group.position;
    for (const [c, cell] of others) {
        cell.update(t, dt);
        const pb = cell.group.position;
        const amt = THREE.MathUtils.clamp(1 - (pa.distanceTo(pb) - CELL_RADIUS * 2) / 900, 0, 1) * 60;  // closer = stretch more
        cell.reachToward(pa, amt);
        reachSum.add(pb);
        bridges.get(c).update(pa, pb, t);
    }
    const n = others.size;
    if (n) me.reachToward(reachSum.divideScalar(n), 40); else me.reachToward(FALLBACK_REACH, 0);
    if (n !== lastPeerCount) { peersEl.textContent = n; lastPeerCount = n; }

    updatePointerEffects(dt);
    updateRings(dt);
    bridgeBoost *= Math.exp(-dt * 3); uBridgeBoost.value = bridgeBoost;

    uDustTime.value = t;
    for (const s of nebulae) {
        const d = s.userData;
        s.position.x = d.x + Math.sin(t * .05 + d.z) * 80;
        s.position.y = d.y + Math.cos(t * .04 + d.z) * 60;
    }

    const blend = Math.min(1, dt * 3);
    camera.position.x += (pointer.nx * 120 * parallax - camera.position.x) * blend;
    camera.position.y += (-pointer.ny * 80 * parallax - camera.position.y) * blend;
    camera.lookAt(0, 0, 0);

    composer.render();
}

frame();
