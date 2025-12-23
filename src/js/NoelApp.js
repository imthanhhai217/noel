import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { CONFIG, Particle } from './Particle.js';

export class NoelApp {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.clock = new THREE.Clock();
        this.audioInitialized = false;
        this.state = {
            mode: 'TREE',
            focusTarget: null,
            hand: { detected: false, x: 0, y: 0 },
            rotation: { x: 0, y: 0 },
            music: {
                playing: false,
                index: 0,
                frequency: 0,
                playlist: [
                    'https://upload.wikimedia.org/wikipedia/commons/4/4d/Jingle_Bells_%28ISRC_USUAN1100187%29.mp3',
                    'https://upload.wikimedia.org/wikipedia/commons/a/a6/We_Wish_you_a_Merry_Christmas_%28ISRC_USUAN1100369%29.mp3',
                    'https://upload.wikimedia.org/wikipedia/commons/0/0f/Silent_Night_%28ISRC_USUAN1100075%29.mp3'
                ]
            },
            config: {
                autoRotate: true,
                gestures: false, // Bắt đầu bằng false để ưu tiên tương tác vật lý khi chưa có camera
                snow: true
            }
        };

        this.particles = [];
        this.photoGroup = new THREE.Group();
        this.lastVideoTime = -1;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.mats = {}; // Store materials for theme updates
        this.themes = {
            classic: { gold: 0xffd966, green: 0x03180a, red: 0x990000, star: 0xffaa00, dust: 0xffeebb },
            frozen: { gold: 0xe0ffff, green: 0x1a4d66, red: 0x00ffff, star: 0xccffff, dust: 0xddffff },
            pinky: { gold: 0xffe4e1, green: 0x6b4247, red: 0xff69b4, star: 0xfff0f5, dust: 0xfff0f5 },
            starry: { gold: 0x9b59b6, green: 0x1a1a2e, red: 0x3498db, star: 0xe74c3c, dust: 0x9bc5ff }
        };

        this.init();
        const title = document.getElementById('app-title');
        if (title) title.innerText = "Merry Christmas";
    }

    async init() {
        this.setupThree();
        this.setupLights();
        this.createAssets();
        this.setupPostProcessing();
        this.bindEvents();

        try {
            // Không gọi initVision ngay lập tức ở init() để tránh bị trình duyệt block trên iOS
            // Chúng ta sẽ đợi user tương tác hoặc chỉ khởi chạy landmarker trước
            const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                    delegate: "AUTO"
                },
                runningMode: "VIDEO",
                numHands: 1
            });
            console.log("HandLandmarker loaded successfully");
        } catch (e) {
            console.error("HandLandmarker fail:", e);
            this.disableGestureUI();
        }

        this.hideLoader();
        this.animate();

        // Tip ban đầu
        setTimeout(() => {
            if (!this.state.config.gestures) {
                this.showMessage("Chào mừng bạn! Hãy sử dụng chuột để xoay 3D 🎄");
            } else {
                this.showMessage("Chào mừng bạn! Hãy thử dùng cử chỉ tay nhé 🖐️");
            }
        }, 2000);
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

        // OrbitControls for Fallback & Hybrid
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 20;
        this.controls.maxDistance = 150;
        this.controls.autoRotate = false;
        this.controls.enablePan = false;
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
        this.mats = {
            gold: new THREE.MeshStandardMaterial({ color: CONFIG.colors.gold, metalness: 1, roughness: 0.1, emissive: 0x443300 }),
            green: new THREE.MeshStandardMaterial({ color: CONFIG.colors.green, roughness: 0.8, emissive: 0x001100 }),
            red: new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.3, roughness: 0.2, clearcoat: 1 }),
            star: new THREE.MeshStandardMaterial({ color: 0xffdd88, emissive: CONFIG.colors.star, emissiveIntensity: 2, metalness: 1 }),
            dust: new THREE.MeshBasicMaterial({ color: 0xffeebb, transparent: true, opacity: 0.6 })
        };

        const geos = {
            sphere: new THREE.SphereGeometry(0.5, 24, 24),
            box: new THREE.BoxGeometry(0.55, 0.55, 0.55),
            oct: new THREE.OctahedronGeometry(1.2, 0)
        };

        for (let i = 0; i < CONFIG.tree.particleCount; i++) {
            const r = Math.random();
            let mesh, type;

            if (r < 0.4) { mesh = new THREE.Mesh(geos.box, this.mats.green); type = 'LEAF'; }
            else if (r < 0.7) { mesh = new THREE.Mesh(geos.box, this.mats.gold); type = 'GIFT'; }
            else if (r < 0.95) { mesh = new THREE.Mesh(geos.sphere, this.mats.gold); type = 'BALL'; }
            else { mesh = new THREE.Mesh(geos.sphere, this.mats.red); type = 'RED_BALL'; }

            const s = 0.4 + Math.random() * 0.5;
            mesh.scale.set(s, s, s);
            this.mainGroup.add(mesh);
            this.particles.push(new Particle(mesh, type));
        }

        const star = new THREE.Mesh(geos.oct, this.mats.star);
        star.position.y = CONFIG.tree.height / 2 + 1.2;
        this.mainGroup.add(star);

        const dustGeo = new THREE.TetrahedronGeometry(0.08, 0);
        for (let i = 0; i < CONFIG.tree.dustCount; i++) {
            const d = new THREE.Mesh(dustGeo, this.mats.dust);
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
        if (this.video && this.video.srcObject) return;

        this.showMessage("Đang yêu cầu quyền Camera... 📸");

        // Kiểm tra thiết bị
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            const devices = await navigator.mediaDevices.enumerateDevices();
            if (!devices.some(d => d.kind === 'videoinput')) {
                this.showMessage("⚠️ Không tìm thấy Camera trên thiết bị này.");
                throw new Error("No camera");
            }
        }

        if (!this.handLandmarker) {
            this.showMessage("Đang tải mô hình trí tuệ nhân tạo... 🧠");
            const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                    delegate: "AUTO"
                },
                runningMode: "VIDEO",
                numHands: 1
            });
        }

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
            video.setAttribute("playsinline", true);
            video.setAttribute("muted", true);
            video.muted = true;

            await new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    video.play().then(resolve).catch(e => {
                        console.error("Play failed:", e);
                        resolve();
                    });
                };
            });

            this.video = video;

            // Sync UI and State
            this.state.config.gestures = true;
            const toggle = document.getElementById('toggle-gestures');
            if (toggle) toggle.checked = true;
            this.updateGuideContent();

            this.predict();
            this.showMessage("✨ Camera đã sẵn sàng! Cử chỉ tay đã BẬT.");
        } else {
            this.showMessage("⚠️ Không thể truy cập Camera. Vui lòng kiểm tra lại quyền.");
            throw new Error("No stream");
        }
    }

    disableGestureUI() {
        this.state.config.gestures = false;
        const toggle = document.getElementById('toggle-gestures');
        if (toggle) toggle.checked = false;
        this.updateGuideContent();
        // Không hiện thông báo ở đây để tránh làm phiền nếu máy ko có cam ngay từ đầu
    }

    predict() {
        if (!this.state.config.gestures) return;

        if (this.handLandmarker && this.video && this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
            this.lastVideoTime = this.video.currentTime;
            try {
                const result = this.handLandmarker.detectForVideo(this.video, performance.now());
                this.processGestures(result);
            } catch (e) {
                console.error("Detection Error:", e);
            }
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
                    this.showMessage("👌 Đã chọn ảnh để xem cận cảnh");
                }
            } else if (openDist < 0.25) {
                if (this.state.mode !== 'TREE') {
                    this.state.mode = 'TREE';
                    this.state.focusTarget = null;
                }
            } else if (openDist > 0.4) {
                if (this.state.mode !== 'SCATTER') {
                    this.state.mode = 'SCATTER';
                    this.state.focusTarget = null;
                }
            }

            // Đếm số ngón tay
            const count = this.countFingers(lms);
            if (count !== this.lastFingerCount) {
                this.lastFingerCount = count;
                if (count > 0) this.showMessage(`Bạn đang giơ ${count} ngón tay 🖐️`);
            }
        } else {
            this.state.hand.detected = false;
            this.lastFingerCount = 0;
        }
    }

    countFingers(lms) {
        let count = 0;
        // Các ngón: Trỏ (8), Giữa (12), Áp út (16), Út (20)
        // Kiểm tra xem khớp đầu ngón có cao hơn khớp MCP (gốc ngón) không
        const tips = [8, 12, 16, 20];
        const bases = [6, 10, 14, 18];

        tips.forEach((tip, idx) => {
            if (lms[tip].y < lms[bases[idx]].y) count++;
        });

        // Riêng ngón cái (4) kiểm tra theo chiều ngang so với gốc ngón (2)
        // (Tùy thuộc vào tay trái hay phải nhưng đơn giản hóa là so sánh khoảng cách x)
        if (Math.abs(lms[4].x - lms[2].x) > 0.1) count++;

        return count;
    }

    bindEvents() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });

        // UI Controls
        const panel = document.getElementById('settings-panel');
        const trigger = document.getElementById('settings-trigger');

        if (trigger) trigger.onclick = () => panel.classList.toggle('open');
        const closeBtn = document.querySelector('.close-settings');
        if (closeBtn) closeBtn.onclick = () => panel.classList.remove('open');

        // Lời nhắn (Gửi lời chúc)
        const updateBtn = document.getElementById('update-message');
        const messageInput = document.getElementById('message-input');
        const appTitle = document.getElementById('app-title');

        if (updateBtn && messageInput && appTitle) {
            updateBtn.onclick = () => {
                const val = messageInput.value.trim();
                if (val) {
                    appTitle.innerText = val.toUpperCase();
                    appTitle.style.opacity = '0.9';
                    messageInput.value = '';
                    this.showMessage("✨ Lời chúc đã được gửi đi!");
                    if (panel) panel.classList.remove('open');
                } else {
                    this.showMessage("⚠️ Hãy nhập lời chúc trước nhé!");
                }
            };
        }

        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.onchange = (e) => this.handleUpload(e);

        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'h') {
                const ui = document.getElementById('ui-layer');
                if (ui) ui.classList.toggle('ui-hidden');
            }
        });

        // Config Toggles
        document.getElementById('toggle-rotate').onchange = (e) => {
            this.state.config.autoRotate = e.target.checked;
        };
        document.getElementById('toggle-gestures').onchange = async (e) => {
            this.state.config.gestures = e.target.checked;
            this.updateGuideContent();
            if (e.target.checked) {
                if (!this.video) {
                    try {
                        await this.initVision();
                    } catch (err) {
                        this.disableGestureUI();
                    }
                } else {
                    this.predict();
                }
            } else {
                this.state.hand.detected = false;
            }
        };
        document.getElementById('toggle-snow').onchange = (e) => {
            this.state.config.snow = e.target.checked;
        };

        const toggleMusic = document.getElementById('toggle-music');
        if (toggleMusic) {
            toggleMusic.onchange = (e) => this.handleMusic(e.target.checked);
        }

        const selectSong = document.getElementById('select-song');
        if (selectSong) {
            selectSong.onchange = (e) => {
                this.state.music.index = parseInt(e.target.value);
                if (this.state.music.playing) this.setupAudio();
            };
        }

        // ... (đã di chuyển lên trên)

        const themeBtns = document.querySelectorAll('.theme-btn');
        themeBtns.forEach(btn => {
            btn.onclick = () => {
                themeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.updateTheme(btn.dataset.theme);
            };
        });

        // Click/Tap Interaction
        const onSelect = (event) => {
            // Chỉ cho phép tương tác chuột/chạm khi chế độ cử chỉ tay đang TẮT
            if (this.state.config.gestures) return;

            // Calculate mouse position
            const x = event.touches ? event.touches[0].clientX : event.clientX;
            const y = event.touches ? event.touches[0].clientY : event.clientY;

            this.mouse.x = (x / window.innerWidth) * 2 - 1;
            this.mouse.y = -(y / window.innerHeight) * 2 + 1;

            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObjects(this.photoGroup.children, true);

            if (intersects.length > 0) {
                // Find the top-level group (the frame+photo)
                let obj = intersects[0].object;
                while (obj.parent && obj.parent !== this.photoGroup) obj = obj.parent;

                this.state.mode = 'FOCUS';
                this.state.focusTarget = obj;
            } else {
                // If clicking background, toggle between TREE and SCATTER
                this.state.mode = (this.state.mode === 'TREE') ? 'SCATTER' : 'TREE';
                this.state.focusTarget = null;
            }
        };

        this.renderer.domElement.addEventListener('mousedown', (e) => {
            if (this.state.config.gestures) return; // Khóa tương tác vật lý nếu bật cử chỉ
            this._clickStartTime = Date.now();
        });
        this.renderer.domElement.addEventListener('mouseup', (e) => {
            if (this.state.config.gestures) return;
            const now = Date.now();
            if (now - this._clickStartTime < 200) {
                // Double click detection
                if (now - (this._lastClickTime || 0) < 300) {
                    this.state.mode = (this.state.mode === 'SCATTER') ? 'TREE' : 'SCATTER';
                    this.state.focusTarget = null;
                } else {
                    onSelect(e);
                }
                this._lastClickTime = now;
            }
        });

        this.renderer.domElement.addEventListener('touchstart', (e) => {
            if (this.state.config.gestures) return;
            this._clickStartTime = Date.now();
        });
        this.renderer.domElement.addEventListener('touchend', (e) => {
            if (this.state.config.gestures) return;
            const now = Date.now();
            if (now - this._clickStartTime < 200) {
                // Double tap detection
                if (now - (this._lastTapTime || 0) < 300) {
                    this.state.mode = (this.state.mode === 'SCATTER') ? 'TREE' : 'SCATTER';
                    this.state.focusTarget = null;
                } else {
                    onSelect(e);
                }
                this._lastTapTime = now;
            }
        });
    }

    handleUpload(e) {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            this.showMessage(`Đang treo ${files.length} kỷ niệm lên cây... 🧦`);
        }
        const loader = new THREE.TextureLoader();
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const dataUrl = ev.target.result;
                loader.load(dataUrl, (t) => {
                    t.colorSpace = THREE.SRGBColorSpace;
                    this.addPhotoToScene(t, dataUrl);
                });
            };
            reader.readAsDataURL(file);
        });
    }

    addPhotoToScene(texture, dataUrl) {
        const id = 'photo_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        const group = new THREE.Group();
        group.userData.id = id;

        const frame = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 1.4, 0.05),
            new THREE.MeshStandardMaterial({ color: this.themes[this.state.mode === 'SCATTER' ? 'starry' : 'classic'].gold, metalness: 1 })
        );
        const photo = new THREE.Mesh(
            new THREE.PlaneGeometry(1.2, 1.2),
            new THREE.MeshBasicMaterial({ map: texture })
        );
        photo.position.z = 0.04;
        group.add(frame, photo);
        group.scale.setScalar(0.8);

        this.photoGroup.add(group);
        const particle = new Particle(group, 'PHOTO');
        particle.id = id;
        particle.dataUrl = dataUrl;
        this.particles.push(particle);

        // Gọi render sau một khoảng nghỉ cực ngắn để đảm bảo array đã được push
        setTimeout(() => this.renderImageList(), 10);
    }

    renderImageList() {
        const container = document.getElementById('image-list');
        if (!container) {
            console.warn("Container #image-list not found in DOM");
            return;
        }

        const photos = this.particles.filter(p => p.type === 'PHOTO');
        if (photos.length === 0) {
            container.innerHTML = '<div style="grid-column: 1/-1; padding: 10px; text-align: center; color: rgba(255,255,255,0.3); font-size: 10px;">Chưa có ảnh nào được treo.</div>';
            return;
        }

        container.innerHTML = photos.map(p => `
            <div class="preview-item">
                <img src="${p.dataUrl}" alt="Kỷ niệm" onerror="this.src='https://via.placeholder.com/100?text=Error'">
                <button class="remove-img" onclick="event.stopPropagation(); window.app.removePhoto('${p.id}')">&times;</button>
            </div>
        `).join('');
    }

    removePhoto(id) {
        const index = this.particles.findIndex(p => p.id === id);
        if (index !== -1) {
            const p = this.particles[index];
            this.photoGroup.remove(p.mesh);
            // Giải phóng bộ nhớ texture
            if (p.mesh.children[1].material.map) {
                p.mesh.children[1].material.map.dispose();
            }
            this.particles.splice(index, 1);
            this.renderImageList();
            this.showMessage("✨ Đã gỡ bỏ 1 kỷ niệm.");

            if (this.state.focusTarget === p.mesh) {
                this.state.focusTarget = null;
                this.state.mode = 'TREE';
            }
        }
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

        let targetRY = (this.state.mode === 'TREE' && this.state.config.autoRotate) ? time * 0.2 : 0;
        let targetRX = 0;

        if (this.state.hand.detected) {
            // Khi có tay, target xoay sẽ theo vị trí tay (đã được mirror để tự nhiên)
            const mirrorX = -this.state.hand.x;
            targetRY = mirrorX * Math.PI * 0.8;
            targetRX = this.state.hand.y * Math.PI * 0.3;
        }

        this.state.rotation.y += (targetRY - this.state.rotation.y) * 2.5 * dt;
        this.state.rotation.x += (targetRX - this.state.rotation.x) * 2.5 * dt;

        // Apply rotation logic based on the switch
        if (this.state.mode === 'FOCUS') {
            this.controls.enabled = false;
            // KHÔNG xoay khi đang focus
        } else if (this.state.config.gestures) {
            this.controls.enabled = false;
            if (this.state.hand.detected) {
                this.mainGroup.rotation.y = this.state.rotation.y;
                this.mainGroup.rotation.x = this.state.rotation.x;
            } else {
                // Tự động xoay nhẹ ở chế độ cử chỉ khi không có tay
                if (this.state.config.autoRotate && this.state.mode === 'TREE') {
                    this.mainGroup.rotation.y += 0.5 * dt;
                } else {
                    this.mainGroup.rotation.y *= 0.95;
                    this.mainGroup.rotation.x *= 0.95;
                }
            }
        } else {
            this.controls.enabled = true;
            this.controls.autoRotate = this.state.config.autoRotate && this.state.mode === 'TREE';
            this.controls.autoRotateSpeed = 1.0;
            this.controls.update();

            // Đảm bảo mainGroup trả về 0 nếu đang ở chế độ chuột để tránh cộng dồn xoay
            this.mainGroup.rotation.y *= 0.95;
            this.mainGroup.rotation.x *= 0.95;
        }

        this.particles.forEach(p => p.update(dt, this.state, this.mainGroup, this.camera));

        // Music Visualizer Logic
        if (this.analyser) {
            this.state.music.frequency = this.analyser.getAverageFrequency();
            const freqNorm = this.state.music.frequency / 128; // 0 to 1

            // Pulse Star & Bloom based on music
            if (this.mats && this.mats.star) {
                this.mats.star.emissiveIntensity = 2 + freqNorm * 6;
            }
            this.renderer.toneMappingExposure = 2.2 + freqNorm * 0.8;
        }

        this.composer.render();
    }

    showMessage(text) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerText = text;

        container.appendChild(toast);

        // Tự xóa sau khi animation kết thúc (4s)
        setTimeout(() => {
            toast.remove();
        }, 4000);
    }

    updateTheme(themeName) {
        const theme = this.themes[themeName];
        if (!theme) return;

        this.mats.gold.color.setHex(theme.gold);
        this.mats.green.color.setHex(theme.green);
        this.mats.red.color.setHex(theme.red);
        this.mats.star.color.setHex(theme.star);
        this.mats.star.emissive.setHex(theme.star);
        this.mats.dust.color.setHex(theme.dust);

        this.showMessage(`Đã chuyển sang chủ đề ${themeName.toUpperCase()} ✨`);
    }

    async handleMusic(play) {
        this.state.music.playing = play;
        if (!this.audioInitialized) {
            this.setupAudio();
        }

        if (play) {
            if (this.sound && this.sound.buffer) {
                this.sound.play();
                this.showMessage("🎶 Đang phát nhạc Giáng sinh...");
            }
        } else {
            if (this.sound && this.sound.isPlaying) {
                this.sound.pause();
                this.showMessage("🔇 Đã tắt nhạc");
            }
        }
    }

    setupAudio() {
        if (!this.sound) {
            const listener = new THREE.AudioListener();
            this.camera.add(listener);
            this.sound = new THREE.Audio(listener);
            this.analyser = new THREE.AudioAnalyser(this.sound, 32);
        }

        if (this.sound.isPlaying) this.sound.stop();

        const audioLoader = new THREE.AudioLoader();
        const songUrl = this.state.music.playlist[this.state.music.index];

        audioLoader.load(songUrl, (buffer) => {
            this.sound.setBuffer(buffer);
            this.sound.setLoop(true);
            this.sound.setVolume(0.5);
            if (this.state.music.playing) {
                this.sound.play();
            }
            this.audioInitialized = true;
        }, undefined, (err) => {
            console.error("Audio Load Error:", err);
            this.showMessage("❌ Không thể tải nhạc, vui lòng thử lại!");
        });
    }

    updateGuideContent() {
        const guide = document.getElementById('gesture-guide-content');
        if (!guide) return;

        if (this.state.config.gestures) {
            guide.innerHTML = `
                🖐️ <b>Xòe tay:</b> Xem tất cả ảnh<br>
                ✊ <b>Nắm tay:</b> Thu gọn cây thông<br>
                👌 <b>Nhón tay:</b> Xem cận cảnh 1 ảnh<br>
                ↔️ <b>Di chuyển:</b> Xoay không gian 3D
            `;
        } else {
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            if (isMobile) {
                guide.innerHTML = `
                    👆 <b>Chạm vào ảnh:</b> Xem cận cảnh<br>
                    🌚 <b>Chạm vùng trống:</b> Tỏa hạt/Cây thông<br>
                    👆 <b>Vuốt 1 ngón:</b> Xoay không gian<br>
                    ✌️ <b>Dùng 2 ngón:</b> Phóng to/Thu nhỏ
                `;
            } else {
                guide.innerHTML = `
                    🖱️ <b>Click vào ảnh:</b> Xem cận cảnh<br>
                    🌌 <b>Double Click:</b> Tỏa hạt/Cây thông<br>
                    🖱️ <b>Giữ chuột trái:</b> Xoay không gian<br>
                    🎡 <b>Cuộn chuột:</b> Phóng to/Thu nhỏ
                `;
            }
        }
    }
}
