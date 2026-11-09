import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/* ------------------------------------------------------------------ *
 *  Cross-window sync (same idea as the original: localStorage)       *
 * ------------------------------------------------------------------ */
const storageNames = { colorsArray: 'colorsArray', myColor: 'myColor' };
const colors = ['red', 'blue', 'green', 'orange', 'pink', 'yellow', 'cyan'];
const palette = {
    red: 0xff3b5c, blue: 0x3b7bff, green: 0x2dff8a, orange: 0xff8a2d,
    pink: 0xff5ce1, yellow: 0xffe53b, cyan: 0x3bf2ff
};
const STALE_MS = 1500;       // ignore windows that stopped reporting
const CELL_RADIUS = 150;     // px, same as the original circle

const getLS = (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const setLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const getSS = (k) => { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : null; };
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

window.addEventListener('beforeunload', () => {
    pushLS(storageNames.colorsArray, myColor);
    localStorage.removeItem(myColor);
});

function publishSelf() {
    setLS(myColor, {
        screenX: window.screenX, screenY: window.screenY,
        centerX: window.innerWidth / 2, centerY: window.innerHeight / 2,
        color: myColor, t: Date.now()
    });
}

/** Other window's center, in this window's pixel coordinates (origin = window center, y up). */
function otherOffset(other) {
    const x = other.screenX - window.screenX + other.centerX - window.innerWidth / 2;
    const y = other.screenY - window.screenY + other.centerY - window.innerHeight / 2;
    return new THREE.Vector3(x, -y, 0);
}

/* ------------------------------------------------------------------ *
 *  Three.js scene — camera tuned so 1 world unit == 1 CSS pixel      *
 * ------------------------------------------------------------------ */
const root = document.getElementById('root');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
root.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.0006);
const FOV = 45;
const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 6000);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.1, 0.6, 0.15);
composer.addPass(bloom);

function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h); composer.setSize(w, h);
    camera.aspect = w / h;
    camera.position.set(0, 0, (h / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

scene.add(new THREE.AmbientLight(0x223344, 1.2));
const keyLight = new THREE.PointLight(0xffffff, 3, 0, 0); keyLight.position.set(400, 500, 800); scene.add(keyLight);
const rimLight = new THREE.PointLight(0x88aaff, 2, 0, 0); rimLight.position.set(-600, -300, 300); scene.add(rimLight);

/* Background: drifting plankton / particles in depth */
const dust = (() => {
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - .5) * 4000;
        pos[i * 3 + 1] = (Math.random() - .5) * 3000;
        pos[i * 3 + 2] = -Math.random() * 2500 + 300;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ size: 3, color: 0x7fffd4, transparent: true, opacity: .35, depthWrite: false, blending: THREE.AdditiveBlending });
    const p = new THREE.Points(g, m); scene.add(p); return p;
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
    return new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uPinch: { value: new THREE.Vector3() }, uPinchAmt: { value: 0 } },
        vertexShader: NOISE + /* glsl */`
            uniform float uTime; uniform vec3 uPinch; uniform float uPinchAmt;
            varying vec3 vN; varying vec3 vView; varying float vN2;
            void main(){
                vec3 p = position;
                float n = snoise(normal*1.6 + uTime*.35);
                float n2 = snoise(normal*4.0 - uTime*.6);
                // stretch toward linked neighbour (cell reaching out)
                float d = max(dot(normalize(normal), uPinch), 0.);
                float reach = pow(d, 6.) * uPinchAmt;
                p += normal * (n*12. + n2*4. + reach);
                vN2 = n2;
                vN = normalize(normalMatrix*normal);
                vec4 mv = modelViewMatrix*vec4(p,1.);
                vView = normalize(-mv.xyz);
                gl_Position = projectionMatrix*mv;
            }`,
        fragmentShader: /* glsl */`
            uniform vec3 uColor; varying vec3 vN; varying vec3 vView; varying float vN2;
            void main(){
                float fres = pow(1. - abs(dot(vN, vView)), 2.4);
                vec3 c = uColor * (fres*1.6 + .06) + vec3(1.)*pow(fres,6.)*.5;
                c += uColor * smoothstep(.55,.9,vN2) * .25;      // shimmering patches
                gl_FragColor = vec4(c, fres*.9 + .05);
            }`
    });
}

/* ---- A Cell: membrane + cytoplasm + nucleus + organelles ---- */
class Cell {
    constructor(colorName) {
        const color = palette[colorName] ?? 0xffffff;
        this.group = new THREE.Group();
        this.target = new THREE.Vector3();
        this.phase = Math.random() * 100;
        this.birth = performance.now();

        this.membrane = new THREE.Mesh(new THREE.IcosahedronGeometry(CELL_RADIUS, 48), membraneMaterial(color));
        this.group.add(this.membrane);

        const cyto = new THREE.Mesh(new THREE.SphereGeometry(CELL_RADIUS * .93, 48, 48),
            new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: .07, roughness: .2, transmission: .4, depthWrite: false }));
        this.group.add(cyto);

        this.nucleus = new THREE.Mesh(new THREE.IcosahedronGeometry(CELL_RADIUS * .32, 6),
            new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .9, roughness: .35, metalness: .1 }));
        this.group.add(this.nucleus);
        const nucleolus = new THREE.Mesh(new THREE.SphereGeometry(CELL_RADIUS * .1, 24, 24),
            new THREE.MeshBasicMaterial({ color: 0xffffff }));
        nucleolus.position.set(CELL_RADIUS * .08, CELL_RADIUS * .06, CELL_RADIUS * .15);
        this.nucleus.add(nucleolus);

        // orbiting organelles
        this.organelles = [];
        for (let i = 0; i < 22; i++) {
            const s = 4 + Math.random() * 9;
            const m = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 12),
                new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .5 + Math.random() * .8 }));
            m.scale.set(1, .6 + Math.random() * .6, 1);
            m.userData = {
                r: CELL_RADIUS * (.45 + Math.random() * .4),
                speed: (.2 + Math.random() * .6) * (Math.random() < .5 ? -1 : 1),
                axis: new THREE.Vector3().randomDirection(),
                angle: Math.random() * Math.PI * 2,
                base: new THREE.Vector3().randomDirection()
            };
            this.group.add(m); this.organelles.push(m);
        }
        this.light = new THREE.PointLight(color, 1.5, CELL_RADIUS * 4, 1.5);
        this.group.add(this.light);
        this.group.scale.setScalar(0.001);
        scene.add(this.group);
    }
    update(t, dt) {
        this.group.position.lerp(this.target, 1 - Math.pow(0.001, dt));   // smooth follow
        const age = (performance.now() - this.birth) / 1000;
        const pop = Math.min(1, age / .8);
        const ease = 1 + 2.7 * Math.pow(pop - 1, 3) + 1.7 * Math.pow(pop - 1, 2); // easeOutBack
        const breathe = 1 + Math.sin(t * 1.6 + this.phase) * .025;
        this.group.scale.setScalar(Math.max(.001, ease * breathe));
        this.group.rotation.y = t * .25 + this.phase;
        this.group.rotation.x = Math.sin(t * .3 + this.phase) * .4;
        this.membrane.material.uniforms.uTime.value = t + this.phase;
        this.nucleus.rotation.set(t * .5, t * .7, 0);
        this.nucleus.scale.setScalar(1 + Math.sin(t * 2.3 + this.phase) * .05);
        for (const o of this.organelles) {
            const u = o.userData; u.angle += u.speed * dt;
            o.position.copy(u.base).applyAxisAngle(u.axis, u.angle).multiplyScalar(u.r);
            o.rotation.x += dt; o.rotation.z += dt * .7;
        }
    }
    reachToward(worldPoint, amount) {
        const local = this.group.worldToLocal(worldPoint.clone()).normalize();
        const u = this.membrane.material.uniforms;
        u.uPinch.value.lerp(local, .2);
        u.uPinchAmt.value += (amount - u.uPinchAmt.value) * .1;
    }
    dispose() {
        scene.remove(this.group);
        this.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    }
}

/* ---- Bridge: glowing energy tube + flowing particles between cells ---- */
class Bridge {
    constructor(colorA, colorB) {
        this.cA = new THREE.Color(palette[colorA]); this.cB = new THREE.Color(palette[colorB]);
        this.mat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            uniforms: { uTime: { value: 0 }, uA: { value: this.cA }, uB: { value: this.cB } },
            vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
            fragmentShader: `uniform float uTime; uniform vec3 uA; uniform vec3 uB; varying vec2 vUv;
                void main(){
                    vec3 c = mix(uA,uB,vUv.x);
                    float pulse = pow(.5+.5*sin(vUv.x*40.-uTime*6.), 4.);
                    float edge = pow(sin(vUv.y*3.14159), 1.5);
                    gl_FragColor = vec4(c*(.35+pulse*.9), edge*(.25+pulse*.6));
                }`
        });
        this.tube = null;
        this.sparks = [];
        const sg = new THREE.SphereGeometry(4, 8, 8);
        for (let i = 0; i < 14; i++) {
            const m = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending }));
            m.userData.off = i / 14; scene.add(m); this.sparks.push(m);
        }
    }
    update(a, b, t) {
        const mid = a.clone().add(b).multiplyScalar(.5);
        const dist = a.distanceTo(b);
        mid.z += Math.min(220, dist * .18) + Math.sin(t) * 20;        // arc out of the screen
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        this.tube?.geometry.dispose();
        if (!this.tube) { this.tube = new THREE.Mesh(undefined, this.mat); scene.add(this.tube); }
        this.tube.geometry = new THREE.TubeGeometry(curve, 64, 6 + Math.sin(t * 3) * 1.5, 10, false);
        this.mat.uniforms.uTime.value = t;
        for (const s of this.sparks) {
            const u = (s.userData.off + t * .18) % 1;
            s.position.copy(curve.getPoint(u));
            s.material.color.copy(this.cA).lerp(this.cB, u).multiplyScalar(1.6);
            s.scale.setScalar(.6 + Math.sin(u * Math.PI) * 1.2);
        }
    }
    dispose() {
        if (this.tube) { scene.remove(this.tube); this.tube.geometry.dispose(); }
        this.mat.dispose();
        for (const s of this.sparks) { scene.remove(s); s.material.dispose(); }
    }
}

/* ------------------------------------------------------------------ *
 *  Main loop                                                         *
 * ------------------------------------------------------------------ */
const me = new Cell(myColor);
const others = new Map();   // color -> Cell
const bridges = new Map();  // color -> Bridge

const hexStr = '#' + new THREE.Color(palette[myColor]).getHexString();
document.getElementById('cellName').textContent = myColor.toUpperCase();
document.documentElement.style.setProperty('--cell', hexStr);
document.title = `Cell ${myColor} · 3D`;

// subtle parallax camera from mouse
const mouse = new THREE.Vector2();
addEventListener('pointermove', e => mouse.set(e.clientX / innerWidth - .5, e.clientY / innerHeight - .5));

const clock = new THREE.Clock();
let lastPublish = 0;
function frame() {
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    const now = Date.now();
    if (now - lastPublish > 30) { publishSelf(); lastPublish = now; }

    const seen = new Set();
    for (const c of colors) {
        if (c === myColor) continue;
        const o = getLS(c);
        if (!o || now - (o.t ?? 0) > STALE_MS) continue;
        seen.add(c);
        let cell = others.get(c);
        const target = otherOffset(o);
        if (!cell) { cell = new Cell(c); cell.group.position.copy(target); others.set(c, cell); bridges.set(c, new Bridge(myColor, c)); }
        cell.target.copy(target);
    }
    for (const [c, cell] of others) if (!seen.has(c)) {
        cell.dispose(); others.delete(c); bridges.get(c).dispose(); bridges.delete(c);
    }

    me.update(t, dt);
    let reachSum = new THREE.Vector3(), n = 0;
    for (const [c, cell] of others) {
        cell.update(t, dt);
        const pa = me.group.position, pb = cell.group.position;
        const d = pa.distanceTo(pb);
        const amt = THREE.MathUtils.clamp(1 - (d - CELL_RADIUS * 2) / 900, 0, 1) * 60;  // closer = stretch more
        cell.reachToward(pa, amt);
        reachSum.add(pb); n++;
        bridges.get(c).update(pa, pb, t);
    }
    if (n) me.reachToward(reachSum.divideScalar(n), 40); else me.reachToward(new THREE.Vector3(1, 0, 0), 0);
    document.getElementById('peers').textContent = n;

    dust.rotation.y = t * .01; dust.position.y = Math.sin(t * .2) * 20;
    const baseZ = camera.position.z;
    camera.position.x += (mouse.x * 120 - camera.position.x) * .05;
    camera.position.y += (-mouse.y * 80 - camera.position.y) * .05;
    camera.lookAt(0, 0, 0);
    camera.position.z = baseZ;

    composer.render();
    requestAnimationFrame(frame);
}
frame();
