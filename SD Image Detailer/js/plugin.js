eagle.onPluginCreate(async (plugin) => {
    console.log('eagle.onPluginCreate');

    // テーマ適用
    await updateTheme();

    // 選択ファイル取得
    let selected_items = await eagle.item.getSelected();
    document.querySelector('#selected-count').innerText = selected_items.length;

    // 選択ファイルリスト表示
    let filesEl = document.querySelector('#selected-files');
    filesEl.innerHTML = "";
    let fileItems = {};
    selected_items.forEach(item => {
        fileItems[item.id] = addFileItem(item);
    });

    // ウィンドウ高さ自動調整
    await adjustWindowHeight(selected_items.length);

    // URL入力欄が変更されたときにドロップダウン再読み込み
    const webuiUrlInput = document.getElementById("webui-url");
    webuiUrlInput.addEventListener("input", async () => {
        await loadDropdowns();
    });

    // 前回の状態読み込み
    loadUIState();

    // Hires/ADetailerの有効/無効の表示切り替え
    toggleFieldset(document.getElementById('hires-enabled').closest('fieldset'), document.getElementById('hires-enabled'));
    toggleFieldset(document.getElementById('adetailer-enabled').closest('fieldset'), document.getElementById('adetailer-enabled'));

    // Upscaler, ADtailerModelのドロップダウンリスト読み込み
    await loadDropdowns();

    // ドロップダウンリストの反映のためもう一度読み込み
    loadUIState();

    // UI変更時に状態保存
    document.querySelectorAll("input, select").forEach(el => {
        el.addEventListener("change", saveUIState);
        el.addEventListener("input", saveUIState);
    });

    // 生成ボタン
    const generateBtn = document.querySelector('#generate-btn');
    const resultMessage = document.querySelector('#result-message');
    generateBtn.addEventListener('click', async () => {
        if (generateBtn.classList.contains("generating")) {
            // 中断
            generateBtn.style.display = "none";
            resultMessage.textContent = "生成を中断しました";
            resultMessage.style.display = "inline";
            await callSDInterruptAPI();
            return;
        }

        generateBtn.textContent = "中断";
        generateBtn.classList.add("generating");

        const controls = document.querySelectorAll("input, select, textarea");
        controls.forEach(el => {
            if (el !== generateBtn) {
                el.disabled = true;
            }
        });

        let selected_items = await eagle.item.getSelected();
        let total = selected_items.length;
        let completed = 0;

        updateProgress(0, completed, total);

        for (let item of selected_items) {
            let payload = parseAnnotation(item.annotation);
            payload.send_images = false;
            payload.save_images = true;

            if (document.querySelector('#hires-enabled').checked) {
                payload.enable_hr = true;
                payload.hr_upscaler = document.querySelector('#hires-upscaler').value;
                payload.hr_scale = parseFloat(document.querySelector('#hires-scale').value);
                payload.denoising_strength = parseFloat(document.querySelector('#hires-denoise').value);
                payload.hr_cfg = 2.5;
                payload.hr_scheduler = "Automatic";
            }

            if (document.querySelector('#adetailer-enabled').checked) {
                payload.alwayson_scripts = {
                    "ADetailer": {
                        "args": [
                            true,
                            false,
                            {
                                "ad_cfg_scale": 2.5,
                                "ad_checkpoint": "Use same checkpoint",
                                "ad_clip_skip": 1,
                                "ad_denoising_strength": parseFloat(document.querySelector('#adetailer-denoise').value),
                                "ad_inpaint_height": 1024,
                                "ad_inpaint_width": 1024,
                                "ad_model": document.querySelector('#adetailer-model').value,
                                "ad_sampler": "Use same sampler",
                                "ad_scheduler": "Use same scheduler",
                                "ad_steps": 30,
                                "ad_tab_enable": true,
                                "ad_vae": "Use same VAE"
                            }
                        ]
                    }
                };
            }

            const result = await callSDGenerationAPI(payload, fileItems[item.id]);

            if (result.interrupted) {
                console.warn("中断で停止");
                break;
            }

            completed++;
            updateProgress(Math.round((completed / total) * 100), completed, total);

            // 生成完了
            if (completed == total) {
                generateBtn.style.display = "none";
                resultMessage.style.display = "inline";
            }
        }
    });
});

eagle.onPluginRun(() => {
    console.log('eagle.onPluginRun');
});

eagle.onPluginShow(async () => {
    console.log('eagle.onPluginShow');
});

eagle.onPluginHide(() => {
    console.log('eagle.onPluginHide');
});

eagle.onPluginBeforeExit((event) => {
    console.log('eagle.onPluginBeforeExit');
});

// --- ユーティリティ関数 ---

function parseAnnotation(annotation) {
    let payload = {};
    let promptPart = "";
    let rest = "";

    if (annotation.includes("Negative prompt:")) {
        // Negative prompt がある場合
        [promptPart, rest] = annotation.split("Negative prompt:");
        payload.prompt = promptPart.trim();

        if (rest) {
            let [negPromptPart, restConfig] = rest.split(/Steps:/);
            payload.negative_prompt = negPromptPart.trim();
            rest = "Steps:" + restConfig;
        }
    } else {
        // Negative prompt がない場合
        let [promptOnly, restConfig] = annotation.split(/Steps:/);
        if (promptOnly) payload.prompt = promptOnly.trim();
        if (restConfig) rest = "Steps:" + restConfig;
    }

    const regexMap = {
        steps: /Steps:\s*(\d+)/,
        sampler_name: /Sampler:\s*([^,]+)/,
        scheduler: /Schedule type:\s*([^,]+)/,
        cfg_scale: /CFG scale:\s*([\d.]+)/,
        seed: /Seed:\s*(\d+)/,
        size: /Size:\s*(\d+x\d+)/,
    };

    for (let key in regexMap) {
        let match = rest.match(regexMap[key]);
        if (match) {
            if (key === "size") {
                let [w, h] = match[1].split("x").map(n => parseInt(n.trim()));
                payload.width = w;
                payload.height = h;
            } else if (key === "steps" || key === "seed") {
                payload[key] = parseInt(match[1]);
            } else if (key === "cfg_scale") {
                payload[key] = parseFloat(match[1]);
            } else {
                payload[key] = match[1].trim();
            }
        }
    }
    return payload;
}

async function callSDGenerationAPI(payload, fileItem) {
    const baseUrl = document.getElementById("webui-url").value;
    const generationUrl = `${baseUrl}/sdapi/v1/txt2img`;

    let isDone = false;
    let data = null;
    let interrupted = false;

    try {
        const generationPromise = fetch(generationUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        generationPromise.then(() => isDone = true).catch(() => isDone = true);

        while (!isDone && !interrupted) {
            try {
                const prog = await callSDProgressAPI();

                if (prog.state?.interrupted) {
                    console.warn("Generation interrupted!");
                    interrupted = true;
                    break;
                }

                const percent = Math.round(prog.progress * 100);
                if (fileItem) fileItem.setProgress(percent);

            } catch (err) {
                console.warn("Progress check error:", err);
            }
            await new Promise(r => setTimeout(r, 500));
        }

        if (!interrupted) {
            // 最終レスポンス
            const res = await generationPromise;
            data = await res.json();
            if (fileItem) fileItem.setProgress(100, true);
            console.log("SD response:", data);
        }

    } catch (err) {
        console.error("Error during generation:", err);
        if (fileItem) fileItem.setProgress(0);
        data = null;
    }

    return { data, interrupted };
}

async function callSDProgressAPI() {
    const baseUrl = document.getElementById("webui-url").value;
    const progressUrl = `${baseUrl}/sdapi/v1/progress`;

    try {
        const res = await fetch(progressUrl);
        const prog = await res.json();
        console.log("Progress:", prog);
        return prog;
    } catch (err) {
        console.warn("Progress check error:", err);
        return null;
    }
}

async function callSDInterruptAPI() {
    const baseUrl = document.getElementById("webui-url").value;
    const interruptUrl = `${baseUrl}/sdapi/v1/interrupt`;

    try {
        const res = await fetch(interruptUrl, { method: "POST" });
        if (res.ok) {
            console.log("Generation interrupted successfully");
        } else {
            console.error("Failed to interrupt generation:", res.status);
        }
    } catch (err) {
        console.error("Interrupt request error:", err);
    }
}

function updateProgress(percent, completed, total) {
    document.querySelector('#progress-bar').style.width = percent + "%";
    document.querySelector('#progress-text').innerText = `完了ファイル：${completed} / ${total} (${percent}%)`;
}

async function loadDropdowns() {
    const baseUrl = document.getElementById("webui-url").value;

    const upscalerSelect = document.getElementById("hires-upscaler");
    const adetailerSelect = document.getElementById("adetailer-model");
    const upscalerError = document.getElementById("hires-upscaler-error");
    const adetailerError = document.getElementById("adetailer-model-error");
    const generateBtn = document.getElementById("generate-btn");

    upscalerSelect.innerHTML = "";
    adetailerSelect.innerHTML = "";
    upscalerError.textContent = "";
    adetailerError.textContent = "";

    let allSuccess = true;
    generateBtn.disabled = true; // 一旦無効化

    try {
        // Upscalers
        let upscalerRes = await fetch(`${baseUrl}/sdapi/v1/upscalers`);
        let upscalers = await upscalerRes.json();
        upscalers.forEach(u => {
            let opt = document.createElement("option");
            opt.value = u.name;
            opt.textContent = u.name;
            upscalerSelect.appendChild(opt);
        });
    } catch (err) {
        console.error("Upscaler fetch error:", err);
        upscalerError.textContent = "※取得失敗";
        allSuccess = false;
    }

    try {
        // ADetailer models
        let adetailerRes = await fetch(`${baseUrl}/adetailer/v1/ad_model`);
        let adModels = await adetailerRes.json();
        (adModels.ad_model || []).forEach(model => {
            let opt = document.createElement("option");
            opt.value = model;
            opt.textContent = model;
            adetailerSelect.appendChild(opt);
        });
    } catch (err) {
        console.error("ADetailer fetch error:", err);
        adetailerError.textContent = "※取得失敗";
        allSuccess = false;
    }

    // 成功判定で生成ボタンを切り替え
    generateBtn.disabled = !allSuccess;
}

function addFileItem(file) {
    const container = document.getElementById("selected-files");

    const item = document.createElement("div");
    item.className = "file-item";

    const thumb = document.createElement("img");
    thumb.className = "file-thumbnail";
    thumb.src = file.thumbnailPath || file.thumbnailURL;

    const info = document.createElement("div");
    info.className = "file-info";

    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = file.name + "." + file.ext;

    const progressContainer = document.createElement("div");
    progressContainer.className = "file-progress-container";

    const progressBar = document.createElement("div");
    progressBar.className = "file-progress-bar";
    progressContainer.appendChild(progressBar);

    info.appendChild(name);
    info.appendChild(progressContainer);

    item.appendChild(thumb);
    item.appendChild(info);
    container.appendChild(item);

    return {
        item,
        name,
        progressContainer,
        progressBar,
        setProgress(pct, done = false) {
            this.progressContainer.style.display = "block";
            this.progressBar.style.width = pct + "%";
            if (done) this.progressBar.style.background = "#4caf50";
        }
    };
}

async function adjustWindowHeight(selectedCount) {
    const baseHeight = 460;      // main padding + ヘッダー + ボタンなど余白
    const itemHeight = 60;       // .file-item の高さ目安
    const maxHeight = 800;       // ウィンドウ最大高さ

    // 選択ファイルに応じた高さ
    selectedCount = Math.min(selectedCount, 3);
    let newHeight = baseHeight + selectedCount * itemHeight;
    if (newHeight > maxHeight) newHeight = maxHeight;

    // ウィンドウサイズを設定
    await eagle.window.setSize(500, newHeight);
}

function toggleFieldset(fieldset, checkbox) {
    function update() {
        const disabled = !checkbox.checked;
        Array.from(fieldset.querySelectorAll('input, select, label')).forEach(el => {
            if (el !== checkbox) {
                el.disabled = disabled;
                el.style.opacity = disabled ? 0.6 : 1;
            }
        });
    }

    checkbox.addEventListener('change', update);
    update();
}

async function updateTheme() {
    const THEME_SUPPORT = {
        AUTO: eagle.app.isDarkColors() ? 'gray' : 'light',
        LIGHT: 'light',
        LIGHTGRAY: 'lightgray',
        GRAY: 'gray',
        DARK: 'dark',
        BLUE: 'blue',
        PURPLE: 'purple',
    };
    const theme = eagle.app.theme.toUpperCase();
    const themeName = THEME_SUPPORT[theme] ?? 'dark';
    const htmlEl = document.querySelector('html');
    htmlEl.classList.add('no-transition');
    htmlEl.setAttribute('theme', themeName);
    htmlEl.setAttribute('platform', eagle.app.platform);
    htmlEl.classList.remove('no-transition');
}

// 状態を保存する
function saveUIState() {
    const state = {
        hiresEnabled: document.getElementById("hires-enabled").checked,
        hiresUpscaler: document.getElementById("hires-upscaler").value,
        hiresScale: document.getElementById("hires-scale").value,
        hiresDenoise: document.getElementById("hires-denoise").value,
        adetailerEnabled: document.getElementById("adetailer-enabled").checked,
        adetailerModel: document.getElementById("adetailer-model").value,
        adetailerDenoise: document.getElementById("adetailer-denoise").value,
        webuiUrl: document.getElementById("webui-url").value,
    };
    localStorage.setItem("sd-ui-state", JSON.stringify(state));
}

// 状態を復元する
function loadUIState() {
    const stateStr = localStorage.getItem("sd-ui-state");
    if (!stateStr) return;

    try {
        const state = JSON.parse(stateStr);
        document.getElementById("hires-enabled").checked = state.hiresEnabled ?? true;
        document.getElementById("hires-upscaler").value = state.hiresUpscaler ?? "None";
        document.getElementById("hires-scale").value = state.hiresScale ?? "1.5";
        document.getElementById("hires-denoise").value = state.hiresDenoise ?? "0.2";
        document.getElementById("adetailer-enabled").checked = state.adetailerEnabled ?? true;
        document.getElementById("adetailer-model").value = state.adetailerModel ?? "face_yolov8n.pt";
        document.getElementById("adetailer-denoise").value = state.adetailerDenoise ?? "0.2";
        document.getElementById("webui-url").value = state.webuiUrl ?? "http://127.0.0.1:7860";
    } catch (e) {
        console.error("UI state restore error:", e);
    }
}
