let currentCharacterFrames = { neutral: null, talking: null };
let uploadedNeutralDataUrl = null; // new: store uploaded start frame
let isGenerating = false;
let isSpeaking = false;
let talkInterval = null;

const characterImg = document.getElementById('character');
const mouthOverlay = document.getElementById('mouthOverlay');
const textInput = document.getElementById('textInput');
const speakInput = document.getElementById('speakInput');
const generateBtn = document.getElementById('generateBtn');
const speakBtn = document.getElementById('speakBtn');
const status = document.getElementById('status');
const uploadInput = document.getElementById('uploadInput');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingMessage = document.getElementById('loadingMessage');
const gallery = document.getElementById('gallery');

function showLoading(message = 'Loading...') {
    if (loadingOverlay) {
        loadingMessage.textContent = message;
        loadingOverlay.setAttribute('aria-hidden', 'false');
    }
}

function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.setAttribute('aria-hidden', 'true');
    }
}

// helper to record canvas + audio to animated webp (if supported)
async function recordCanvasWithAudio(drawFn, durationMs, audioElement) {
    // create canvas sized to character 512x512 for consistency
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // draw first frame immediately
    drawFn(ctx, 0);

    // capture canvas stream
    const canvasStream = canvas.captureStream(30); // 30fps
    let mixedStream = canvasStream;

    // if audio provided, get its MediaStream via capture from audio element (via AudioContext)
    if (audioElement) {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = audioCtx.createMediaStreamDestination();
        const source = audioCtx.createMediaElementSource(audioElement);
        source.connect(dest);
        source.connect(audioCtx.destination); // playback
        mixedStream = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    }

    // choose mime if available
    let options = {};
    const possible = [
        'image/webp;codecs=vp8,opus',
        'image/webp;codecs=vp8',
        'image/webp'
    ];
    for (const m of possible) {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) {
            options.mimeType = m;
            break;
        }
    }

    const recorder = new MediaRecorder(mixedStream, options.mimeType ? { mimeType: options.mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    recorder.start(100); // gather small chunks

    // drawing loop synced to 200ms flip as used elsewhere; run at 30fps but swap images every 200ms using drawFn param frameIndex
    const fps = 30;
    let elapsed = 0;
    let frame = 0;
    const interval = 1000 / fps;
    const start = performance.now();
    let rafId;

    const step = (now) => {
        elapsed = now - start;
        // call draw with logical frame index based on elapsed (every 200ms toggles)
        const logicalIndex = Math.floor(elapsed / 200);
        drawFn(ctx, logicalIndex);
        frame++;
        if (elapsed < durationMs) {
            rafId = requestAnimationFrame(step);
        } else {
            // finish
            cancelAnimationFrame(rafId);
            setTimeout(() => {
                recorder.stop();
            }, 50);
        }
    };
    rafId = requestAnimationFrame(step);

    return await new Promise((resolve, reject) => {
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: options.mimeType || chunks[0]?.type || 'image/webp' });
            resolve(blob);
        };
        recorder.onerror = (ev) => reject(ev);
    });
}

generateBtn.addEventListener('click', async () => {
    if (isGenerating) return;
    const promptText = textInput.value.trim();
    if (!promptText) {
        status.textContent = 'Please enter a prompt to generate the character.';
        return;
    }
    isGenerating = true;
    generateBtn.disabled = true;
    showLoading('Generating base character and talking frame...');
    status.textContent = 'Generating base character and talking frame...';
    try {
        // Generate base (neutral) frame
        const result1 = await websim.imageGen({
            prompt: promptText,
            width: 512,
            height: 512
        });
        currentCharacterFrames.neutral = result1.url;
        characterImg.src = currentCharacterFrames.neutral;

        // Prepare base64 for next generation
        let base64;
        if (result1.url.startsWith('data:')) {
            base64 = result1.url;
        } else {
            const response = await fetch(result1.url);
            const blob = await response.blob();
            base64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        }

        // Generate talking frame automatically
        const result2 = await websim.imageGen({
            prompt: "Make this character's mouth open as if talking or speaking, keep the same art style and colors",
            image_inputs: [{ url: base64 }],
            width: 512,
            height: 512
        });
        currentCharacterFrames.talking = result2.url;

        status.textContent = 'Character generated with 2 frames! Enter text to speak.';
        hideLoading();
        textInput.value = '';
        // ensure speak input is focused for speaking
        speakInput.placeholder = 'Enter text to speak...';
        speakInput.value = '';
        speakBtn.disabled = false;
    } catch (error) {
        console.error('Error generating character:', error);
        status.textContent = 'Error generating character or talking frame. Please try again.';
        hideLoading();
    } finally {
        isGenerating = false;
        generateBtn.disabled = false;
    }
});

uploadInput.addEventListener('change', async () => {
    const file = uploadInput.files && uploadInput.files[0];
    if (!file) {
        status.textContent = 'Please choose an image file to upload first.';
        return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
        uploadedNeutralDataUrl = reader.result;
        currentCharacterFrames.neutral = uploadedNeutralDataUrl;
        characterImg.src = uploadedNeutralDataUrl;
        status.textContent = 'Uploaded image set; generating talking frame...';
        showLoading('Generating talking frame from uploaded image...');
        try {
            const base64 = uploadedNeutralDataUrl;
            const result2 = await websim.imageGen({
                prompt: "Make this character's mouth open as if talking or speaking, keep the same art style and colors",
                image_inputs: [{ url: base64 }],
                width: 512,
                height: 512
            });
            currentCharacterFrames.talking = result2.url;
            status.textContent = 'Frames ready! Enter text and press Speak to animate.';
            hideLoading();
            speakInput.placeholder = 'Enter text to speak...';
            speakBtn.disabled = false;
        } catch (err) {
            console.error(err);
            status.textContent = 'Error generating talking frame from upload.';
            hideLoading();
        }
    };
    reader.readAsDataURL(file);
});

async function speakText() {
    const textToSpeak = speakInput.value.trim();
    if (isSpeaking || !textToSpeak) {
        if (!textToSpeak) status.textContent = 'Please enter text to speak.';
        return;
    }
    
    isSpeaking = true;
    speakBtn.disabled = true;
    const text = textToSpeak;
    
    try {
        // Generate speech
        status.textContent = 'Generating speech...';
        showLoading('Generating speech and preparing recording...');
        const ttsResult = await websim.textToSpeech({
            text: text,
            voice: 'en-male'
        });
        
        // Create audio element
        const audio = new Audio(ttsResult.url);
        audio.crossOrigin = "anonymous";
        
        // hide loading UI before starting playback/animation per requirement
        hideLoading();

        // Prepare draw function for canvas recording
        const frames = {
            neutral: currentCharacterFrames.neutral,
            talking: currentCharacterFrames.talking
        };

        const drawFn = (ctx, logicalIndex) => {
            // logicalIndex toggles every 200ms; even -> talking, odd -> neutral
            const showTalking = (logicalIndex % 2) === 0;
            const src = showTalking ? frames.talking : frames.neutral;
            // clear and draw image (synchronous via Image)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0,0,512,512);
            if (!src) return;
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = src;
            // draw if loaded, otherwise wait briefly (best-effort)
            if (img.complete) {
                ctx.drawImage(img, 0, 0, 512, 512);
            } else {
                img.onload = () => ctx.drawImage(img, 0, 0, 512, 512);
            }
        };

        // Wait a moment to ensure audio can be loaded
        await audio.play().catch(() => { /* autoplay may be blocked, we'll play on user gesture (speakBtn) so should work */ });
        audio.pause();
        audio.currentTime = 0;

        // Start recording while playing audio; duration from audio metadata if available, else estimate using length of TTS text (fall back)
        let durationMs = 0;
        // Try to fetch duration via metadata
        await new Promise((res) => {
            audio.addEventListener('loadedmetadata', () => {
                durationMs = (audio.duration || 1) * 1000;
                res();
            });
            // safety timeout
            setTimeout(() => {
                if (!durationMs) durationMs = Math.max(1500, text.length * 60); // fallback estimate
                res();
            }, 800);
        });

        // Start recording and playback together
        const recordingPromise = recordCanvasWithAudio(drawFn, durationMs + 200, audio); // small pad
        // play audio now (canvas recording function will route audio via AudioContext)
        await audio.play();

        status.textContent = 'Recording spoken generation...';
        // Stop when audio ends handled by recording promise resolution
        const webpBlob = await recordingPromise;

        // Create gallery item
        const url = URL.createObjectURL(webpBlob);
        const item = document.createElement('div');
        item.className = 'gallery-item';
        const thumb = document.createElement('img');
        thumb.src = url;
        thumb.alt = 'Spoken generation';
        item.appendChild(thumb);

        // add download link overlay
        const link = document.createElement('a');
        link.href = url;
        link.download = `spoken_generation_${Date.now()}.webp`;
        link.title = 'Download WebP';
        link.style.position = 'absolute';
        link.style.width = '100%';
        link.style.height = '100%';
        link.style.top = 0;
        link.style.left = 0;
        link.style.textIndent = '-9999px';
        item.style.position = 'relative';
        item.appendChild(link);

        gallery.prepend(item);

        // cleanup and UI restore
        characterImg.src = currentCharacterFrames.neutral;
        isSpeaking = false;
        speakBtn.disabled = false;
        status.textContent = 'Recording complete — saved to gallery!';
        hideLoading();

    } catch (error) {
        console.error('Error with TTS or recording:', error);
        if (talkInterval) { clearInterval(talkInterval); talkInterval = null; }
        characterImg.src = currentCharacterFrames.neutral;
        isSpeaking = false;
        speakBtn.disabled = false;
        status.textContent = 'Error generating speech or recording. Please try again.';
        hideLoading();
    }
}

// attach speak button and initialize UI state
speakBtn.addEventListener('click', speakText);

textInput.disabled = false; // allow entering prompt for generation initially
speakInput.disabled = false;
speakBtn.disabled = true;