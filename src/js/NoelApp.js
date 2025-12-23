import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { CONFIG, Particle } from './Particle.js';

export class NoelApp {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.clock = new THREE.Clock();
        this.state = {
            mode: 'TREE',
            focusTarget: null,
            hand: { detected: false, x: 0, y: 0 },
            rotation: { x: 0, y: 0 }
        };

        this.particles = [];
        this.photoGroup = new THREE.Group();
        this.lastVideoTime = -1;

        this.init();
        const title = document.getElementById('app-title');
        if (title) title.innerText = "MERRY CHRISTMAS";
    }

    async init() {
        this.setupThree();
        this.setupLights();
        this.createAssets();
        this.setupPostProcessing();
        this.bindEvents();

        try {
            await this.initVision();
        } catch (e) {
            console.warn("Vision System failed to start. Falling back to mouse/keyboard.", e);
        }

        this.hideLoader();
        this.animate();
    }

    setupThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(CONFIG.colors.bg);
        this.scene.fog = new THREE.FogExp2(CONFIG.colors.bg, 0.01);

        this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 2, CONFIG.camera.z);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        this.renderer.toneMappingExposure = 2.2;
        this.container.appendChild(this.renderer.domElement);

        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);
        this.mainGroup.add(this.photoGroup);

        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }

    setupLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

        const pLight = new THREE.PointLight(0xffaa00, 2, 20);
        pLight.position.set(0, 5, 0);
        this.mainGroup.add(pLight);

        const goldSpot = new THREE.SpotLight(0xffcc66, 1000, 100, 0.5, 0.5);
        goldSpot.position.set(30, 40, 40);
        this.scene.add(goldSpot);

        const blueSpot = new THREE.SpotLight(0x6688ff, 500, 100);
        blueSpot.position.set(-30, 20, -30);
        this.scene.add(blueSpot);

        const fill = new THREE.DirectionalLight(0xffeebb, 0.8);
        fill.position.set(0, 0, 50);
        this.scene.add(fill);
    }

    createAssets() {
        const mats = {
            gold: new THREE.MeshStandardMaterial({ color: CONFIG.colors.gold, metalness: 1, roughness: 0.1, emissive: 0x443300 }),
            green: new THREE.MeshStandardMaterial({ color: CONFIG.colors.green, roughness: 0.8, emissive: 0x001100 }),
            red: new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.3, roughness: 0.2, clearcoat: 1 }),
            star: new THREE.MeshStandardMaterial({ color: 0xffdd88, emissive: CONFIG.colors.star, emissiveIntensity: 2, metalness: 1 })
        };

        const geos = {
            sphere: new THREE.SphereGeometry(0.5, 24, 24),
            box: new THREE.BoxGeometry(0.55, 0.55, 0.55),
            oct: new THREE.OctahedronGeometry(1.2, 0)
        };

        for (let i = 0; i < CONFIG.tree.particleCount; i++) {
            const r = Math.random();
            let mesh, type;

            if (r < 0.4) { mesh = new THREE.Mesh(geos.box, mats.green); type = 'LEAF'; }
            else if (r < 0.7) { mesh = new THREE.Mesh(geos.box, mats.gold); type = 'GIFT'; }
            else if (r < 0.95) { mesh = new THREE.Mesh(geos.sphere, mats.gold); type = 'BALL'; }
            else { mesh = new THREE.Mesh(geos.sphere, mats.red); type = 'RED_BALL'; }

            const s = 0.4 + Math.random() * 0.5;
            mesh.scale.set(s, s, s);
            this.mainGroup.add(mesh);
            this.particles.push(new Particle(mesh, type));
        }

        const star = new THREE.Mesh(geos.oct, mats.star);
        star.position.y = CONFIG.tree.height / 2 + 1.2;
        this.mainGroup.add(star);

        const dustGeo = new THREE.TetrahedronGeometry(0.08, 0);
        const dustMat = new THREE.MeshBasicMaterial({ color: 0xffeebb, transparent: true, opacity: 0.6 });
        for (let i = 0; i < CONFIG.tree.dustCount; i++) {
            const d = new THREE.Mesh(dustGeo, dustMat);
            this.mainGroup.add(d);
            this.particles.push(new Particle(d, 'DUST', true));
        }
    }

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloom.threshold = 0.7;
        bloom.strength = 0.45;
        this.composer.addPass(bloom);
    }

    async initVision() {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 1
        });

        const video = document.getElementById('webcam');
        const constraintsList = [
            { video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } },
            { video: { facingMode: "user" } },
            { video: true }
        ];

        let stream = null;
        for (const constraints of constraintsList) {
            try {
                stream = await navigator.mediaDevices.getUserMedia(constraints);
                if (stream) break;
            } catch (err) { }
        }

        if (stream) {
            video.srcObject = stream;
            video.onloadedmetadata = () => video.play();
            this.video = video;
            this.predict();
        }
    }

    predict() {
        if (this.video && this.video.currentTime !== this.lastVideoTime) {
            this.lastVideoTime = this.video.currentTime;
            const result = this.handLandmarker.detectForVideo(this.video, performance.now());
            this.processGestures(result);
        }
        requestAnimationFrame(() => this.predict());
    }

    processGestures(result) {
        if (result.landmarks && result.landmarks[0]) {
            this.state.hand.detected = true;
            const lms = result.landmarks[0];
            this.state.hand.x = (lms[9].x - 0.5) * 2;
            this.state.hand.y = (lms[9].y - 0.5) * 2;

            const wrist = lms[0], thumb = lms[4], index = lms[8];
            const pinch = Math.hypot(thumb.x - index.x, thumb.y - index.y);
            const openDist = [8, 12, 16, 20].reduce((a, i) => a + Math.hypot(lms[i].x - wrist.x, lms[i].y - wrist.y), 0) / 4;

            if (pinch < 0.05) {
                if (this.state.mode !== 'FOCUS') {
                    this.state.mode = 'FOCUS';
                    const photos = this.particles.filter(p => p.type === 'PHOTO');
                    if (photos.length) this.state.focusTarget = photos[Math.floor(Math.random() * photos.length)].mesh;
                }
            } else if (openDist < 0.25) {
                this.state.mode = 'TREE';
                this.state.focusTarget = null;
            } else if (openDist > 0.4) {
                this.state.mode = 'SCATTER';
                this.state.focusTarget = null;
            }
        } else {
            this.state.hand.detected = false;
        }
    }

    bindEvents() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });

        const panel = document.getElementById('settings-panel');
        const trigger = document.getElementById('settings-trigger');

        trigger.onclick = () => panel.classList.toggle('open');
        document.querySelector('.close-settings').onclick = () => panel.classList.remove('open');

        document.getElementById('file-input').onchange = (e) => this.handleUpload(e);

        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'h') document.getElementById('ui-layer').classList.toggle('ui-hidden');
        });
    }

    handleUpload(e) {
        const files = Array.from(e.target.files);
        const loader = new THREE.TextureLoader();
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                loader.load(ev.target.result, (t) => {
                    t.colorSpace = THREE.SRGBColorSpace;
                    this.addPhotoToScene(t);
                });
            };
            reader.readAsDataURL(file);
        });
    }

    addPhotoToScene(texture) {
        const group = new THREE.Group();
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 0.05), new THREE.MeshStandardMaterial({ color: CONFIG.colors.gold, metalness: 1 }));
        const photo = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: texture }));
        photo.position.z = 0.04;
        group.add(frame, photo);
        group.scale.setScalar(0.8);
        this.photoGroup.add(group);
        this.particles.push(new Particle(group, 'PHOTO'));
    }

    hideLoader() {
        const loader = document.getElementById('loader');
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.remove(), 1000);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const dt = this.clock.getDelta();
        const time = this.clock.elapsedTime;

        let targetRY = (this.state.mode === 'TREE') ? time * 0.2 : 0;
        let targetRX = 0;

        if (this.state.hand.detected && this.state.mode === 'SCATTER') {
            targetRY = this.state.hand.x * Math.PI * 0.6;
            targetRX = this.state.hand.y * Math.PI * 0.25;
        }

        this.state.rotation.y += (targetRY - this.state.rotation.y) * 2.5 * dt;
        this.state.rotation.x += (targetRX - this.state.rotation.x) * 2.5 * dt;

        this.mainGroup.rotation.y = this.state.rotation.y;
        this.mainGroup.rotation.x = this.state.rotation.x;

        this.particles.forEach(p => p.update(dt, this.state, this.mainGroup, this.camera));

        this.composer.render();
    }
}
