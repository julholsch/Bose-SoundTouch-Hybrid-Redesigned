
    // --- GLOBAL STATE ---
let currentDevices = []; // Stores the latest snapshot of speaker data from the backend.
let isUserInteracting = false; // Flags if the user is dragging a slider to pause polling.
let isPollingFrozen = false; // Temporarily disables updates during network operations.
let lastRenderedHTML = ""; // Caches the last HTML string to optimize DOM diffing.
let globalSettings = {
    mobileAutoSortSpeakers: true
};

    // --- CONFIGURATION ---
    const POLLING_DELAY = 3500; // Time to wait after a command before resuming polling (Network latency mask).
    let volumeThrottleTimer = null; // Timer for debouncing main volume inputs.
    let interactionWatchdog = null; // Safety timer to resume polling if the user stops interacting.

const LockManager = {
    locks: {},

    // Sets a lock for a specific device IP and property type (POWER, TRANSPORT, etc).
    set: function (ip, type, val, expected = null) {
        this.locks[ip] = {
            type,
            val,
            expected,
            timestamp: Date.now()
        };
        try {

            renderSpeakers(true); // Forces an immediate re-render to reflect the user's action.
        } catch (e) {
            console.log("Error Executing renderSpeaker(true)");
        }
    },

    get: function (ip) {
        return this.locks[ip];
    },

    // Checks if the backend state has "caught up" to the lock.
    // If the hardware reports the expected state, the lock is released.
    check: function (device) {
        const lock = this.locks[device.ip];
        if (!lock)
            return;
        if (isPollingFrozen)
            return;

        // Transport Lock Logic (Play/Pause handling)
        if (lock.type === 'TRANSPORT' && lock.val === 'PLAY_PAUSE') {
            const current = device.playStatus;
            const expected = lock.expected;

            // Only delete the yellow lock if the speaker actually PAUSED
            if (expected === 'NOT_PLAYING') {
                if (current === 'PAUSE_STATE' || current === 'STOP_STATE')
                    delete this.locks[device.ip];
            }
            // Only delete the green lock if the speaker actually PLAYED
            else if (expected === 'PLAYING') {
                if (current === 'PLAY_STATE' || current === 'BUFFERING_STATE')
                    delete this.locks[device.ip];
            }

            // Failsafe: Expire locks older than 60s to prevent stuck UI states.
            if (Date.now() - lock.timestamp > 60000)
                delete this.locks[device.ip];
            return;
        }

        // General Lock Release: If device reports it is "Ready for Display", release.
        if (device.readyForDisplay) {
            delete this.locks[device.ip];
        }
    }
};


async function loadDeviceStatus() {
    try {
        const status = await fetch("api/status");
        const newStatusData = await status.json();
        try {
            const healthStatus = await fetch('/api/health');
            if (healthStatus.ok) {
                const h = await healthStatus.json();
                const banner = document.getElementById('mass-error-banner');
                if (banner) {
                    if (h && h.healthy === false) {
                        if (banner.style.display !== 'flex')
                            banner.style.display = 'flex';
                    } else {
                        banner.style.display = 'none';
                    }
                }
            }
        } catch (e) { 
            console.log("Health Error: ", e);
        }	
        if (currentDevices.length > 0) {
            newStatusData.forEach(newDev => {
                const oldDev = currentDevices.find(d => d.ip === newDev.ip);
                const isLocked = LockManager.get(newDev.ip);
                if (oldDev && isLocked && !newDev.readyForDisplay && !newDev.isStandby) {
                    newDev.track = oldDev.track;
                    newDev.artist = oldDev.artist;
                    newDev.album = oldDev.album;
                    newDev.art = oldDev.art;
                }
            });
        }

        currentDevices = newStatusData;
        currentDevices.forEach(d => LockManager.check(d));

    } catch (e) {
        console.error(e);
    }
}


// --- NOW PLAYING POLLING ---
// Starts the poller only when the "Now Playing" tab is active to save resources.

let lastSeenPosition = -1;
let lastSeenTrack = "";
let positionAnchorTime = Date.now();
let localTicker = null;
let npInterval = null;
let lastKnownDevice = null;

async function startNpPolling() {
    if (npInterval)
        clearInterval(npInterval);
    if (localTicker)
        clearInterval(localTicker);

    await loadNowPlaying();

    // 📡 NETWORK POLLING: Stays at 2.5 seconds
    npInterval = setInterval(loadNowPlaying, 2000);

    // ⏱️ UI TICKER: Updates the screen every 1 second
    localTicker = setInterval(() => {
        if (lastKnownDevice)
            updateNpUI(lastKnownDevice);

    }, 1000);
}

function stopNpPolling() {
    if (npInterval)
        clearInterval(npInterval);
    if (localTicker)
        clearInterval(localTicker);
    npInterval = null;
    localTicker = null;
}

// Fetches status for the *currently selected speaker* dropdown item.
async function loadNowPlaying() {
    const select = document.getElementById('global-speaker');
    if (!select || select.selectedIndex === -1 || !select.value) {
        updateNpUI(null);
        return;
    }

    const targetIp = select.selectedOptions[0].getAttribute('data-ip');
    if (!targetIp) {
        updateNpUI(null);
        return;
    }

    const devices = await api('/api/status');

    if (Array.isArray(devices)) {
        const device = devices.find(device => device.ip === targetIp);

        if (device) {
            // ⏱️ ANCHOR LOGIC: Reset stopwatch if Bose pushes a new time OR the track changes!
            if (device.position !== lastSeenPosition || device.track !== lastSeenTrack) {

                // If the Track Name changed, force our local math to start counting from 0
                if (device.track !== lastSeenTrack) {
                    device.position = 0;
                }

                lastSeenPosition = device.position;
                lastSeenTrack = device.track;
                positionAnchorTime = Date.now();
            }

            // Apply the true anchor time to the device so the math works
            device.lastUpdateAt = positionAnchorTime;
            lastKnownDevice = device;


            updateNpUI(device);
        }
    } else {
    }
    

}

// Updates the Now Playing card with Art, Metadata, and Status Badge.
function updateNpUI(device) {

/*     const devicesWithIndex = currentDevices.map((d, i) => ({
        ...d,
        originalIndex: i
    }));

    console.log("devicesWithIndex: ", devicesWithIndex);
    const visibleDevices = devicesWithIndex.filter(d => d.stereoRole !== 'RIGHT');
    
    const selectedDevice = visibleDevices.filter(d => d.mac === document.getElementById('global-speaker').selectedOptions[0].dataset.mac);
    console.log("visibleDevices: ", visibleDevices);
    console.log("selectedDevice: ", selectedDevice); */

    const ui = calculateUi(device);

    const nowPlaying = {
        img: document.getElementById('np-img'),
        track: document.getElementById('np-track'),
        artist: document.getElementById('np-artist'),
        album: document.getElementById('np-album'),
        status: document.getElementById('np-status'),
        timer: document.getElementById('np-timer'),
        controls: document.getElementById('np-controls')
    };

    if (device) {
        // --- ARTWORK ---
        nowPlaying.img.outerHTML = /*html*/`
            <div id="np-img" class="np-art ${device.artPlaceholder}">
                ${device.art && device.art !== 'custom_url' ? `<img alt="now playing image" src="${device.art}">` : ''}
            </div>
        `;
        nowPlaying.img = document.getElementById('np-img');
        nowPlaying.img.style.display = 'flex';

        // --- METADATA ---
        nowPlaying.track.innerText = device.track || "Ready";
        nowPlaying.artist.innerText = device.artist || "";
        nowPlaying.album.innerText = device.album || "";

        // --- STATUS & SMOOTH TIMER ---
        if (device.isStandby) {
            nowPlaying.status.innerHTML = `<span style="color:var(--text-secondary)">STANDBY</span>`;
        } else {
            const isPlaying = (device.playStatus === 'PLAY_STATE' || device.playStatus === 'BUFFERING_STATE');
            const color = isPlaying ? "var(--accent)" : (device.playStatus === 'PAUSE_STATE' ? "var(--pending)" : "var(--text-primary)");
            const label = isPlaying ? "PLAYING" : (device.playStatus === 'PAUSE_STATE' ? "PAUSED" : "ON");
            
            ui.playDisabled = false;
            ui.nextDisabled = false; 
            ui.prevDisabled = false;

            // Calculate per-second drift since the last real update from the hardware
            let timerHtml = "";
            if (device.duration > 0) {
                const formatTime = (secs) => {
                    const m = Math.floor(secs / 60);
                    const s = Math.floor(secs % 60).toString().padStart(2, '0');
                    return `${m}:${s}`;
                };

                // The Math: How many seconds passed since the server sent this status?
                const msSinceUpdate = Date.now() - (device.lastUpdateAt || Date.now());
                const secondDrift = isPlaying ? Math.floor(msSinceUpdate / 1000) : 0;

                // Apply drift to the last known position from the hardware
                let currentPos = Math.min((device.position || 0) + secondDrift, device.duration);

                timerHtml = `<span class="np-timer">${formatTime(currentPos)} / ${formatTime(device.duration)}</span>`;
            }

            nowPlaying.status.innerHTML = `<span style="color:${color}">${label}</span>`;
            nowPlaying.timer.innerHTML = `${timerHtml}`;
        }
    } else {
        nowPlaying.img.outerHTML = `<div id="np-img" class="np-art art-blank"></div>`;
        nowPlaying.img = document.getElementById('np-img');
        nowPlaying.img.style.display = 'block';
        nowPlaying.track.innerText = "Ready";
        nowPlaying.artist.innerText = "";
        nowPlaying.status.innerText = "STANDBY / OFFLINE";
        ui.playDisabled = true;
        ui.nextDisabled = true; 
        ui.prevDisabled = true;
    }

        
        
        const clickPrev = `onmousedown="uiTransport('${device.ip}', 'PREV_TRACK')"`;
        const clickPlay = `onmousedown="uiTransport('${device.ip}', 'PLAY_PAUSE')"`;
        const clickNext = `onmousedown="uiTransport('${device.ip}', 'NEXT_TRACK')"`;

            
        const dis = (val) => val ? 'disabled' : ''; // Utility for HTML attributes
        //const cls = (val) => val ? 'btn-disabled' : '';



        nowPlaying.controls.innerHTML = `
            <button class="btn-secondary np-controls prev ${ui.prevClass}" ${dis(ui.prevDisabled)} ${clickPrev}>
                <svg class="control-icon icon-backwards" id="Icons" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
                 viewBox="0 0 32 32" xml:space="preserve">
                <path d="M26.6,15.2l-9-7c-0.3-0.2-0.7-0.3-1.1-0.1C16.2,8.3,16,8.6,16,9v5L8.6,8.2C8.3,8,7.9,7.9,7.6,8.1C7.2,8.3,7,8.6,7,9v14
                    c0,0.4,0.2,0.7,0.6,0.9C7.7,24,7.9,24,8,24c0.2,0,0.4-0.1,0.6-0.2L16,18v5c0,0.4,0.2,0.7,0.6,0.9C16.7,24,16.9,24,17,24
                    c0.2,0,0.4-0.1,0.6-0.2l9-7c0.2-0.2,0.4-0.5,0.4-0.8S26.9,15.4,26.6,15.2z"/>
                </svg>
            </button>
            <button class="btn-secondary np-controls play ${ui.playClass}" ${dis(ui.playDisabled)} ${clickPlay}>
            <svg class="control-icon icon-play" version="1.1" id="Icons" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
                 viewBox="0 0 32 32" xml:space="preserve">
                <path d="M21.6,15.2l-9-7c-0.3-0.2-0.7-0.3-1.1-0.1C11.2,8.3,11,8.6,11,9v14c0,0.4,0.2,0.7,0.6,0.9C11.7,24,11.9,24,12,24
                    c0.2,0,0.4-0.1,0.6-0.2l9-7c0.2-0.2,0.4-0.5,0.4-0.8S21.9,15.4,21.6,15.2z"/>
            </svg>
            </button>
            <button class="btn-secondary np-controls next ${ui.nextClass}" ${dis(ui.nextDisabled)} ${clickNext}>
                <svg class="control-icon icon-forward" id="Icons" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
                 viewBox="0 0 32 32" xml:space="preserve">
                    <path d="M26.6,15.2l-9-7c-0.3-0.2-0.7-0.3-1.1-0.1C16.2,8.3,16,8.6,16,9v5L8.6,8.2C8.3,8,7.9,7.9,7.6,8.1C7.2,8.3,7,8.6,7,9v14
                        c0,0.4,0.2,0.7,0.6,0.9C7.7,24,7.9,24,8,24c0.2,0,0.4-0.1,0.6-0.2L16,18v5c0,0.4,0.2,0.7,0.6,0.9C16.7,24,16.9,24,17,24
                        c0.2,0,0.4-0.1,0.6-0.2l9-7c0.2-0.2,0.4-0.5,0.4-0.8S26.9,15.4,26.6,15.2z"/>
                </svg>
            </button>
        `;
}
         /*       <svg height="800px" width="800px" id="Icons" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
                 viewBox="0 0 32 32" xml:space="preserve">
                    <g>
                        <path d="M14,8H9C8.4,8,8,8.4,8,9v14c0,0.6,0.4,1,1,1h5c0.6,0,1-0.4,1-1V9C15,8.4,14.6,8,14,8z"/>
                        <path d="M23,8h-5c-0.6,0-1,0.4-1,1v14c0,0.6,0.4,1,1,1h5c0.6,0,1-0.4,1-1V9C24,8.4,23.6,8,23,8z"/>
                    </g>
                </svg>
         */


const nowPlayingFooter =  /*html*/ `
    <footer class="np-view">
        <div id="np-card" class="np-card">
            <div class="np-column">
                <div id="np-img" class="np-img np-art art-off"><img src="" alt="" style="display: none;"></div>
                
                <div id="np-info" class="np-info np-infos">
                    <div id="np-track" class="np-track">Loading...</div>
                    <div id="np-artist" class="np-artist">Loading...</div>
                    <div id="np-album" class="np-album">Loading...</div>
                    <div id="np-timer" class="np-timer"></div>
                </div>
            </div>
            <div class="np-column">
                <div id="np-controls" class="np-controls-wrapper">              
                </div>
            </div>
            
            <div class="np-column">
                <div id="np-status" class="np-status np-status-badge">CONNECTING</div>
                
                <div class="speaker-select">
                    <div class="custom-dropdown-wrapper">
                        
                        <select id="global-speaker" class="mini-select" onchange="handleSpeakerChange()">
                            <option value="">Loading...</option>
                        </select>
                    </div>
                </div>                
            </div>
        </div>
    </footer>
`




// ======================================================
// 2. LOGIC ENGINE (UI Calculation)
// ======================================================
// Converts raw device data into display-ready properties (classes, disabled states, text).
async function calculateUi(device) {
    // Determines if the device is a "Slave" in a multi-room group.
/*     if (!device) {

        const select = document.getElementById('global-speaker');
        const targetIp = select.selectedOptions[0].getAttribute('data-ip');
        const devices = await api('/api/status');
    
        if (Array.isArray(devices)) {
            const device = devices.find(device => device.ip === targetIp);
        }
    } */

    const isSlave = (device.zone && device.zone.master && device.zone.master !== device.mac);
    let masterIp = null;
    let effectiveDevice = device; 
    let effectiveLock = LockManager.get(device.ip);
    // console.log(`device.zone: ${device.zone}`);

    // If Slave, it attempts to inherit metadata (Art, Artist) from the Master.
    if (isSlave) {
        const master = currentDevices.find(d => d.mac === device.zone.master);
        if (master) {
            masterIp = master.ip;
            effectiveDevice = master; // Use Master's data for display
            // Slave inherits Master's locks if they exist.
            const masterLock = LockManager.get(master.ip);
            if (masterLock)
                effectiveLock = masterLock;
        }
    }

    // Initializes the base UI object.
    let ui = {
        isStandby: effectiveDevice.isStandby,
        track: effectiveDevice.track || effectiveDevice.source,
        artist: effectiveDevice.artist,
        art: effectiveDevice.art,
        artPlaceholder: effectiveDevice.artPlaceholder || 'art-off', 
        pwrClass: !effectiveDevice.isStandby ? 'on' : '',          
        playClass: '',          
        prevClass: '', 
        nextClass: '', 
        joinClass: '',
        presetNum: effectiveDevice.activePreset,          
        playDisabled: true, 
        nextDisabled: true, 
        prevDisabled: true,          
        volDisabled: device.isStandby, 
        joinDisabled: false, 
        presetDisabled: false,
        sourceAuxDisabled: false,
        sourceBluetoothDisabled: false,
        sourceWifiDisabled: false
    };

    // --- NATIVE STATE HANDLING ---
    // Sets the color of the Play/Pause button based on playback state.
    if (effectiveDevice.playStatus === 'PLAY_STATE') {
        ui.playClass = 'btn-active'; // Green (Playing)
    } else if (effectiveDevice.playStatus === 'PAUSE_STATE') {
        ui.playClass = 'btn-pending'; // Yellow (Paused)
    } else {
        ui.playClass = ''; // Gray (Stopped)
    }

    // Special handling for Slaves waiting for Master synchronization.
    if (isSlave && masterIp) {
        const master = currentDevices.find(d => d.ip === masterIp);
        if (!master) {
            ui.track = "Joining..."; 
            ui.artist = ""; 
            ui.art = "";
        }
    }

    // Fallback for missing metadata using the ContentItem source.
    if (effectiveDevice.ContentItem && (effectiveDevice.ContentItem.source === 'Ready' || effectiveDevice.ContentItem.source === 'Paused')) {
        ui.track = effectiveDevice.ContentItem.source;
    }

    // --- ENABLE CONTROLS RULE ---
    // Controls are enabled if the device is Playing OR Paused (virtual state).
    if ((effectiveDevice.playStatus === 'PLAY_STATE' || effectiveDevice.playStatus === 'PAUSE_STATE') && !effectiveDevice.isStandby) {
        ui.playDisabled = false;
        
        // 🛑 THE RADIO CHECK: Is this a live stream or custom URL?
        const mType = (effectiveDevice.mediaType || '').toLowerCase();
        const provider = (effectiveDevice.provider || '').toLowerCase();
        
        // Trap any known radio sources (TuneIn, Built-in Custom URLs, or Radio tags)
        const isRadio = mType.includes('radio') || mType.includes('custom') || 
                        provider.includes('tunein') || provider.includes('builtin') || 
                        !!effectiveDevice.stationName;
        
        // Prev/Next buttons are disabled while Paused OR if playing a Radio stream.
        if (effectiveDevice.playStatus === 'PAUSE_STATE' || isRadio) {
            ui.nextDisabled = true; 
            ui.prevDisabled = true;
        } else {
            ui.nextDisabled = false; 
            ui.prevDisabled = false;
        }
    }

    // --- STANDBY RULE ---
    // If the device is Off, all transport controls are disabled.
    if (ui.isStandby) {
        ui.track = "Off"; 
        ui.artist = ""; 
        ui.art = "";           
        ui.playDisabled = true; 
        ui.nextDisabled = true; 
        ui.prevDisabled = true;
        ui.volDisabled = true; 
        ui.joinDisabled = false; 
        ui.presetDisabled = false;
        ui.sourceAuxDisabled = false;
        ui.sourceBluetoothDisabled = false;
        ui.sourceWifiDisabled = false;
        ui.presetNum = 0; 
    }

    // 3. APPLY LOCKS (User Interaction Overrides)
    // Checks for active locks and forces the UI to match the user's expected state.
    if (effectiveLock) {
        if (effectiveLock.type === 'POWER' && effectiveLock.val === 'OFF') {
            ui.isStandby = true; 
            ui.pwrClass = ''; 
            ui.playDisabled = true; 
            ui.nextDisabled = true; 
            ui.prevDisabled = true;
            ui.joinDisabled = false; 
            ui.presetDisabled = false; 
            ui.volDisabled = true;
            ui.sourceAuxDisabled = false;
            ui.sourceBluetoothDisabled = false;
            ui.sourceWifiDisabled = false; 
            ui.presetNum = 0;
            ui.art = ""; 
            ui.track = "Off"; 
            ui.artist = ""; 
            ui.playClass = ''; 
            ui.artPlaceholder = 'art-off';
        } else if (effectiveLock.type === 'POWER' && effectiveLock.val === 'ON') {
            ui.isStandby = false;
            ui.pwrClass = 'on';
            ui.playDisabled = true;
            ui.nextDisabled = true;
            ui.prevDisabled = true;
            ui.volDisabled = false;
            ui.sourceAuxDisabled = false;
            ui.sourceBluetoothDisabled = false;
            ui.sourceWifiDisabled = false; 
            ui.presetNum = 0;
            ui.art = "";
            ui.track = "Ready";
            ui.artist = "";
            ui.playClass = '';
            ui.artPlaceholder = 'art-off';
        } else if (effectiveLock.type === 'PRESET') {
            ui.isStandby = false;
            ui.pwrClass = 'on';
            ui.presetNum = effectiveLock.val;
            ui.playDisabled = true;
            ui.nextDisabled = true;
            ui.prevDisabled = true;
            ui.volDisabled = false;
            ui.sourceAuxDisabled = false;
            ui.sourceBluetoothDisabled = false;
            ui.sourceWifiDisabled = false; 
            ui.art = "";
            ui.track = "Loading...";
            ui.artist = "";
            ui.playClass = '';
            ui.artPlaceholder = 'art-off';
        } else if (effectiveLock.type === 'TRANSPORT') {
            if (effectiveLock.val === 'PLAY_PAUSE') {
                // Optimistic toggling of the Play button color.
                if (effectiveLock.expected === 'NOT_PLAYING') {
                    ui.playClass = 'btn-pending'; // Yellow (Expect Pause)
                    ui.playDisabled = false;
                    ui.nextDisabled = true;
                    ui.prevDisabled = true;
                    ui.sourceAuxDisabled = true;
                    ui.sourceBluetoothDisabled = true;
                    ui.sourceWifiDisabled = true; 
                } else {
                    ui.playClass = 'btn-active'; // Green (Expect Play)
                    ui.playDisabled = false;
                    ui.nextDisabled = true;
                    ui.prevDisabled = true;
                    ui.sourceAuxDisabled = true;
                    ui.sourceBluetoothDisabled = true;
                    ui.sourceWifiDisabled = true; 
                }
            } else if (effectiveLock.val === 'PREV_TRACK') {
                ui.prevClass = 'btn-pending';
                ui.playClass = 'btn-pending';
                ui.playDisabled = true;
                ui.nextDisabled = true;
                ui.prevDisabled = false;
                ui.sourceAuxDisabled = true;
                ui.sourceBluetoothDisabled = true;
                ui.sourceWifiDisabled = true; 
            } else if (effectiveLock.val === 'NEXT_TRACK') {
                ui.nextClass = 'btn-pending';
                ui.playClass = 'btn-pending';
                ui.playDisabled = true;
                ui.prevDisabled = true;
                ui.nextDisabled = false;
                ui.sourceAuxDisabled = true;
                ui.sourceBluetoothDisabled = true;
                ui.sourceWifiDisabled = true; 
            }
        } else if (effectiveLock.type === 'JOIN') {
            ui.isStandby = false;
            ui.pwrClass = 'on';
            ui.joinClass = 'btn-master-join';
            ui.presetNum = 0;
            ui.presetDisabled = false;
            ui.volDisabled = false;
            ui.playDisabled = true;
            ui.nextDisabled = true;
            ui.prevDisabled = true;
            ui.sourceAuxDisabled = false;
            ui.sourceBluetoothDisabled = false;
            ui.sourceWifiDisabled = false; 
            ui.playClass = '';
            ui.art = "";
            ui.track = "Joining...";
            ui.artist = "";
            ui.artPlaceholder = 'art-off';
        }
    }

    // Hard override: Slaves effectively have disabled transport controls.
    if (isSlave) {
        ui.playDisabled = true;
        ui.nextDisabled = true;
        ui.prevDisabled = true;
        ui.presetDisabled = true;
        ui.sourceAuxDisabled = true;
        ui.sourceBluetoothDisabled = true;
        ui.sourceWifiDisabled = true; 
    }

    return ui;
}


    // Wrapper for sending commands that automatically pauses polling to prevent UI jitter.
async function sendCommand(url, body) {
    isPollingFrozen = true;
    try {
        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        await new Promise(r => setTimeout(r, POLLING_DELAY));
    } catch (e) {
        console.error(e);
    } finally {
        isPollingFrozen = false;
        await loadDeviceStatus();
    }
}

    // Handles Transport controls (Play/Pause/Next/Prev).
function uiTransport(ip, key) {
    const device = currentDevices.find(d => d.ip === ip);
    let expected = null;

    // Toggles the expected state for Play/Pause button logic.
    if (key === 'PLAY_PAUSE') {
        const lock = LockManager.get(ip);
        // If a lock already exists, toggle the expectation.
        if (lock && lock.type === 'TRANSPORT' && lock.val === 'PLAY_PAUSE' && lock.expected === 'NOT_PLAYING') {
            expected = 'PLAYING';
        } else if (device.playStatus === 'PLAY_STATE') {
            expected = 'NOT_PLAYING';
        } else {
            expected = 'PLAYING';
        }
    }
    LockManager.set(ip, 'TRANSPORT', key, expected);
    sendCommand('/api/key', {
        ip,
        key
    });
}






let selectedSpeaker2 = readUrlFilter("speaker");

let speakerSelectState = {
    speaker: selectedSpeaker2
};

window.onload = async function () {
    await fetchSpeakers();
    await startNpPolling();
}

window.addEventListener("popstate", () => {
  // Aktuellen Tab aus der geänderten URL auslesen oder Fallback nutzen
  const currentTab = readUrlFilter("tab") || "library";
  const currentSpeaker = readUrlFilter("speaker");
  console.log("popstat");
  // UI umschalten, aber das Update der URL blockieren (da der Browser das schon tat)
  newSwitchTab(currentTab, false);
  //selectSpeakerByFilter(currentSpeaker);
});

 function readUrlFilter(filterName) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(filterName);
 }

  function updateUrlFilter(filterName, filterValue, replaceState = false) {
    const url = new URL(window.location.href);
    url.searchParams.set(filterName, filterValue);
    if (!replaceState) {
        history.pushState({}, '', url.href);
    } else {
        history.replaceState({}, '', url.href);
        
    }
  }

async function api(url, options = {}) {
  try {
      const res = await fetch(url, {
          headers: {
              'Content-Type': 'application/json'
          },
          ...options
      });
      return await res.json();
  } catch (e) {
      console.error("API Error:", e);
      return {
          error: e.message
      };
  }
}

async function fetchSpeakers() {
    const select = document.getElementById('global-speaker');
  
    try {
        const [maPlayers, stDevices] = await Promise.all([
                    api('/api/manager/players'),
                    api('/api/status')
                ]);

        if (!stDevices || !stDevices.length) {
            select.innerHTML = '<option value="">No Speakers</option>';
            return;
        }

        // 1. OUTER JOIN: Uses stDevices (speakers.json) as the master list.
        const options = stDevices.map(d => {
            const p = maPlayers ? maPlayers.find(mp => mp.ip === d.ip) : null;

            const isPlaying = (d.playStatus === 'PLAY_STATE' || d.playStatus === 'BUFFERING_STATE');
            const isOffline = !d.online;
            const isMissingFromMass = !p;

            let icon = '';
            let colorClass = '';

            // Determine Icons & Classes
            if (isOffline) {
                icon = ' 🔴';
                colorClass = 'class="status-offline"';
            } else if (isMissingFromMass) {
                icon = ' 🔇';
                colorClass = 'class="status-missing"';
            } else if (isPlaying) {
                icon = ' 🎵';
            }

            const finalLabel = `${d.name}${icon}`;

            // --- THE FILTERS ---
            const isStereoRight = (d.stereoRole === 'RIGHT');
            let playDisabledAttr = '';
            if (isOffline || isMissingFromMass) {
                playDisabledAttr = `disabled ${colorClass}`;
            } else if (isStereoRight) {
                playDisabledAttr = `disabled style="color: var(--text-secondary); font-style: italic;"`;
            }

            const playValue = p ? p.id : '';
            const editStyleAttr = colorClass ? `${colorClass}` : '';

            return {
                htmlId: `<option value="${playValue}" data-ip="${d.ip}" data-mac="${d.mac}" data-playing="${isPlaying}" ${playDisabledAttr}>${finalLabel}</option>`,
                htmlIp: `<option value="${d.ip}" data-id="${playValue}" data-ip="${d.ip}" data-mac="${d.mac}" ${editStyleAttr}>${finalLabel}</option>`,
                isPlaying: isPlaying,
                id: playValue,
                mac: d.mac,
                isPlayable: (!isOffline && !isMissingFromMass && !isStereoRight)
            };
        });

        select.innerHTML = options.length ? options.map(o => o.htmlId).join('') : '<option value="">No Configured Speakers Found</option>';

        const ipOptionsHtml = options.map(o => o.htmlIp).join('');

        const viewFilter = document.getElementById('preset-view-filter');
        if (viewFilter) {
            const currentVal = viewFilter.value;
            viewFilter.innerHTML = `<option value="global">Global (Default)</option>${ipOptionsHtml}`;
            if (currentVal)
                viewFilter.value = currentVal;
        }

        const editFilter = document.getElementById('edit-speaker');
        if (editFilter) {
            const currentEditVal = editFilter.value;
            editFilter.innerHTML = `<option value="">Global (All Speakers)</option>${ipOptionsHtml}`;
            if (currentEditVal)
                editFilter.value = currentEditVal;
        }

        // 2. AUTO-SELECT LOGIC
        const playableOptions = options.filter(o => o.isPlayable);
        const activeSpeaker = playableOptions.find(o => o.isPlaying);

        // Wir suchen genau das Objekt, bei dem die MAC mit state.speaker übereinstimmt
        const matchedSpeaker = playableOptions.find(o => o.mac === speakerSelectState.speaker);


        // ICH JULIUS Versuche hier auf die mac adress zu prüfen NICHTS VERÄNDERN BITTE!!
        if (speakerSelectState.speaker != null && matchedSpeaker) {
            select.value = matchedSpeaker.id;
            saveSpeakerSelection();
        } else {
            // Dieser Teil exsetierte schon vorher
            if (activeSpeaker) {
                select.value = activeSpeaker.id;
                saveSpeakerSelection();

            } else {
                const saved = localStorage.getItem('bose_active_speaker');
                if (saved && Array.from(select.options).some(o => o.value === saved && !o.disabled)) {
                    select.value = saved;
                } else {
                    const firstValid = Array.from(select.options).find(o => !o.disabled && o.value !== "");
                    if (firstValid) {
                        select.value = firstValid.value;
                        saveSpeakerSelection();
                    }
                }
            }
        }


        await loadNowPlaying();

    } catch (e) {
        console.log("Error Fetching Speaker: ", e);
        select.innerHTML = '<option>Error Loading</option>';
    }
}
    function saveSpeakerSelection() {
        const select = document.getElementById('global-speaker');

        
        /* console.log(speaker); */
        // Erst den normalen Value für den localStorage speichern
        localStorage.setItem('bose_active_speaker', select.value);
        
        // Prüfen, ob überhaupt eine Option ausgewählt ist und ein Wert existiert
        let replaceState;
        if (select.selectedIndex !== -1 && select.value) {
            // Über selectedOptions[0] greifen wir direkt auf die aktive Option zu
            const macAddress = select.selectedOptions[0].dataset.mac;

            // Jetzt schreiben wir die gefundene MAC in den URL-Filter
            updateUrlFilter("speaker", macAddress, replaceState = true);
        }
    }


    // Called when user manually changes the dropdown.
    function handleSpeakerChange() {
        saveSpeakerSelection();
        // If viewing the Now Playing tab, refresh immediately to show the new speaker's status.
        loadNowPlaying();
    }




// --- GITHUB UPDATE BANNER HTML ---
const updateBannerHTML =  /*html*/`
<div id="github-update-banner" class="banner banner-update">
    🚀 <strong>Update Available!</strong> Version <span id="update-version-text"></span> is out.
    <a id="update-link" class="banner-link" href="#" target="_blank">View Release Notes & Update</a>
    <button id="update-dismiss-btn" class="banner-button">Dismiss</button>
</div>
`;

// dismiss for the current session
window.dismissUpdateBanner = function (versionToDismiss) {
  document.getElementById("github-update-banner").style.display = "none";
  // Save to sessionStorage wipes when closed.
  localStorage.setItem("dismissedUpdateVersion", versionToDismiss);
};

// Function to ping the backend and check for updates
async function checkForUpdates() {
  try {
    const res = await fetch(`/api/check_update?t=${Date.now()}`, {
      cache: "no-store",
    });
    const data = await res.json();

    if (data.updateAvailable) {
      // Check the SESSION memory to see if we dismissed it during this active use
      const skippedVersion = localStorage.getItem("dismissedUpdateVersion");

      if (skippedVersion !== data.latest) {
        const banner = document.getElementById("github-update-banner");
        document.getElementById("update-version-text").innerText = data.latest;
        document.getElementById("update-link").href = data.url;

        document.getElementById("update-dismiss-btn").onclick = () =>
          dismissUpdateBanner(data.latest);

        banner.style.display = "block";
      }
    }
  } catch (e) {
    console.error("Failed to check for updates:", e);
  }
}

// --- UNIFIED MASS HEALTH MODAL HTML ---
const maHealthBannerHTML = /*html*/`
<div id="mass-error-banner">
    <div class="banner-header">
        <span class="banner-title">🚨 Music Assistant Error</span>
        <button class="banner-close" onclick="dismissHealthModal()">&times;</button>
    </div>
    <div class="banner-body">
        Music Assistant reported a playback failure. How to fix it:
        <ul>
            <li>
                <strong>Invalid Media (Empty album, dead stream):</strong><br>
                No restart needed. <strong>Dismiss</strong> this message. It will clear on next successful playback.
            </li>
            <li>
                <strong>Dropped DLNA/AirPlay Socket:</strong><br>
                The speaker connection dropped. Try a quick <strong>Reload DLNA & AirPlay</strong> first.
            </li>
            <li>
                <strong>Server Locked Up:</strong><br>
                If reconnecting fails, you must do a full <strong>Restart Service</strong>.
            </li>
        </ul>
    </div>
    <div class="banner-actions">
        <button class="btn-dismiss banner-button banner-button--success" onclick="dismissHealthModal()">✅ Dismiss</button>
        <button class="btn-reconnect banner-button" onclick="executeGlobalRecovery(this)">🚨 Reload DLNA & AirPlay</button>
        <button class="btn-restart banner-button" onclick="executeGlobalRestart(this)">Restart Service</button>
    </div>
</div>
`;

// --- UNIFIED RECOVERY LOGIC ---
async function executeGlobalRecovery(btn) {
    const orig = btn.innerText;
    btn.innerText = "Reloading...";
    btn.disabled = true;

    try {
      // Aggressively Reload DLNA
      await fetch("/api/admin/rescan_ma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aggressive: true, provider: "dlna" }),
      });

      // Aggressively Reload AirPlay
      await fetch("/api/admin/rescan_ma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aggressive: true, provider: "airplay" }),
      });

      await fetch("/api/health/reset", { method: "POST" });
      btn.innerText = "✅ Sent";
      setTimeout(() => {
        dismissHealthModal();
      }, 1500);
    } catch (e) {
      btn.innerText = "❌ Error";
      setTimeout(() => {
        btn.innerText = orig;
        btn.disabled = false;
      }, 3000);
    }
}

// Global hook to restart the docker container
async function executeGlobalRestart(btn) {
  if (
    !confirm(
      "Are you sure you want to completely restart the Music Assistant container?",
    )
  )
    return;
  const orig = btn.innerText;
  btn.innerText = "Restarting...";
  btn.disabled = true;
  window.isMaRestartingProcess = true; // Lock the UI loops

  try {
    await fetch("/api/admin/restart_ma", { method: "POST" });
    await fetch("/api/health/reset", { method: "POST" });

    btn.innerText = "✅ Sent";
    setTimeout(() => {
      dismissHealthModal();
      window.isMaRestartingProcess = false; // Unlock after command clears
    }, 1500);
  } catch (e) {
    btn.innerText = "❌ Error";
    setTimeout(() => {
      btn.innerText = orig;
      btn.disabled = false;
      window.isMaRestartingProcess = false;
    }, 3000);
  }
}

function dismissHealthModal() {
  const banner = document.getElementById("mass-error-banner");
  if (banner) {
    banner.style.display = "none";
    banner.dataset.dismissed = "true";
    banner.style.transform = "";
    banner.style.left = "";
    banner.style.top = "";
  }

  // Tell the backend we are ignoring the error so it stops bugging us
  fetch("/api/health/reset", { method: "POST" }).catch(() =>
    console.log("Health reset suppressed"),
  );
}

// Inject the banner HTML into the DOM as soon as the page loads
document.addEventListener("DOMContentLoaded", () => {
  // BUG FIX: Changed from boseMassBannerHTML to the correct maHealthBannerHTML
  document.body.insertAdjacentHTML("afterbegin", maHealthBannerHTML);
  document.body.insertAdjacentHTML("afterbegin", updateBannerHTML);
  document.querySelector(".app-container").insertAdjacentHTML("beforeend", nowPlayingFooter);
  startNpPolling();
  makeBannerDraggable();
  checkForUpdates();
});

window.isMaRestartingProcess = false;

// --- MUSIC ASSISTANT HEALTH MONITOR (Runs every 5 seconds) ---
// This loop constantly checks if the Music Assistant backend is healthy.
setInterval(async () => {
  // STEP 1: Safety Check
  // If a restart or reconnect process is ALREADY happening, skip this check.
  if (window.isMaRestartingProcess) return;

  try {
    // STEP 2: Ping the Health Endpoint
    // append a timestamp (?t=...) to prevent the browser from caching an old response.
    const res = await fetch(`/api/health?t=${Date.now()}`, {
      cache: "no-store",
    });
    const h = await res.json();
    const banner = document.getElementById("mass-error-banner");

    // STEP 3: Handle Unhealthy State (Connection Lost)
    if (h && h.healthy === false) {
      // Because the backend gatekeeper now intercepts auto-restarts silently,
      // if this returns false, it means the user WANTS to see the manual banner!
      if (
        banner &&
        banner.style.display !== "flex" &&
        !banner.dataset.dismissed
      ) {
        banner.style.display = "flex";
      }
    } else {
      // STEP 4: Handle Healthy State (Recovery Successful)
      if (banner) {
        banner.style.display = "none";
        banner.dataset.dismissed = ""; // Reset for next time
      }
    }
  } catch (e) {
    // Catch network errors silently to prevent console spam if the server goes completely offline.
  }
}, 5000);

function makeBannerDraggable() {
  const banner = document.getElementById("mass-error-banner");
  if (!banner) return;
  const header = banner.querySelector(".banner-header");
  if (!header) return;

  header.style.cursor = "grab";
  let pos1 = 0,
    pos2 = 0,
    pos3 = 0,
    pos4 = 0;

  header.onmousedown = dragMouseDown;
  header.ontouchstart = dragTouchStart;

  function prepareDrag() {
    if (banner.style.transform !== "none") {
      const rect = banner.getBoundingClientRect();
      banner.style.transform = "none";
      banner.style.left = rect.left + "px";
      banner.style.top = rect.top + "px";
      banner.style.margin = "0";
    }
    header.style.cursor = "grabbing";
  }

  function dragMouseDown(e) {
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
    prepareDrag();
  }
  function dragTouchStart(e) {
    const touch = e.touches[0];
    pos3 = touch.clientX;
    pos4 = touch.clientY;
    document.ontouchend = closeDragElement;
    document.ontouchmove = elementTouchDrag;
    prepareDrag();
  }
  function elementDrag(e) {
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    banner.style.top = banner.offsetTop - pos2 + "px";
    banner.style.left = banner.offsetLeft - pos1 + "px";
  }
  function elementTouchDrag(e) {
    const touch = e.touches[0];
    pos1 = pos3 - touch.clientX;
    pos2 = pos4 - touch.clientY;
    pos3 = touch.clientX;
    pos4 = touch.clientY;
    banner.style.top = banner.offsetTop - pos2 + "px";
    banner.style.left = banner.offsetLeft - pos1 + "px";
  }
  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
    document.ontouchend = null;
    document.ontouchmove = null;
    header.style.cursor = "grab";
  }
}

// --- GLOBAL SYSTEM ACTIONS ---
window.triggerGlobalAllOff = async function() {
    if(!confirm("Turn off ALL speakers?")) return;

    const btns = document.querySelectorAll('.btn-all-off');
    btns.forEach(b => b.style.opacity = '0.5');

    try {
        // 1. Fetch current states to know who is currently ON
        const res = await fetch('/api/status');
        const devices = await res.json();

        // 2. OPTIMISTIC UI (Adapts to current page)
        // -> If user is on control.html
        if (typeof window.isPollingFrozen !== 'undefined') {
            window.isPollingFrozen = true;
        }
        if (window.LockManager && window.currentDevices) {
            window.currentDevices.forEach(d => {
                if (!d.isStandby) window.LockManager.set(d.ip, 'POWER', 'OFF');
            });
        }
        // -> If user is on admin.html
        devices.forEach(d => {
            const pwrBtn = document.getElementById(`pwr-${d.ip}`);
            const modeBadge = document.getElementById(`mode-${d.ip}`);
            if (pwrBtn && !d.isStandby) {
                pwrBtn.className = 'pwr-off'; 
                pwrBtn.innerText = 'OFF';
                if (modeBadge) modeBadge.innerText = '(STANDBY)';
            }
        });

        // 3. FILTER: Command only Masters and Standalone speakers
        const onDevices = devices.filter(d => {
            const isSlave = (d.zone && d.zone.master && d.zone.master !== d.mac);
            return !d.isStandby && !isSlave;
        });

        // 4. Send individual POWER keys
        for (const d of onDevices) {
            await fetch('/api/key', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({ ip: d.ip, key: 'POWER' }) 
            });
        }

        // Wait 1.5s for hardware to process (Matches the individual toggle delay)
        await new Promise(r => setTimeout(r, 1500));

        // 5. Unfreeze and Quietly Refresh specific elements
        if (typeof window.isPollingFrozen !== 'undefined') {
            window.isPollingFrozen = false;
        }

        // Quietly fetch individual states instead of nuking the grid with loadAdmin()
        if (typeof window.fetchDeviceState === 'function') {
            devices.forEach(d => window.fetchDeviceState(d.ip));
        } else if (typeof window.loadStatus === 'function') {
            await window.loadDeviceStatus();
        }
    } catch (e) {
        console.error("Failed to power off speakers", e);
    } finally {
        btns.forEach(b => b.style.opacity = '1');
    }
};

loadDeviceStatus();

