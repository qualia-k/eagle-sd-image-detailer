eagle.onPluginCreate(async (plugin) => {
    console.log('eagle.onPluginCreate');

    updateTheme();
    let selected_items = await eagle.item.getSelected();

    // 選択数表示
    document.querySelector('#selected-count').innerText = selected_items.length;

    // 選択ファイル名リスト表示
    let filesEl = document.querySelector('#selected-files');
    filesEl.innerHTML = ""; // まずクリア
    selected_items.forEach(item => {
        let div = document.createElement('div');
        div.textContent = item.name; // item.name でファイル名
        filesEl.appendChild(div);
    });

    // 生成ボタンイベント
    document.querySelector('#generate-btn').addEventListener('click', async () => {
        document.querySelector('#progress').innerText = "処理中...";

        for (let item of selected_items) {
            let payload = parseAnnotation(item.annotation);

            // 追加パラメータ
            payload.send_images = false;
            payload.save_images = true;

            if (document.querySelector('#hires-enabled').checked) {
                payload.enable_hr = true;
                payload.hr_upscaler = document.querySelector('#hires-upscaler').value;
                payload.hr_scale = parseFloat(document.querySelector('#hires-scale').value);
                payload.denoising_strength = parseFloat(document.querySelector('#hires-denoise').value);
                payload.hr_cfg = 2.5,
                    payload.hr_scheduler = "Automatic"
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

            await sendToSD(payload);
        }

        document.querySelector('#progress').innerText = "完了！";
    });
});

eagle.onPluginRun(() => {
    console.log('eagle.onPluginRun');
});

eagle.onPluginShow(async () => {
    console.log('eagle.onPluginShow');
    //document.querySelector('#selected-count').innerText = selected_items.length;

});

eagle.onPluginHide(() => {
    console.log('eagle.onPluginHide');
});

eagle.onPluginBeforeExit((event) => {
    console.log('eagle.onPluginBeforeExit');
});

function parseAnnotation(annotation) {
    let payload = {};

    // Prompt と Negative Prompt
    let [promptPart, rest] = annotation.split("Negative prompt:");
    if (promptPart) {
        payload.prompt = promptPart.trim();
    }
    if (rest) {
        let [negPromptPart, restConfig] = rest.split(/Steps:/);
        payload.negative_prompt = negPromptPart.trim();
        rest = "Steps:" + restConfig;
    }

    // 各パラメータを正規表現で抽出
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

async function sendToSD(payload) {
    let url = "http://127.0.0.1:7860/sdapi/v1/txt2img";
    try {
        let response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        let data = await response.json();
        console.log("SD response:", data);
    } catch (err) {
        console.error("Error:", err);
    }
}

async function updateTheme() {
    const THEME_SUPPORT = {
        AUTO: eagle.app.isDarkColors() ? 'gray' : 'light',
        LIGHT: 'light',
        LIGHTGRAY: 'lightgray',
        GRAY: 'gray',
        DARK: 'light',
        BLUE: 'blue',
        PURPLE: 'purple',
    };

    const theme = eagle.app.theme.toUpperCase();
    console.log('current Theme:', theme);
    const themeName = THEME_SUPPORT[theme] ?? 'dark';
    const htmlEl = document.querySelector('html');

    htmlEl.classList.add('no-transition');
    htmlEl.setAttribute('theme', themeName);
    htmlEl.setAttribute('platform', eagle.app.platform);
    htmlEl.classList.remove('no-transition');

    console.log('Theme applied:', themeName);
}